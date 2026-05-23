---
name: backend-auto-cleanup-worker
description: Use when the user asks to build, extend, or schedule the Backend Auto Cleanup Worker — nightly cron/edge function that purges expired function_cache rows, old failed webhook attempts, temporary uploads, abandoned draft estimates, orphaned storage files, stale AI generation jobs, dead mobile sessions, old logs past retention, duplicate import records, and empty/invalid contacts. Triggers on requests touching cleanup-worker, scheduled cleanup, retention policy, function_cache expiry sweep, webhook_attempts pruning, orphaned storage GC, stale ai_measurement_jobs, mobile session expiry, log retention windows, or duplicate/empty record removal.
---

# Backend Auto Cleanup Worker

## Role
You build and extend the nightly `cleanup-worker` edge function. Every cleanup target follows the same contract: scoped query, dry-run support, batch limits, audit log, never touches active customer/job/lead/project data.

## Applies when
A request touches:
- `cleanup-worker` edge function or its pg_cron schedule
- `function_cache` expiry sweep (the existing helper only deletes on read — this worker fixes the leak)
- `webhook_attempts` / `webhook_delivery_log` pruning
- Temporary upload / staging bucket cleanup
- Abandoned draft estimates / draft proposals
- Orphaned `storage.objects` (no owning row)
- Stale `ai_measurement_jobs` / `measurement_jobs` stuck in `processing`
- Mobile session / `auth_sessions` expiry
- Log retention (`activity_log`, `audit_log`, `function_edge_logs` mirrors)
- Duplicate import records (`bulk_imports`, `pipeline_entries` dupes)
- Empty / invalid contact records

## Architecture Contract

```
pg_cron (nightly, 03:15 America/Chicago)
  └─ net.http_post → cleanup-worker edge function
       ├─ tasks/function-cache-expired.ts
       ├─ tasks/webhook-attempts-retention.ts
       ├─ tasks/temp-uploads.ts
       ├─ tasks/abandoned-draft-estimates.ts
       ├─ tasks/orphaned-storage.ts
       ├─ tasks/stale-ai-jobs.ts
       ├─ tasks/dead-mobile-sessions.ts
       ├─ tasks/old-logs.ts
       ├─ tasks/duplicate-imports.ts
       └─ tasks/empty-invalid-contacts.ts
  → writes summary row to cleanup_worker_runs (id, started_at, finished_at,
    tasks jsonb, dry_run bool, triggered_by text)
```

Never bypass `cleanup-worker`. Never delete from the client. Never run destructive SQL outside a task module.

## Task Contract

Every task default-exports:
```ts
export default {
  id: string;              // stable, e.g. "function_cache.expired"
  retention: string;       // human, e.g. "expires_at < now()"
  defaultBatchLimit: number;
  async run(ctx: TaskCtx): Promise<TaskResult>;
}

type TaskResult = {
  id: string;
  scanned: number;
  deleted: number;          // 0 when dry_run
  skipped_active: number;   // rows matched but protected by active-data guard
  storage_objects_deleted?: number;
  errors: Array<{ row_id?: string; message: string }>;
  dry_run: boolean;
  duration_ms: number;
};
```

## Required Cleanup Targets (all 10 mandatory)

| # | Task id | Source | Retention rule | Active-data guard |
|---|---|---|---|---|
| 1 | `function_cache.expired` | `function_cache` | `expires_at < now()` | none — pure TTL |
| 2 | `webhook_attempts.retention` | `webhook_attempts` / `webhook_delivery_log` | `status in ('failed','dead_letter') AND created_at < now() - interval '30 days'` | exclude rows still referenced by an open `webhook_subscription` |
| 3 | `temp_uploads.purge` | `storage.objects` in `temp-*` / `staging-*` buckets | `created_at < now() - interval '24 hours'` | path NOT used by any `documents`, `photos`, `inspection_photos`, `pdf_source_files` row |
| 4 | `abandoned_draft_estimates.purge` | `estimates` | `status='draft' AND updated_at < now() - interval '60 days' AND signed_at IS NULL AND sent_at IS NULL` | exclude any estimate referenced by a `jobs`/`projects` row with status not in (`cancelled`,`lost`) |
| 5 | `orphaned_storage.gc` | `storage.objects` | object path's owning row no longer exists (per-bucket resolver map) | tenant-prefixed path must match an existing tenant; never delete cross-tenant |
| 6 | `stale_ai_jobs.fail` | `ai_measurement_jobs`, `measurement_jobs` | `status in ('processing','queued') AND updated_at < now() - interval '2 hours'` | DOES NOT delete — marks `result_state='ai_failed_unknown'` via `normalizeResultStateForWrite()`, sets `hard_fail_reason='cleanup_worker_timeout'` |
| 7 | `dead_mobile_sessions.purge` | `mobile_sessions` / `auth_sessions` mirror | `last_seen_at < now() - interval '30 days' AND revoked_at IS NULL` | exclude sessions belonging to a user with `last_active_at > now() - interval '7 days'` |
| 8 | `old_logs.purge` | `activity_log` (90d), `audit_log` (365d), `edge_function_log_mirror` (30d) | per-table retention column | `audit_log` rows with `severity='critical'` retained 730d |
| 9 | `duplicate_imports.dedupe` | `bulk_imports`, `pipeline_entries` (import-sourced) | identical `(tenant_id, source_external_id)` keep newest | never touch rows promoted to a `lead`/`project` |
| 10 | `empty_invalid_contacts.purge` | `contacts` | `(email IS NULL OR email='') AND (phone IS NULL OR phone='') AND (first_name IS NULL OR first_name='') AND (last_name IS NULL OR last_name='') AND created_at < now() - interval '7 days'` | exclude contacts referenced by any `jobs`, `projects`, `pipeline_entries`, `estimates`, `invoices`, `calls`, `sms_messages`, `documents`, `photos` |

## Hard Rules

1. **One file per task** under `supabase/functions/cleanup-worker/tasks/*.ts`. `index.ts` is orchestration only.

2. **Active-data guard is non-negotiable.** Every delete query must EXCLUDE rows tied to active customer/job/lead/project/financial data via explicit JOIN/`NOT EXISTS` — never trust a simple WHERE on the target table alone. If you cannot prove activity, you do not delete.

3. **Dry-run by default for new tasks.** Each task ships with `dry_run=true` on first deploy. Promotion to live deletes requires a separate change with at least one dry-run summary stored in `cleanup_worker_runs`.

4. **Batch limit per task** (default 5000 rows). Deletes use `DELETE ... WHERE id IN (SELECT id FROM target WHERE <cond> LIMIT N)` pattern to avoid lock storms. Never `DELETE ... WHERE <cond>` unbounded.

5. **Storage deletes are two-step**: select object paths in batches → `storage.from(bucket).remove(paths)` → then delete the DB row that referenced them (if applicable). Never delete the DB row before the storage object — leaks an orphan.

6. **Stale AI jobs are FAILED, not deleted.** Use `normalizeResultStateForWrite()` from `_shared/result-state.ts`. Specific reason goes into `hard_fail_reason='cleanup_worker_timeout'`, not into `result_state`. Honors the Result State Contract (10 buckets only).

7. **Tenant isolation**: orphaned-storage and empty-contact tasks must verify the tenant prefix path matches a real tenant. Never delete a storage object whose first path segment is not a known `tenant_id`.

8. **Audit row per run** in `cleanup_worker_runs` (JSONB `tasks` field, NOT a column per task — schema-drift safe per Supabase Schema & DB Drift Guard). Every individual deleted record id batch is logged in the `tasks[i].sample_ids` (capped at 50, with `sample_truncated: true`).

9. **Idempotent + restartable**: a task crash must not leave the system in a worse state. Use SAVEPOINT per batch where possible; persist progress in `cleanup_worker_runs.tasks[i].batches[]`.

10. **Performance budget**: full worker run < 5 minutes. Long tasks (`orphaned_storage`, `old_logs`) must respect batch limits and may be split across multiple nightly runs.

11. **Master-only manual trigger**: the `?task=<id>&dry_run=true` debug invocation requires master role server-side. Cron invocation uses an internal worker secret (`Authorization: Bearer ${CLEANUP_WORKER_SECRET}`), NOT service-role exposed to anything else.

12. **Never delete**: `tenants`, `companies`, `users`, `profiles`, `user_company_access`, `roles`, `permissions`, `subscriptions`, `payments`, `invoices`, `contracts`, signed `estimates`, `roof_measurements` with `customer_report_ready=true`, any row with non-null `signed_at` / `accepted_at` / `paid_at`.

## Refusal triggers

Refuse to mark complete if a change would:
- Delete from a customer/job/lead/project/financial table without an active-data guard
- Skip the `cleanup_worker_runs` audit row
- Run unbounded `DELETE` without a batch `LIMIT`
- Delete a DB row before its storage object
- Delete a stale AI job instead of failing it through the normalizer
- Add a new top-level column for per-task stats instead of nesting in `tasks` JSONB
- Trigger the worker from the client without master-role check
- Touch any of the "Never delete" tables

## Required output before code changes

1. **Task inventory diff** — which of the 10 tasks exist, which are missing, which need expansion (with file paths).
2. **Migration needed?** — only for `cleanup_worker_runs` table or new retention columns. JSONB additions to existing `tasks` field need no migration.
3. **Cron schedule SQL** (uses `insert` tool, NOT migration — contains project URL + anon key, never run on remix):
   ```sql
   select cron.schedule(
     'cleanup-worker-nightly',
     '15 3 * * *',
     $$ select net.http_post(
       url:='https://<project-ref>.supabase.co/functions/v1/cleanup-worker',
       headers:='{"Content-Type":"application/json","Authorization":"Bearer <CLEANUP_WORKER_SECRET>"}'::jsonb,
       body:='{"triggered_by":"pg_cron"}'::jsonb
     ); $$
   );
   ```
4. **Active-data guard per task** — exact JOIN/`NOT EXISTS` clauses (copy from catalog above; adjust only with justification).
5. **Dry-run plan** — which tasks ship as `dry_run=true` first.
6. **Performance plan** — batch sizes, expected total runtime, which tasks may split across nights.

## Admin UI contract (optional surface)

If the request asks for a UI:
- Route: `/admin/cleanup-worker` (master-only).
- Lists last 30 `cleanup_worker_runs` rows with per-task scanned/deleted/skipped_active counts.
- "Run now (dry run)" and "Run now (live)" buttons → `supabase.functions.invoke('cleanup-worker', { body: { triggered_by: 'admin', dry_run: true|false }})`.
- Per-task toggle for enable/disable persisted in `cleanup_worker_runs` config row (or a small `cleanup_worker_config` table).
- Uses existing semantic design tokens; no hard-coded colors.

## Interaction with related skills

- **Supabase Schema & DB Drift Guard**: any new diagnostic field goes into `cleanup_worker_runs.tasks` JSONB. Migrations include `NOTIFY pgrst, 'reload schema';`.
- **Supabase Health Doctor**: cleanup-worker failures and skipped batches should surface as a `queues.cleanup_backlog` check on the health dashboard.
- **Pitch CRM Tenant Security Enforcer**: every storage delete path validated against known tenant ids; cron invocation uses internal worker secret, never service role exposed to the client.
- **Result State Contract**: stale AI job failures only via `normalizeResultStateForWrite()`.
