## Goal
Unblock `supplier-api` deploy so the corrected ABC payload logic in `handler.ts` goes live, then run three smoke tests against `abc-api-proxy` and report results.

## Root cause
`supabase/functions/supplier-api/index.ts` imports the ABC handler from a sibling folder:

```ts
import { handle as abcProxyHandle } from "../abc-api-proxy/handler.ts";
```

The Supabase edge bundler resolves each function in isolation, so `../abc-api-proxy/handler.ts` is outside `supplier-api/`'s root and fails with "Module not found: handler.ts". Same pattern exists for `billtrust-auth` and `billtrust-pricing`, but only ABC is in scope for this fix.

## Fix

1. **Copy the handler local to `supplier-api`**
   - Create `supabase/functions/supplier-api/abc-proxy-handler.ts` with the exact contents of `supabase/functions/abc-api-proxy/handler.ts` (964 lines, unchanged — all corrected payload logic preserved).

2. **Update `supplier-api/index.ts`**
   - Replace the sibling import with a local one:
     ```ts
     import { handle as abcProxyHandle } from "./abc-proxy-handler.ts";
     ```
   - `app.all("/abc/proxy", (c) => abcProxyHandle(c.req.raw))` stays unchanged.

3. **Leave `abc-api-proxy/handler.ts` in place**
   - `abc-api-proxy/index.ts` is the public shim; it forwards to `supplier-api/abc/proxy`. The shim itself does not import `handler.ts`, so no change needed there. Keeping the original `handler.ts` avoids breaking any other reference and keeps the two copies aligned for now (a follow-up should dedupe via `_shared/`, out of scope here).

4. **Redeploy**
   - Deploy `supplier-api` first, then `abc-api-proxy` (to confirm the shim still works after the dependency split).

## Smoke tests (after deploy)

Run via `supabase--curl_edge_functions` against `abc-api-proxy`:

1. `action=get_status` — confirm 200 and that response shape matches the corrected `supplier-api` handler (not the legacy one).
2. `action=search_products` with `query="shingle"` — confirm outgoing payload is:
   ```json
   { "filters": [...], "pagination": { "itemsPerPage": 10, "pageNumber": 1 } }
   ```
   not `{ query, branchNumber }`.
3. `action=submit_test_order` — requires real sandbox `shipToNumber`, `branchNumber`, `itemNumber` from the user. Confirm endpoint `https://partners-sb.abcsupply.com/api/order/v2/orders` and array body.

For each test, report: exact endpoint, request payload, HTTP status, response body (as surfaced by the Demo Readiness panel / edge logs).

## Question for the user before running test #3

I need real sandbox `shipToNumber`, `branchNumber`, and `itemNumber` values to run `submit_test_order`. Tests 1 and 2 I can run immediately after deploy without input.

## Out of scope
- Migrating `billtrust-auth` / `billtrust-pricing` sibling imports (same bug, not blocking demo).
- Deduping the two ABC handler copies into `_shared/`.
- Any business-logic changes in `handler.ts`.

## Files touched
- **NEW**: `supabase/functions/supplier-api/abc-proxy-handler.ts` (copy of `abc-api-proxy/handler.ts`)
- **EDIT**: `supabase/functions/supplier-api/index.ts` (1 import line)
