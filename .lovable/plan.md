## Goal

Replace our best-effort Beacon push with the **official QXO/Beacon v2 contract** for Orders, Quote Orders, Order History, Invoices, and Quotes — and surface them in the app. OAuth client-credentials wiring is deferred (per your note); for now we keep the existing cookie-session auth and swap in a Bearer token later by changing one helper.

---

## What gets built

### 1. Edge function: `qxo-submit-order` (replaces ad-hoc paths in `qxo-push-order`)

- POSTs to `/v2/rest/com/becn/submitOrder` with the exact official body:
  `accountId, job{jobName,jobNumber}, purchaseOrderNo, extendedPO, orderStatusCode, lineItems[{itemNumber,quantity,unitOfMeasure,description,productNumber,lineComments,cost,price,vendorCode}], shipping{shippingMethod,shippingBranch,address{...},deliveryType}, sellingBranch, specialInstruction, checkForAvailability, pickupDate, apiSiteId, pickupTime, onHold, UUID, attachFile?`
- Maps our estimate/PO line items → Beacon line items, respecting all field max-lengths.
- `UUID` = our local `purchase_orders.id` so we can reconcile responses.
- On 200 → store `beacon_order_id = response.orderId`, set PO `status='submitted'`.
- On 4xx/5xx → store `beacon_message_code` + `beacon_message`, set `status='qxo_rejected'`.

### 2. Edge function: `qxo-submit-quote-order`

- POSTs `/v2/rest/com/becn/submitQuoteOrder` with `bidNumber` + the fuller `lineItems` schema (`itemUnitPrice, itemSubTotal, ATGItemMapping, sendToMincronDirectly, itemType, nonStockItem, …`).
- Same response handling pattern as submitOrder.

### 3. Edge function: `qxo-orders` (history + detail + PDF)

- `GET ?action=list` → `/v2/rest/com/becn/orderhistory_v2` with passthrough query params (`pageSize, pageNo, searchBy, searchTerm, searchStartDate, searchEndDate, searchEnum, orderBy`). Caches each page into a new `qxo_orders` table so the UI is instant.
- `GET ?action=detail&orderId=…` → `/v2/rest/com/becn/orderdetail` (passes `showDT=true`).
- `GET ?action=pdf&orderId=…` → proxies `/v2/rest/com/becn/downloadOrderDetailAsPDF` and streams the PDF back.

### 4. Edge function: `qxo-invoices-v4` (replaces invoice sync)

- `GET ?action=list` → `/v4/rest/com/becn/invoice` with `accountId, company, branchNumber` + search params; upserts into existing `qxo_invoices` table using the v4 field shape (`orderNumber, invoiceDate, jobName, jobNumber, purchaseOrderNumber, sales, otherCharges, salesPlusOtherCharges`).
- `GET ?action=pdf&invoiceNumbers=…` → proxies `/v2/rest/com/becn/downloadBillTrustInvoiceAsPDF`.

### 5. Edge function: `qxo-quotes`

- `GET ?action=detail&quoteId=…` → `/v2/rest/com/becn/getMincronQuoteDetail`
- `POST {action:'revise', quoteId, quoteNotes}` → `/v2/reviseQuote`
- `POST {action:'reject', quoteId, reason}` → `/v2/rejectQuote`
- `POST {action:'submitDelegated', …}` → `/v2/rest/com/becn/submitDelegatedQuote` (full body validation per the spec).

### 6. Database (one migration)

- New `qxo_orders` (cached order history): `tenant_id, beacon_order_id, account_id, po_number, customer_uuid, job_name, job_number, status_code, status_value, on_hold, total, sub_total, tax, currency, order_placed_date, invoiced_date, payment_status, selling_branch, shipping_branch, shipping_method, ship_address jsonb, raw_payload jsonb, last_synced_at`. Unique `(tenant_id, beacon_order_id)`. RLS scoped to tenant.
- New `qxo_quotes`: `tenant_id, beacon_quote_id, mincron_id, account_id, account_name, status, status_description, job_name, job_number, work_type, total, sub_total, tax, expires, creation_date, quote_notes, quote_items jsonb, raw_payload jsonb, last_synced_at`. Unique `(tenant_id, beacon_quote_id)`. RLS scoped to tenant.
- Add columns to `purchase_orders`: `beacon_order_id text`, `beacon_message_code text`, `beacon_message text`, `beacon_uuid uuid` (mirrors local PO id sent as Beacon `UUID`).
- Add columns to `qxo_invoices`: `company int`, `branch_number int`, `sales numeric`, `other_charges numeric`, `sales_plus_other_charges numeric`, `mincron_invoice_pdf_url text` — to fit the v4 schema.

### 7. Shared helper (`supabase/functions/_shared/qxo-auth.ts`)

- Single function `getBeaconAuth(supabase, tenantId)` returning `{ headers, accountId, branch, apiSiteId }`.
- Today: performs cookie login (existing logic), returns `{ Cookie: … }`.
- Tomorrow when OAuth secrets land: swap the body to fetch `/v1/rest/com/becn/oauth` and return `{ Authorization: 'Bearer …' }`. Every new edge function calls this helper, so the migration to OAuth is one-file.

### 8. Frontend

- **Settings → QXO panel**: add three sub-tabs — *Orders*, *Invoices*, *Quotes* — each with a paged table powered by the new edge functions, plus a row action to open Beacon's PDF in a new tab.
- **Estimate → Material Order area**: rewire `PushToQXOButton` to call `qxo-submit-order` (the new function) and show the returned `beacon_order_id` in the toast + PO row.
- New hook `useQxoOrders`, `useQxoInvoicesV4`, `useQxoQuotes` (tanstack-query, all scoped via `useEffectiveTenantId()`).

---

## Order of operations

```text
1. Migration (qxo_orders, qxo_quotes, purchase_orders cols, qxo_invoices cols)
2. _shared/qxo-auth.ts (auth helper using current cookie login)
3. qxo-submit-order        + UI rewire on PushToQXOButton
4. qxo-orders              + Settings → QXO → Orders tab
5. qxo-invoices-v4         + Settings → QXO → Invoices tab (replaces current sync)
6. qxo-quotes              + Settings → QXO → Quotes tab
7. qxo-submit-quote-order  + "Convert to Quote Order" action on PO row
```

When you're ready to provide `QXO_CLIENT_ID` / `QXO_CLIENT_SECRET`, only `_shared/qxo-auth.ts` changes — none of the new functions touch auth directly.

---

## Open questions

1. For `submitOrder`, do you want **`onHold: true`** by default (order goes to Beacon as a draft you confirm in their portal) or **`onHold: false`** (auto-submit)?
2. `checkForAvailability` — default to `"yes"` (Beacon validates stock before accepting) or `"no"` (faster, may bounce later)?
3. `apiSiteId` — should we hard-code `"BDD"`, store it on `qxo_connections`, or let users pick per-order?
4. Are you OK with me **deprecating** the current `qxo-push-order` (we'd keep the file as a thin shim that calls `qxo-submit-order` so any old callers don't break)?
