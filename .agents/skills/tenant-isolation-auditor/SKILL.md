---
name: tenant-isolation-auditor
description: Cross-company / cross-brand data leak auditor for Pitch CRM's multi-tenant white-label SaaS. Auto-loads on any request touching tenant isolation, multi-company architecture, RLS policy review, `company_id` / `tenant_id` / `brand_id` scoping, Telnyx number routing across brands, QBO / QXO / SRS / ABC / Billtrust / DocuSign credential scoping, storage path tenant prefix enforcement, cross-tenant query risk, service-role usage, webhook tenant resolution, or anything that could let one company see another company's contacts, jobs, leads, estimates, invoices, messages, calls, documents, measurements, or integrations.
---

# Tenant Isolation Auditor

White-label / multi-company SaaS. One cross-tenant leak = lost contract + lawsuit. This auditor is non-negotiable and refuses to mark work complete until every isolation check passes.

## Scope of audit

Six gates. ALL must pass for a clean report.

### Gate 1 — Schema: every company-owned table has `tenant_id` (or `company_id`)
Tables holding customer, lead, job, estimate, invoice, payment, document, photo, measurement, message, call, automation, integration credential, or audit data MUST have a non-null `tenant_id` (preferred) or `company_id` column with an index.

Query template:
```sql
-- Tables in public schema missing tenant_id AND company_id
select c.table_name
from information_schema.tables c
where c.table_schema = 'public'
  and c.table_type = 'BASE TABLE'
  and not exists (
    select 1 from information_schema.columns col
    where col.table_schema = 'public'
      and col.table_name = c.table_name
      and col.column_name in ('tenant_id','company_id','organization_id')
  )
order by c.table_name;
```
Allowlist (no tenant column required): `tenants`, `companies`, `app_role`, `roles`, `permissions`, platform-admin tables, lookup/enum tables. Anything not on the allowlist is a **HARD FAIL**.

### Gate 2 — RLS: every tenant-owned table has RLS ON and every policy filters by tenant
```sql
-- Tables with RLS disabled
select schemaname, tablename
from pg_tables
where schemaname='public' and rowsecurity=false;

-- Policies that do NOT reference tenant_id / company_id
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname='public'
  and qual !~ '(tenant_id|company_id|organization_id|has_role|is_master)'
  and (with_check is null or with_check !~ '(tenant_id|company_id|organization_id|has_role|is_master)');
```
Fail conditions:
- `USING (true)` or `WITH CHECK (true)` on any tenant-owned table.
- Policies that resolve tenant from `request.jwt.claims` body fields the client controls (must use `auth.uid()` → membership table via SECURITY DEFINER function like `get_user_tenant_id(auth.uid())`).
- Missing per-command policy (SELECT/INSERT/UPDATE/DELETE) where the operation is supported by the UI.

### Gate 3 — Storage: every object path starts with `{tenant_id}/...`
```sql
-- Storage objects whose first path segment is not a known tenant UUID
select bucket_id, name
from storage.objects
where split_part(name, '/', 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
limit 100;
```
Storage RLS policies MUST enforce `((storage.foldername(name))[1] = get_user_tenant_id(auth.uid())::text)` for tenant-scoped buckets. Public buckets are allowed ONLY if explicitly documented in the audit report.

### Gate 4 — Telnyx numbers cannot leak across brands
- `telnyx_phone_numbers` (or equivalent) MUST have `tenant_id` AND `brand_id`.
- Inbound SMS/voice webhook MUST resolve `to_number` → row → `(tenant_id, brand_id)` BEFORE writing any message/call record. Never trust `tenant_id` from the webhook body.
- Outbound send MUST verify the chosen `from_number.tenant_id === caller's resolvedTenantId AND brand_id === caller's brand_id`. No fallback to "first available number."
- Conversation / message tables MUST filter by `(tenant_id, brand_id)` on read; cross-brand within same tenant is also a leak.

Grep targets:
```
rg -n "telnyx" supabase/functions --type ts
rg -n "from_number|to_number" supabase/functions --type ts
rg -n "phone_numbers" supabase/functions --type ts
```
Fail any handler that writes a message/call without an explicit tenant+brand resolution call.

### Gate 5 — Integration credentials scoped per company
Tables: `qbo_connections`, `qxo_connections`, `srs_connections`, `abc_connections`, `billtrust_connections`, `docusign_connections`, `stripe_connections`, any `*_integration_credentials`.
- Each row MUST have `tenant_id` (and `company_id` if multi-company under one tenant).
- Edge functions reading credentials MUST `.eq('tenant_id', resolvedTenantId)` and `.maybeSingle()`, never `.limit(1)` without filter.
- Tokens NEVER returned to the browser. Refresh handlers update only the row matching `resolvedTenantId`.
- Webhook callbacks (QBO realm, SRS order webhook, etc.) MUST resolve provider id → `tenant_id` via a lookup row, not via request body.

### Gate 6 — Cross-tenant query risk in code
Grep targets that almost always indicate leaks:
```
rg -n "\.from\('[a-z_]+'\)\.select" src/ --type ts | rg -v "eq\('(tenant|company|organization)_id'"
rg -n "supabase\.from\(" supabase/functions --type ts | rg -v "eq\('(tenant|company|organization)_id'"
rg -n "SUPABASE_SERVICE_ROLE_KEY" supabase/functions --type ts
rg -n "useEffectiveTenantId|getResolvedTenantId|get_user_tenant_id" src/ supabase/functions
```
Any service-role query without an explicit `.eq('tenant_id', …)` is a HARD FAIL. Any frontend query that bypasses `useEffectiveTenantId()` is a HARD FAIL.

## Hard rules (refuse if violated)

1. **Never trust tenant_id / company_id / brand_id from request body, query string, or JWT custom claim** controlled by the client. Resolve from `auth.uid()` via `user_company_access` (or equivalent membership table) inside a SECURITY DEFINER function with `SET search_path = public`.
2. **Service role bypasses RLS** — every service-role query MUST manually filter by `tenant_id`. No exceptions.
3. **No service role in frontend.** Anon key only. Sensitive operations go through edge functions.
4. **Storage paths**: tenant_id prefix is law. Reject any upload path that doesn't start with the caller's resolved tenant_id.
5. **Telnyx brand isolation**: inbound resolution by `to_number → (tenant_id, brand_id)`; outbound verification of `(tenant_id, brand_id)` match. Cross-brand within same tenant is a leak.
6. **Integration tokens never reach the browser.** Provider OAuth callbacks resolve provider id → tenant via a lookup table populated at connect time, not via state param alone.
7. **Master role exception is explicit.** Master/platform-admin policies use `has_role(auth.uid(), 'master')` (or equivalent) and the report MUST list every master-only policy so they're auditable.
8. **No `USING (true)`** on tenant-owned tables. Public-by-design tables (e.g., public webhook receivers, public quote view) MUST be documented in the audit memory.
9. **Audit row required** for every cross-tenant action a master user takes (impersonation, override, credential read). Logged to `audit_log` with target tenant_id, actor user_id, action, before/after.
10. **No new feature merges** without a refreshed audit report covering all six gates for the tables/functions it touches.

## Required output before code changes or sign-off

The auditor produces a structured report. Do NOT write fixes until the report is on the table.

```
## Tenant Isolation Audit — <scope>

### Gate 1 — Schema
- Tenant-owned tables scanned: N
- Missing tenant_id/company_id: <list or "none">
- Allowlisted tables: <list>

### Gate 2 — RLS
- Tables with RLS disabled: <list>
- Policies without tenant filter: <table.policy_name list with SQL excerpt>
- Permissive `USING (true)` policies: <list>
- Missing per-command policies: <table → missing cmds>

### Gate 3 — Storage
- Buckets reviewed: <list with public/private>
- Objects with non-UUID first segment: <count, sample 10>
- Storage policies missing tenant folder check: <list>

### Gate 4 — Telnyx
- Phone-number table has tenant_id + brand_id: yes/no
- Inbound handler resolves tenant from to_number: yes/no (file:line)
- Outbound verifies from_number.tenant_id === caller: yes/no (file:line)
- Cross-brand read risk: <findings>

### Gate 5 — Integration credentials
- Tables reviewed: <list>
- Rows missing tenant_id: <count per table>
- Edge functions reading credentials without tenant filter: <file:line list>
- Tokens exposed to frontend: <findings or "none">

### Gate 6 — Code-level
- Frontend queries bypassing useEffectiveTenantId(): <file:line list>
- Service-role queries without tenant filter: <file:line list>
- New SECURITY DEFINER functions without tenant check: <list>

### Verdict
- PASS / FAIL
- Hard fails: <numbered list>
- Recommended fixes (minimal diff): <ordered list of migrations + edge-function edits>
- Master-only policies in scope: <list — auditable>
```

## Refusal triggers

- A tenant-owned table without `tenant_id` / `company_id`.
- An RLS policy with `USING (true)` on tenant-owned data.
- A service-role query without `.eq('tenant_id', …)`.
- A storage upload path that doesn't start with `{tenant_id}/`.
- A Telnyx inbound handler that writes records before resolving `to_number → (tenant_id, brand_id)`.
- An integration credential read that uses `.limit(1)` instead of `.eq('tenant_id', resolvedTenantId).maybeSingle()`.
- A frontend query without `useEffectiveTenantId()` on tenant-scoped data.
- A new feature shipped without a Gate-1–6 report covering its tables and functions.

## Interaction with related skills

- **Pitch CRM Tenant Security Enforcer** — this skill is the auditor; the enforcer is the per-request gatekeeper. The auditor produces the report; the enforcer blocks merges that violate it.
- **Supabase Schema & DB Drift Guard** — every new tenant column gets `IF NOT EXISTS` + `NOTIFY pgrst, 'reload schema';`. Tenant columns are stable DB columns, never JSONB.
- **Storage Orphan Cleaner** — quarantine scoped per tenant; cross-tenant batches forbidden.
- **Backend Auto Cleanup Worker** — every delete query filters by `tenant_id`.
- **Supabase Health Doctor** — surfaces "exposed tables without tenant isolation" and "tenants without RLS" as red status cards.
