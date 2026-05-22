
# Edge Function Consolidation Plan

## Current State
- `supabase/functions/` contains **412 functions** (cap is 500 — getting close).
- **535** `supabase.functions.invoke(...)` calls in `src/`, plus **22** raw `/functions/v1/` fetches.
- Goal: collapse into ~40 routed API functions + webhooks + workers, without breaking the running app.

## Strategy: 4 Phases, No Big-Bang
Each phase is independently shippable. We never delete a function until references are gone AND logs have been quiet for 14 days.

---

## Phase 1 — Audit + Scaffolding (this pass)

### 1a. Repo-wide audit
Build a script (`scripts/audit-edge-functions.ts`) that:
- Reads every folder under `supabase/functions/*`.
- Greps the entire repo for each name across:
  - `supabase.functions.invoke("name"|'name'|\`name\`)`
  - `fetch(..."/functions/v1/name"...)`
  - Internal edge-function-to-edge-function `fetch` calls (scan `supabase/functions/**/index.ts`)
  - Docs (`docs/**`, `*.md`, `README*`)
  - `supabase/config.toml` and cron/scheduled refs
- Classifies each function into one of the target domains (messaging, email, measurement, supplier, qbo, ai, payment, canvass, permit, storm, map, document, pdf, signature, admin, auth, company, user, contact, job, pipeline, task, analytics, security, backup, health, training-data, roof-report-ingest, property-data, voice, webhook).
- Flags `is_public_webhook` (any function whose name contains `webhook`, `inbound`, `oauth-callback`, or is referenced by an external provider).
- Risk levels:
  - HIGH = public webhooks, payment, auth, OAuth callbacks
  - MEDIUM = workers, cron-driven, high-volume (messaging, measurement)
  - LOW = simple CRUD/RPC wrappers
- Outputs:
  - `docs/EDGE_FUNCTION_CONSOLIDATION_AUDIT.md` (human summary, per-domain counts, risk callouts)
  - `docs/edge-function-consolidation-audit.csv` with the exact columns specified

### 1b. Scaffold routed API skeletons
Create empty Hono-based functions (NO logic moved yet — just route shells returning `501 not_migrated` for unmapped paths). One folder per target function:

```
supabase/functions/messaging-api/index.ts
supabase/functions/messaging-webhook/index.ts
supabase/functions/messaging-worker/index.ts
supabase/functions/email-api/index.ts
... (full list from task)
```

Each uses a shared template at `supabase/functions/_shared/router.ts`:
- CORS (npm:@supabase/supabase-js@2/cors)
- Auth guard helper (`requireAuth(c)` → calls `supabase.auth.getClaims(token)`); skipped on routes registered as `public`.
- Tenant guard helper (`requireTenant(c, claims)` → resolves `tenant_id` via existing `useEffectiveTenantId` server equivalent already in `_shared`).
- Consistent JSON: `{ ok, data?, error?, code?, requestId }`.
- Request id via `crypto.randomUUID()`.
- Audit logger → inserts into `edge_function_audit` (migration adds the table if missing; columns: id, function_name, route, method, user_id, tenant_id, status, latency_ms, request_id, created_at).

This phase ships an empty but routable surface. Frontend not touched yet.

### 1c. Backend audit table migration
New migration adds `edge_function_audit` + RLS (master/COB read, service-role insert). This is the only DB change in phase 1.

---

## Phase 2 — Move logic + add shims (per domain, repeated)

For each domain (messaging first → highest call volume), in one PR per domain:

1. Copy logic from each old function into the matching route handler in the new routed API.
2. Replace the old function's `index.ts` with a **forwarding shim**:
   ```ts
   // TEMPORARY SHIM — delete after references migrated and logs quiet for 14 days.
   import { forward } from "../_shared/shim.ts";
   Deno.serve((req) => forward(req, "messaging-api", "/sms/send"));
   ```
   `forward()` preserves method, headers (Authorization, apikey, content-type), body, and logs `deprecated_invoke` to `edge_function_audit`.
3. Run deploy + smoke test (curl_edge_functions) against both old shim and new route.

**Domain order** (lowest blast radius first):
1. map-api, health-api (read-only, low risk)
2. ai-api, ai-worker (mostly internal)
3. document-api, pdf-api, signature-api (no provider webhooks except docusign)
4. measurement-api, measurement-worker, roof-report-ingest, training-data-api
5. canvass-api, property-data-api, permit-api, storm-api
6. supplier-api, supplier-worker, qbo-api, qxo via supplier
7. messaging-api, email-api, telnyx-api (high volume — last after pattern proven)
8. payment-api, stripe-webhook
9. admin-api, auth-api, company-api, user-api, contact-api, job-api, pipeline-api, task-api

Public webhooks (`*-webhook`, `*oauth-callback`, telnyx inbound, stripe-webhook-handler, docusign-webhook, qbo-webhook-handler) are **migrated logically into the new routed *-webhook function**, but the OLD function folder stays as a shim **indefinitely** until the provider's callback URL is verified switched. The audit CSV's `is_public_webhook=true` rows are flagged "DO NOT DELETE — requires provider URL update".

---

## Phase 3 — Frontend migration

Per-domain, after the domain's routes are live:
- Replace `supabase.functions.invoke("send-sms", ...)` → `invoke("messaging-api", { body: { ...body }, headers: { "x-route": "/sms/send" }})` OR pass path via wrapping helper.
- Introduce `src/lib/edgeApi.ts`:
  ```ts
  export const api = (fn: string, route: string, body?: any) =>
    supabase.functions.invoke(fn, { body: { __route: route, ...body }});
  ```
  Router reads `__route` and dispatches. (Avoids needing per-call URL construction and keeps `invoke` semantics intact.)
- Update the confirmed hot files first:
  - `src/hooks/useSendSMS.ts`, `useMeasurement.ts`, `useMapboxToken.ts`, `useReportPacket.ts`, `usePdfAiRewrite.ts`, `useAIErrorFixer.ts`, `useXactComparison.ts`, `useScopeComparison.ts`
  - `src/lib/mobileBootstrap.ts`
  - `src/components/orders/PushToQXOButton.tsx`
  - `src/components/storm-canvass/DropPinDialog.tsx`
  - `src/components/skip-trace/SkipTraceButton.tsx`
  - `src/features/contacts/components/LeadScoringActions.tsx`
- Then sweep the rest using the audit CSV as the worklist.

---

## Phase 4 — Cleanup

1. Produce `docs/EDGE_FUNCTION_DELETE_CANDIDATES.md` from updated audit, grouped:
   - Safe delete (zero references, 14d quiet shim log)
   - Keep as public webhook
   - Keep as active worker
   - Shim for 14 days
   - Unknown / manual review
2. Delete in batches of ~25 via `supabase--delete_edge_functions`.
3. Target: < 100 functions remaining.
4. Add `docs/EDGE_FUNCTION_RULES.md` (rules from task 8) + CI check (`scripts/check-no-new-one-off.ts`) that fails PRs adding new `supabase/functions/*` folders not in an allowlist (api/webhook/worker suffix).

---

## Technical Details

### Router choice
`jsr:@hono/hono` per task spec. One `Hono()` per function. Shared middleware factory in `_shared/router.ts`. Avoids per-function boilerplate.

### Auth model
Default = `verify_jwt = false` in config (existing project pattern), JWT validated **in code** via `supabase.auth.getClaims(token)`. Public routes opt-in via `app.post("/path", { public: true }, handler)` wrapper.

### Tenant isolation
Every non-public route resolves `tenant_id` from JWT claims + `user_company_access` table via existing helper in `supabase/functions/_shared/` (already used by current functions). Body-supplied `tenant_id` is **ignored**, never trusted.

### Shim safety
- `forward()` adds header `x-shim-from: <old-name>` so audit log distinguishes shim traffic from direct.
- Shim never mutates body; pass-through stream.
- If new route returns non-2xx, shim returns it verbatim.

### Webhook safety
Public webhooks (Telnyx, Stripe, DocuSign, QBO, ABC OAuth callback) keep their original deployed URL until ops manually updates provider config. Doc + delete-candidates file explicitly lists each provider + dashboard URL.

### Things NOT changed
- No DB schema renames.
- No RLS changes other than the new audit table.
- No UI changes beyond `invoke()` call sites.
- No removal of cron-driven workers in this pass.

---

## What this first pass delivers
1. `scripts/audit-edge-functions.ts` + generated `docs/EDGE_FUNCTION_CONSOLIDATION_AUDIT.md` + `docs/edge-function-consolidation-audit.csv`.
2. Migration creating `edge_function_audit` table.
3. `supabase/functions/_shared/router.ts` + `_shared/shim.ts`.
4. All ~40 routed function folders scaffolded (empty handlers, route registry, deploys clean).
5. `src/lib/edgeApi.ts` helper (no call sites migrated yet).
6. `docs/EDGE_FUNCTION_RULES.md`.

No old functions deleted. No frontend calls changed yet. App keeps running on the existing 412 functions.

## Open questions before I start
1. Is it OK that this first pass **adds ~40 new function folders** (taking us from 412 → ~452, still under cap) before any are deleted? Alternative: scaffold lazily one domain at a time.
2. For the routing convention — do you prefer body-based `{ __route, ...payload }` (works with `supabase.functions.invoke` unchanged) or path-based (`invoke("messaging-api/sms/send", ...)` requires URL-style calls)? Body-based is safer for the existing SDK usage.
3. Should the shim layer also rate-limit / circuit-break, or pure pass-through?
