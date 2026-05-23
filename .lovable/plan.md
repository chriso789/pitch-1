# Phase 1 — Backend Maintenance Center (Read-Only Audit)

## Guardrails (non-negotiable, per your answer + architecture guard)

- **Read-only.** No deletes, no merges, no quarantines, no RLS rewrites, no auto-fixes.
- **Zero new standalone edge functions.** All 5 reports become new routes inside existing grouped functions: `health-api`, `security-api`, `admin-api`. Current folder count stays at **461**.
- **Master role only** (COB). Hidden behind existing master gate. Surfaces as a tab group inside the AI Admin Command Center.
- **No secrets in responses.** Env checks return `{ present: boolean }` only.
- **All audit runs persisted** to two new tables so findings are diff-able over time.
- **No mock data.** Every report queries real Postgres / `pg_*` / `storage.objects` / `function_edge_logs`.
- Phase 2 (workers that mutate: cleanup, quarantine, dedupe) is documented only — not built.

## Modules (Phase 1, 5 only)

You explicitly listed 9 in the prompt body but answered "Phase 1 = audit-only, 5 modules." I'm building the 5 you named at the top:

1. **Supabase Health Doctor**
2. **Edge Function Consolidator Report**
3. **Tenant Isolation Auditor**
4. **Security & RLS Linter**
5. **Auto Cleanup Worker — *report only* (preview of what Phase 2 would clean)**

Duplicate Cleaner, Storage Orphan Cleaner, Database Index Optimizer, and Migration Readiness Scanner are deferred to Phase 2 per your scope answer.

## Route map (no new functions)

All routes return the same envelope: `{ ok, data: { run_id, generated_at, summary: {critical,high,medium,low,info}, findings: [...] }, requestId }`.

| Module | Function | Route |
|---|---|---|
| Health Doctor | `health-api` | `GET /doctor` |
| Edge Function Consolidator | `admin-api` | `GET /edge-functions/report` |
| Tenant Isolation Auditor | `security-api` | `GET /tenant-audit/report` |
| Security & RLS Linter | `security-api` | `GET /rls-linter/report` |
| Cleanup Preview (read-only) | `admin-api` | `GET /cleanup/preview` |

Every route: master-only via `_shared/auth.ts` + role check; uses `_shared/errors.ts`; logs run to `system_audit_runs`; persists findings to `system_audit_findings`; supports `?persist=false` for ad-hoc preview without writing rows.

## Finding shape (uniform across all 5)

```ts
{
  id: string,                         // stable per-finding, e.g. "rls.no_tenant_filter:public.contacts.contacts_select"
  category: 'health'|'edge_functions'|'tenant_isolation'|'rls_security'|'cleanup_preview',
  severity: 'critical'|'high'|'medium'|'low'|'info',
  entity_type: string,                // 'table' | 'policy' | 'function' | 'bucket' | 'object' | 'queue'
  entity_id: string,                  // e.g. 'public.contacts' or 'send-sms'
  title: string,
  detail: string,                     // human explanation, no secrets
  evidence: jsonb,                    // capped 50 rows
  recommended_action: string,         // SQL or code snippet, REVIEW-ONLY
  risk_explanation: string,
  company_id: uuid|null               // null = platform-wide
}
```

## Check catalogs (what each module returns)

### 1. Health Doctor (`health-api GET /doctor`)
Expand existing `health-api` (currently 1 file). Sub-checks:
- `db.tables.required_present` — diff `information_schema.tables` against a manifest in `_shared/required-tables.ts`.
- `db.rls.disabled_tables` — `pg_class.relrowsecurity=false` in `public`.
- `db.tenant_id_missing` — public tables missing `tenant_id`/`company_id` (uses allowlist).
- `db.broken_fks` — sampled orphan row count per FK.
- `db.dead_tuples_pct` — `pg_stat_user_tables` n_dead / n_live > 40%.
- `db.slow_queries` — top 25 by `pg_stat_statements.total_exec_time` (mean > 1s = high).
- `cache.function_cache_size` — row count + expired-row count.
- `queues.backlog` — pending rows older than 5 min across known queue tables (dialer_leads, ai_measurement_jobs, *_queue if present).
- `webhooks.failure_rate_24h` — from `function_edge_logs` 5xx ratio.
- `auth.stale_sessions` — `last_seen_at < now() - 30d AND revoked_at IS NULL`.
- `storage.buckets.public_with_pii_path` — public bucket holding tenant-prefixed paths.
- `env.required_secrets` — presence-only check for required `Deno.env` keys (never the value).

### 2. Edge Function Consolidator (`admin-api GET /edge-functions/report`)
Runs `scripts/audit-edge-functions.ts` logic in-function (or reads the pre-generated CSV at `docs/edge-function-consolidation-audit.csv` if present). Returns:
- folder count vs 500 cap
- MIGRATE / TBD / DELETE_CANDIDATE / KEEP classification per function
- scaffold-only grouped functions (return 501)
- old `supabase.functions.invoke('<name>')` call sites in `src/`
- functions with zero invocations in `function_edge_logs` over 30d
- public-webhook list (never-delete)
- duplicate/near-duplicate prefix groups

Classification labels in response: `KEEP | MIGRATE | MERGE | DELETE_CANDIDATE | REVIEW`. No deletes.

### 3. Tenant Isolation Auditor (`security-api GET /tenant-audit/report`)
Six gates from the Tenant Isolation Auditor skill, severity ≥ high:
- Gate 1: tables missing `tenant_id`/`company_id` (non-allowlist) → **critical**
- Gate 2: RLS disabled OR policy text not referencing `tenant_id`/`company_id`/`has_role` → **critical**
- Gate 3: `storage.objects` whose first path segment is not a known tenant UUID → **high** (sampled)
- Gate 4: Telnyx — `telnyx_phone_numbers` rows missing `tenant_id`/`brand_id`; inbound handlers grepped for `to_number` → tenant resolution (static check on shipped code) → **critical**
- Gate 5: integration credential tables (qbo/qxo/srs/abc/billtrust/docusign/stripe) — rows missing `tenant_id`, edge functions reading without `.eq('tenant_id', …)` → **critical**
- Gate 6: code-level grep — frontend queries lacking `useEffectiveTenantId()` filter on tenant-scoped tables; service-role queries without tenant filter → **high**

Code-level gates run by reading repo files at function startup (already present in container) and matching with `rg`-equivalent regex in TS.

### 4. Security & RLS Linter (`security-api GET /rls-linter/report`)
Ten gates from Security RLS Linter skill:
1. Tables without RLS (P0)
2. `USING (true)` / `WITH CHECK (true)` on tenant tables (P0)
3. Service-role usage in edge functions w/o tenant filter (P0)
4. Frontend direct writes to sensitive tables (P0)
5. Public storage buckets holding sensitive data (P0)
6. Wildcard CORS on admin/diagnostic endpoints (P1) — explicitly flags existing `supabase-health` Access-Control-Allow-Origin: '*'
7. Edge functions missing auth checks (P0 for mutating, P1 for read)
8. Queries missing tenant filter (P0/P1)
9. Exposed/committed secrets — regex on repo (P0); `VITE_*SECRET|PRIVATE|SERVICE` (P0)
10. Supabase platform hardening — `supabase--linter` results, leaked-password protection, MFA, OTP expiry (P1)

### 5. Cleanup Preview (`admin-api GET /cleanup/preview`)
**Read-only preview** of what a Phase-2 cleanup worker WOULD touch. No writes. Returns counts + sample IDs for:
- `function_cache` rows with `expires_at < now()`
- `webhook_attempts` failed/dead-letter older than 30d
- Storage `temp-*` buckets, objects older than 24h
- `ai_measurement_jobs` stuck `processing/queued` >2h
- Mobile/auth sessions inactive >30d
- `activity_log` >90d, `audit_log` >365d
- Duplicate `bulk_imports` by `(tenant_id, source_external_id)`
- Empty contact rows older than 7d with no FK references
- Storage objects whose first path segment is not a known tenant
- Duplicate contacts by `(tenant_id, lower(email))` and `(tenant_id, phone)` clusters > 5

Each row shipped with a `would_action` string (e.g. `"delete"`, `"quarantine"`, `"fail_with_normalized_state"`) — UI shows it as a disabled "Execute (Phase 2)" button.

## Database changes (one migration)

Two new tables, both master-only, both with RLS:

```sql
create table public.system_audit_runs (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in
    ('health_doctor','edge_functions','tenant_isolation','rls_security','cleanup_preview')),
  triggered_by uuid not null,         -- auth.uid()
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',  -- running|ok|partial|error
  summary jsonb not null default '{}'::jsonb,  -- {critical,high,medium,low,info}
  duration_ms int,
  error_message text
);

create table public.system_audit_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.system_audit_runs(id) on delete cascade,
  finding_key text not null,          -- stable id from above shape
  category text not null,
  severity text not null check (severity in ('critical','high','medium','low','info')),
  entity_type text not null,
  entity_id text not null,
  title text not null,
  detail text,
  evidence jsonb,
  recommended_action text,
  risk_explanation text,
  company_id uuid,                    -- null = platform-wide
  created_at timestamptz not null default now()
);

create index on public.system_audit_runs (module, started_at desc);
create index on public.system_audit_findings (run_id, severity);
create index on public.system_audit_findings (category, severity);

alter table public.system_audit_runs enable row level security;
alter table public.system_audit_findings enable row level security;

-- Master-only via existing has_role helper
create policy "master read runs" on public.system_audit_runs
  for select using (public.has_role(auth.uid(), 'master'));
create policy "master read findings" on public.system_audit_findings
  for select using (public.has_role(auth.uid(), 'master'));
-- INSERT/UPDATE happen only from edge functions via service role; no client policies needed.
```

No mutations to existing tables. No RLS changes elsewhere. JSONB-based so future checks add fields without migrations.

## Frontend (one new page, master-only)

- **Route:** `/admin/ai-command-center/maintenance` (nested under existing AI Admin Command Center per your nav answer)
- **Component:** `src/pages/admin/BackendMaintenanceCenter.tsx`
- **Tabs:** Health Doctor · Edge Functions · Tenant Isolation · RLS Security · Cleanup Preview
- **Each tab:**
  - "Run now" button → invokes the corresponding route via `edgeApi(...)`
  - Severity legend (critical/high/medium/low/info) with red/amber/yellow/blue/grey semantic tokens (NO hardcoded colors)
  - Findings table: severity, category, entity, title, recommended_action (collapsible), risk_explanation
  - Export JSON / Export CSV
  - "Last run" timestamp + duration + Δ vs previous run (count change per severity)
  - **Phase-2 fix buttons are rendered as disabled** with tooltip "Available in Phase 2"
- Master gate: existing `useIsMaster()` hook. Non-masters get the standard 403 fallback. Nav entry hidden via existing master-only render guard.

## Documentation deliverables

- `docs/system-health-audit.md` — new. Explains modules, gates, severity scale, how to add a new check.
- `docs/edge-function-current-status.md` — update with the 5 new routes and confirm folder count unchanged at 461.
- `docs/phase-2-backend-maintenance-plan.md` — new. Stubs the deferred 4 modules + the mutating workers, with the contracts from the existing skills (`backend-auto-cleanup-worker`, `storage-orphan-cleaner`, `database-index-optimizer`, `migration-readiness-scanner`) so Phase 2 is fully scoped.

## Acceptance criteria (verifiable)

1. `ls supabase/functions | wc -l` returns the same value before and after.
2. The 5 new routes return real findings (no stubs) against the live database.
3. `system_audit_runs` and `system_audit_findings` populated after running each tab once.
4. Non-master users get 403 on each route and never see the nav entry.
5. No migration alters existing tables' columns or RLS.
6. No `DELETE`, `UPDATE` (other than to the two new audit tables), `DROP`, or `ALTER POLICY` anywhere in the edge function code.
7. Wildcard CORS finding flags the existing `supabase-health` function as P1.
8. Edge Function Consolidator report classifies the current 461 functions and prints the cap distance.
9. JSON + CSV export works on every tab.
10. `docs/edge-function-current-status.md` updated; folder-count delta documented as 0.

## What is explicitly NOT in this plan

- No Duplicate Lead Cleaner (Phase 2)
- No Storage Orphan Cleaner (Phase 2)
- No Database Index Optimizer (Phase 2)
- No Migration Readiness Scanner (Phase 2)
- No `backend-maintenance-worker` standalone function — its read-only preview lives in `admin-api`. The mutating worker is Phase 2 only if you decide to route it via existing `*-worker` grouped functions or a single new approved exception.
- No RLS policy changes, no index creation, no function deletion, no record merging.

## Technical risks called out

- `pg_stat_statements` may not be enabled — Health Doctor will degrade that check to `info` with a "enable extension" recommendation, not an error.
- `function_edge_logs` retention is platform-controlled; webhook-failure-rate check is a 24h snapshot only.
- Code-level grep checks (Tenant Gate 6, RLS Gate 9) run against files bundled into the edge function deploy. They reflect *deployed* code, not local working tree.
- Cleanup Preview counts can be expensive on `storage.objects`; route uses `LIMIT 10000` per bucket and reports "truncated: true" when hit.

Approve and I'll build this exactly as scoped.