---
name: supabase-health-doctor
description: Use when the user asks to inspect, audit, or expand backend health — Supabase Health Doctor, supabase-health edge function, admin health dashboard, RLS audit, tenant isolation check, missing indexes, bloated tables, slow queries, failing Edge Functions, storage bucket policies, webhook queue backlog, duplicate contacts/leads, orphaned storage files, or red/yellow/green status cards for database/storage/functions/auth/queues/integrations.
---

# Supabase Health Doctor

## Role
You expand the existing `supabase-health` edge function and `api_health_report` summary into a full backend inspection system that powers a master-only admin dashboard with red/yellow/green status cards.

## Applies when
A request touches:
- `supabase-health` edge function
- `api_health_report` / health dashboard / admin command center health view
- "Supabase Health Doctor"
- Backend audit, RLS audit, tenant isolation audit
- Storage bucket policy review, orphaned files
- Edge function failure monitoring
- Webhook queue backlog, function cache size
- Duplicate contacts/leads detection
- Missing indexes, bloated tables, slow queries
- Broken foreign keys, missing tables

## Architecture Contract

ONE canonical health pipeline:

```
supabase-health (edge function)
  ├─ runs all checks below
  ├─ writes results to api_health_report (JSONB)
  └─ returns { categories: [...], checks: [...], generated_at }

HealthDoctorDashboard (UI, master-only)
  ├─ reads latest api_health_report
  ├─ groups by category → status cards (red/yellow/green)
  └─ exposes "Run inspection now" button → invokes supabase-health
```

Never bypass `supabase-health`. Never write health results from the client. Never expose raw `pg_*` queries to the frontend.

## Required Check Catalog

Every check must return:
```ts
{
  id: string;               // stable, e.g. "rls.tenant_isolation.contacts"
  category: HealthCategory; // see enum below
  label: string;
  status: 'green' | 'yellow' | 'red';
  metric?: number | string;
  threshold?: { yellow: number; red: number };
  detail?: string;          // human explanation
  remediation?: string;     // one-line fix hint
  evidence?: Record<string, unknown>; // raw rows / counts (capped 50)
}
```

`HealthCategory` enum (frozen — never add ad-hoc strings):
`database | rls | tenant_isolation | storage | edge_functions | auth | queues | integrations | data_quality`

### Checks (all 13 are mandatory)

| # | Check id prefix | Category | Source of truth | Red threshold |
|---|---|---|---|---|
| 1 | `database.missing_tables` | database | Compare `information_schema.tables` vs required manifest in `_shared/required-tables.ts` | any missing |
| 2 | `rls.policy_failures` | rls | `pg_policies` + `pg_class.relrowsecurity` — flag tables with RLS disabled OR zero policies | any public table without RLS |
| 3 | `tenant_isolation.exposed_tables` | tenant_isolation | Tables with `tenant_id` column whose policies don't reference `tenant_id` / `current_tenant_id()` | any |
| 4 | `database.broken_foreign_keys` | database | `pg_constraint` LEFT JOIN target → orphan rows count via parameterized sample | orphans > 0 |
| 5 | `database.missing_indexes` | database | `pg_stat_user_tables` seq_scan/idx_scan ratio + FK columns without index | ratio > 100 on >10k row table |
| 6 | `database.bloated_tables` | database | `pg_stat_user_tables.n_dead_tup / n_live_tup` | >40% dead |
| 7 | `database.slow_queries` | database | `pg_stat_statements` mean_exec_time top N | mean > 1000ms |
| 8 | `edge_functions.failures` | edge_functions | `function_edge_logs` last 24h: 5xx rate per function | >5% error rate |
| 9 | `storage.bucket_policies` | storage | `storage.buckets` + `storage.policies` — flag public buckets, missing tenant prefix policy | any public bucket holding tenant data |
| 10 | `edge_functions.cache_size` | edge_functions | function deployment size / cold-start metrics | size > 50MB |
| 11 | `queues.webhook_backlog` | queues | webhook/job queue tables (project-specific) — pending older than 5 min | backlog > 100 OR oldest > 30 min |
| 12 | `data_quality.duplicate_contacts` | data_quality | `contacts` grouped by `(tenant_id, lower(email))` and `(tenant_id, phone)` having count > 1 | any dup cluster > 5 |
| 13 | `storage.orphaned_files` | storage | `storage.objects` whose tenant-prefixed path's owning row no longer exists | >0 |

## Hard Rules

1. **All checks live in `supabase/functions/supabase-health/checks/*.ts`**, one file per check, default-exporting `{ id, run(ctx) }`. The main `index.ts` only orchestrates and aggregates.

2. **Never widen the `HealthCategory` enum** without also updating the dashboard grouping and `api_health_report` consumers. Add a new check under an existing category first.

3. **Status thresholds are explicit per check** — no global "if metric > X red" logic. Each check owns its red/yellow boundaries.

4. **Tenant isolation check is non-negotiable**: any table with a `tenant_id` column whose RLS policies don't textually reference `tenant_id` is `red`. Do not soften to `yellow`.

5. **Schema-cache safety** (per Supabase Schema & DB Drift Guard skill): if a check writes back to `api_health_report` and adds new evidence fields, those go into the existing JSONB `payload` column — never new top-level columns without a migration with `NOTIFY pgrst, 'reload schema'`.

6. **Master-only**: the dashboard route and the `supabase-health` invocation from the UI must verify `master` role server-side. Anon/authenticated callers get 403.

7. **Performance budget**: full inspection must complete in < 30s. Long checks (slow_queries, orphaned_files) must use `LIMIT` + sampling. Persist partial results — never throw away completed checks on one failure.

8. **Every check must be independently runnable** via `supabase-health?check=<id>` for debugging. Never require running all 13 to test one.

9. **Evidence cap**: never persist more than 50 rows of evidence per check into `api_health_report`. Truncate with `evidence_truncated: true`.

10. **Regression test**: every new check ships with a fixture-based test in `supabase/functions/supabase-health/__tests__/<check>.test.ts` covering green / yellow / red paths.

## Refusal triggers

Refuse and ask for correction if the request would:
- Add health checks directly in the dashboard UI (must go through `supabase-health`)
- Bypass master-role gating
- Add a new `HealthCategory` without dashboard updates
- Run raw SQL from the client
- Store check evidence in new DB columns instead of `api_health_report.payload` JSONB
- Mark tenant-isolation failures as `yellow`
- Skip the regression test for a new check

## Required output before code changes

1. **Check inventory diff** — which of the 13 checks already exist in `supabase-health`, which are missing, which need expansion.
2. **Files to create / edit**: list `checks/*.ts`, `__tests__/*.ts`, dashboard component path, and any `_shared/required-tables.ts` manifest.
3. **Migration needed?** — only if `api_health_report` is missing or its payload shape needs a NOT NULL field. JSONB additions need no migration.
4. **Master-role gate location** — confirm both edge function and dashboard route check it.
5. **Performance plan** — which checks need sampling/LIMIT, expected total runtime.
6. **Threshold table** — explicit yellow/red cutoffs per check (copy from catalog above, adjust only with justification).

## Dashboard UI contract

- Route: `/admin/health-doctor` (master-only).
- Layout: one card per `HealthCategory`, rolled-up status = worst child status.
- Each card expands to show individual checks with status dot, metric, detail, remediation.
- "Run inspection now" button → `supabase.functions.invoke('supabase-health', { body: { force: true } })`, then refetch `api_health_report`.
- Empty/error state: show last successful `generated_at` and a "Never run" banner if null.
- Use existing design tokens — no hard-coded colors. Map status → `bg-destructive` (red), `bg-warning` (yellow), `bg-success` (green) semantic tokens.
