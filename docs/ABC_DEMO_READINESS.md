# ABC Supply Demo Readiness

Operational checklist for the live ABC sandbox walkthrough.

## Architecture

- Frontend invokes `supabase.functions.invoke('abc-api-proxy', { body })`.
- `supabase/functions/abc-api-proxy/index.ts` is a thin shim that forwards every call to the grouped function `supplier-api` at route `/abc/proxy`.
- `supabase/functions/supplier-api/index.ts` mounts the corrected handler from `supabase/functions/abc-api-proxy/handler.ts`. **That handler is the implementation that runs.**
- OAuth callback runs in `supabase/functions/abc-oauth-callback/index.ts` and persists tokens via the `abc_tokens_upsert` RPC using `ABC_TOKEN_ENC_KEY`.

## OAuth flow (Authorization Code + PKCE)

1. User clicks **Begin OAuth Authorization** in Settings → Integrations → ABC Supply.
2. `abc-api-proxy` action `start_oauth` generates `state` + PKCE pair, stores them in `abc_oauth_states`, and returns the authorize URL.
3. Browser opens ABC Okta login. User authenticates with the assigned ABC sandbox test user.
4. ABC redirects to the **canonical** callback URL with `?code=...&state=...`:

   ```
   https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/abc-oauth-callback
   ```

5. Callback exchanges the code at ABC Okta `/v1/token` using HTTP Basic auth + `code_verifier`, persists encrypted tokens, and redirects back to `/settings?tab=integrations&abc=connected`.

## Registered redirect URI (must match exactly)

```
https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/abc-oauth-callback
```

## Required Supabase Edge Function secrets

| Secret | Purpose |
| --- | --- |
| `ABC_CLIENT_ID_SANDBOX` / `ABC_CLIENT_ID_PRODUCTION` | OAuth client ID per environment |
| `ABC_CLIENT_SECRET_SANDBOX` / `ABC_CLIENT_SECRET_PRODUCTION` | OAuth client secret per environment |
| `ABC_TOKEN_ENC_KEY` | AES key used by `abc_tokens_upsert` to encrypt access/refresh tokens at rest |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Standard Supabase service-side access |

Optional overrides:

| Secret | Default |
| --- | --- |
| `ABC_TOKEN_URL_SANDBOX` | `https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/token` |
| `ABC_TOKEN_URL_PRODUCTION` | `https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/token` |
| `ABC_DEFAULT_BRANCH` | fallback branch for canned demos |
| `ABC_ACCOUNT_NUMBER` | fallback ship-to for canned demos |
| `ABC_SANDBOX_TEST_USERNAME` | ABC-provided sandbox OAuth test user (e.g. `connect_user@test.com`). Safe to display. |
| `ABC_SANDBOX_TEST_PASSWORD` | Temporary password for the sandbox OAuth test user. **Never commit, display, log, or return from any edge function.** |

## ABC Sandbox OAuth Test Login

ABC provided a sandbox OAuth test user for the manual Authorization Code Flow login.

- **Username:** `connect_user@test.com`
- **Password:** Stored temporarily as Supabase secret `ABC_SANDBOX_TEST_PASSWORD`. Do not commit, display, log, or expose this password. It must be typed manually into the ABC sandbox login screen.

Usage:

1. Open Pitch CRM.
2. Go to **Settings → Integrations → ABC Supply**.
3. Set **Environment** to `Sandbox`.
4. Click **Connect ABC Supply** (Begin OAuth Authorization).
5. When ABC's sandbox login opens, sign in using the sandbox test user above.
6. Confirm ABC redirects back to:

   ```
   https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/abc-oauth-callback
   ```

If ABC redirects to the developer dashboard instead of the callback, this is an ABC-side app assignment, redirect URI, or OAuth client configuration issue (not a Pitch bug).

Auto-login into the ABC OAuth consent screen is **not** implemented — ABC's Okta login blocks automated credential submission. The password is for manual entry only.


## Required OAuth scopes

```
pricing.read order.read order.write product.read account.read location.read offline_access
```

## API endpoints (sandbox = `https://partners-sb.abcsupply.com/api`)

```
GET  {apiBase}/location/v1/branches
GET  {apiBase}/location/v1/branches/{branchNumber}
POST {apiBase}/product/v1/search/items
GET  {apiBase}/product/v1/items/{itemNumber}
POST {apiBase}/pricing/v2/prices
GET  {apiBase}/order/v2/orders?confirmationNumber={confirmationNumber}
GET  {apiBase}/order/v2/orders/{orderNumber}
POST {apiBase}/order/v2/orders
```

All requests use:

```
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json
```

Do **not** send `Ocp-Apim-Subscription-Key`.

## Live demo sequence

1. Settings → Integrations → ABC Supply. Confirm **Demo Readiness** panel shows green for client ID, secret on server, encryption key, redirect URI, sandbox environment.
2. Enter the sandbox **Ship-To Number**, **Branch Number**, and **Item Number** Sandy provided.
3. **Begin OAuth Authorization** → log in with the assigned ABC sandbox user.
4. After redirect, **Last callback hit** populates and **Token status** flips to connected.
5. **Test Connection** → expect 200.
6. **Test Branch Lookup** (blank → list branches; with branch number → single branch).
7. **Test Product Search** with a known item description.
8. **Test Price Items** with `{ itemNumber, shipToNumber, branchNumber }`.
9. **Submit Sandbox Test Order** — POSTs the ABC-shaped order to `/order/v2/orders`.
10. **Test Order Status** with the returned order/confirmation number.

Every call writes a row to `abc_api_audit` with URL, payload, status, and response body.

## Sandbox test order payload (ABC documented shape)

```json
[
  {
    "requestId": "PITCH-TEST-1709990000",
    "purchaseOrder": "PITCH-TEST-1709990000",
    "branchNumber": "0001",
    "deliveryService": "CPU",
    "typeCode": "SO",
    "currency": "USD",
    "shipTo": {
      "name": "ABC Sandbox Test",
      "number": "TEST-ACCOUNT",
      "address": {
        "line1": "123 Test Street",
        "city": "North Port",
        "state": "FL",
        "postal": "34286",
        "country": "USA"
      }
    },
    "orderComments": [],
    "lines": [
      {
        "id": 1,
        "itemNumber": "TEST-SHINGLE-001",
        "itemDescription": "Sandbox test item",
        "orderedQty": { "value": 1, "uom": "EA" }
      }
    ]
  }
]
```

`deliveryService` codes: `CPU` (customer pickup), `OTG` (other ground), `OTR` (other roof), `COM` (commercial), `EXP`, `OTW`, `TPC`.

## Sandy-confirmed sandbox values

| Field | Value |
| --- | --- |
| Ship-To Number | `2010466-2` |
| Branch Number | `1209` |
| Item Number | any item available at branch 1209 (use Product Search) |

Sandbox is ABC's internal QA environment — orders do NOT create real production work.

## Persistent diagnostics

Every `submit_test_order` call writes/updates a row in `public.abc_orders` (with a single line in `public.abc_order_lines`). The Settings → Integrations → **ABC Submit Diagnostics** panel renders these rows like the SRS diagnostics panel — supplier badge, status pill, webhook count, "Last ABC update" banner, Job/Customer/Address (if linked), and Inspect drawer with request/response/audit/webhook timeline. Sandbox attempts that come back without an `orderNumber` or `confirmationNumber` are stored with `order_status = submitted_pending_reference` and still appear in the panel using `requestId` + `purchaseOrder` as proof of submission. Failed submits persist as `order_status = error` with the rejection mapped from the audit response.


## Troubleshooting

### "ABC redirects me to the developer dashboard instead of the callback"

This is **not** a Pitch code problem. ABC is logging the user in but not honoring the OAuth redirect. Check, in order:

1. The OAuth app registration in ABC has the **exact** redirect URI:
   `https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/abc-oauth-callback`
2. The login is performed with the customer test account assigned to the OAuth app (e.g. `connect_user@test.com`) — not the developer portal account used to register the app.
3. The test user is **assigned** to the OAuth app in ABC's admin console.
4. The OAuth client type is set up for Authorization Code with PKCE, not implicit or client credentials.

### "missing_code" / "missing_state" / "invalid_state" / "state_expired" / "token_exchange_failed"

These now appear in `abc_integrations.last_error` and on the Demo Readiness panel's **Last callback hit** row. Retry the OAuth flow; if `state_expired` repeats, the user took longer than the state TTL (default 10 minutes) — start over.

### "Test order rejected — HTTP 400"

Almost always the `shipToNumber`, `branchNumber`, or `itemNumber` is not valid in ABC's sandbox. Confirm the values with Sandy.

## Files

- `supabase/functions/abc-api-proxy/handler.ts` — all action routing and ABC HTTP calls
- `supabase/functions/abc-api-proxy/index.ts` — shim forwarding to `supplier-api/abc/proxy`
- `supabase/functions/supplier-api/index.ts` — mounts the ABC handler on `/abc/proxy`
- `supabase/functions/abc-oauth-callback/index.ts` — token exchange and encrypted persist
- `src/components/settings/ABCConnectionSettings.tsx` — credentials UI, OAuth launcher, Demo Readiness panel, sandbox test console
