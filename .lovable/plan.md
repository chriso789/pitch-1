

# Fix: Manually Added Attachments Missing from Preview Export PDF

## Problem Summary

When you click "Export PDF" from the Preview Estimate dialog, manually-added attachments (from Company Docs) are not included in the downloaded PDF. You confirmed:
- The attachments finish loading and display correctly in the preview
- You wait for them to load before clicking Export
- The downloaded PDF is still missing those attachment pages

## Root Cause

The Preview Panel uses `usePDFGeneration` (single-page capture) instead of `useMultiPagePDFGeneration` (multi-page capture).

**The critical difference:**

| Hook | Capture Method | Result |
|------|----------------|--------|
| `usePDFGeneration` | Captures entire element as ONE canvas image, then slices into pages | Long content gets chopped arbitrarily; attachment pages at the bottom get cut off |
| `useMultiPagePDFGeneration` | Finds each `[data-report-page]` element and captures separately | Each page is captured individually with proper boundaries |

### Code Flow

**Current (broken):**
```typescript
// EstimatePreviewPanel.tsx line 150
const { generatePDF } = usePDFGeneration(); // WRONG

// line 224 - captures id="estimate-preview-template" as ONE image
const pdfBlob = await generatePDF('estimate-preview-template', {...});
```

The `usePDFGeneration.generatePDF()` function:
1. Uses `html2canvas` to render the ENTIRE container as one giant canvas
2. Slices that canvas image into pages by height
3. This approach DOES NOT respect page boundaries

**What happens:**
- Cover page (data-report-page) renders at ~1056px height
- Estimate content pages render at ~1056px each
- Attachment pages render at ~1056px each
- BUT html2canvas captures them all as one tall image
- jsPDF then slices at fixed intervals (297mm) which doesn't align with actual page boundaries
- Attachments at the bottom get cut off or omitted entirely

### Why MultiTemplateSelector Works (Sometimes)

In `MultiTemplateSelector.tsx` (lines 1174-1192), after capturing the PDF it also:
1. Calls `mergeEstimateWithAttachments()` to fetch attachment PDFs from storage
2. Uses `pdf-lib` to merge the original PDFs as full pages

But `EstimatePreviewPanel` doesn't have this merge step - it only relies on `usePDFGeneration` which can't properly capture multi-page documents.

---

## The Fix

### Part 1: Switch to Multi-Page PDF Generation

Replace `usePDFGeneration` with `useMultiPagePDFGeneration` in EstimatePreviewPanel.

**File**: `src/components/estimates/EstimatePreviewPanel.tsx`

**Change 1** - Update import (around line 49):
```typescript
// OLD
import { usePDFGeneration } from '@/hooks/usePDFGeneration';

// NEW
import { useMultiPagePDFGeneration } from '@/hooks/useMultiPagePDFGeneration';
```

**Change 2** - Update hook usage (around line 150):
```typescript
// OLD
const { generatePDF } = usePDFGeneration();

// NEW
const { generateMultiPagePDF, isGenerating: isGeneratingPDF } = useMultiPagePDFGeneration();
```

**Change 3** - Rewrite `handleExportPDF` (lines 220-256):
```typescript
const handleExportPDF = async () => {
  setIsExporting(true);
  const filename = getFilename();
  
  try {
    // Wait for any attachments to finish rendering
    const container = document.getElementById('estimate-preview-template');
    if (!container) throw new Error('Preview template not found');
    
    // Poll for attachment loading completion (max 10 seconds)
    const maxWaitMs = 10000;
    const pollIntervalMs = 200;
    let waited = 0;
    
    while (waited < maxWaitMs) {
      const loadingIndicators = container.querySelectorAll('.animate-spin');
      const pageCount = container.querySelectorAll('[data-report-page]').length;
      
      if (loadingIndicators.length === 0 && pageCount > 0) {
        console.log(`[PreviewExport] Ready after ${waited}ms, ${pageCount} pages found`);
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      waited += pollIntervalMs;
    }
    
    // Small delay for final render stability
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Count actual pages
    const pageCount = container.querySelectorAll('[data-report-page]').length;
    console.log(`[PreviewExport] Generating PDF with ${pageCount} pages`);
    
    // Generate multi-page PDF (captures each [data-report-page] separately)
    const result = await generateMultiPagePDF('estimate-preview-template', pageCount, {
      filename,
      format: 'letter',
      orientation: 'portrait',
    });

    if (result.success && result.blob) {
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        title: 'PDF Downloaded',
        description: `${filename} has been downloaded (${pageCount} pages)`,
      });
    } else {
      throw new Error(result.error || 'PDF generation failed');
    }
  } catch (error: any) {
    console.error('Error exporting PDF:', error);
    toast({
      title: 'Export Failed',
      description: error.message || 'Failed to generate PDF',
      variant: 'destructive',
    });
  } finally {
    setIsExporting(false);
  }
};
```

**Change 4** - Update button disabled state (around line 570):
```typescript
// OLD
disabled={isExporting}

// NEW  
disabled={isExporting || isGeneratingPDF}
```

---

## How This Fixes the Issue

1. **`useMultiPagePDFGeneration`** iterates over all `[data-report-page]` elements
2. Each page (cover, content, warranty, attachments) is captured **individually** as its own canvas
3. Each canvas becomes a proper PDF page with correct boundaries
4. Manually-added attachments (rendered by `AttachmentPagesRenderer`) are now properly captured

---

## Technical Summary

| What | Before | After |
|------|--------|-------|
| Hook | `usePDFGeneration` | `useMultiPagePDFGeneration` |
| Capture method | Single canvas slice | Per-page capture |
| Page boundaries | Arbitrary height slicing | Respects `[data-report-page]` elements |
| Attachment handling | Gets cut off at bottom | Each attachment page captured separately |
| Wait for attachments | No waiting | Polls for `.animate-spin` completion |

---

## Files to Modify

1. **`src/components/estimates/EstimatePreviewPanel.tsx`**
   - Change import from `usePDFGeneration` to `useMultiPagePDFGeneration`
   - Rewrite `handleExportPDF` to use multi-page generation with attachment wait polling

---

## Testing After Fix

1. Open Preview Estimate for an estimate with manually-added attachments
2. Verify attachments load and display in the preview
3. Click "Export PDF"
4. Open the downloaded PDF
5. Verify ALL pages are present:
   - Cover page
   - Estimate content pages
   - Warranty page
   - **All attachment pages (template + manually added)**

