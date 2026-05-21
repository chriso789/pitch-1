
# ABC Supply OAuth Repair + Test Console Hardening

## Goal
Diagnose why ABC login redirects to the developer dashboard instead of our callback, and harden the OAuth + test console end-to-end so we can prove (a) whether ABC ever hits our callback, and (b) that all downstream API calls use the documented endpoints and payloads.

## Scope (what changes)

### 1. Frontend: `src/components/settings/ABCConnectionSettings.tsx`
- Add **"Copy OAuth URL"** button that copies the exact `authorization_url` returned by `abc-api-proxy` `action=start_oauth`.
- Add an **OAuth Debug Panel** showing: `authorization_url`, `client_id`, `redirect_uri`, `scopes`, `state`, `environment`, `tenant_id` present, current Supabase user authenticated, expected callback URL.
- Update displayed/requested scopes to:
  `pricing.read order.read order.write product.read account.read location.read offline_access`
- Add user-facing troubleshooting card: "If you land on the ABC developer dashboard after login, the redirect URI is not registered, the test user is not assigned, or you're logging in with the developer/admin account instead of `connect_user@test.com`."
- Test console: render raw request URL, request payload, HTTP status, ABC response body, and mapped error for each call.

### 2. Edge function: `abc-api-proxy` (`action=start_oauth`)
- Pre-flight validation, returns structured JSON error if any of these are missing/wrong:
  - `ABC_CLIENT_ID_PRODUCTION` or `ABC_CLIENT_ID_SANDBOX`
  - `ABC_CLIENT_SECRET_PRODUCTION` or `ABC_CLIENT_SECRET_SANDBOX`
  - `ABC_REDIRECT_URI` must equal `https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/abc-oauth-callback`
  - `tenant_id` present
  - Authenticated Supabase user present
- Error shape: `{ success:false, error_code, human_message, missing_env, expected_value }`
- Success shape:
  ```
  { success:true, authorization_url, authorize_base_url, client_id, redirect_uri,
    scopes, state, environment, tenant_id, pkce_enabled:true,
    code_challenge_method:"S256", instructions }
  ```
- Hardcode redirect URI to the Supabase callback (no `pitch-crm.ai/api/abc/callback`, no preview URLs).

### 3. Edge function: `abc-oauth-callback`
- **Always** insert a row into `abc_oauth_callback_logs` before any branching — proves whether ABC ever hits us.
- On success, upsert `abc_connections` and set `abc_integrations.status='connected'`.
- On missing `code`/`state`, log first, then render error HTML.

### 4. Edge function: `abc-api-proxy` (test API actions)
Add/correct these actions with documented ABC paths (base already includes `/api`):
- `get_branches` → `GET /location/v1/branches` (and `/{branchNumber}`)
- `search_products` → `POST /product/v1/search/items`
- `price_items` → `POST /pricing/v2/prices` (documented payload below)
- `get_order_status` → `GET /order/v2/orders?confirmationNumber=...` and `/order/v2/orders/{orderNumber}`
- `place_order` → `POST /order/v2/orders` (documented payload below)

Production base: `https://partners.abcsupply.com/api`
Sandbox base: `https://partners-sb.abcsupply.com/api`

**Order payload** (sandbox test order):
```
[{ requestId, purchaseOrder, branchNumber, deliveryService:"CPU",
   typeCode:"SO", currency:"USD",
   shipTo:{ name:"ABC Sandbox Test", number, address:{...} },
   lines:[{ id:1, itemNumber, itemDescription, orderedQty:{ value:1, uom:"EA" } }] }]
```

**Pricing payload**:
```
{ requestId, shipToNumber, branchNumber, purpose:"estimating",
  lines:[{ id:"1", itemNumber, quantity:1, uom:"EA" }] }
```

Remove any subscription key (`Ocp-Apim-Subscription-Key`) — auth is OAuth Bearer only.

### 5. Database migration
Two new tables (RLS enabled, master/tenant read; service role write from edge fn):

**`abc_oauth_callback_logs`**
`id, tenant_id, environment, state, has_code, has_error, error, error_description, full_query jsonb, user_agent, ip_address, created_at`

**`abc_api_call_logs`**
`id, tenant_id, environment, action, method, url, request_payload jsonb, response_status, response_body jsonb, error_message, created_at`

### 6. Audit logging
Wrap all outbound ABC calls in `abc-api-proxy` with a helper that inserts into `abc_api_call_logs` (request + response) before returning to the client.

## Technical details

- PKCE: keep S256 code_challenge; persist `code_verifier` keyed by `state` (existing behavior).
- Scopes list is the single source of truth in `abc-api-proxy`; frontend just renders what the function returns.
- Redirect URI constant lives in the edge function; frontend never builds it.
- All new logs respect tenant_id; `useEffectiveTenantId()` on the UI side.
- No changes to `pipeline-*`, SMS blast, measurement, or PDF systems.

## Out of scope
- Changing ABC portal config (user must register the redirect URI and assign `connect_user@test.com` to the app).
- Production order submission flow beyond the sandbox test action.
- QXO / SRS code paths.

## Verification
1. Open Integrations → ABC, click **Begin OAuth**, copy URL from new debug panel, confirm it matches the documented `auth.partners.abcsupply.com/oauth2/.../v1/authorize` and contains all 7 scopes.
2. Complete login with `connect_user@test.com`. Query `abc_oauth_callback_logs` — a row MUST exist. If `has_code=false`, the issue is ABC-side (redirect URI or user assignment), and the UI troubleshooting card explains next steps.
3. After successful callback, `abc_connections` row exists and `abc_integrations.status='connected'`.
4. Run Get Branches, Search Products, Price Items, Submit Sandbox Order from test console; confirm each call appears in `abc_api_call_logs` with correct URL/payload and ABC response body is rendered in the UI.
