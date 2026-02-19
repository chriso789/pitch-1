

# Fix: Signature Page Index Calculation + Verification Details

## The Real Problem

The `signature_page_index` is being calculated incorrectly. The code counts ALL `[data-report-page]` elements inside `#estimate-pdf-pages`, but attachment pages (license, insurance docs) are ALSO rendered inside `#estimate-pdf-pages` via `AttachmentPagesRenderer`. So `estimatePageCount - 1` points to the last attachment page, not the signature block page.

**PDF page structure (example with current estimate):**
```text
Page 0: Cover page
Page 1: Items/pricing (first page)
Page 2: Items continuation + Terms + SIGNATURE BLOCK  <-- THIS is the target
Page 3: Attachment (Florida license)                   <-- Currently targeted (WRONG)
```

The signature block is part of the `TermsSection` component, which is rendered on the last ITEMS page (the one with `showTerms={true}`). Warranty, measurement, photos, and attachment pages all come AFTER it.

## Solution

### 1. Fix signature page index calculation in `EstimatePreviewPanel.tsx`

Instead of counting all `#estimate-pdf-pages [data-report-page]` (which includes attachments), we need to count only the estimate content pages EXCLUDING attachment pages.

The `AttachmentPagesRenderer` renders its pages with a key pattern `attachment-*`. We can add a `data-attachment-page` attribute to distinguish them, then count only non-attachment pages:

```
signaturePageIndex = total [data-report-page] count - attachment [data-report-page] count - 1
```

More precisely: count the pages that are NOT attachment pages to find the last estimate content page.

**Changes:**
- In `AttachmentPagesRenderer.tsx`: add `data-attachment-page` attribute to each attachment page div (alongside the existing `data-report-page`)
- In `EstimatePreviewPanel.tsx`: calculate signature page as `totalPages - attachmentPages - warrantyPages - measurementPages - photoPages`. Actually, simpler: query for `[data-report-page]:not([data-attachment-page])` inside `#estimate-pdf-pages`, then subtract warranty/measurement/photo pages. 

Even simpler approach: since we know the page structure, we can compute the signature page index directly from the options:
- Start at 0
- +1 if cover page enabled
- + number of item chunks (always at least 1)
- The last item chunk page is the one with the signature block
- So: `signaturePageIndex = (coverPage ? 1 : 0) + itemChunks - 1`

But we don't have access to `itemChunks` in the preview panel. The cleanest fix is to mark attachment pages with a data attribute and exclude them from the count.

### 2. Add `data-attachment-page` marker to `AttachmentPagesRenderer.tsx`

Add `data-attachment-page` attribute to each rendered attachment page div. This lets us distinguish estimate content pages from attachment pages in the DOM.

### 3. Fix the page index calculation in `EstimatePreviewPanel.tsx`

Change the signature page calculation from:
```typescript
const estimatePages = container.querySelectorAll('#estimate-pdf-pages [data-report-page]');
const sigPageIdx = estimatePages.length - 1;
```

To:
```typescript
const allPages = container.querySelectorAll('#estimate-pdf-pages [data-report-page]');
const attachmentPages = container.querySelectorAll('#estimate-pdf-pages [data-attachment-page]');
const contentPageCount = allPages.length - attachmentPages.length;
```

But this still includes warranty, measurement, and photos pages which come AFTER the signature block. We need to go further back.

The most reliable approach: add a `data-signature-page` marker directly on the page that contains the signature block in `EstimatePDFDocument.tsx`. Then query for it by attribute.

### 4. Mark the signature block page in `EstimatePDFDocument.tsx`

On the `PageShell` that wraps the last items page (the one with `showTerms={true}` and `showSignatureBlock`), add a `data-signature-page` attribute. Then in the preview panel, find this specific page's index among all `[data-report-page]` elements.

### 5. Adjust signature position coordinates in `finalize-envelope/index.ts`

The current `sigY = 120` places the signature near the bottom. But the "Customer Signature" block is positioned within the terms section content area. Based on the HTML structure (the signature block has "Customer Signature" label with `mb-6` spacing, then a border line, then "Date: ___"), the signature image should be placed approximately:
- `x = 60` (left column, matching current)
- `y = 130-140` from the bottom (just above the signature line in the left column)

Also draw the verification details (signer name, date signed, IP address) clearly below the signature image, filling in the "Date: ___" field area.

## Files to Change

| File | Change |
|---|---|
| `src/components/estimates/EstimatePDFDocument.tsx` | Add `data-signature-page` attribute to the PageShell wrapping the page that contains the signature block |
| `src/components/estimates/AttachmentPagesRenderer.tsx` | Add `data-attachment-page` attribute to each attachment page div |
| `src/components/estimates/EstimatePreviewPanel.tsx` | Find the signature page by querying `[data-signature-page]` and computing its index among all `[data-report-page]` elements |
| `supabase/functions/finalize-envelope/index.ts` | Fine-tune Y coordinate for signature placement to match the "Customer Signature" block area |

## Technical Detail: Finding the Correct Page Index

```typescript
// In EstimatePreviewPanel.tsx handlePrepareAndShare:
const allPages = Array.from(container.querySelectorAll('[data-report-page]'));
const sigPage = container.querySelector('[data-signature-page]');
let sigPageIdx: number | null = null;
if (sigPage) {
  sigPageIdx = allPages.indexOf(sigPage);
}
// Falls back to null if not found (finalize-envelope will use last page)
```

This is bulletproof -- it finds the exact DOM element that contains the signature block and determines its position in the page sequence, regardless of how many warranty, measurement, photo, or attachment pages follow it.

## What This Fixes

- Signature image will appear on the exact page containing the "Customer Signature" block, not on an attachment page
- Works regardless of how many extra pages (warranty, measurements, photos, attachments) follow the signature block
- Verification details (signer name, date, IP) will be drawn clearly below the signature on the correct page
- Backward compatible: envelopes without `signature_page_index` still fall back to last page
