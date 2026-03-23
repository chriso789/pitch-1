

## Fix: AI Invoice Parsing Not Populating Form Fields

### Problem
When a Beacon Roofing Supply invoice PDF is uploaded, the AI scan runs but fails to populate the form fields (amount shows $0.00, vendor/invoice# are empty). The edge function extracts only 4 basic fields and doesn't capture line items. The user wants the form to be ready to save after upload.

### Root Causes
1. The `parse-invoice-document` edge function prompt is too minimal — it asks for only invoice_number, date, amount, vendor_name but doesn't extract line items
2. The tool schema doesn't include a `line_items` array for itemized costs
3. The `InvoiceUploadCard` component doesn't display extracted line items or give a clear confirmation that fields were populated

### Plan

**1. Enhance the edge function extraction schema**
- File: `supabase/functions/parse-invoice-document/index.ts`
- Expand the AI prompt to explicitly ask for line items (description, quantity, unit price, line total)
- Add `line_items` array to the tool function schema
- Improve the system prompt to handle roofing supply invoices specifically (PO numbers, branch codes, account numbers)
- Add a `subtotal`, `tax`, and `total` breakdown so the amount is more reliably captured

**2. Update the UI to show extracted line items and auto-fill reliably**
- File: `src/components/production/InvoiceUploadCard.tsx`
- After AI parse, display a collapsible summary of extracted line items below the form so the user can verify
- Auto-populate `notes` field with a formatted line item summary (item descriptions + amounts)
- Ensure the amount field shows the parsed total immediately
- Add a visual "fields populated" indicator when AI scan succeeds

**3. Deploy the updated edge function**
- Redeploy `parse-invoice-document` so the enhanced extraction takes effect

### Technical Details

**Enhanced tool schema** will include:
```typescript
line_items: [{
  description: string,
  quantity: number,
  unit_price: number,
  line_total: number
}],
subtotal: number,
tax_amount: number,
total_amount: number  // replaces invoice_amount for clarity
```

**Line items display** — a small table/list rendered below the form fields showing each extracted item, with the total auto-summed into the Amount field.

### Files to Update
- `supabase/functions/parse-invoice-document/index.ts` — enhanced extraction
- `src/components/production/InvoiceUploadCard.tsx` — line items display + better auto-fill

### Expected Result
- Upload a Beacon invoice PDF → all fields auto-populate (vendor: "Beacon Roofing Supply", invoice #, date, total amount)
- Line items are shown as a summary the user can review
- Form is ready to submit immediately after scan completes

