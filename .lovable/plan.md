## Goal

Turn the ABC Supply settings page from an engineering console into a demo-ready integration workflow for Sandy's call, while keeping every existing capability behind an "Advanced / Developer Details" accordion. ABC order tracking should look like the existing SRS / material order tracking UI.

## Sandy-confirmed sandbox defaults (UI only, never hardcoded server-side)

- Ship-To: `2010466-2`
- Branch: `1209`
- Item: discovered via product search at branch 1209
- Default product search query: `shingle`

## Files touched

- **EDIT** `src/components/settings/ABCConnectionSettings.tsx` — full restructure into Simple Mode + Advanced accordion; all current state, queries, and edge-function calls preserved.
- **EDIT (minor)** `supabase/functions/abc-api-proxy/handler.ts` and `supabase/functions/supplier-api/abc-proxy-handler.ts` — confirm `search_products` filters/pagination shape (already correct), add `select_item` passthrough only if needed; ensure `submit_test_order` returns `orderNumber`/`confirmationNumber` fields hoisted to the top of the response for the UI to read.
- **EDIT** `docs/ABC_DEMO_READINESS.md` — add Sandy confirmation note + sandbox defaults table.

No DB migrations. No new edge functions. No changes to `abc-oauth-callback`.

## New page structure (top → bottom)

```text
┌─────────────────────────────────────────────────────────────┐
│ A. Header / Status Card                                     │
│   logo · "ABC Supply" · subtitle · status badge             │
│   environment selector (Sandbox / Production)               │
│   sandbox info badge OR production red warning              │
├─────────────────────────────────────────────────────────────┤
│ B. Connection Setup Card                                    │
│   OAuth Client ID, OAuth Client Secret                      │
│   [Save Credentials] [Connect ABC Supply]                   │
│   [Test Token] [Disconnect]                                 │
│   (Account # + Default Branch in "Account Defaults" subacc.)│
├─────────────────────────────────────────────────────────────┤
│ C. Compact Demo Readiness strip (Simple)                    │
│   Credentials · Token · Sandbox · Last API call             │
├─────────────────────────────────────────────────────────────┤
│ D. Demo Workflow Card (sandbox only)                        │
│   Stepper: 1 Connect · 2 Search · 3 Price · 4 Submit/Track  │
│   Shared inputs: shipToNumber, branchNumber, itemNumber     │
│   Pre-filled: 2010466-2 / 1209 / (blank)                    │
├─────────────────────────────────────────────────────────────┤
│ E. Sandbox Test Console                                     │
│   Product Search (query, branch) → result table w/ "Use"    │
│   Price Item (shipTo, branch, item, qty)                    │
│   Submit Sandbox Test Order (disabled until item set)       │
│   Track Order (orderNumber/confirmationNumber + Refresh)    │
├─────────────────────────────────────────────────────────────┤
│ F. Latest Result Card                                       │
│   action · endpoint · status · success/fail · message       │
│   [View Raw JSON] accordion (collapsed)                     │
├─────────────────────────────────────────────────────────────┤
│ G. Order Tracking Card (SRS-style)                          │
│   PO · ABC Order # · Confirmation # · Status · Branch       │
│   Ship-To · Requested delivery · Last updated               │
│   Line items table (item, desc, qty, uom, status)           │
│   [Refresh Order Status]                                    │
├─────────────────────────────────────────────────────────────┤
│ H. Advanced / Developer Details (accordion, collapsed)      │
│   Authorization URL, Token URL, Redirect URI, Scopes,       │
│   API Base · Inspect / Copy OAuth URL · full readiness grid │
│   latest abc_oauth_callback_logs row                        │
│   latest abc_api_audit row · raw request/response JSON      │
│   OAuth troubleshooting text (auto-expands on ?abc=error)   │
└─────────────────────────────────────────────────────────────┘
```

## Behaviour rules

- **Environment selector** stays at top; sandbox shows green/blue info badge ("Sandbox orders run in ABC QA only and are non-production."), production shows red warning ("Production is live. Do not submit test orders in Production.").
- **Renames**: "Begin OAuth Authorization" → "Connect ABC Supply"; "Test Connection" → "Test Token".
- **Pre-fill on sandbox**: `demoShipTo=2010466-2`, `demoBranch=1209`, `productQuery=shingle`. Never pre-fill `itemNumber`. Submit Sandbox Test Order is disabled until itemNumber is non-empty.
- **Product search → Use this item**: each row in the search result table gets a button that copies `itemNumber` into the shared `demoItemNumber` field used by Price + Submit Order.
- **Auto-track after submit**: when `submit_test_order` returns `orderNumber` or `confirmationNumber`, populate the Order Tracking card and immediately call `get_order_status`. If ABC returns neither, show: *"Sandbox order submitted. ABC did not return an order/confirmation number in this response."*
- **Order Tracking card** visually mirrors `src/components/orders/MaterialOrderDetail.tsx` (same Card + Badge + Table layout, same status badge styling) so ABC tracking matches the existing supplier tracking experience. No new shared component — the layout is copied locally to keep ABC self-contained.
- **Compact readiness strip** in Simple Mode shows four pills only; the full grid moves into Advanced.
- **OAuth troubleshooting text** lives in Advanced by default, but auto-expands Advanced if URL has `?abc=error` or last callback log has `has_error=true`.

## Backend payloads (verify only — handler already matches)

`search_products` body (already correct in `handler.ts` lines ~609-641):

```json
{
  "filters": [
    { "key": "itemDescription", "condition": "contains", "values": ["shingle"], "joinCondition": "and" },
    { "key": "branchNumber",    "condition": "equals",   "values": ["1209"],    "joinCondition": "and" }
  ],
  "pagination": { "itemsPerPage": 10, "pageNumber": 1 }
}
```

If `itemNumber` is provided, swap to `{ key: "itemNumber", condition: "equals", values: [itemNumber] }`. Confirm this branch exists; add it if missing.

`price_items` → `POST {apiBase}/pricing/v2/prices` with `requestId`, `shipToNumber`, `branchNumber`, `purpose: "estimating"`, `lines[{ id, itemNumber, quantity, uom }]`. Verify shape, adjust only if drifted.

`submit_test_order` → `POST {apiBase}/order/v2/orders` with an **array** body matching the spec already in `docs/ABC_DEMO_READINESS.md`. Verify, and ensure the response surfaced to the client hoists `orderNumber` and `confirmationNumber` from the ABC response so the UI can auto-track.

## Docs update

Add to `docs/ABC_DEMO_READINESS.md`:

> **Sandbox is non-production.** Sandy (ABC) confirmed the Sandbox environment and all orders sent in that environment are non-production and connect with ABC's QA environment internally. Sandbox accounts are test accounts, not live production accounts.
>
> **Sandy-approved sandbox demo values**
>
> - Ship-To: `2010466-2`
> - Branch: `1209`
> - Item: any item available at branch `1209` (use product search first)

## Acceptance checks (run after build, logged in)

1. **Inspect OAuth URL** — contains `response_type=code`, `client_id`, `redirect_uri=https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/abc-oauth-callback`, full scope string, `state`, `code_challenge`, `code_challenge_method=S256`.
2. **Product Search** with `query=shingle`, `branchNumber=1209` — request body shows `filters` + `pagination`, not `{ query, branchNumber }`.
3. **Price Item** with `shipToNumber=2010466-2`, `branchNumber=1209`, `itemNumber=<from search>` — hits `https://partners-sb.abcsupply.com/api/pricing/v2/prices`.
4. **Submit Sandbox Test Order** — hits `https://partners-sb.abcsupply.com/api/order/v2/orders`, body is an array. Will only be run with a real item from step 2 (no placeholders).
5. **Track Order** — if response carries `orderNumber`/`confirmationNumber`, tracking card auto-populates and `get_order_status` runs; otherwise the sandbox-no-number message is shown.

## Out of scope

- Re-architecting `abc-api-proxy` ↔ `supplier-api` (already deployed via local handler copy).
- Production OAuth client setup or ABC dashboard configuration.
- Any change to existing SRS, QXO, or material order code paths.
- Persisting ABC orders to a new table — order tracking reads live from ABC via `get_order_status`.  
  

  ```
  Approved. Execute this ABC Supply UI cleanup plan.

  Keep the scope tight:
  - No DB migrations
  - No new edge functions
  - No changes to abc-oauth-callback unless a compile issue is found
  - No changes to SRS/QXO/material order code paths
  - No server-side hardcoding of Sandy’s sandbox values

  Sandy-confirmed sandbox values are UI defaults only:
  - Ship-To: 2010466-2
  - Branch: 1209
  - Product search query: shingle
  - Item Number: must be selected from product search results at branch 1209

  Main objective:
  Turn ABCConnectionSettings.tsx from a debug console into a clean demo workflow while preserving every existing tool under Advanced / Developer Details.

  Required implementation details:

  1. Page structure
  Build the page in this order:

  A. Header / Status Card
  - ABC Supply icon
  - Title: ABC Supply
  - Subtitle: Connect ABC Supply to sync pricing, product availability, material ordering, and order tracking.
  - Status badge
  - Environment selector
  - Sandbox info badge:
    “Sandbox orders run in ABC QA only and are non-production.”
  - Production warning only when production is selected:
    “Production is live. Do not submit test orders in Production.”

  B. Connection Setup Card
  Default-visible fields only:
  - OAuth Client ID
  - OAuth Client Secret
  - Save Credentials
  - Connect ABC Supply
  - Test Token
  - Disconnect

  Move ABC Account # and Default Branch Code into a collapsed Account Defaults sub-accordion.

  C. Compact Demo Readiness Strip
  Simple Mode only. Four pills:
  - Credentials
  - Token
  - Sandbox
  - Last API Call

  Full readiness grid goes into Advanced.

  D. Sandbox Demo Workflow Card
  Only show in sandbox.
  Stepper:
  1. Connect
  2. Search
  3. Price
  4. Submit / Track

  Shared demo inputs:
  - shipToNumber default 2010466-2
  - branchNumber default 1209
  - productQuery default shingle
  - itemNumber blank

  Submit Sandbox Test Order must stay disabled until itemNumber is non-empty.

  E. Sandbox Test Console
  Keep compact:
  - Product Search
  - Price Item
  - Submit Sandbox Test Order
  - Track Order

  Use one shared set of inputs. No duplicate forms.

  F. Latest Result Card
  Show only:
  - action
  - endpoint
  - HTTP status
  - success/fail
  - human message
  - collapsed View Raw JSON accordion

  G. ABC Submit Diagnostics / Order Tracking Card
  Make this visually mirror the existing SRS Submit Diagnostics / material order tracking style.

  It must display:
  - ABC supplier badge
  - purchaseOrder / requestId as main title
  - status pill
  - received/update timestamp pill
  - API/webhook update count if available
  - Last ABC update banner
  - Job / Customer / Address box if job context exists
  - Submitted timestamp
  - Branch
  - Ship-To
  - orderNumber
  - confirmationNumber
  - requestId
  - purchaseOrder
  - Inspect button
  - Refresh Status button
  - Line items table: itemNumber, description, quantity, uom, status

  If ABC returns an error/rejection, show red rejection box:
  Title: Rejection reason
  Message: mapped ABC error or response body summary

  Raw request/response JSON only inside Inspect, not on the main card.

  H. Advanced / Developer Details
  Collapsed by default.
  Move all debug details here:
  - Authorization URL
  - Token URL
  - Redirect URI
  - Scopes
  - API Base
  - Inspect OAuth URL
  - Copy OAuth URL
  - latest abc_oauth_callback_logs row
  - latest abc_api_audit row
  - raw request/response JSON
  - OAuth troubleshooting text

  Auto-expand Advanced only when:
  - URL has ?abc=error
  - latest callback log has has_error=true
  - OAuth connect fails

  2. Backend verification
  Verify both copies remain aligned:
  - supabase/functions/abc-api-proxy/handler.ts
  - supabase/functions/supplier-api/abc-proxy-handler.ts

  Confirm:
  A. search_products uses filters + pagination.
  B. itemNumber search branch exists and uses itemNumber equals.
  C. branchNumber filter appends correctly.
  D. price_items payload matches ABC docs.
  E. submit_test_order posts array body to /order/v2/orders.
  F. submit_test_order response hoists:
  - orderNumber
  - confirmationNumber
  - requestId
  - purchaseOrder
  to the top-level response so the UI can auto-track.

  3. Auto-track behavior
  After Submit Sandbox Test Order:
  - If orderNumber or confirmationNumber returns, populate the tracking field and auto-call get_order_status.
  - If neither returns, show:
  “Sandbox order submitted. ABC did not return an order/confirmation number in this response.”
  - Still show requestId and purchaseOrder in ABC Submit Diagnostics.

  4. Product Search selection
  Product Search results must render a small result table.
  Each row must have:
  - itemNumber
  - description
  - availability/status if returned
  - Use button

  Clicking Use copies itemNumber into the shared itemNumber field.

  5. Copy cleanup
  Replace:
  “POSTs the canned PITCH sandbox payload to /order/v2/orders.”

  With:
  “Submits a non-production ABC sandbox order to ABC QA.”

  6. Docs
  Update docs/ABC_DEMO_READINESS.md with Sandy confirmation:
  “The Sandbox environment and all orders sent in that environment are non-production and connect with ABC’s QA environment internally. Sandbox accounts are test accounts, not live production accounts.”

  Add:
  - Ship-To: 2010466-2
  - Branch: 1209
  - Item: any item available at branch 1209; use product search first
  - Default product search query: shingle

  7. Acceptance checks after build
  Run in logged-in app session:

  A. Inspect OAuth URL
  Confirm response_type=code, client_id, redirect_uri, scopes, state, code_challenge, code_challenge_method=S256.

  B. Product Search
  Use query=shingle and branchNumber=1209.
  Confirm request body shows filters + pagination, not { query, branchNumber }.

  C. Select item
  Click Use on a product search result and confirm itemNumber fills.

  D. Price Item
  Use shipToNumber=2010466-2, branchNumber=1209, selected itemNumber.
  Confirm endpoint:
  https://partners-sb.abcsupply.com/api/pricing/v2/prices

  E. Submit Sandbox Test Order
  Confirm endpoint:
  https://partners-sb.abcsupply.com/api/order/v2/orders
  Confirm body is an array.
  Confirm no placeholder TEST-ACCOUNT / 0001 / TEST-SHINGLE-001 is submitted.

  F. Track Order
  If orderNumber/confirmationNumber returns, confirm tracking card auto-runs get_order_status.

  Deploy after changes and report:
  - files changed
  - deploy status
  - product search request/response
  - price request/response
  - sandbox order request/response
  - tracking result
  ```
  One concern: Lovable says **order tracking reads live from ABC via** `get_order_status` and is not persisting to a new table. That’s fine for demo, but long-term you’ll want successful ABC order submissions persisted like SRS so users can revisit order history without needing a fresh API pull every time.
  For Sandy’s demo, the plan is acceptable. The most important rule is: **search first, select a real branch-1209 item, then price and order that selected item.**