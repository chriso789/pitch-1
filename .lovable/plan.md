

# Add "Save" Button to Estimate Preview Panel

## Overview

Add a dedicated **Save** button to the Preview Estimate panel that generates the PDF from the current preview (with all toggle settings, attachments, and page order) and saves it to storage + creates a document record. This lets users persist the exact document they see without needing to share or re-export it later.

## What Changes

### Single File Modified: `src/components/estimates/EstimatePreviewPanel.tsx`

**1. Add a `Save` icon import**

Add `Save` from `lucide-react` to the existing icon imports.

**2. Add `isSaving` state**

New boolean state to track save-in-progress and disable the button during upload.

**3. New `handleSaveToDocuments` function**

This reuses the existing PDF generation pattern (already in `handlePrepareAndShare`) combined with the `saveEstimatePdf` utility from `src/lib/estimates/estimatePdfSaver.ts`:

- Wait for attachments to finish rendering (same polling logic already used)
- Generate multi-page PDF via `generateMultiPagePDF`
- Call `saveEstimatePdf()` which uploads to `documents` bucket at `{pipelineEntryId}/estimates/{estimateNumber}.pdf` and creates a `documents` table row
- Also update `enhanced_estimates.pdf_url` so the saved PDF is linked to the estimate
- Show success/error toast

This function requires `pipelineEntryId`, `tenantId`, and `userId` props (already passed to the component).

**4. Add Save button to the footer action bar**

The current footer has: `Reset Defaults`, `Share`, `Export PDF`.

Updated layout will be: `Reset Defaults`, then a row of three buttons: `Save` | `Share` | `Export PDF`.

- **Save** button: disk icon, calls `handleSaveToDocuments`
- Disabled when `isSaving`, `isExporting`, or when required props (`pipelineEntryId`, `tenantId`, `userId`) are missing
- Shows spinner while saving, success toast with filename on completion

**5. Import `saveEstimatePdf`**

Add import from `@/lib/estimates/estimatePdfSaver`.

## Button Behavior

- **Save**: Generates PDF from current preview state -> uploads to storage -> creates document record -> updates estimate's `pdf_url`. User can later find it in the Documents tab or re-share without rebuilding.
- **Share**: (existing) Generates PDF -> uploads -> opens share dialog to send via email/SMS.
- **Export PDF**: (existing) Generates PDF -> downloads to user's device locally.

## Technical Details

```text
handleSaveToDocuments flow:
  1. Set isSaving = true
  2. Poll for attachments ready (existing pattern)
  3. generateMultiPagePDF('estimate-preview-template', pageCount, options)
  4. saveEstimatePdf({ pdfBlob, pipelineEntryId, tenantId, estimateNumber, description, userId, estimateDisplayName })
  5. Update enhanced_estimates.pdf_url = filePath
  6. Toast success: "Estimate saved to documents"
  7. Set isSaving = false
```

The `saveEstimatePdf` function already handles:
- Uploading to `documents` bucket with `upsert: true` (overwrites previous version)
- Creating a `documents` table row with metadata
- Proper error handling and partial-success reporting

No new database tables, edge functions, or migrations needed -- this leverages the existing `saveEstimatePdf` utility and storage infrastructure.

