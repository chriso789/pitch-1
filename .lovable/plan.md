## ABC Supply Integration — Audit Repair Plan

Adopting the audit verbatim. Fixes are scoped to 4 files plus 1 migration.

### 1. Redirect URI hardening (frontend + backend)
- `src/components/settings/ABCConnectionSettings.tsx`: stop deriving the callback URL from `VITE_SUPABASE_PROJECT_ID`. Hardcode `https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/abc-oauth-callback` and display it verbatim (with copy button) so the user pastes the right value into the ABC developer portal.
- `abc-api-proxy` `start_oauth`: ignore any client-supplied redirect, always use `${SUPABASE_URL}/functions/v1/abc-oauth-callback`.

### 2. Secure token storage
- Rewrite `abc-oauth-callback` to write into the existing `abc_tokens` table (encrypted columns) instead of plaintext columns on `abc_connections`.
- Add a small migration: `pgsodium` encrypt helper or `pgp_sym_encrypt` using `ABC_TOKEN_ENC_KEY` secret; expose `abc_tokens_upsert(tenant_id, env, access, refresh, expires_at, scope)` SECURITY DEFINER function. Callback + proxy use this function only.
- Update all proxy reads to fetch tokens via a matching `abc_tokens_get(tenant_id, env)` definer function returning decrypted values to the edge function context only.
- Leave `abc_connections` for metadata (client_id, scopes, environment, connection status, last_test). Drop reliance on plaintext token columns (keep columns nullable for now; clear on migration).

### 3. Correct ABC endpoint paths + payloads in `abc-api-proxy`
Replace fictional `/orders` calls. Use exact paths under `${cfg.apiBase}`:

```text
POST /pricing/v2/prices
GET  /location/v1/branches
GET  /location/v1/branches/{branchNumber}
POST /product/v1/search/items
GET  /product/v1/items/{itemNumber}
POST /order/v2/orders
GET  /order/v2/orders?confirmationNumber={cn}
GET  /order/v2/orders/{orderNumber}
GET  /order/v2/orders/orderHistory
```

Add proxy actions and remove the bad ones:
- `price_items` → POST /pricing/v2/prices
- `get_branches` → GET /location/v1/branches (optional `branchNumber` query)
- `search_products` → POST /product/v1/search/items
- `get_item` → GET /product/v1/items/{itemNumber}
- `place_order` (replaces `submit_order`) → POST /order/v2/orders
- `get_order_status` → GET /order/v2/orders/{orderNumber} (or by confirmationNumber)
- `submit_test_order` → same as place_order but with hardcoded sandbox-safe payload and `on_hold=true`
- Keep: `start_oauth`, `test_connection`, `get_status`

Payload shapes wired exactly as in the audit (orders is a JSON array of one order object; pricing uses `requestId`, `shipToNumber`, `branchNumber`, `purpose`, `lines[]`). `Authorization: Bearer <access_token>` only — no subscription key.

Update `PushToQXOButton` / any callers using `submit_order` → `place_order` and map item fields (`itemNumber`, `orderedQty.value/uom`, `unitPrice`).

### 4. Token refresh helper
Extract inline refresh logic into a `refreshAccessToken(tenant_id, env)` helper inside `abc-api-proxy`. Every action calls `ensureValidToken()` which refreshes when `expires_at - now < 60s`. Refreshed tokens go through `abc_tokens_upsert`.

### 5. Scopes
Default `ABC_SCOPES` becomes:
`pricing.read order.read order.write product.read account.read location.read offline_access`
(Notification scopes stay opt-in for when webhooks are registered.)

### 6. Audit logging
Add `abc_api_audit` table (migration): `tenant_id, environment, action, endpoint, method, request_body_redacted jsonb, status_code, response_body jsonb, duration_ms, created_at`. RLS: tenant admins read own rows; service role inserts. Every proxy outbound call wrapped in a logger that strips `Authorization`, `access_token`, `refresh_token`, `client_secret`.

### 7. Error mapping
Central `mapAbcError(status, body)` returning a stable `code` from:
`not_connected | token_expired | missing_scope | invalid_redirect_uri | invalid_client | abc_400_bad_payload | abc_401_unauthorized | abc_403_forbidden | abc_404_not_found | abc_429_rate_limited | abc_500_upstream`
Return `{ ok:false, code, message, abc_status, abc_body }` to the UI.

### 8. UI test buttons (`ABCConnectionSettings.tsx`)
Add a "Sandbox Test Console" panel exposing:
- Begin OAuth Authorization (existing)
- Test Token (calls `test_connection`)
- Test Branch Lookup (asks for branch number, calls `get_branches`)
- Test Product Search (item search input → `search_products`)
- Test Price Items (item + qty → `price_items`)
- Test Order Status (order number → `get_order_status`)
- Submit Sandbox Test Order (calls `submit_test_order`)

Each button shows raw JSON response + mapped error code in a result drawer so we can hand evidence to Penny.

### 9. config.toml (verify, no change expected)
```toml
[functions.abc-api-proxy]
verify_jwt = true
[functions.abc-oauth-callback]
verify_jwt = false
```

### 10. Cleanup of `abc-pricing`
It's a legacy stub. Two options — recommend **delete** to avoid drift. (Will confirm before deleting.)

### Files touched
- `supabase/functions/abc-api-proxy/index.ts` (rewrite action router, add helpers, fix paths/payloads)
- `supabase/functions/abc-oauth-callback/index.ts` (write to `abc_tokens` via RPC)
- `src/components/settings/ABCConnectionSettings.tsx` (hardcoded redirect URI display + new test console)
- `src/components/orders/PushToQXOButton.tsx` (rename action to `place_order`, remap payload)
- New migration: `abc_tokens` RPC helpers, `abc_api_audit` table + RLS
- `supabase/functions/abc-pricing/` (delete, pending confirmation)

### Open questions
1. OK to delete `abc-pricing` edge function? It's superseded by `abc-api-proxy` `price_items`.
2. Do you already have `ABC_TOKEN_ENC_KEY` secret, or should I add it and use `pgp_sym_encrypt` (pgcrypto) for token-at-rest encryption?
3. For "Submit Sandbox Test Order", do you have a known-good sandbox `branchNumber` + `shipToNumber` + `itemNumber` from Penny we should hardcode as the default test payload? If not, I'll wire the form to require them.
