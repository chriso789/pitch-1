# ABC Supply Sandbox Validation — Drop-In Plan

## Goal
Wire ABC sandbox test login as Supabase secrets only, expose a yes/no readiness signal, fix the Product Search payload shape, and re-run the full sandbox validation (Token → Product Search → Price → Submit → Diagnostics), with proper WAF-block handling.

## Security Contract (non-negotiable)
- `ABC_SANDBOX_TEST_USERNAME` and `ABC_SANDBOX_TEST_PASSWORD` stored ONLY as Supabase Edge Function secrets.
- Password never: logged, returned from any edge function, written to docs/markdown, frontend code, DB, or UI.
- Username `connect_user@test.com` may appear in docs and the Advanced/Developer Details panel.
- Readiness check returns boolean only (`sandbox_test_login_configured: true/false`) — never the value.

## Step 1 — Add Secrets
Add via `secrets--add_secret`:
- `ABC_SANDBOX_TEST_USERNAME`
- `ABC_SANDBOX_TEST_PASSWORD`

No code reads the password. Only a presence check on the username is exposed.

## Step 2 — Edge Function: readiness signal
In `supabase/functions/abc-api-proxy/handler.ts`, extend the existing `demo_readiness` (or equivalent status) action to include:
```ts
sandbox_test_login_configured: Boolean(Deno.env.get("ABC_SANDBOX_TEST_USERNAME"))
```
Do NOT read or return the password. Do NOT log either secret.

## Step 3 — Fix Product Search payload
In both `supabase/functions/abc-api-proxy/handler.ts` and `supabase/functions/supplier-api/abc-proxy-handler.ts`, change `product_search` to POST the documented filters+pagination shape (not `{ query, branchNumber }`):
```json
{
  "filters": [
    { "key": "itemDescription", "condition": "contains", "values": ["<q>"], "joinCondition": "and" },
    { "key": "branchNumber",    "condition": "equals",   "values": ["<branch>"], "joinCondition": "and" }
  ],
  "pagination": { "itemsPerPage": 10, "pageNumber": 1 }
}
```

## Step 4 — Price Item & Submit Order payload audit
Verify both handlers already emit:
- Price: `{ requestId, shipToNumber, branchNumber, purpose:"estimating", lines:[{id,itemNumber,quantity,uom}] }`
- Submit: array-wrapped order with `dates.deliveryRequestedFor`, `orderComments:[{code:"H",description:"PITCH integration sandbox test order - non-production QA"}]`, real `itemNumber` (no placeholders).
Patch any drift to match the spec.

## Step 5 — WAF-block persistence
In the `callAbc` helper, detect Incapsula/Imperva response (HTML body with `_Incapsula_Resource` or `incident_id`, or 403 with HTML content-type) and:
- Set `error_code = "abc_waf_blocked"` on the persisted audit row.
- For `submit_test_order`, still write `abc_orders` (status `error`) + `abc_order_lines` so Diagnostics renders the attempt.
- Surface friendly message in the diagnostics card: "ABC's WAF blocked the request before it reached the API. OAuth is valid, but ABC must allowlist the outbound IP or a fixed relay must be used."

No DB migration — reuse existing `error_code` / `status` columns.

## Step 6 — Frontend (ABCConnectionSettings.tsx)
- Advanced / Developer Details: add line `Sandbox test login configured: yes/no` driven by readiness response.
- Add OAuth troubleshooting note: "ABC sandbox OAuth test user: connect_user@test.com. Password is stored temporarily as a Supabase secret and must not be committed, logged, displayed, or exposed."
- Refresh Status button: disable when neither `orderNumber` nor `confirmationNumber` present, tooltip: "ABC did not return an order or confirmation number for status lookup."
- No password input. No auto-login.

## Step 7 — Docs
Update `docs/ABC_DEMO_READINESS.md` with the "ABC Sandbox OAuth Test Login" section, username only, explicit note that password lives in `ABC_SANDBOX_TEST_PASSWORD` secret and must not be committed/logged/displayed.

## Step 8 — Deploy & Validate
Deploy `supplier-api` and `abc-api-proxy`. Then run via `supabase--curl_edge_functions` (preview session auth):
1. `test_connection` → capture body.
2. `product_search` with `query="shingle"`, `branchNumber="1209"` → capture endpoint/request/response, pick a real `itemNumber`.
3. `price_items` with shipTo `2010466-2`, branch `1209`, that itemNumber, qty 1 → capture.
4. `submit_test_order` with same → capture.
5. Query `abc_orders` / `abc_order_lines` / `abc_api_audit` to confirm persistence (row created, status one of submitted / submitted_pending_reference / error, `raw_payload` has request+response).
6. Open `/settings?tab=integrations` in browser; confirm ABC Submit Diagnostics row visible after refresh, Inspect drawer shows endpoint/request/response/audit/timeline.
7. If `orderNumber` or `confirmationNumber` returned, exercise Refresh Status and confirm `raw_payload.status_lookup` updates.

If WAF blocks again: confirm the attempt is persisted with `abc_waf_blocked`, the diagnostics card renders the friendly message, and report the observed egress IPs (expected `3.76.122.156`, `18.193.68.155`) for ABC allowlisting. Do NOT retry from the browser.

## Final Report Back
Files changed, deploy status (supplier-api, abc-api-proxy), Test Token response, Product Search endpoint/request/response, selected itemNumber, Price endpoint/request/response, Submit endpoint/request/response, `abc_orders` row yes/no, `abc_order_lines` row yes/no, Diagnostics visible after refresh yes/no, Inspect working yes/no, WAF block yes/no.
