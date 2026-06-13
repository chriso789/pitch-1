# QXO Runtime Tenant Isolation + Routed API Migration

This is a stop-ship security PR. Goal: every QXO action runs behind `qxo-api` with JWT-resolved tenant, verified supplier connection, scope check, audit log, rate limit, and (for writes) idempotency. Body-supplied `tenant_id` is ignored everywhere in QXO.

## Order of work

### Step 1 — Recon (parallel reads, ~1 batch)
Read current shape before touching anything:
- `supabase/functions/_shared/router.ts` (confirm `serveRouter`, `requireAuth`, `requireTenant`, `jsonOk/jsonErr` signatures)
- `supabase/functions/_shared/shim.ts`
- `supabase/functions/_shared/qxo-auth.ts` (`getBeaconAuth` signature)
- `supabase/functions/qxo-api/index.ts`
- `supabase/functions/qxo-orders/index.ts`, `qxo-invoices-v4`, `qxo-quotes`, `qxo-submit-order`, `qxo-submit-quote-order`, `qxo-push-order`, `qxo-pricing`, `qxo-sync-orchestrator`, `qxo-save-credentials`
- `src/components/orders/PushToSupplierDialog.tsx`
- `src/lib/edgeApi.ts` (already in context — already supports the `edgeApi(fn, route, body)` pattern)

Confirm `user_company_access` column name (`tenant_id` vs `company_id`) and existence of any `has_role`/master helper.

### Step 2 — Migrations (single migration call, awaits approval)

Three concerns in one migration:

1. `ALTER TABLE qxo_connections` adding `authorized_by_user_id`, `authorization_method`, `authorization_status`, `scopes text[]`, `connected_at`, `revoked_at`, `last_verified_at` + backfill (using `IS NULL OR = 'pending'`, not `IN ('pending', NULL)`) + composite index.
2. `CREATE TABLE supplier_audit_log` + GRANTs (service_role only; authenticated SELECT gated to own-tenant via `has_role`/tenant helper if available, else no client policy) + RLS.
3. `CREATE TABLE supplier_idempotency_keys` with UNIQUE (tenant_id, supplier, action, idempotency_key) + GRANTs (service_role only) + RLS.
4. `CREATE TABLE supplier_rate_limits` with UNIQUE (tenant_id, user_id, supplier, action, window_start) + GRANTs (service_role only) + RLS.

All three new tables: service_role full, no anon/authenticated write policies. RLS enabled.

### Step 3 — Shared QXO integration helpers

Create under `supabase/functions/_shared/integrations/`:

- **`qxo-tenant-guard.ts`** — exports `qxoTenantGuard(c, { action, requiredScope })`. Reads `userId`/`tenantId`/`requestId` from Hono context (NEVER body). Service-role client. Loads `qxo_connections` for that tenant; verifies `tenant_id` match, `connection_status='connected'`, `authorization_status='active'`, scope present. Throws via `jsonErr` on failure (403 `qxo_not_authorized` / 412 `qxo_connection_missing` / 403 `qxo_scope_missing`). Returns `{ userId, tenantId, requestId, qxoConnection }`. Never returns secrets.
- **`qxo-audit.ts`** — `auditQxo({ tenantId, userId, action, result, requestId, idempotencyKey, supplierAccountId, metadata })` writes to `supplier_audit_log` with `supplier='qxo'`. Redacts any `token|secret|password|key` in metadata.
- **`qxo-idempotency.ts`** — `withIdempotency({ tenantId, action, key, payload, run })`. SHA-256 the payload for `request_hash`. Atomically insert started row; on conflict: same hash → return stored response; different hash → 409 `idempotency_key_reused_with_different_payload`. After `run()`, update row with `succeeded`/`failed`/`pending_verification` and `response_json`.
- **`qxo-rate-limit.ts`** — `checkRateLimit({ tenantId, userId, action, limit, windowSeconds })` using sliding window into `supplier_rate_limits`. Returns 429 on exceed; emits audit row.

### Step 4 — Rewrite `qxo-api/index.ts`

Replace scaffold with:

```ts
const app = createRouter("qxo-api");
app.get("/__health", (c) => jsonOk(c, { fn: "qxo-api", ok: true }));
app.use("/*", requireAuth);
app.use("/*", requireTenant);
```

Add routes (each: tenant guard with required scope → rate limit → audit → handler → audit). Handlers wrap the existing logic currently in the legacy functions, but load QXO creds only via `getBeaconAuth(supabase, resolvedTenantId)`:

- `POST /orders/list` (scope: `order_status`)
- `POST /orders/detail` (`order_status`)
- `POST /orders/pdf` (`order_status`)
- `POST /orders/submit` (`order_submit`, idempotency required)
- `POST /orders/submit-quote` (`order_submit`, idempotency required)
- `POST /invoices/list` (`invoice_read`)
- `POST /invoices/pdf` (`invoice_read`)
- `POST /quotes/list` (`pricing`)
- `POST /quotes/detail` (`pricing`)
- `POST /quotes/revise` (`order_submit`, idempotency required)
- `POST /quotes/reject` (`order_submit`)
- `POST /quotes/submit` (`order_submit`, idempotency required)
- `POST /pricing/lookup` (`pricing`)
- `POST /sync/tenant` (`pricing` or `order_status`) — single-tenant sync only

`serveRouter(app)` at bottom.

Strict response envelope. No QXO username/password/access_token/refresh_token in any response or audit metadata.

### Step 5 — Shim the seven legacy functions

Replace each with `_shared/shim.ts` forwarder. Each shim:
- preserves `Authorization`
- adds `x-shim-from: <old-name>`
- ignores `body.tenant_id`
- maps to the corresponding `qxo-api` route (action-based for `qxo-quotes`)
- carries the `// TEMPORARY SHIM — delete after references are migrated and logs are quiet for 14 days.` comment
- never loads QXO creds itself

`qxo-pricing` shim → `/pricing/lookup` (NOT the global API key path). If the legacy global-key path is currently in use, this PR drops it; document in the legacy file header and acceptance note.

`qxo-push-order` → forward to `/orders/submit` (assume still in use; safer than 410).

### Step 6 — Quarantine `qxo-sync-orchestrator`

Keep as standalone worker. Require `x-internal-worker-secret` header matching `INTERNAL_WORKER_SECRET` env. Reject (401) otherwise. No JWT path. Iterates all connected tenants, calls per-tenant sync, writes audit row per tenant. Document under "Approved exceptions" in `docs/EDGE_FUNCTION_RULES.md`.

User-triggered single-tenant sync goes through `qxo-api POST /sync/tenant` (resolved tenant only).

### Step 7 — Fix `qxo-save-credentials`

Audit existing membership check. Normalize to the column the rest of the repo uses (`user_company_access.tenant_id` per project memory). On save/finalize set `authorized_by_user_id = auth.uid()`, `authorization_method = 'api_key'`, `authorization_status = 'active'`, `scopes = ['pricing','catalog','order_submit','order_status','invoice_read','delivery_tracking']`, `connected_at = now()`, `last_verified_at = now()`. Master-role exception only if a `has_role` helper already exists.

### Step 8 — Frontend: `PushToSupplierDialog.tsx`

Replace the QXO branch's `supabase.functions.invoke('qxo-submit-order', { body: { tenant_id, ... }})` with:

```ts
const idempotencyKey = crypto.randomUUID();
const { data, error } = await edgeApi("qxo-api", "/orders/submit", {
  idempotency_key: idempotencyKey,
  project_id: projectId,
  job_id: projectId,
  job_name: customerName,
  job_number: jobNumber,
  delivery_address: addr,
  special_instruction: notes || (customerName ? `For ${customerName}` : undefined),
  on_hold: false,
  check_for_availability: "yes",
  items: editableItems.map(...),
});
```

Remove `tenant_id` from the payload. No other behavior changes.

### Step 9 — Tests

Add three integration test files under `tests/integration/`:
- `qxo-tenant-isolation.test.ts` — cross-tenant denial across list/detail/submit/invoices/quotes/pricing; body `tenant_id` ignored; missing/revoked/expired/scope-missing connection blocks; audit row written on deny.
- `qxo-order-idempotency.test.ts` — missing key → 400; same key+same payload → cached; same key+different payload → 409; never double-submits to supplier (mock asserts call count = 1).
- `qxo-legacy-shims.test.ts` — each shim forwards, never loads creds, body tenant_id ignored.

All supplier calls mocked (mock layer over `getBeaconAuth` + outbound `fetch`). Tests assert no `username|password|access_token|refresh_token` substrings appear in any response body or audit metadata.

### Step 10 — Docs

- Append QXO routes and the `qxo-sync-orchestrator` internal-worker exception to `docs/EDGE_FUNCTION_RULES.md`.
- Update `docs/edge-function-current-status.md` (shim count +7, qxo-api with real routes +1, legacy migrated +7).

## Out of scope (per user)

- ABC / SRS / Billtrust hardening (deferred — same shared helpers apply later).
- Cross-customer QXO price DB (forbidden).
- Browser-stored QXO credentials (forbidden).
- Portal scraping.
- Pricing global-API-key path (this PR removes/deprecates it).

## Confirmation requested before I start

1. **Idempotency key source on `crypto.randomUUID()` per submit click** — that's correct only if the dialog mounts once per submission attempt. If users can rapid-click submit, the UUID changes on every click and we lose dedupe. Should I generate the key once when the dialog opens (so retries within the same dialog session dedupe) instead of per click? **Default: generate once on dialog open.**

2. **`qxo-push-order`** — shim to `/orders/submit` or return 410? Repo audit will show usage; I'll default to shim unless zero references.

3. **`supplier_audit_log` tenant-admin read policy** — if no `has_role('admin', auth.uid())` helper exists yet, I'll ship with **service-role-only** access (no client read). Confirm OK, or do you want me to add a minimal admin-read policy now?

4. **One mega-migration vs four small ones** — I'll batch into one migration call (qxo_connections ALTER + three new tables) since they're a logical unit. Confirm OK.

Once you say "go" (and answer Q1–Q3 if you want a non-default), I'll execute Steps 1→10 without further interruption.
