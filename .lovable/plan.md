

# Fix: Place Signature on Correct Page (Signature Block) + Show Verification Details

## Problem

The signature is being placed on the LAST page of the PDF (which is an attachment page -- the Florida Building Commission license), instead of on the estimate's "Customer Signature" block. This happens because `finalize-envelope` uses `pageCount - 1` to get the last page, but attachment pages come AFTER the estimate pages.

The estimate PDF structure is:
- Pages 1-N: Estimate content (the LAST of these has the "Customer Signature" block)
- Pages N+1 to end: Attachment pages (license, insurance, etc.)

The code targets the wrong page because it doesn't know where the estimate ends and attachments begin.

## Solution

### 1. Add `signature_page_index` column to `signature_envelopes`

A new integer column that stores the 0-based index of the page containing the signature block. This tells `finalize-envelope` exactly which page to draw on.

```sql
ALTER TABLE signature_envelopes 
ADD COLUMN IF NOT EXISTS signature_page_index INTEGER;
```

### 2. Pass signature page index from EstimatePreviewPanel

In the `handleShareEstimate` function, after counting total pages, also count only the estimate content pages (from `#estimate-pdf-pages [data-report-page]`). The signature block is on the LAST estimate page, so `signature_page_index = estimatePageCount - 1`.

Store this on the `enhanced_estimates` record alongside the `pdf_url` update, then the `send-document-for-signature` function can read it.

**File: `src/components/estimates/EstimatePreviewPanel.tsx`**
- After generating the PDF, count estimate-only pages: `container.querySelectorAll('#estimate-pdf-pages [data-report-page]').length`
- Update `enhanced_estimates` with a new field or store in the existing record

### 3. Pass signature page index through `send-document-for-signature`

**File: `src/components/estimates/ShareEstimateDialog.tsx`**
- Accept a new prop `signaturePageIndex`
- Pass it in the request body to `send-document-for-signature`

**File: `supabase/functions/send-document-for-signature/index.ts`**
- Accept `signature_page_index` in the request body
- Store it on the envelope when inserting into `signature_envelopes`

### 4. Use the correct page in `finalize-envelope`

**File: `supabase/functions/finalize-envelope/index.ts`**
- Read `envelope.signature_page_index` 
- If set, use `pdfDoc.getPage(envelope.signature_page_index)` instead of `pdfDoc.getPage(pageCount - 1)`
- Fallback to `pageCount - 1` if not set (backward compatibility)
- Position signature at the "Customer Signature" area: left column, just above the signature line (~`y=100`, `x=60`)
- Draw signer name below the signature image
- Draw `Date: MM/DD/YYYY` below the name (filling in the "Date: ___" field)
- Draw IP address in small gray text below the date

### 5. Fix base64 image detection (from previous plan, still needed)

**File: `supabase/functions/finalize-envelope/index.ts`**
- The existing code at line 210 already checks `sig.signature_data.startsWith('data:image')` -- verify this path is actually being reached. If `signature_data` is `null` or the condition doesn't match, the signature silently skips. Add logging to confirm.

## Files to Change

| File | Change |
|---|---|
| **Database migration** | Add `signature_page_index INTEGER` column to `signature_envelopes` |
| **`src/components/estimates/EstimatePreviewPanel.tsx`** | Count estimate-only pages, pass `signaturePageIndex` to ShareEstimateDialog |
| **`src/components/estimates/ShareEstimateDialog.tsx`** | Accept and forward `signaturePageIndex` prop |
| **`supabase/functions/send-document-for-signature/index.ts`** | Accept `signature_page_index`, store on envelope |
| **`supabase/functions/finalize-envelope/index.ts`** | Use `signature_page_index` to target the correct page; fallback to last page |

## What This Fixes

- Signature image will appear on the "Customer Signature" line of the estimate page, not on the attachment page
- Signer name, date, and IP will be visible below the signature on the correct page
- Works correctly regardless of how many attachment pages follow the estimate
- Backward compatible: envelopes without `signature_page_index` will still target the last page

