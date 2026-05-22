## Current state (verified against repo)

- **457** function folders in `supabase/functions/` (down from ~499)
- Audit CSV exists with **410** legacy entries: 300 MIGRATE, 69 DELETE_CANDIDATE, 21 SHIM, 20 KEEP — but **109 MIGRATE rows still have target `TBD`**
- **31 grouped functions exist as ~20-line shells** — every route returns `501 not_migrated`. No logic actually moved yet.
- Shared helpers present: `router.ts`, `shim.ts`, `env.ts`, `tenant.ts`, `rateLimit.ts`
- **Missing helpers**: `auth.ts`, `errors.ts`, `audit.ts`
- `scripts/audit-edge-functions.ts` exists (299 lines) but `docs/edge-function-current-status.md` does not

So scaffolding is in place, real consolidation work has not started.

## Plan

### Phase 0 — Finalize audit (1 pass, no code)

1. Resolve the **109 TBD targets** in `docs/edge-function-consolidation-audit.csv` by classifying each by domain (messaging, measurement, supplier, etc.). Anything that genuinely doesn't fit → flip to `DELETE_CANDIDATE`.
2. Re-tally so every MIGRATE row has a concrete `recommended_new_function` + `recommended_new_route`.

### Phase 1 — Complete shared helpers

Add the three missing files (the router already does most of the work, these split responsibilities cleanly):

- `_shared/auth.ts` — `requireAuth`, `requireServiceRole`, `requireInternalSecret(WORKER_SECRET)`, `requireWebhookSignature(provider)`
- `_shared/errors.ts` — typed error codes + `httpFromCode()` mapper; `{ok:false,error,code,details}` envelope
- `_shared/audit.ts` — `logAuditAsync()` + `logShimCall()` writing to `edge_function_audit_log` (new table, see Phase 2)

Extend `router.ts` to expose `app.publicWebhook(path, handler)` and `app.workerRoute(path, handler)` shortcuts that bypass auth but enforce signature/service-role.

### Phase 2 — Audit table + RLS

Migration: create `edge_function_audit_log` (function_name, route, method, status, latency_ms, user_id, tenant_id, shim_from, request_id, created_at). Service-role-only writes; admins read.

### Phase 3 — Wire routes into the 31 grouped functions

Driven by the audit CSV's `recommended_new_function`/`recommended_new_route`. For each grouped function:

1. Replace `501 not_migrated` stub with real handler.
2. Copy logic from the legacy function (don't rewrite — port verbatim, then refactor minimally for the router context).
3. Reuse existing `_shared/*` helpers (telnyx.ts, lovable-ai.ts, supabase.ts, etc.).
4. Tenant-scoped routes verify `tenant_id` against authenticated user (never trust client-supplied IDs).

Priority order by MIGRATE volume:
- `supplier-api` (19), `measurement-api` (18), `document-api` (16), `email-api` (15), `signature-api` (13), `telnyx-api` (11), `payment-api` (8), `ai-api` (8), `map-api` (6), `qbo-api` (5), `canvass-api` (5), `ai-worker` (5), and the long tail.

### Phase 4 — Shim every migrated legacy function

For each migrated legacy `supabase/functions/<old>/index.ts`, replace with:

```ts
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "messaging-api", "/sms/send", "send-sms"));
```

`shim.ts` already exists — extend it to call `logShimCall()` so we see which legacy URLs are still being hit in production. **Do not delete the old folder yet** — the deployed function keeps serving traffic via the shim until logs show zero hits.

### Phase 5 — Frontend migration

Update `src/lib/edgeApi.ts` consumers and any direct `supabase.functions.invoke("<old-name>")` call sites in `src/**` to call the grouped function + route. Keep old invokes working (the shim handles it) but migrate the hot paths.

### Phase 6 — Delete-candidate triage

For each of the 69 DELETE_CANDIDATE rows, run the audit script's reference scan. If 0 frontend / backend / docs hits → append to `docs/edge-function-delete-candidates.md` with last-modified date and recommended drop date (deletion happens in a later loop, not this one).

### Phase 7 — KEEP / public webhooks

Document each of the 20 KEEP rows in `docs/edge-function-current-status.md` with: provider, dashboard URL where the webhook is registered, signature secret env var. These cannot be shimmed without breaking provider configuration.

### Phase 8 — Audit script + status doc

1. Extend `scripts/audit-edge-functions.ts` to write structured output to `docs/edge-function-current-status.md` with the exact counts requested:
   - folder count (excluding `_shared`)
   - grouped routed functions
   - legacy shim functions
   - delete candidates (with reference-check results)
   - public webhooks that must stay
   - frontend call sites still pointing to old names
   - remaining action plan to reach <150 deployed functions
2. Run it once and commit the generated `current-status.md`.

### Phase 9 — `supabase/config.toml`

Ensure every grouped function has `verify_jwt = false` (auth done in router via `getClaims`). Public webhooks: `verify_jwt = false` + signature validation. Worker routes: `verify_jwt = false` + `requireInternalSecret`.

### Phase 10 — Rules doc

Update `docs/EDGE_FUNCTION_RULES.md` with the "one domain = one edge function with internal routes" rule and a PR checklist: any new function PR that adds a folder under `supabase/functions/` (not matching `*-api|*-worker|*-webhook` + already approved list) must be rejected.

## Technical details

**Routing convention** — already implemented in `router.ts` via Hono. Routes use real URL pathnames (`POST /functions/v1/messaging-api/sms/send`), not `__route` body field. The `edgeApi.ts` client already sends `x-route` header and `__route` body; keep that for backward compat with the shim, but new clients should call the path directly via `supabase.functions.invoke("messaging-api/sms/send")`.

**Tenant guard** — `requireTenant` middleware loads user → resolves `active_tenant_id` from `profiles` → sets `c.var.tenantId`. Routes must use `c.var.tenantId`, never read from body.

**Worker routes** — internal-only, called from pg_cron or other edge functions via `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` or `x-internal-secret: <WORKER_SECRET>` (new secret).

**Webhook signature validation** — Stripe, Telnyx, QBO, Resend, DocuSign each have HMAC verification. Use existing `_shared/telnyx.ts` patterns where present.

**Phased function-count targets** (per user request):
- After Phase 4 (shims in place, nothing deleted): still ~457
- After Phase 6 deletes execute (next loop): 250–300
- After legacy-function traffic confirmed zero and shims dropped: 120–160
- Final: 75–100

## Out of scope for this loop

- **Actually deleting** legacy functions (only documenting candidates; deletes happen after production logs show zero shim traffic)
- New backend features
- PDF packet generation, email/share workflow, claim tracker (separate roadmap)

## Deliverable check at end of loop

The audit script must report, in `docs/edge-function-current-status.md`:
- exact folder count
- exact grouped count = 31 (or higher if new domains needed)
- exact shim count = number of MIGRATE rows actually shimmed this loop
- exact delete-candidate count with reference-scan results
- exact public-webhook count = 20 (KEEP rows documented)
- exact frontend-still-old count
