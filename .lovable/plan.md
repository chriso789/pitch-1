## Third-Party Aggregator Hardening — Phased Plan

Pitch is a multi-tenant supplier aggregator (ABC / QXO / SRS). The biggest live risk is cross-tenant supplier access via QXO endpoints. We will land the work in five phases, in the order you specified (1 → 3 → 4 → 5), with QXO tenant gating shipped first.

### Phase 1 — Save source-of-truth docs (small, do first)
Create two markdown files committing the strategy:
- `docs/integrations/production-readiness-audit.md` — the full audit you provided, verbatim, as the canonical reference.
- `docs/integrations/third-party-aggregator-readiness.md` — explicit statement that Pitch is an aggregator (tenant → authorized user → connected supplier account → supplier API → audit → response stored under same tenant) plus the stop-ship risk list.

No code changes in this phase.

### Phase 2 — QXO tenant verification (highest-priority code fix)
Add hard tenant gating to QXO edge functions:
- `supabase/functions/qxo-orders`
- `supabase/functions/qxo-invoices-v4`
- `supabase/functions/qxo-quotes`
- `supabase/functions/qxo-sync-orchestrator`
- `supabase/functions/qxo-submit-order` (verify + patch if needed)

For each: resolve user from JWT (`getClaims`), resolve active tenant server-side via `user_company_access`, verify the QXO connection / credential / account row's `tenant_id` matches, reject mismatches with 403 + safe message, never trust `tenant_id` / `account_id` / `credential_id` from the body, never return credentials to the browser. Fail closed on any uncertainty. Add structured deny logs.

Also fix the supplier-boundary bug:
- `src/components/orders/PushToQXOButton.tsx` currently calls `abc-api-proxy` with ABC payload shape. Either route it to the real QXO endpoint or delete it in favor of `PushToSupplierButton` / `PushToSupplierDialog`. Confirm direction with user during implementation — default plan: remove `PushToQXOButton` and replace any usages with `PushToSupplierButton`, since the shared dialog already routes per supplier.

### Phase 3 — Shared integration primitives
Scaffold `supabase/functions/_shared/integrations/`:
- `tenant-guard.ts` — auth + tenant membership + supplier-connection-owns-tenant + scope check; single helper QXO/ABC/SRS routes call.
- `credential-vault.ts` — tenant-scoped credential fetch, token refresh hook, redaction, never-to-browser invariant.
- `idempotency.ts` — `tenant_id + supplier + action + idempotency_key` dedupe with stored result; backed by a new `supplier_idempotency_keys` table (migration in this phase).
- `webhook-verify.ts` — per-supplier signature verifier, marks unsupported suppliers as `manual_review_required`.
- `audit.ts` — structured supplier audit events written to a new `supplier_audit_log` table (migration in this phase), with token/secret redaction.
- `rate-limit.ts` — per (tenant, user, supplier, action) sliding-window limiter using a new `supplier_rate_limits` table, returns 429 + audit event.

Migrations (one combined migration):
- `supplier_idempotency_keys` (tenant_id, supplier, action, idempotency_key UNIQUE, response_jsonb, status, created_at)
- `supplier_audit_log` (tenant_id, user_id, supplier, supplier_account_id, action, result, request_id, idempotency_key, metadata_jsonb, created_at)
- `supplier_rate_limits` (tenant_id, user_id, supplier, action, window_start, count)

All three: GRANTs to `service_role` only, RLS on, deny-all policies for `authenticated` except admin read on audit log.

Wire the new helpers into QXO endpoints (Phase 2 endpoints get a follow-up patch to call `tenantGuard()`, `audit()`, `idempotency()`).

### Phase 4 — Customer authorization data model
Add `supplier_connections` enhancements (or new table if missing) with:
`tenant_id, supplier, supplier_account_id, authorized_by_user_id, authorization_method, authorization_status, scopes[], connected_at, revoked_at, last_verified_at, environment`.

Inspect existing `abc_connections`, `qxo_connections`, `srs_connections` first — likely we add the missing fields (`scopes`, `authorization_method`, `authorization_status`, `authorized_by_user_id`, `last_verified_at`) rather than create a new table. Enforce in `tenant-guard.ts`: required scope must be present and `authorization_status='active'`.

### Phase 5 — Compliance docs + supplier runbooks + CI
- `docs/compliance/*` — privacy-policy, terms-of-use, api-acceptable-use, customer-authorization-form, information-security-policy, incident-response-plan, data-retention-policy, logging-and-audit-standard, insurance/coverage-requirements (all written for aggregator posture: no scraping, no resale, no token pooling, no browser-stored supplier passwords, no cross-customer price DB).
- `docs/integrations/{abc,qxo,srs}-third-party-aggregator.md`, `docs/integrations/supplier-rate-limits.md`, `docs/integrations/supplier-webhooks.md`.
- CI: add `.github/workflows/secret-scan.yml` (gitleaks), `.gitleaks.toml`, ensure `.gitignore` includes `.env`, `.env.*`, `!.env.example`, supplier dumps. Confirm `package.json` has `lint`, `typecheck`, `test`, `test:unit` (already present per ci.yml).
- Add tests under `tests/integration/supplier-tenant-isolation.test.ts` covering: cross-tenant QXO read denied, cross-tenant order submit denied, revoked connection blocks pricing/order, missing `order_submit` scope blocks submit, duplicate idempotency key dedupes, audit row emitted on deny, secrets redacted from responses, `PushToQXOButton` (or replacement) never calls `abc-api-proxy`.

### Sequencing and confirmation
Phase 1 ships immediately (docs only — no risk). Then Phase 2 (QXO gating + supplier-boundary fix) which is the actual stop-ship. Phase 3 + 4 land together because the guard needs the data-model fields. Phase 5 closes out compliance + CI.

I'll need one quick confirmation before Phase 2 implementation: **remove `PushToQXOButton.tsx` and migrate its callers to `PushToSupplierButton`, or keep the button and rewire it to a real QXO route?** I'll ask inline once Phase 1 is committed.

### Out of scope for this loop
- ABC and SRS endpoint hardening (Phase 6, after the shared guard proves itself on QXO).
- Real signature docs from suppliers that don't publish them (tracked as `manual_review_required` in `webhook-verify.ts`).
- Billtrust quarantine (separate follow-up).
