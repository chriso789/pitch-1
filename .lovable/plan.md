

# AI Invoice Scraping + Live Profit Margin Updates

## Overview
Two changes: (1) Auto-extract invoice data (number, date, total) from uploaded PDFs/images using AI vision, and (2) ensure the Profit Center and hyperlink bar update in real-time as invoices are uploaded.

## 1. New Edge Function: `parse-invoice-document`

**File**: `supabase/functions/parse-invoice-document/index.ts`

Uses LOVABLE_API_KEY + Gemini vision to extract structured data from an uploaded invoice image/PDF:
- Invoice number
- Invoice date
- Total amount
- Vendor name (bonus)

The function accepts a `document_url` (public URL of the uploaded file), sends it to the AI gateway with a structured extraction prompt, and returns the parsed fields. Uses tool-calling for structured output (invoice_number, invoice_date, invoice_amount, vendor_name).

## 2. Update `InvoiceUploadCard` Component

**File**: `src/components/production/InvoiceUploadCard.tsx`

After a file is uploaded to storage (line 82-90), call the new `parse-invoice-document` edge function with the public URL. On success, auto-fill the form fields:
- `invoice_number` → parsed invoice number
- `invoice_date` → parsed date (formatted to YYYY-MM-DD)
- `invoice_amount` → parsed total
- `vendor_name` → parsed vendor name

Show a loading state ("Scanning invoice...") while AI processes. User can still manually override any field before submitting.

## 3. Live Profit Margin Updates (Already Working)

Looking at the existing code, the `ProfitCenterPanel` already:
- Fetches invoices via `useQuery(['pipeline-invoices', pipelineEntryId])`
- Calculates `effectiveMaterialCost` and `effectiveLaborCost` from actual invoices
- Computes `profitMargin` using effective costs
- Shows variance indicators

The `handleInvoiceSuccess` callback already calls `queryClient.invalidateQueries` which triggers re-fetch. The hyperlink bar uses a separate query key (`hyperlink-data`) but the profit center already recalculates on invoice changes.

To ensure the **hyperlink bar** also reflects actual costs, I'll update the `EstimateHyperlinkBar` to also listen for invoice data and overlay actual costs on the Materials/Labor sections when invoices exist.

## 4. Update EstimateHyperlinkBar with Actuals

**File**: `src/components/estimates/EstimateHyperlinkBar.tsx`

Add a query for `pipeline-invoices` (same as ProfitCenterPanel). When actual invoices exist for materials or labor, show the actual cost in the bar instead of just the estimate, and adjust the profit % to reflect real margins.

## Changes Summary

| File | Change |
|------|--------|
| `supabase/functions/parse-invoice-document/index.ts` | New — AI vision extraction of invoice data |
| `supabase/config.toml` | Add `parse-invoice-document` function entry |
| `src/components/production/InvoiceUploadCard.tsx` | Call AI parser after upload, auto-fill fields |
| `src/components/estimates/EstimateHyperlinkBar.tsx` | Fetch invoices, overlay actuals on bar sections |

