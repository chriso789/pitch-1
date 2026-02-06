
# Fix: Cover Page and Marketing Flyer Not Showing in Preview Panel

## Problem Summary

The **Preview Estimate** dialog is missing two key components:
1. **Cover Page** - Not shown and no toggle to enable it
2. **Marketing Flyer (Template Attachments)** - Not visible in the preview

---

## Root Cause Analysis

### Why Cover Page is Missing

The `EstimatePreviewPanel` component:
- Uses `EstimatePDFTemplate` for rendering (line 447)
- `EstimatePDFTemplate` is a **single-page** template with NO cover page support
- The Cover Page functionality exists only in `EstimatePDFDocument` (used for actual PDF generation)
- The "Extra Pages" section in the sidebar is missing the "Cover Page" toggle - it has Measurement Details, Job Photos, and Warranty Info, but NOT Cover Page

### Why Marketing Flyer is Missing

Template attachments (e.g., metal roof flyer):
- Are fetched by `MultiTemplateSelector` via `fetchTemplateAttachments()`
- Are merged into the PDF AFTER generation (`handleCreateEstimate` line 1040)
- The preview panel has NO access to these attachments
- Even if it did, there's no rendering logic to display PDF attachments as preview pages

---

## Solution Overview

### Fix 1: Add Cover Page Toggle to Preview Panel

**File:** `src/components/estimates/EstimatePreviewPanel.tsx`

Add a "Cover Page" toggle in the "Extra Pages" section:

```typescript
// In the Extra Pages section (around line 357)
<ToggleRow
  label="Cover Page"
  checked={options.showCoverPage}
  onChange={(v) => updateOption('showCoverPage', v)}
/>
```

### Fix 2: Replace EstimatePDFTemplate with EstimatePDFDocument

The preview panel should use `EstimatePDFDocument` instead of `EstimatePDFTemplate` to render the full multi-page estimate with cover page support.

**Changes:**
1. Import `EstimatePDFDocument` instead of `EstimatePDFTemplate`
2. Update the preview render area to use `EstimatePDFDocument`
3. Pass additional required props: `companyName`, `createdAt`, `companyLogo`

### Fix 3: Pass Template Attachments to Preview (Indicator)

Since PDF attachments can't be easily rendered as React components in the preview:
1. Pass `templateAttachments` array to `EstimatePreviewPanel`
2. Show an info badge in the sidebar indicating attachments will be included:
   ```
   📎 1 attachment will be appended:
   - Metal Roof Product Flyer
   ```

---

## Technical Changes

### File 1: `src/components/estimates/EstimatePreviewPanel.tsx`

**Add Cover Page toggle (line ~357):**

```typescript
<div className="space-y-2 pl-2">
  {/* NEW: Cover Page toggle */}
  <ToggleRow
    label="Cover Page"
    checked={options.showCoverPage}
    onChange={(v) => updateOption('showCoverPage', v)}
  />
  <ToggleRow
    label="Measurement Details"
    checked={options.showMeasurementDetails}
    onChange={(v) => updateOption('showMeasurementDetails', v)}
    disabled={!measurementSummary}
  />
  {/* ... rest of toggles */}
</div>
```

**Replace EstimatePDFTemplate with EstimatePDFDocument (line ~447):**

```typescript
import { EstimatePDFDocument } from './EstimatePDFDocument';

// In render area:
<EstimatePDFDocument
  estimateNumber={estimateNumber}
  customerName={customerName}
  customerAddress={customerAddress}
  customerPhone={customerPhone}
  customerEmail={customerEmail}
  companyInfo={companyInfo}
  companyName={companyInfo?.name || 'Company'}
  companyLogo={companyInfo?.logo_url || undefined}
  materialItems={materialItems}
  laborItems={laborItems}
  breakdown={breakdown}
  config={config}
  finePrintContent={finePrintContent}
  options={options}
  measurementSummary={measurementSummary}
  createdAt={new Date().toISOString()}
/>
```

**Add attachments indicator section:**

```typescript
// New prop
interface EstimatePreviewPanelProps {
  // ... existing props
  templateAttachments?: Array<{ filename: string }>;
}

// In sidebar, after Extra Pages section:
{templateAttachments && templateAttachments.length > 0 && (
  <div className="space-y-2">
    <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
      <Paperclip className="h-3 w-3" />
      Attachments
    </h4>
    <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded text-xs">
      <p className="text-blue-700 dark:text-blue-400">
        📎 {templateAttachments.length} document(s) will be appended:
      </p>
      <ul className="mt-1 text-blue-600 dark:text-blue-300">
        {templateAttachments.map((att, i) => (
          <li key={i}>• {att.filename}</li>
        ))}
      </ul>
    </div>
  </div>
)}
```

### File 2: `src/components/estimates/MultiTemplateSelector.tsx`

**Pass attachments to preview panel:**

Update the preview panel invocation to pass template attachments:

```typescript
<EstimatePreviewPanel
  // ... existing props
  templateAttachments={templateAttachments}
/>
```

---

## Result After Fix

1. ✅ **Cover Page toggle** appears in the Extra Pages section of the preview sidebar
2. ✅ **Cover Page renders** in the preview when enabled (uses `EstimatePDFDocument`)
3. ✅ **Attachments indicator** shows which documents will be appended to the final PDF
4. ✅ **Full multi-page preview** - shows all pages including cover, content, warranty, etc.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/estimates/EstimatePreviewPanel.tsx` | Add Cover Page toggle, switch to `EstimatePDFDocument`, add attachments indicator, add new prop |
| `src/components/estimates/MultiTemplateSelector.tsx` | Pass `templateAttachments` to `EstimatePreviewPanel` |

---

## Testing Plan

1. Open an estimate with a metal template selected
2. Click "Preview Estimate" button
3. Verify the Cover Page toggle appears in Extra Pages section
4. Enable Cover Page and verify it renders as the first page in preview
5. Verify the attachments indicator shows the metal roof flyer
6. Export PDF and verify both cover page and flyer are included
