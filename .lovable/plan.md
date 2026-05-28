# ABC Supply Demo Hardening Plan

Goal: make the ABC integration safe to demo live to Sandy in the ABC sandbox. Confirm routing, fix the two payloads that will fail against ABC's documented schemas, expose a "Demo Readiness" panel, and add a docs file.

## 0. Routing confirmation (no code change needed)

Verified `supabase/functions/abc-api-proxy/index.ts` is a shim that forwards `abc-api-proxy` invocations to the grouped `supplier-api` function at route `/abc/proxy`, and `supplier-api/index.ts` mounts the corrected `handler.ts` on that route. The new implementation IS the one being executed — no rewrite of `index.ts` needed.

## 1. Fix `search_products` payload (handler.ts ~line 609)

ABC's `POST /product/v1/search/items` expects a filters + pagination body, not `{ query, branchNumber }`. Rebuild the payload:

- If `body.itemNumber` provided → filter `key: itemNumber, condition: equals, values: [itemNumber]`
- Else → filter `key: itemDescription, condition: contains, values: [query]`
- If `body.branchNumber` provided → append filter `key: branchNumber, condition: equals, values: [branchNumber]`
- Always include `pagination: { itemsPerPage: 10, pageNumber: 1 }`
- Each filter object: `joinCondition: "and"`

Continue to return `{ request, endpoint, status, body, error_code }` and write the audit row unchanged.

## 2. Fix legacy `place_order` / `submit_order` payload (handler.ts ~line 746)

The legacy item-based branch still builds ABC-incompatible fields (`sourceSystem`, `purchaseOrderNumber`, `deliveryType`, `lineNumber`, `quantity`, `unitOfMeasure`). Replace the legacy payload builder with ABC's documented array shape:

```ts
[{
  requestId, purchaseOrder, branchNumber,
  deliveryService: "CPU" | mapFromDeliveryMethod(body.delivery_method),
  typeCode: "SO",
  dates: { deliveryRequestedFor: body.delivery_date },
  currency: "USD",
  shipTo: { name, number: shipToNumber, address: { line1, city, state, postal, country: "USA" } },
  orderComments: notes ? [{ code: "H", description: notes }] : [],
  lines: items.map((i, idx) => ({
    id: idx + 1,
    itemNumber: i.abc_item_code || i.item_name,
    itemDescription: i.description || i.item_name,
    orderedQty: { value: Number(i.quantity), uom: (i.unit || "EA").toUpperCase() },
  })),
}]
```

`requestId` and `purchaseOrder` = `PITCH-{job_number||"JOB"}-{Date.now()}`. Map `delivery_method`: `pickup→CPU`, `ground_drop→OTG`, default `OTR` (roof_load → OTR per ABC delivery service codes; fall back to CPU only if unknown).

Update the post-success persist block so it reads from the new shape:

- `orderObj.purchaseOrder` (not `.purchaseOrderNumber`)
- `orderObj.shipTo?.number` (not `.shipToNumber`)
- `orderObj.branchNumber` unchanged
- line items use `orderedQty.value` / `orderedQty.uom`

Pre-shaped `body.order` passthrough stays as-is.

## 3. Demo Readiness panel in `ABCConnectionSettings.tsx`

New collapsible card "Demo Readiness" showing:

- OAuth client ID present (UI-known)
- Client secret present server-side (existing health check)
- `ABC_TOKEN_ENC_KEY` present server-side (existing health check)
- Exact registered redirect URI (copyable)
- Selected environment (sandbox/production) with warning if production
- Scopes string
- Token connected status + last refresh
- Most recent row from `abc_oauth_callback_logs`
- Most recent row from `abc_api_audit`

Add buttons (some may already exist — verify, add missing):

- Copy OAuth URL · Begin OAuth · Test Token · Test Branch Lookup · Test Product Search · Test Price Items · Test Order Status · Submit Sandbox Test Order

Add input fields persisted to component state for: `shipToNumber`, `branchNumber`, `itemNumber`, `confirmationNumber`/`orderNumber`, product search `query`. These feed the Test buttons.

## 4. Callback diagnostics (`abc-oauth-callback`)

After every callback hit, update `abc_integrations.last_error` (clear on success) with one of: `missing_code`, `missing_state`, `invalid_state`, `state_expired`, `token_exchange_failed`. Keep existing `abc_oauth_callback_logs` writes.

## 5. New file: `docs/ABC_DEMO_READINESS.md`

Covers: OAuth flow + PKCE, registered redirect URI, required Supabase secrets, scope list, end-to-end sandbox test sequence, example sandbox test order payload, troubleshooting (especially "ABC redirects to developer dashboard instead of callback" = ABC-side app/user assignment, not code).

## Out of scope

- Header hygiene (already correct — Bearer + JSON, no Ocp-Apim-Subscription-Key)
- Endpoint paths (already correct)
- `submit_test_order` payload (already ABC-shaped)
- OAuth dashboard-redirect issue — ABC-side config, not fixable in code

## Files touched

- `supabase/functions/abc-api-proxy/handler.ts` — search_products + legacy place_order payloads
- `supabase/functions/abc-oauth-callback/index.ts` — last_error writes
- `src/components/settings/ABCConnectionSettings.tsx` — Demo Readiness panel, test fields, buttons
- `docs/ABC_DEMO_READINESS.md` — new

After deploy, walk the demo checklist end-to-end in sandbox before Sandy's call.  
  


```
Approved. Move forward with the ABC Supply Demo Hardening Plan.

Before coding, add these two requirements:

1. Default the ABC demo/test console to Sandbox, not Production.
- The ABC demo email says sandbox test order validation will happen in Sandbox.
- If Production is selected, show a red warning:
  “Production is live. ABC demo order validation should use Sandbox unless ABC explicitly instructs otherwise.”

2. Do not rely on fake defaults for the live demo.
- Keep fallback placeholders for local UI testing, but the real Submit Sandbox Test Order button must require:
  shipToNumber
  branchNumber
  itemNumber
- If any are missing, block submission and show:
  “ABC sandbox Ship-To, Branch, and Item Number are required for demo validation.”
- Do not submit TEST-ACCOUNT, 0001, or TEST-SHINGLE-001 during a real demo unless ABC confirms those are valid sandbox values.

Then complete the plan exactly:

A. Confirm routing
- Keep the existing routing if abc-api-proxy/index.ts forwards to supplier-api /abc/proxy and supplier-api mounts handler.ts.
- Add a short comment in index.ts or docs confirming abc-api-proxy is routed through supplier-api.

B. Fix search_products
- Use ABC documented filters + pagination body:
  - itemNumber → key=itemNumber, condition=equals
  - query → key=itemDescription, condition=contains
  - branchNumber → key=branchNumber, condition=equals
  - pagination: { itemsPerPage: 10, pageNumber: 1 }
  - each filter joinCondition="and"

C. Fix legacy place_order / submit_order
- Remove sourceSystem, purchaseOrderNumber, deliveryType, lineNumber, quantity, unitOfMeasure.
- Build ABC documented order array:
[
  {
    requestId,
    purchaseOrder,
    branchNumber,
    deliveryService,
    typeCode: "SO",
    dates: { deliveryRequestedFor },
    currency: "USD",
    shipTo: {
      name,
      number: shipToNumber,
      address: { line1, city, state, postal, country: "USA" }
    },
    orderComments: notes ? [{ code: "H", description: notes }] : [],
    lines: [
      {
        id,
        itemNumber,
        itemDescription,
        orderedQty: { value, uom }
      }
    ]
  }
]

D. Preserve pre-shaped body.order passthrough.

E. Update success persistence to read:
- orderObj.purchaseOrder
- orderObj.shipTo?.number
- orderObj.branchNumber
- orderedQty.value
- orderedQty.uom

F. Add Demo Readiness panel
Show:
- OAuth client ID present
- client secret present server-side
- ABC_TOKEN_ENC_KEY present server-side
- exact redirect URI
- selected environment
- scopes
- token connected status
- last token refresh
- latest abc_oauth_callback_logs row
- latest abc_api_audit row

G. Add/verify test buttons:
- Copy OAuth URL
- Begin OAuth Authorization
- Test Token
- Test Branch Lookup
- Test Product Search
- Test Price Items
- Test Order Status
- Submit Sandbox Test Order

H. Add required demo input fields:
- shipToNumber
- branchNumber
- itemNumber
- confirmationNumber/orderNumber
- product search query

I. Update callback diagnostics
- Every callback hit logs to abc_oauth_callback_logs.
- Also update abc_integrations.last_error with:
  missing_code
  missing_state
  invalid_state
  state_expired
  token_exchange_failed
- Clear last_error on success.

J. Add docs/ABC_DEMO_READINESS.md
Include:
- OAuth + PKCE flow
- registered redirect URI
- required Supabase secrets
- required scopes
- sandbox test sequence
- sandbox test order payload
- troubleshooting:
  “ABC redirects to developer dashboard instead of callback” means ABC-side app/user assignment, redirect URI, or OAuth client settings issue.

K. Final acceptance checks
After deploy, verify in Sandbox:
1. OAuth URL generates with response_type=code, state, code_challenge, code_challenge_method=S256.
2. ABC redirects to abc-oauth-callback with code and state.
3. Token is stored encrypted.
4. Test Token works.
5. Branch Lookup works.
6. Product Search works.
7. Price Items works.
8. Submit Sandbox Test Order sends to:
   https://partners-sb.abcsupply.com/api/order/v2/orders
9. Audit logs show request URL, request payload, status, response body.

Do not add Ocp-Apim-Subscription-Key. The scraped docs use OAuth Bearer token only.
```

Also send this to Sandy now so you don’t get stuck live on the call:

ABC API Demo Prep - Sandbox Test ValuesABC API Demo Prep - Sandbox Test Values 

---

Hi Sandy,

Looking forward to the demo.

We have the ABC OAuth + sandbox workflow prepared. To make sure the live sandbox test order validates cleanly during the walkthrough, can you confirm the sandbox-safe values we should use?

1. Sandbox Ship-To number
2. Sandbox branch number
3. Sandbox item number for a safe test order
4. Preferred sandbox delivery service code — should we use CPU for customer pickup, or another code?
5. Confirmation that the test user [connect_user@test.com](mailto:connect_user@test.com) is assigned to our OAuth client
6. Confirmation that our redirect URI is registered exactly as:

[https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/abc-oauth-callback](https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/abc-oauth-callback)

That will let us avoid using placeholder values during the demo.

Best,  
Chris