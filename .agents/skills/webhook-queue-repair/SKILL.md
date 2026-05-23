---
name: webhook-queue-repair
description: Diagnose and repair stuck or failed backend jobs, webhook deliveries, and queue work across Pitch's Telnyx, QBO/QXO, SRS, AI worker, mobile upload, and campaign automation surfaces. Auto-loads on any request about stuck jobs, pending/processing rows older than threshold, failed or duplicate webhooks, replayed/duplicate event IDs, poison jobs, dead-letter queues, retry storms, exponential backoff, provider outages (Telnyx/QBO/SRS down), webhook signature failures, missing company_id/tenant_id on queue rows, cron poller catch-up, or "why didn't this job/webhook fire".
---

# Webhook Queue Repair

This skill turns a noisy backend into a deterministic queue health audit. It never silently retries production jobs. It classifies, proposes, then waits for approval.

## Scope

Surfaces this skill owns:

- Telnyx call/SMS webhooks and the unified inbox triggers
- QBO / QXO / SRS Distribution webhooks and order-status pollers
- SRS `/orders/v2/submit` queued→accepted promotion (see Core memory)
- AI measurement, AI invoice, AI answering job queues
- Mobile photo upload queue and any IndexedDB→server reconciliation
- Campaign / automation worker (`automation-processor`, text blasts, email sequences)
- Any cron job calling `net.http_post` from `pg_cron`
- `pdf_operations` recompile workers
- Any table with `status in ('pending','processing','queued','failed','dead')`

Out of scope: business logic rewrites, schema redesigns, new queue libraries. Use the Edge Function Consolidator skill for "should this be a worker" questions.

## Hard rules

1. **Never bulk-retry without classification.** A retry on a poison job amplifies the outage.
2. **Idempotency is sacred.** Never replay a webhook unless the consumer dedupes by provider event ID. If no dedupe column exists, flag it — do not retry.
3. **Tenant safety.** Any queue/webhook row missing `tenant_id`/`company_id` is quarantined, never retried. Per project Core memory, multi-tenant isolation is non-negotiable.
4. **SRS contract.** HTTP 200 from `/orders/v2/submit` with `queueID===orderID` or "Queued" message is NOT acceptance. Never mark such rows `accepted` from this skill — only the poller/webhook may.
5. **Stable webhook URLs.** Never rename a webhook function. Repair in place.
6. **No destructive deletes.** Quarantine = move to `*_dead` table or set `status='quarantined'` with reason. Never `DELETE FROM` queue tables in repair migrations.
7. **Time-bound everything.** Every classification carries an age threshold and a sample count. No vibes.

## Eight Gates

Run all eight. Skip none. Each gate produces a row count, a sample (≤5 rows redacted), and a recommended action. Output only — do not execute.

### Gate 1 — Inventory queue & webhook surfaces
Enumerate every table/function that looks like a queue or webhook log:
- Tables with columns matching `(status, attempts|retry_count, next_attempt_at|scheduled_at, last_error, provider_event_id|external_id|telnyx_*_id|qbo_*_id)`
- Edge functions whose name contains `webhook|callback|hook|process|worker|poll|tick|retry|dispatch`
- `pg_cron` jobs (`select jobname, schedule, command from cron.job`)
- Realtime broadcast channels used as queues

Output: table of surfaces with row volume and last-activity timestamp.

### Gate 2 — Stuck `processing` jobs
Rows in `status='processing'` (or equivalent) with `updated_at < now() - interval '15 minutes'` AND no heartbeat. These are workers that crashed mid-run.

Recommended action: requeue → `status='pending'`, `attempts=attempts` (do not increment), append `last_error='reaped: stuck processing > 15m'`. Only if the consumer is idempotent. Otherwise quarantine.

### Gate 3 — Old `pending` jobs
Rows in `status='pending'|'queued'` with `created_at < now() - interval '1 hour'` and `next_attempt_at < now()`. Means the worker/cron is not picking them up.

Diagnose: is the cron job enabled? Is the function deployed? Are there auth/CORS errors in edge logs? Report root cause, do not just retry.

### Gate 4 — Failed webhook deliveries
For inbound webhooks: look for rows where signature verification failed, or where the handler 5xx'd. For outbound (we POST to QBO/SRS/Telnyx): look for non-2xx response codes in the audit log.

Bucket by:
- Signature/auth failure → likely secret rotation or wrong endpoint. Never auto-retry; ask user to confirm secret.
- 4xx from us → bug. Quarantine, file as defect.
- 5xx from provider → retryable with exponential backoff, capped attempts.
- Timeout → retryable, but check provider status page first.

### Gate 5 — Duplicate provider event IDs
For each webhook table with a `provider_event_id|external_id|telnyx_event_id|qbo_event_id|stripe_event_id` column: count duplicates.

- Duplicates with same payload hash → consumer is missing a unique index. Recommend `CREATE UNIQUE INDEX CONCURRENTLY` on `(provider, event_id)`.
- Duplicates with different payloads → provider is replaying; consumer must dedupe by event_id, not payload. Flag as data-integrity risk.

### Gate 6 — Poison jobs & retry storms
Rows with `attempts >= max_attempts` (or `attempts > 10` if no cap) AND repeating `last_error`. These are eating worker capacity.

Recommended action: move to `*_dead` table with full payload + error history, set `status='dead'`, stop. Never delete. Surface top 5 error signatures so the user can fix the root cause.

Also detect retry storms: any job with `attempts > 3` AND `last_attempt_at - created_at < interval '2 minutes'` — means backoff is broken.

### Gate 7 — Provider outage pattern detection
For each external provider (Telnyx, QBO, QXO, SRS, Stripe, OpenAI, Anthropic, Resend, Mapbox), compute failure rate in the last 1h, 6h, 24h windows. If 1h failure rate > 30% AND >10 attempts, declare suspected outage.

Recommended action: pause that provider's queue (set worker to skip, do not increment attempts), post a single alert row, resume after failure rate drops below 5% for 15 min. Never auto-pause without surfacing the decision.

### Gate 8 — Missing tenant_id / company_id
Per Core memory: every company-owned row must carry `tenant_id` (or `company_id` where canonical). Scan every queue/webhook table for NULL tenant scoping.

Recommended action: **quarantine all such rows immediately.** Never retry. Surface count + sample so the user can trace which producer is dropping tenant context. If the producer is a public webhook (Growth Hub lead, Telnyx inbound), recommend hardening the ingress to derive tenant from the receiving phone number / API key / route prefix.

## Output format

Produce exactly this structure:

```
# Queue & Webhook Repair Report — {timestamp}

## Summary
- Surfaces scanned: N tables, M edge functions, K cron jobs
- Stuck processing: N
- Old pending: N
- Failed webhooks (1h / 24h): N / N
- Duplicate event IDs: N rows across M tables
- Poison jobs: N
- Suspected provider outages: [list]
- Rows missing tenant_id: N  ← BLOCKING if > 0

## Gate {1..8}
- Finding: ...
- Sample (redacted): ...
- Recommended action: ...
- SQL (review-only, not executed): ...

## Proposed repair migration (review-only)
-- Single transaction per gate. Idempotent. Quarantine before retry.
-- CREATE UNIQUE INDEX CONCURRENTLY for dedupe gaps.
-- No DELETE. No bulk retry across providers.

## Open questions for the user
1. ...
```

## Refusal triggers

Refuse to proceed (and say why) if:
- User asks to "retry all failed jobs" without classification.
- User asks to delete from a queue/webhook table.
- User asks to retry rows missing `tenant_id`.
- User asks to mark SRS orders `accepted` based on submit-time 200.
- User asks to rename or merge a webhook function (defer to Edge Function Consolidator).
- No idempotency key exists on the target consumer and user wants replay.

## Repair migration ordering

When the user approves repairs, generate migrations in this order, each separately:
1. Add missing unique indexes for event-id dedupe (`CONCURRENTLY`).
2. Create `*_dead` quarantine tables where missing.
3. Move poison jobs and tenant-less rows to quarantine.
4. Reap stuck `processing` rows back to `pending` (idempotent consumers only).
5. Add/fix exponential backoff column defaults.
6. Wire missing cron jobs or fix disabled ones (use insert tool, not migration tool, per project rules).

Never combine steps. Each migration is reviewable in isolation.
