## Goal

Replace the ephemeral in-memory "Order Tracking" card on the ABC Supply settings page with a persistent **ABC Submit Diagnostics** panel that mirrors the existing `SrsDiagnosticsPanel`, reads from `abc_orders` / `abc_api_audit` / `abc_webhook_events`, and updates live as ABC responds.

## Changes

### 1. Backend — persist `submit_test_order` results

`supabase/functions/abc-api-proxy/handler.ts` and `supabase/functions/supplier-api/abc-proxy-handler.ts` (mirror edits):

- In the `submit_test_order` branch, after the `auditCall(...)`, upsert an `abc_orders` row on the `(tenant_id, request_id)` natural key (use `purchase_order` as fallback uniqueness when ABC echoes nothing):
  - `request_id`, `purchase_order`, `order_number` (hoisted), `confirmation_number` (hoisted)
  - `order_status`: `'submitted'` on `r.ok`, `'error'` otherwise
  - `branch_number`, `ship_to_number`, `sold_to_number = shipToNumber`
  - `ordered_on = today`, `delivery_requested_for`
  - `source = 'sandbox'`
  - `raw_payload = { request: payload, response: { status, body } }`
- Insert a single `abc_order_lines` row from `orderObj.lines[0]` (item number + qty + uom).
- Do not touch `abc_order_job_links` for sandbox submits (no project context).
- Return value unchanged (UI already uses the hoisted `orderNumber` / `confirmationNumber`).

No migration needed — tables, indexes, and grants for `abc_orders` / `abc_order_lines` already exist.

### 2. New component — `src/components/settings/AbcDiagnosticsPanel.tsx`

Mirror `src/components/orders/SrsDiagnosticsPanel.tsx` 1:1 visually (card header, badges, pills, banners, spacing, expanded "Inspect" section). ABC-specific wiring:

- Tenant-scoped query (`useEffectiveTenantId` + `.eq('tenant_id', …)`).
- Fetch latest 5 rows from `abc_orders` ordered by `created_at desc`. Optional `projectId` prop filters via `abc_order_job_links`.
- For each order, fetch in parallel:
  - `abc_webhook_events` matched on `(tenant_id, order_number)` OR `(tenant_id, confirmation_number)` — newest first. Treat these as the "webhook timeline" (count + Received pill + Last ABC update banner showing `event_type`).
  - Latest `abc_api_audit` row(s) where `request_body_redacted ->> 'requestId' = request_id` (or `action='submit_test_order'` matching `purchase_order`) for the Inspect section (endpoint, status_code, response_body, duration).
  - Job/customer/address via `abc_order_job_links → projects → pipeline_entries → contacts` using the explicit `contacts!pipeline_entries_contact_id_fkey` hint. Sandbox rows show no job box.
- Realtime channel on `abc_orders` and `abc_webhook_events` (same tenant) → `load()`.
- Card layout per row:
  - Header: `ABC` badge (use existing `Badge` variants, ABC = orange/secondary), `purchase_order` as title, status pill (`submitted` / `accepted` / `rejected` / `error` / `pending`), Received pill with webhook timestamp, webhook count pill.
  - "Last ABC update" banner: `{order_status} — {latest webhook event_type or "Order Update"}`.
  - Job/Customer/Address box (only if link found).
  - Metadata rows: `Submitted`, `Branch`, `Ship-To`, `ABC orderNumber`, `confirmationNumber`, `requestId`, `purchaseOrder`, `transactionID` (read from `raw_payload.response[0].transactionID` if present). Each long ID gets a copy button (same `Copy` icon pattern as SRS).
  - Buttons: **Inspect** (toggles raw payload/response, audit row, webhook list) and **Refresh Status** (calls `abc-api-proxy` action `get_order_status` with `orderNumber || confirmationNumber`; toast on missing).
  - Red rejection box when status matches `/reject|fail|cancel|error/i`, message mapped from `error_code` or `response_body.error/message`.
- "Inspect" drawer content: endpoint, request payload (`raw_payload.request`), response status + body (`raw_payload.response`), latest audit row summary, and webhook events list with raw payload `<details>` toggles. Raw JSON lives ONLY inside Inspect.
- Empty state: "No ABC submit attempts yet."
- Sandbox no-tracker fallback row: when `order_number` and `confirmation_number` are both null, show muted message "Sandbox order submitted. ABC did not return an order/confirmation number in this response." while still rendering `requestId` and `purchaseOrder`.

### 3. Wire into `src/components/settings/ABCConnectionSettings.tsx`

- Import and render `<AbcDiagnosticsPanel />` in Simple Mode where the current ephemeral `OrderTrackingCard` sits (Section G).
- Remove the ephemeral `OrderTrackingCard` JSX and its now-unused helpers (`trackingFirst`, `trackingBody`, `orderLines`, `trackingStatus`, `hasTracker`, `OrderTrackingCard`). Keep `orderResult` / `trackResult` state only as needed by the existing Submit + Refresh buttons (toast messaging). The persistent panel becomes the single source of truth for tracking.
- Keep all OAuth / endpoints / raw logs inside the existing Advanced / Developer Details accordion.
- Wording: line 860 already reads "Submits a non-production ABC sandbox order to ABC QA." — no change needed. Sweep the file once more to confirm no remaining "canned PITCH sandbox payload" copy.

### 4. Verification

- Run `supabase--curl_edge_functions` against `abc-api-proxy` with `action=submit_test_order` using `2010466-2` / `1209` and a real item once the user is connected, then `read_query` `abc_orders` ordered desc to confirm the new row, then load Settings → ABC Supply and confirm the diagnostics card renders with the correct pills, metadata, and Inspect contents. `Refresh Status` should call `get_order_status` and update the banner via realtime.

## Out of Scope

- Webhook receiver changes (`abc_webhook_events` is consumed read-only; assumed already populated by existing webhook function).
- Job linking UI for sandbox orders.
- Production order path / `submit_order` legacy persistence (already writes to `abc_orders`).
- Any SRS-side changes.

## Files Touched

- EDIT `supabase/functions/abc-api-proxy/handler.ts` — persist `submit_test_order` to `abc_orders` + `abc_order_lines`.
- EDIT `supabase/functions/supplier-api/abc-proxy-handler.ts` — same mirror edit.
- NEW `src/components/settings/AbcDiagnosticsPanel.tsx` — diagnostics card (SRS pattern, ABC fields).
- EDIT `src/components/settings/ABCConnectionSettings.tsx` — mount panel, remove ephemeral tracking card.  
  

  ```
  Approved. Execute the ABC persistent Submit Diagnostics plan with the following required clarifications.

  Main goal:
  Replace the ephemeral ABC order tracking card with a persistent “ABC Submit Diagnostics” panel that mirrors the existing SrsDiagnosticsPanel behavior and reads from:
  - abc_orders
  - abc_order_lines
  - abc_api_audit
  - abc_webhook_events if present

  This is the right direction. ABC submitted orders must survive refresh and must show up like SRS diagnostics.

  Required adjustments before coding:

  1. Persistence key / upsert safety

  The plan says upsert abc_orders on (tenant_id, request_id), but I need you to verify a unique constraint/index exists for that. If it does not exist, do not assume upsert will work.

  Since the plan says no DB migrations, use safe logic:

  A. First query:
  select id from abc_orders
  where tenant_id = tenant_id
  and (
    request_id = requestId
    or purchase_order = purchaseOrder
    or confirmation_number = confirmationNumber
    or order_number = orderNumber
  )
  limit 1

  B. If found, update that row.
  C. If not found, insert new row.

  Do not use upsert on a non-unique natural key unless the unique index exists.

  2. abc_order_lines duplicate prevention

  Before inserting the sandbox test line:
  - delete existing abc_order_lines for that order_id and tenant_id
  or
  - check whether the same line exists

  For sandbox submit_test_order, deleting and reinserting lines is fine.

  3. Persist both success and failure

  Even if ABC returns error, persist the abc_orders row with:
  - order_status = 'error'
  - request_id
  - purchase_order
  - branch_number
  - ship_to_number
  - source = 'sandbox'
  - raw_payload = request/response

  That way rejected/error submissions also appear in ABC Submit Diagnostics like SRS rejected submissions.

  4. Status mapping

  Map ABC statuses consistently:
  - r.ok with orderNumber/confirmationNumber → submitted
  - r.ok without orderNumber/confirmationNumber → submitted_pending_reference
  - non-2xx → error
  - webhook rejected/failure/cancel/error → rejected or error visually

  In the UI, status pill text can still be friendly:
  submitted
  pending reference
  error
  rejected

  5. Hoist response values robustly

  In submit_test_order response, hoist these top-level values:
  - requestId
  - purchaseOrder
  - orderNumber
  - confirmationNumber
  - transactionID
  - branchNumber
  - shipToNumber

  ABC may return an array or object. Handle both:
  const first = Array.isArray(responseBody) ? responseBody[0] : responseBody;

  Look for:
  first.orderNumber
  first.order_number
  first.confirmationNumber
  first.confirmation_number
  first.transactionID
  first.transactionId
  first.transaction_id

  6. AbcDiagnosticsPanel data loading

  Build src/components/settings/AbcDiagnosticsPanel.tsx to visually mirror SrsDiagnosticsPanel, but keep ABC self-contained.

  Important:
  - If job/customer/address linkage is not available for sandbox rows, do not show an empty job box.
  - Show “Sandbox test order” or “No job linked” only in muted text if needed.
  - Do not let missing job links break the panel.

  7. Webhook/event matching

  When matching abc_webhook_events:
  - match tenant_id
  - match order_number OR confirmation_number
  - if both are missing, optionally match requestId/purchaseOrder inside payload if available
  - if no events, still show the card using abc_orders and abc_api_audit

  8. Audit matching

  abc_api_audit may store request body as:
  - request_body_redacted.requestId
  - request_body_redacted[0].requestId
  - request_body_redacted.purchaseOrder
  - request_body_redacted[0].purchaseOrder

  Support both object and array forms.

  9. Realtime

  Realtime should subscribe to:
  - abc_orders tenant rows
  - abc_webhook_events tenant rows
  - optionally abc_api_audit tenant rows

  If abc_api_audit realtime is too noisy, use manual refresh only. Do not risk performance problems.

  10. Refresh Status button

  Refresh Status should call:
  abc-api-proxy action=get_order_status

  Use:
  orderNumber if present
  else confirmationNumber if present

  If neither exists, disable Refresh Status and show:
  “ABC did not return an order or confirmation number for status lookup.”

  11. Inspect section

  Raw JSON must only appear inside Inspect.
  Main card stays clean.

  Inspect should include:
  - endpoint
  - request payload
  - response status
  - response body
  - latest audit row
  - webhook events timeline

  12. UI placement

  In ABCConnectionSettings.tsx:
  - Replace ephemeral OrderTrackingCard with <AbcDiagnosticsPanel />
  - Keep Latest Result Card for immediate feedback from the last clicked action
  - ABC Submit Diagnostics becomes the persistent historical tracking section

  13. Backend mirror edit rule

  Any change to:
  supabase/functions/abc-api-proxy/handler.ts

  must be mirrored exactly to:
  supabase/functions/supplier-api/abc-proxy-handler.ts

  After edits, redeploy:
  - supplier-api
  - abc-api-proxy

  14. Test sequence after deploy

  Run from logged-in app session:

  A. Product Search
  query=shingle
  branchNumber=1209
  Confirm filters + pagination.

  B. Pick real item from product search.

  C. Price Item
  shipToNumber=2010466-2
  branchNumber=1209
  itemNumber=<selected item>
  Confirm /pricing/v2/prices.

  D. Submit Sandbox Test Order
  shipToNumber=2010466-2
  branchNumber=1209
  itemNumber=<selected item>
  Confirm /order/v2/orders with array body.

  E. Confirm abc_orders row exists.
  F. Confirm abc_order_lines row exists.
  G. Confirm ABC Submit Diagnostics renders after page refresh.
  H. Confirm Inspect opens raw details.
  I. If orderNumber/confirmationNumber returned, confirm Refresh Status calls get_order_status.

  15. Docs

  Update docs/ABC_DEMO_READINESS.md with Sandy confirmation and add that ABC Submit Diagnostics persists sandbox attempts in abc_orders for demo traceability.

  Proceed.
  ```
  My main warning: their “no migration needed” assumption is only safe if they **don’t use database upsert without a unique constraint**. If `abc_orders` does not have a unique index on `(tenant_id, request_id)` or `(tenant_id, purchase_order)`, Supabase upsert will fail or silently not behave how they expect. The safer query-then-update/insert approach above avoids that.