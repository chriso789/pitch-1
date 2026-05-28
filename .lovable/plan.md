# Persistent ABC Submit Diagnostics

Mirror SRS diagnostics for ABC. Persist every sandbox submit (success or failure) into `abc_orders` / `abc_order_lines` using safe query-then-update/insert (no upsert, no migration). Replace ephemeral order card with a persistent panel.

## 1. Backend — `abc-api-proxy/handler.ts` (mirror to `supplier-api/abc-proxy-handler.ts`)

### `submit_test_order` rewrite

- Build payload, POST to ABC `/order/v2/orders`.
- **Hoist response IDs** (response may be array or object):
  - `orderNumber` / `order_number`
  - `confirmationNumber` / `confirmation_number`
  - `transactionID` / `transactionId` / `transaction_id`
  - `requestId`, `purchaseOrder`, `branchNumber`, `shipToNumber`
- **Determine status**:
  - `r.ok` + has orderNumber|confirmationNumber → `submitted`
  - `r.ok` + no reference → `submitted_pending_reference`
  - non-2xx → `error`
- **Persist (no upsert)**:
  1. Query `abc_orders` for tenant_id + (request_id OR purchase_order OR confirmation_number OR order_number).
  2. If found → update. If not → insert.
  3. For lines: delete existing `abc_order_lines` where `order_id = <row>.id AND tenant_id = …`, then insert current submitted line.
- Write `abc_api_audit` row with endpoint, request body, response status, response body, requestId, purchaseOrder.
- Return top-level: `{ orderNumber, confirmationNumber, transactionID, requestId, purchaseOrder, branchNumber, shipToNumber, status, raw }`.

### `get_order_status`

- Accept `orderNumber` (preferred) or `confirmationNumber`. If neither, 400.
- On success, update matching `abc_orders` row (`order_status`, `last_status_payload`, `updated_at`).

### Wording fix in proxy/UI helper text

- Replace: `POSTs the canned PITCH sandbox payload to /order/v2/orders`
- With: `Submits a non-production ABC sandbox order to ABC QA`

## 2. Frontend — new `src/components/settings/AbcDiagnosticsPanel.tsx`

Visually mirrors `SrsDiagnosticsPanel`:

- Header: "ABC Submit Diagnostics"
- For each of latest 5 `abc_orders` (by `created_at desc`):
  - Supplier badge `ABC`
  - Title = `purchase_order` || `request_id`
  - Status pill (submitted / submitted_pending_reference / error / etc.)
  - Received/last-update timestamp pill
  - Webhook/API count pill (count of matching `abc_api_audit` + `abc_webhook_events`)
  - "Last ABC update: …" banner from latest audit/webhook
  - Metadata rows: Submitted, Branch, Ship-To, orderNumber, confirmationNumber, transactionID, requestId, purchaseOrder
  - Conditional Job/Customer/Address rows — **hidden when not linked** (sandbox)
  - Red rejection box when `order_status='error'` with error message
  - **Refresh Status** button → calls `abc-api-proxy` `get_order_status` (orderNumber first, then confirmationNumber). Disabled with tooltip `"ABC did not return an order or confirmation number for status lookup."` when neither exists.
  - **Inspect** toggle reveals: endpoint, request payload, response status, response body, latest `abc_api_audit` row, webhook/event timeline (raw JSON only here).

### Data fetching

- `abc_orders` latest 5 by tenant.
- `abc_order_lines` joined by order_id.
- `abc_api_audit` matching `request_id` OR `purchase_order`.
- `abc_webhook_events` matching `order_number` OR `confirmation_number` (render order even when none).

## 3. `ABCConnectionSettings.tsx` cleanup

- Remove ephemeral `OrderTrackingCard` + the helper state/handlers that only powered it.
- Keep "Latest Result" card for immediate feedback after a click.
- Mount `<AbcDiagnosticsPanel />` as the persistent tracking section (visible in Simple Mode).
- Keep raw OAuth/dev details inside Advanced / Developer Details.

## 4. Docs — `docs/ABC_DEMO_READINESS.md`

Add:

- Sandbox orders are non-production, connect only to ABC QA (confirmed by Sandy).
- Ship-To: `2010466-2`, Branch: `1209`.
- Must run product search at branch 1209 first to pick a valid `itemNumber`.
- ABC Submit Diagnostics persists every sandbox attempt in `abc_orders` for traceability.

## 5. Deploy & validate

- Redeploy `supplier-api` and `abc-api-proxy`.
- Run end-to-end: product search (branch 1209) → price_items → submit_test_order.
- Report: files changed, deploy status for both functions, product search result, selected itemNumber, price_items req/resp, submit_test_order req/resp, `abc_orders` row created, `abc_order_lines` row created, panel visible after refresh, Inspect works.

## Technical notes

- **No migration.** Persistence uses query-then-update/insert keyed on tenant_id + first available of (request_id, purchase_order, confirmation_number, order_number). No assumption of a unique index.
- Both proxy handlers must stay byte-identical for the submit/status logic; shared helper kept inline in each per existing pattern.
- All new RLS-touching reads use `useEffectiveTenantId()` and explicit `.eq('tenant_id', …)` filters.  
  
This plan is the right move. It finally makes ABC behave like SRS: every submit attempt gets a permanent diagnostic record, users can refresh the page and still see the history, and the demo has proof of what was sent/received.
  Send Lovable this approval with a few final requirements:
  ```

  ```
  ```
  Approved. Execute the Persistent ABC Submit Diagnostics plan.

  This is the correct architecture:
  - Every sandbox submit attempt must persist to abc_orders and abc_order_lines.
  - ABC Submit Diagnostics should mirror SRS diagnostics visually.
  - Raw details stay inside Inspect.
  - No DB migration.
  - No new edge functions.
  - No SRS-side changes.

  Proceed with the plan exactly, with these final requirements:

  1. Persistence must happen for both success and failure

  In submit_test_order:
  - Always write abc_api_audit.
  - Always create/update abc_orders even if ABC returns non-2xx.
  - Always save raw_payload = { request, response }.

  Status mapping:
  - r.ok + orderNumber/confirmationNumber → submitted
  - r.ok + no orderNumber/confirmationNumber → submitted_pending_reference
  - non-2xx → error

  2. Query-then-update/insert only

  Do not use upsert unless a matching unique index is verified.

  Find existing abc_orders row by tenant_id and first available of:
  - request_id
  - purchase_order
  - confirmation_number
  - order_number

  If found, update.
  If not found, insert.

  3. abc_order_lines

  After abc_orders row exists:
  - delete existing abc_order_lines for order_id + tenant_id
  - insert the current submitted item line

  This prevents duplicate lines after retries.

  4. Hoist response fields

  submit_test_order response must include top-level:

  {
    orderNumber,
    confirmationNumber,
    transactionID,
    requestId,
    purchaseOrder,
    branchNumber,
    shipToNumber,
    status,
    raw
  }

  Handle ABC response as either array or object:
  const first = Array.isArray(responseBody) ? responseBody[0] : responseBody;

  Check these variants:
  - orderNumber / order_number
  - confirmationNumber / confirmation_number
  - transactionID / transactionId / transaction_id

  5. get_order_status persistence

  When get_order_status succeeds:
  - update matching abc_orders row
  - update order_status
  - update last_status_payload if that column exists
  - update raw_payload.response.status_lookup or raw_payload.status_lookup if last_status_payload does not exist
  - update updated_at

  Do not fail if last_status_payload column does not exist. Use a safe fallback.

  6. Mirror both handlers exactly

  Any submit_test_order or get_order_status changes in:

  supabase/functions/abc-api-proxy/handler.ts

  must be mirrored to:

  supabase/functions/supplier-api/abc-proxy-handler.ts

  After edits, redeploy:
  - supplier-api
  - abc-api-proxy

  7. AbcDiagnosticsPanel

  Create:
  src/components/settings/AbcDiagnosticsPanel.tsx

  Mirror SrsDiagnosticsPanel visually:
  - Header: ABC Submit Diagnostics
  - Refresh icon
  - ABC badge
  - purchase_order || request_id as title
  - status pill
  - received/update timestamp pill
  - webhook/API count pill
  - Last ABC update banner
  - metadata rows
  - copy buttons for long IDs
  - Inspect toggle
  - Refresh Status button
  - red rejection/error box when order_status is error/rejected/failed/cancelled

  Do not render empty Job/Customer/Address box for sandbox rows with no project/job linkage.

  8. Data fetching rules

  Read latest 5 abc_orders by tenant_id and created_at desc.

  For each order:
  - load abc_order_lines by order_id
  - load matching abc_api_audit by requestId or purchaseOrder
  - load matching abc_webhook_events by order_number or confirmation_number
  - if no webhook events exist, still render from abc_orders + abc_api_audit

  Audit matching must support request body as object or array:
  - request_body_redacted.requestId
  - request_body_redacted[0].requestId
  - request_body_redacted.purchaseOrder
  - request_body_redacted[0].purchaseOrder

  9. Refresh Status button

  Use:
  orderNumber first
  confirmationNumber second

  If neither exists, disable the button and tooltip:
  “ABC did not return an order or confirmation number for status lookup.”

  10. Inspect content

  Inspect should show:
  - endpoint
  - request payload
  - response status
  - response body
  - latest audit row
  - webhook/event timeline

  Raw JSON only inside Inspect.

  11. ABCConnectionSettings cleanup

  Remove ephemeral OrderTrackingCard and helpers that only powered it.

  Keep Latest Result Card for immediate click feedback.

  Mount:
  <AbcDiagnosticsPanel />

  in Simple Mode as the persistent tracking section.

  12. Docs

  Update docs/ABC_DEMO_READINESS.md:
  - Sandy confirmed sandbox is non-production and connects only to ABC QA.
  - Ship-To: 2010466-2
  - Branch: 1209
  - Item: use product search first; any item available at branch 1209
  - ABC Submit Diagnostics persists every sandbox submit attempt into abc_orders for traceability.

  13. Deploy and report back

  After deployment, provide:
  - files changed
  - supplier-api deploy status
  - abc-api-proxy deploy status
  - product search result
  - selected itemNumber
  - price_items request/response
  - submit_test_order request/response
  - abc_orders row created/updated
  - abc_order_lines row created
  - diagnostics panel visible after refresh
  - Inspect section working
  ```
  This is the version I’d trust for Sandy’s demo. The only thing to watch: if `abc_orders` does **not** have a `last_status_payload` column, Lovable must not break the status refresh trying to write to it. The fallback to `raw_payload.status_lookup` is important.