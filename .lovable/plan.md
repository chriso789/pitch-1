
# ABC v2 — Step 2 (Recommended: Option C, scoped)

Recommendation: **C, but with a hard scope line** — stand up the entire `abc-api` route surface in one pass so the frontend has stable contracts to build against, but only OAuth + accounts are *real* in this chunk. Catalog/availability/price/orders return well-typed stubs backed by the new tables (empty arrays, `price_pending: true`, etc.) so UI work in later steps doesn't block on backend, and we never accidentally ship a fake price or fake order to a tenant.

Why not A: A leaves the frontend guessing at response shapes for 7 more routes, which causes churn when we wire the order modal and materials table later.
Why not B: order-modal refactor depends on `/accounts` + `/catalog/family` shapes existing; doing it first means rework.

## Scope of this chunk

### 1. `abc-api` edge function (single routed Hono function, per EDGE_FUNCTION_RULES)

Routes mounted under `abc-api`, all `requireAuth` + `requireTenant` except `/oauth/callback` (public, validates `state`):

| Route | Status this chunk | Notes |
|---|---|---|
| `POST /oauth/start` | **real** | Generates PKCE verifier+challenge, stores in `abc_oauth_state` (new tiny table, tenant+user scoped, TTL 10 min), returns ABC Okta authorize URL with `offline_access` scope |
| `GET  /oauth/callback` | **real** | Public route. Validates `state`, exchanges code → tokens, encrypts refresh_token, upserts `abc_user_connections`, then calls ABC `GET /accounts` to discover ship-tos and `GET /accounts/{id}/branches` to populate `abc_ship_to_accounts` + `abc_account_branches`. Marks `is_default` / `is_home_branch`. Redirects back to `/settings/integrations?abc=connected` |
| `POST /oauth/disconnect` | **real** | Revokes ABC token, deletes connection + ship-tos + branches for this user |
| `GET  /accounts` | **real** | Returns ship-tos + branches for current user from DB |
| `GET  /catalog/search` | **stub** | Returns `{ items: [], total: 0 }` with correct typed shape; full-text query parsed but no rows yet (catalog sync is Step 3) |
| `GET  /catalog/family/:itemNumber` | **stub** | Returns `{ family: null, members: [] }` |
| `POST /availability` | **stub** | Returns `{ items: [{ itemNumber, available: null, pending: true }] }` |
| `POST /price` | **stub** | Returns `{ items: [{ itemNumber, uom, unitPrice: null, price_pending: true, reason: "catalog_not_synced" }] }` — never `$0.00`, never silently zero |
| `POST /orders/submit` | **stub** | Returns HTTP 501 `{ ok:false, code:"abc_orders_not_enabled" }` until Step 6 — order modal must surface this as "Coming soon", never silently succeed |
| `GET  /orders/:id` | **stub** | Same 501 |

All responses use the standard envelope `{ ok, data?, error?, code?, requestId }`.

### 2. New tiny table: `abc_oauth_state`

```text
abc_oauth_state(
  state TEXT PK,
  tenant_id UUID, user_id UUID,
  code_verifier TEXT, redirect_uri TEXT,
  created_at, expires_at  -- 10 min TTL
)
```
RLS: user can only see their own rows; service role full. Cleanup via `expires_at < now()` in callback.

### 3. Secrets needed (will request via secrets tool before deploying)

- `ABC_CLIENT_ID` (per environment)
- `ABC_CLIENT_SECRET`
- `ABC_OKTA_BASE_URL` (sandbox vs prod)
- `ABC_API_BASE_URL`
- `ABC_TOKEN_ENCRYPTION_KEY` (for refresh_token at rest)

Server-token-only secrets (`ABC_PARTNER_TOKEN`) stay as-is — used later by `abc-worker` for catalog sync.

### 4. Frontend changes (narrow, UI-only this chunk)

- **Replace `AbcConnectCard`** (the legacy "branch code + account number" form) with:
  - If `useSupplierDeveloperMode().showAdvanced` → existing dev panel stays (sandbox login, env selector, raw audit), gated behind a "Developer" tab.
  - Normal tenant view → single big **"Sign in with ABC Supply"** button → calls `/oauth/start`, redirects to ABC Okta.
  - After callback, card shows: connection status, signed-in user email, list of ship-to accounts (default badge), home branch per ship-to, and a "Disconnect" button.
- Add `useAbcConnection()` hook backed by `abc_user_connections` + `abc_ship_to_accounts` + `abc_account_branches`, tenant-scoped via `useEffectiveTenantId()`.
- No changes to order modal or materials table yet — those land in Steps 5–6 once catalog/pricing are real.

### 5. Guardrails honored

- Hard rules: no fake geometry, no fake measurements — extended here to **no fake pricing and no fake orders**. Stubs are explicitly typed as `pending` / 501 so UI cannot render a misleading $0.00 or "order placed".
- Edge function rules: one routed `abc-api`, not one function per route. `abc-oauth-callback` is the one allowed standalone (public redirect URL) and is listed in `EDGE_FUNCTION_RULES.md` exceptions — but here we keep callback as a route on `abc-api` with `verify_jwt = false` for just that path, which is simpler and already permitted (state param is the auth). If ABC's redirect URI registration requires a fixed standalone path, we'll split `abc-oauth-callback` out as a documented exception — flagged for confirmation below.
- Multi-tenancy: every query uses `useEffectiveTenantId()` + explicit `.eq('tenant_id', ...)`.
- Architecture guard: no new standalone functions beyond the (possibly) one OAuth callback.

### 6. Out of scope this chunk (queued for next chunks)

- Step 3: `abc-worker` full-sync + delta-sync (populates `abc_catalog_items`, `abc_item_family_members`)
- Step 4: live pricing hook + price cache writes
- Step 5: materials table color-aware mapping UI (`abc_material_sku_mappings`)
- Step 6: order modal refactor (ship-to + branch + delivery override) + real `/orders/submit`
- Step 7: `abc-webhook` order-status → unified inbox
- Step 8: developer-mode gating rollout to SRS + QXO
- Step 9: per-tenant `abc_v2_enabled` flag + legacy form removal

## One question before I build

**OAuth callback shape** — do you want me to:

- **(i)** Keep callback as a route on `abc-api` (`GET /oauth/callback` with `verify_jwt = false` for that path only) — simpler, one function, but ABC's registered redirect URI will be `https://<project>.functions.supabase.co/abc-api/oauth/callback`.
- **(ii)** Split it out as a dedicated `abc-oauth-callback` standalone function (already listed as an approved exception in `EDGE_FUNCTION_RULES.md`), so the redirect URI is the cleaner `https://<project>.functions.supabase.co/abc-oauth-callback`.

If ABC's developer portal has already had a redirect URI registered for the legacy integration, tell me which one and I'll match it. Otherwise I'll default to **(ii)** because it matches the doc and is what ABC's TPA guide expects.
