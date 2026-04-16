

# Invoice & Payment Enhancements Plan

## Problem
1. **Invoice line items show empty** when the estimate was created via the `estimates` table (not `enhanced_estimates`). The current query only checks `enhanced_estimates`. Need to also check the `estimates` table as a fallback.
2. **Invoice should account for previous payments** — when creating a new invoice, the dialog should show total already paid and remaining balance, and optionally pre-fill the remaining amount.
3. **Record Payment dialog needs a "Scan" button** and a QuickBooks/bank account selector for matching payments.

## Changes

### 1. PaymentsTab.tsx — Fix estimate line item lookup (fallback to `estimates` table)
- Add a second query to the `estimates` table when `enhanced_estimates` returns no results
- Parse the `estimates` table `line_items` format (may differ slightly)
- This ensures the invoice dialog always shows line items from the approved estimate regardless of which table stores it

### 2. PaymentsTab.tsx — Show previous payments context in invoice dialog
- Display a summary above the line items: "Contract Value", "Already Paid", "Remaining Balance"
- Add a "Bill Remaining Balance" quick-fill button that sets the invoice total to `sellingPrice - totalPaid`
- When line items are loaded, if total paid > 0, show an info banner: "Previously paid: $X,XXX.XX"

### 3. PaymentsTab.tsx — Add Scan & QuickBooks to Record Payment dialog
- Add a **"Scan Payment"** button (camera icon) that opens the device camera or file picker to capture a check/receipt image, then uses AI (existing `parse-invoice-document` edge function pattern) to extract amount, date, and reference number
- Add **"QuickBooks"** and **"Bank Account"** as payment method options in the dropdown
- When "QuickBooks" is selected, show a sub-selector to pick from QBO payment records (fetches from `qbo_connections` → lists recent unmatched payments via the QBO API)
- If no QBO connection exists, show a "Connect QuickBooks" link to settings

### Technical Details
- **Estimate fallback query**: Query `estimates` table with `.eq('pipeline_entry_id', pipelineEntryId).in('status', ['approved','sent','signed'])` when `enhanced_estimates` returns empty
- **Scan button**: Uses `navigator.mediaDevices.getUserMedia` or file input for image capture, sends to existing `parse-invoice-document` edge function, auto-fills amount/date/reference fields
- **QBO payment matching**: New edge function `qbo-list-payments` that fetches recent payments from QBO API filtered by customer, returns them for selection in the UI
- All changes are in `PaymentsTab.tsx` plus one new edge function

