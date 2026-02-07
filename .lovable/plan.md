
# Fix: Quote PDF Missing Attachment Pages

## Problem Summary
When the "View Your Quote" link is opened, only 2 pages of the PDF are visible and the attachments are stuck in a "Loading attachments..." state. The saved PDF only has 2 pages instead of the full estimate with all attachments (SS vs 5V product flyer, License/Insurance docs, etc.).

## Root Cause Analysis

There are **two separate issues** causing the incomplete PDF:

### Issue 1: Hidden PDF Template Missing `templateAttachments` Prop

When generating PDFs for saving, `MultiTemplateSelector` renders a hidden `<EstimatePDFDocument>` (lines 2118-2134) to capture pages. However, **this hidden render does NOT pass `templateAttachments`**:

```typescript
// Current hidden PDF (lines 2118-2134) - NO templateAttachments!
<EstimatePDFDocument
  estimateNumber={pdfData.estimateNumber}
  estimateName={pdfData.estimateName}
  customerName={...}
  // ... other props
  measurementSummary={pdfData.measurementSummary}
  // MISSING: templateAttachments={...}
/>
```

Meanwhile, the `EstimatePreviewPanel` DOES pass `templateAttachments`:
```typescript
<EstimatePreviewPanel
  ...
  templateAttachments={templateAttachments}  // Correctly passed here
/>
```

So when you preview, attachments render correctly. But when you **save/create** the estimate, the hidden PDF document doesn't include attachments because they're not passed in.

### Issue 2: `pdfData` Object Missing `templateAttachments`

The `pdfData` state object is built at lines 1130-1145 and again at lines 1722-1738, but **neither includes `templateAttachments`**:

```typescript
setPdfData({
  estimateNumber,
  estimateName: pdfEstimateName,
  customerName,
  customerAddress,
  companyInfo,
  // ... etc
  measurementSummary,
  // MISSING: templateAttachments
});
```

### Issue 3: Timing Problem with Attachment Loading

Even if we pass `templateAttachments`, the `AttachmentPagesRenderer` loads PDFs asynchronously via `useEffect`. The current 500-800ms wait before capturing may not be enough for:
1. Fetching attachment PDFs from Supabase Storage
2. Rendering each page to a data URL using PDF.js
3. Injecting the rendered images into the DOM

The current flow only waits 500ms before calling `generateMultiPagePDF`, which captures whatever `[data-report-page]` elements exist at that moment. If attachments haven't finished loading, they show the spinner state (or no pages at all).

---

## Solution

### Part 1: Add `templateAttachments` to `pdfData` state

Update all locations where `setPdfData` is called to include the attachments:

**File**: `src/components/estimates/MultiTemplateSelector.tsx`

**Location 1** (line ~1130, in `handleCreateEstimate`):
```typescript
setPdfData({
  estimateNumber,
  estimateName: pdfEstimateName,
  ...
  measurementSummary,
  templateAttachments,  // ADD THIS
});
```

**Location 2** (line ~1430, in `handleSaveLineItemChanges` background PDF regen):
```typescript
setPdfData({
  estimateNumber: estimateNumberToUpdate,
  estimateName: pdfEstimateName,
  ...
  options: pdfOptions,
  templateAttachments,  // ADD THIS
});
```

**Location 3** (line ~1722, in `handleExportPDF`):
```typescript
setPdfData({
  estimateNumber,
  estimateName: pdfEstimateName,
  ...
  measurementSummary,
  templateAttachments,  // ADD THIS
});
```

### Part 2: Pass `templateAttachments` to hidden EstimatePDFDocument

**File**: `src/components/estimates/MultiTemplateSelector.tsx`

**Location** (lines 2118-2134, the hidden PDF capture element):
```typescript
<EstimatePDFDocument
  estimateNumber={pdfData.estimateNumber}
  estimateName={pdfData.estimateName}
  ...
  measurementSummary={pdfData.measurementSummary}
  templateAttachments={pdfData.templateAttachments}  // ADD THIS
/>
```

### Part 3: Wait for Attachments to Load Before Capture

The critical fix is ensuring we don't capture the PDF until attachments have fully rendered. We need to wait for the `AttachmentPagesRenderer` to finish loading and setting its `loading` state to false.

**Approach**: Add a mechanism to detect when all attachment pages have been rendered. We can poll for the absence of the loading spinner, or use a callback/ref approach.

**Simple polling approach** (in `handleCreateEstimate` after `setShowPDFTemplate(true)`):

```typescript
// Wait for render including attachments
const maxWaitMs = 15000; // 15 second max
const pollIntervalMs = 200;
let waited = 0;

// Poll until no loading indicators remain
while (waited < maxWaitMs) {
  await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  waited += pollIntervalMs;
  
  // Check if any attachment loaders are still showing
  const container = document.getElementById('estimate-pdf-pages');
  if (!container) continue;
  
  const loadingIndicators = container.querySelectorAll('.animate-spin');
  const pageCount = container.querySelectorAll('[data-report-page]').length;
  
  // If no spinners and we have pages, we're ready
  if (loadingIndicators.length === 0 && pageCount > 0) {
    console.log(`[PDF] Attachments ready after ${waited}ms, ${pageCount} pages found`);
    break;
  }
}

// Final small delay for render stability
await new Promise(resolve => setTimeout(resolve, 300));
```

This ensures:
- We wait up to 15 seconds for attachments to load
- We detect when loading spinners are gone
- We then capture all pages including attachment pages

---

## Files to Modify

1. **`src/components/estimates/MultiTemplateSelector.tsx`**
   - Add `templateAttachments` to all `setPdfData()` calls (3 locations)
   - Pass `templateAttachments={pdfData.templateAttachments}` to hidden `<EstimatePDFDocument>`
   - Implement polling wait for attachment rendering before PDF capture

---

## Testing After Fix

1. Create or edit an estimate that has template attachments (e.g., metal roof with 5V flyer)
2. Click "Create Estimate" or "Save Changes"
3. Verify the saved PDF includes:
   - Cover page
   - Estimate content pages
   - Warranty page
   - **All attachment pages (SS vs 5V flyer, License/Insurance, etc.)**
4. Send quote via email
5. Open the "View Your Quote" link
6. Verify all pages are visible without "Loading attachments..." spinner
