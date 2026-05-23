---
name: edge-function-consolidator
description: Audits all supabase/functions/* in the Pitch CRM project, classifies each as live / duplicate / dead / consolidate-into-router / move-to-worker-queue / move-off-Supabase, and produces a consolidation plan. Auto-loads on requests about edge function sprawl, the 500-function Supabase cap, dead/duplicate/unused functions, router-style consolidation, shared auth/tenant/logging middleware, moving polling work to cron/queue workers, or any "we have too many edge functions" cleanup.
---

# Edge Function Consolidator

Audit-only by default. NEVER delete an edge function, rename invoke paths, or merge handlers without first producing the consolidation plan below AND getting explicit user approval per function group. Live customer traffic and Telnyx/Stripe/SRS/QBO webhooks depend on stable URLs.

## When this skill applies

Triggers: "too many edge functions", "function cap", "500 limit", "dead function", "duplicate function", "consolidate functions", "router function", "worker queue", "move off Supabase", "function sprawl", "shared middleware for functions", "audit supabase/functions".

## Hard rules

1. **Stable URLs are sacrosanct.** Any function receiving webhook traffic (Telnyx, Stripe, SRS, DocuSign, QBO, Growth Hub, Mapbox, Resend, public lead intake) keeps its exact `/functions/v1/<name>` path. Consolidation happens behind it (new function delegates to shared router) — never by renaming.
2. **Delete only with proof of zero traffic.** A function is "dead" only if BOTH: (a) zero references in `src/`, `supabase/functions/*`, and any `config.toml`/cron schedule, AND (b) zero invocations in `function_edge_logs` for ≥30 days. Otherwise it's "suspect", not "dead".
3. **Never break tenant resolution.** Every consolidated/router function MUST resolve `tenant_id` via the existing `_shared/tenant.ts` (or equivalent) helper — never re-implement. Routes that today silently trust `request.body.tenant_id` are findings, not "working".
4. **Webhook idempotency preserved.** When merging webhook handlers into a router, the `UNIQUE (provider, event_id)` idempotency check must survive the merge. No router that processes the same event twice.
5. **CORS + `verify_jwt` per route, not per file.** A router exposes per-route auth requirements through a route table; the file-level `verify_jwt` config stays open-but-validated-in-code (per Lovable edge function rules).
6. **No business-logic rewrites during consolidation.** Consolidation moves code; it does not "improve" SRS submit logic, measurement gates, result_state writes, or PDF compilation. Those follow their own skills.
7. **Polling ≠ edge function.** Anything that runs on a `pg_cron` schedule or polls a queue belongs in ONE `worker-tick` function dispatched by cron, not N separate scheduled functions.
8. **Master-only diagnostic functions get one router.** Don't ship 20 admin edge functions — route them under one master-gated function.

## Canonical buckets

Every function in `supabase/functions/` MUST be classified into exactly one bucket:

| Bucket | Definition | Action |
|---|---|---|
| `live-pinned` | Public webhook target OR customer-facing endpoint with stable URL contract | Keep as-is. Refactor internals only. |
| `live-private` | Frontend-invoked via `supabase.functions.invoke(name)`, in active use | Candidate for router merge if it shares auth/tenant/logging with siblings. |
| `cron-worker` | Scheduled function (polls queue, refreshes cache, runs cleanup) | Candidate to merge into a single `worker-tick` dispatched by cron. |
| `duplicate` | Functionally equivalent to another (same inputs, same effect, different name) | Pick canonical; redirect callers; delete loser after 30 days zero traffic. |
| `dead` | Zero `src/` references AND zero invocations ≥30 days AND not in cron/webhook config | Schedule deletion via `supabase--delete_edge_functions`. |
| `consolidate-router` | Small handler that shares auth/tenant/logging with N siblings (e.g. one-off CRUD endpoints) | Merge into a router function (`crm-router`, `admin-router`, `integration-router`, etc.). |
| `move-to-queue` | Long-running, retryable, or rate-limit-sensitive (AI inference, PDF compile, mass SMS, vendor sync) | Wrap as a job: insert row in a queue table; let `worker-tick` process it. |
| `move-off-supabase` | Heavy CPU/memory, long-running (>30s), GPU, or needs persistent connection (RoofNetV3 inference, large measurement compute) | Document as out-of-scope for Supabase edge runtime; recommend external worker (Fly/Cloud Run/Lambda). NOT done in this skill — only flagged. |

## Audit checklist (run in order)

### Gate 1 — Enumerate

```bash
ls supabase/functions/ | grep -v _shared | grep -v __tests__
```

Count total. If approaching 500, raise it as a `critical` finding regardless of individual classifications.

### Gate 2 — Static reference scan

For each function `<name>`:

```bash
rg -n "functions\.invoke\(['\"]<name>['\"]" src/ supabase/functions/
rg -n "/functions/v1/<name>" src/ supabase/functions/
rg -n "['\"]<name>['\"]" supabase/config.toml
```

Capture: invoked-from-frontend? invoked-from-other-edge-function? cron-scheduled? referenced by webhook URL in any external provider config (note: provider-side config is invisible to repo grep — flag any function whose name matches `*-webhook`, `*-callback`, `receive-*`, `inbound-*` as `live-pinned` until proven otherwise).

### Gate 3 — Runtime invocation evidence

```sql
SELECT m.function_id,
       count(*) AS calls_30d,
       max(timestamp) AS last_called
FROM function_edge_logs
CROSS JOIN unnest(metadata) AS m
WHERE timestamp > now() - interval '30 days'
GROUP BY m.function_id
ORDER BY calls_30d DESC;
```

Cross-join with function name list. Zero rows for a function = candidate `dead`. Any rows = `live-*` until further analysis.

Also check error rate:

```sql
SELECT m.function_id,
       count(*) FILTER (WHERE response.status_code >= 500) AS errors_5xx,
       count(*) AS total
FROM function_edge_logs
CROSS JOIN unnest(metadata) AS m
CROSS JOIN unnest(m.response) AS response
WHERE timestamp > now() - interval '7 days'
GROUP BY m.function_id
HAVING count(*) FILTER (WHERE response.status_code >= 500) > 0
ORDER BY errors_5xx DESC;
```

High-error functions get flagged for review during consolidation, not silently merged.

### Gate 4 — Duplicate / near-duplicate detection

For functions sharing prefixes (`send-*-email`, `process-*-webhook`, `sync-*`, `get-*`, `list-*`):

1. Diff `index.ts` bodies with `rg --files-with-matches`-style heuristics.
2. Compare input shape (request body schema) and output shape.
3. Functional equivalence = same effect on DB + same response contract. Different cosmetic naming doesn't count as different.

Pairs/groups with ≥80% body overlap → `duplicate` or `consolidate-router`.

### Gate 5 — Cron / queue candidates

Read `supabase/config.toml` and any `pg_cron` schedules:

```sql
SELECT jobname, schedule, command
FROM cron.job
ORDER BY jobname;
```

Every distinct scheduled function = candidate `cron-worker`. If >3 scheduled functions exist, recommend merging into a single `worker-tick` that reads a dispatch table:

```
worker-tick (every minute via pg_cron)
  └─ dispatch_table: { job_key, last_run_at, interval, enabled }
       ├─ cleanup-expired-cache
       ├─ poll-srs-order-status
       ├─ retry-failed-webhooks
       ├─ ai-measurement-job-poller
       └─ ...
```

### Gate 6 — Move-to-queue candidates

Flag any function that:

- Calls external APIs with rate limits (Telnyx mass send, SRS submit, QBO sync, Mapbox batch geocode)
- Runs AI inference (Gemini, OpenAI, Anthropic) on more than one record per invocation
- Compiles PDFs or large documents
- Loops over more than ~50 rows

These belong as jobs in a queue table consumed by `worker-tick`, not as synchronous edge functions.

### Gate 7 — Move-off-Supabase candidates

Flag (do NOT migrate) functions that:

- Exceed 30s wall time in `function_edge_logs.execution_time_ms`
- Require GPU or >1GB memory (any roof topology/UNet/large image processing — though per project memory, UNet is not built, so this should be a future-tense recommendation)
- Maintain long-lived state or connections

Output: a "future migration" section in the report, not a deletion.

## Consolidation patterns

### Router function template (per category)

Recommended top-level routers, each with internal `path → handler` table:

- `crm-router` — contact/lead/job/pipeline CRUD that today lives in many small functions
- `admin-router` — master-only diagnostic / health / cache-bust / one-off scripts
- `integration-router` — internal sync endpoints for QBO/SRS/ABC/DocuSign (NOT the public webhook receivers — those stay pinned)
- `comms-router` — internal send-sms/send-email/initiate-call endpoints
- `worker-tick` — cron-dispatched job runner reading from a `worker_jobs` table

Each router MUST:

- Use `_shared/cors.ts`, `_shared/auth.ts`, `_shared/tenant.ts`, `_shared/logger.ts` — no inlined copies.
- Resolve `tenant_id` once at the top; pass it to every route handler.
- Log `{ route, tenant_id, user_id, ms, status }` for every request.
- Return 404 for unknown routes (never 500).
- Per-route `auth_required: boolean` and `master_only: boolean` flags enforced before handler runs.

### Webhook handlers (pinned, don't merge)

Stay as individual functions. Internally they may import shared validation/idempotency from `_shared/webhook.ts`. Do NOT merge two different providers' webhooks behind one URL — they have different signature schemes and provider-side configs.

## Output: the consolidation report

Always deliver one report with these sections:

1. **Summary counts** — total functions, by bucket, distance from 500 cap.
2. **`live-pinned`** — list, with the external system depending on each URL.
3. **`live-private`** — list, grouped by proposed router target.
4. **`cron-worker`** — list + proposed `worker-tick` dispatch entries.
5. **`duplicate`** — pairs/groups with chosen canonical and losers.
6. **`dead`** — list with last-invocation date and reference-scan evidence. Each row: "safe to delete after 30-day cooldown observation."
7. **`consolidate-router`** — proposed router files with route tables.
8. **`move-to-queue`** — list with proposed `worker_jobs.job_key` for each.
9. **`move-off-supabase`** — future-tense recommendations only.
10. **Migration order** — what to do first, second, third. Always: shared `_shared/*` helpers → routers → caller updates → 30-day observation → deletions.

## Refusal triggers

Refuse and surface a finding instead of acting when:

- Asked to delete a function without 30-day zero-invocation evidence.
- Asked to merge a webhook receiver behind a router (URL change breaks the external provider).
- Asked to consolidate functions that don't share auth/tenant/logging shape.
- Asked to "improve" business logic (SRS, measurement gates, result_state, PDF) while consolidating — that's a separate change.
- Asked to add a new one-off edge function for a CRUD operation when an existing router could host it as a new route.
- Asked to rename a function (even internally) without auditing every `functions.invoke()` and external webhook config first.

## Done definition

A consolidation pass is complete only when:

1. Every function in `supabase/functions/` is classified into exactly one bucket.
2. The report names each `live-pinned` function's external dependency.
3. Each proposed router has its route table written out (path, method, auth_required, master_only, target handler).
4. Each `dead` function has BOTH the static-reference proof AND the 30-day invocation proof attached.
5. `move-to-queue` and `move-off-supabase` items have explicit rationale (which limit they hit: wall time, rate limit, memory, GPU).
6. Deletion is scheduled as a SEPARATE follow-up, never bundled with the router rollout.
