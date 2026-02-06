
# Plan: Fix PDF Filename and Duplicate Attachments Header

## Issues Identified

### Issue 1: PDF Not Saving with Estimate Display Name
When exporting an estimate PDF, it saves as `EST-94749505.pdf` instead of using the custom display name the user entered (e.g., "Smith Residence - Full Roof Replacement").

**Root Cause**: 
- `EstimatePreviewPanel` uses only `estimateNumber` for the filename
- `estimateDisplayName` is never passed to the preview panel from `MultiTemplateSelector`

### Issue 2: "ATTACHMENTS" Header Appears Twice
The screenshot shows two "ATTACHMENTS (1)" headers in the sidebar.

**Root Cause**: 
- `EstimatePreviewPanel.tsx` has a `Collapsible` section with header "Attachments"
- `EstimateAttachmentsManager.tsx` component ALSO renders its own "Attachments" header internally
- Result: When collapsible is open, both headers display

---

## Technical Solution

### Fix 1: Pass Display Name to Preview Panel & Use for Filename

**File: `src/components/estimates/MultiTemplateSelector.tsx`**
- Add `estimateDisplayName` prop when rendering `EstimatePreviewPanel`

**File: `src/components/estimates/EstimatePreviewPanel.tsx`**
- Add `estimateDisplayName?: string` to props interface
- Use display name for filename if available, falling back to estimate number
- Sanitize filename to remove special characters

**Updated filename logic:**
```typescript
// Generate safe filename from display name or estimate number
const getFilename = () => {
  if (estimateDisplayName?.trim()) {
    // Sanitize: remove special chars, limit length
    const sanitized = estimateDisplayName
      .trim()
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 50);
    return `${sanitized}.pdf`;
  }
  return `${estimateNumber}.pdf`;
};
```

---

### Fix 2: Remove Duplicate Header from Attachments Manager

**File: `src/components/estimates/EstimateAttachmentsManager.tsx`**
- Remove the internal header (`<h4>Attachments</h4>`) since the parent `Collapsible` already provides this header
- Keep just the content (attachment list + add button)

The parent `EstimatePreviewPanel` already has:
```tsx
<CollapsibleTrigger>
  <h4>Attachments ({allAttachments.length})</h4>
</CollapsibleTrigger>
<CollapsibleContent>
  <EstimateAttachmentsManager ... />  {/* Should NOT have its own header */}
</CollapsibleContent>
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/MultiTemplateSelector.tsx` | Pass `estimateDisplayName` prop to `EstimatePreviewPanel` |
| `src/components/estimates/EstimatePreviewPanel.tsx` | Add `estimateDisplayName` prop, use for PDF filename |
| `src/components/estimates/EstimateAttachmentsManager.tsx` | Remove duplicate header (lines 282-284) |

---

## Result After Fix

1. **PDF Export**: Will save as `Smith_Residence_-_Full_Roof_Replacement.pdf` instead of `EST-94749505.pdf`
2. **Attachments UI**: Single "ATTACHMENTS (1)" header, no duplication
