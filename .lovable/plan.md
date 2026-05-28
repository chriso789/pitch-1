## Goal
Rework `AbcDiagnosticsPanel` so each ABC order shows a clear lifecycle (Sent → API Response → Confirmation → Webhook) instead of a single confusing `submitted` + `0 webhooks` row.

## Scope
Frontend-only refactor of `src/components/settings/AbcDiagnosticsPanel.tsx`. No DB or edge-function changes — we already persist enough in `abc_orders`, `abc_api_audit`, and `abc_webhook_events`. Refresh Status already accepts confirmationNumber.

## Changes

### 1. Per-order header pills
Replace the single `submitted` + `N webhooks` pills with an explicit lifecycle row:

`[ABC] {PO/requestId} [Sent] [API accepted | API error {code}] [Confirmation received | Order # received | No order ref returned] [N webhook(s) | No webhook updates yet] [sandbox|production]`

Color rules:
- Sent → green if request fired, red if invoke threw
- API response → green for 2xx, red for non-2xx (from `abc_api_audit.status_code`)
- Confirmation → green if `confirmation_number` or `order_number`; yellow "Submitted, no order reference returned" if 2xx with neither
- Webhooks → green if count>0, muted (not red) if 0

### 2. Main banner
Single sentence chosen from:
- "ABC API accepted order — confirmation received" (2xx + confirmation/order #)
- "ABC API accepted order — waiting on order reference" (2xx, no refs)
- "Last ABC webhook: {event_type} ({when})" (overrides above when webhooks exist)
- "ABC API rejected request — inspect response" (non-2xx)

### 3. Body
Always show `confirmationNumber: …` prominently when present. When `order_number` is missing show muted `orderNumber: Not returned by ABC sandbox response`. Remove the existing scary "ABC did not return an order/confirmation number…" warning block (replaced by the yellow pill + banner).

### 4. Inspect (expanded) section
Restructure into three labeled subsections instead of the current single dump:

- **A. Sent Request** — endpoint, method, payload (from latest matching `abc_api_audit` row), created_at
- **B. API Response** — HTTP status, response body, extracted `confirmationNumber` / `orderNumber` / `transactionID`
- **C. Webhook / Status Timeline** — list of `abc_webhook_events` rows, or muted "No ABC webhook events received for this order yet."

Raw JSON stays only inside Inspect.

### 5. Refresh Status
Already prefers `order_number` then falls back to `confirmation_number` — keep, but after the call append a "Status lookup" entry in section C showing HTTP status + body/error so the demo can show the result inline (transient component state, no DB write).

### 6. Wording sweep
- Replace any "0 webhooks" / "N webhooks" label with "No webhook updates yet" / "{N} webhook update(s)"
- Replace bare "Received" with one of: "API response received", "Confirmation received", "Webhook received"

## Files
- `src/components/settings/AbcDiagnosticsPanel.tsx` (only file touched)

## Out of scope
- No new DB columns; we read `abc_api_audit.status_code/response_body/request_body/endpoint/method` that already exist (will verify in build mode and adjust selectors if column names differ).
- No edge-function changes.
