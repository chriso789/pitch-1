---
name: security-rls-linter
description: Audit Supabase RLS, storage policies, edge function auth, CORS, and secret hygiene for Pitch CRM. Auto-loads on any request about security scans, RLS missing/disabled, "table without RLS", "service role" misuse, leaked passwords, leaked secrets, hardcoded API keys, public storage buckets, wildcard CORS, missing auth on edge functions, missing tenant/company checks, overly broad UPDATE/DELETE policies, `USING (true)`, exposed `VITE_*` keys, password protection disabled, signed-URL leakage, or "is my backend secure".
---

# Security & RLS Linter

Audit-only. Never silently "fix" security. Classify, propose, wait for approval. Coordinate with `pitch-crm-tenant-security-enforcer` (tenancy rules) and `webhook-queue-repair` (queue/webhook tenant gaps) — this skill is the broader perimeter scan.

## Hard rules

1. **No silent fixes.** Every finding gets severity + remediation SQL/code, but is not applied without approval.
2. **Tenant isolation = P0.** Anything that crosses companies is critical, never high.
3. **Service role never in frontend.** `VITE_*` exposure of service role / provider secrets = P0.
4. **`USING (true)` is guilty until proven innocent.** Allowed only on tables explicitly documented as public (customer portal view tokens, published quote pages). All others = critical.
5. **Wildcard CORS + auth-required = wrong.** `Access-Control-Allow-Origin: '*'` is OK only on truly public, sanitized endpoints (health pings without payload, public lead webhooks). Admin/diagnostic/master-only routes must restrict origin OR require auth in code.
6. **Never paste secret values into chat or files.** Reference by name only.
7. **Coordinate, don't overlap.** Tenant-isolation auditor owns deep tenant cross-checks; this skill owns the perimeter sweep that flags them.

## Ten Gates

Run all. Each gate emits: count, sample (≤5 rows redacted), severity (P0/P1/P2), remediation.

### Gate 1 — Tables without RLS
```sql
SELECT n.nspname AS schema, c.relname AS table, c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname) AS policy_count
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND n.nspname='public'
ORDER BY rls_enabled, policy_count;
```
- `relrowsecurity=false` on a public-schema table holding tenant data → **P0**.
- RLS enabled but zero policies → effectively locked, but flag as **P1** (likely bug).

### Gate 2 — Overly broad policies
Scan `pg_policies` for:
- `USING (true)` or `WITH CHECK (true)` on UPDATE/DELETE → **P0** unless allowlisted.
- Policies that don't reference `tenant_id`, `company_id`, `auth.uid()`, or a `has_role()`/`is_master()` helper → **P1**.
- `FOR ALL` policies (vs split SELECT/INSERT/UPDATE/DELETE) on sensitive tables → **P1** review.

### Gate 3 — Service role abuse inside edge functions
```bash
rg -n "SUPABASE_SERVICE_ROLE_KEY|service_role" supabase/functions/ --type ts
```
For each hit, verify the function:
- Resolves `tenant_id` from JWT (not body) before any service-role query.
- Adds explicit `.eq('tenant_id', resolvedTenantId)` / `.eq('company_id', …)` on every table touched.
- Writes an audit log row for destructive operations.
Missing any → **P0**.

### Gate 4 — Frontend calls that should be server-side
Scan `src/` for direct DB writes/reads that bypass an edge function gate:
- `supabase.from('user_roles' | 'companies' | 'feature_toggles' | 'audit_logs' | 'integration_credentials' | 'webhook_endpoints' | '*_secrets' | 'master_*').{update,delete,insert}` → **P0**.
- Calls to provider APIs (Telnyx/QBO/SRS/Stripe/OpenAI/Anthropic/Resend) with API key in client code → **P0**.
- `fetch('/functions/v1/<webhook-receiver>')` from frontend (webhook URLs are for providers, not us) → **P1**.

### Gate 5 — Public storage buckets
```sql
SELECT id, name, public FROM storage.buckets WHERE public=true;
```
For each public bucket: list policies and confirm intended (e.g., logos, published-quote covers). Tenant-data buckets that are `public=true` → **P0**. Also verify per project Core memory: every storage policy enforces `{tenant_id}/...` as first path segment.

### Gate 6 — Wildcard CORS on sensitive functions
```bash
rg -n "Access-Control-Allow-Origin.*\*" supabase/functions/
```
For each match, classify the function:
- Public webhook receiver (Telnyx/Stripe/SRS inbound) → `*` is acceptable.
- Public lead intake / portal read → acceptable if payload is sanitized and rate-limited.
- Admin / master-only / diagnostic / health / cache-bust / debug → **P1**. Restrict to known origins (preview + `https://pitch-crm.ai`) OR require master role in code. Note: `supabase-health` is explicitly called out — admin diagnostics must auth-gate even when CORS stays wide.
- Anything writing data → **P0** unless auth-gated server-side.

### Gate 7 — Missing auth checks in edge functions
For each function under `supabase/functions/` that is NOT a signed webhook receiver:
- Confirm `Authorization` header is read AND `supabase.auth.getClaims(token)` (or equivalent) is called.
- Confirm 401 is returned on failure with CORS headers.
- Confirm role/tenant gating happens after auth.
Missing → **P0** for any function that mutates data; **P1** for read-only.

For webhook receivers: confirm provider signature verification (`Telnyx-Signature-Ed25519`, `Stripe-Signature`, etc.). Missing signature check → **P0**.

### Gate 8 — Missing tenant checks
For each query in edge functions and `src/`, flag any read/write of a tenant-scoped table that lacks `.eq('tenant_id', …)` / `.eq('company_id', …)`. Cross-reference Core memory list of tenant-scoped tables (contacts, jobs, pipeline_entries, estimates, invoices, photos, documents, measurements, integration credentials, etc.). **P0** for writes, **P1** for reads (data leakage).

### Gate 9 — Exposed / committed secrets
- `rg -n "(sk_live|sk_test|rk_live|whsec_|SG\\.|AIza|xoxb-|ghp_|eyJhbGciOi[A-Za-z0-9_-]{20,})" --hidden -g '!node_modules' -g '!*.lock'` — any hit outside `supabase/migrations` examples = **P0**.
- `rg -n "VITE_[A-Z_]+(SECRET|PRIVATE|SERVICE|TOKEN|API_KEY)" src/` — `VITE_*` should only carry publishable keys. Anything matching SECRET/PRIVATE/SERVICE_ROLE/non-publishable token → **P0**.
- Any hardcoded phone number, company UUID, user UUID, or Telnyx connection ID in source → **P1** (per project architecture guard).
- Cross-check `secrets--fetch_secrets` list against secret names referenced via `Deno.env.get(...)` — list expected-but-missing secrets as **P2** info.

### Gate 10 — Auth & platform hardening
- Run `supabase--linter`; surface any **leaked password protection disabled**, **MFA disabled**, **OTP long expiry**, **postgres version outdated** warnings as **P1**.
- Check `auth.config` for: email confirmation enforced, password min length, password breach check (HIBP), session timeout sane.
- Check that password reset uses the custom Resend function per Core memory, not legacy SMTP.
- Check public schema for `SECURITY DEFINER` functions without `SET search_path = public` → **P0** (RLS bypass risk).
- Check for triggers on `auth`, `storage`, `realtime`, `vault`, `supabase_functions` schemas → **P0** (forbidden per Lovable rules).

## Output format

```
# Security & RLS Lint Report — {timestamp}

## Summary
- P0 critical: N
- P1 high: N
- P2 info: N
- Top 5 risks (one line each)

## Gate {1..10}
- Finding: ...
- Severity: P0|P1|P2
- Evidence: file:line OR row count + sample
- Remediation (SQL / code diff, review-only): ...

## Proposed remediations, ordered by blast radius
1. P0 secret/role exposures — rotate keys FIRST, then patch code.
2. P0 RLS gaps — enable RLS + add tenant-scoped policies (one migration per table).
3. P0 service-role misuse in edge functions — add tenant filter + audit log.
4. P0 missing webhook signature checks.
5. P1 wildcard CORS on admin endpoints — restrict origin or gate by role.
6. P1 missing auth checks on read-only endpoints.
7. P2 platform hardening (HIBP, MFA, OTP expiry).

## Open questions
1. Is bucket `<x>` intentionally public?
2. Is endpoint `<y>` intentionally CORS-open?
```

## Refusal triggers

Refuse and explain if asked to:
- Auto-apply RLS policy changes without per-table review.
- Rotate or print a secret value in chat.
- Add `USING (true)` to any non-public-by-design table.
- Disable RLS to "make a query work".
- Move a service-role key into the frontend, even temporarily.
- Add `Access-Control-Allow-Origin: '*'` to a function that writes data and lacks auth.
- "Just trust" `company_id` from request body.

## Remediation migration ordering

When the user approves fixes, emit migrations separately, in this order:
1. Rotate exposed secrets (out-of-band; this skill only lists names).
2. Enable RLS on tables missing it (one migration per table; include FORCE if owner-bypass risk).
3. Add tenant-scoped policies (split SELECT / INSERT / UPDATE / DELETE; reference `has_role()` / `current_tenant_id()` helpers; never recursive — use `SECURITY DEFINER` helper per project rules).
4. Replace `USING (true)` policies.
5. Patch edge functions: add `getClaims` + tenant resolution + audit log; tighten CORS on admin routes; add signature verification on webhooks.
6. Remove hardcoded secrets/IDs from `src/`; move to `Deno.env` in edge functions.
7. Enable Supabase auth hardening (HIBP, MFA, OTP expiry) via dashboard — surface as user-action items, not migrations.

Never bundle steps. Each is reviewable in isolation.
