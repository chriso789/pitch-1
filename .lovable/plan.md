

## Problem

When exporting a PDF from the Preview Estimate panel, the filename defaults to the estimate number (e.g., `EST-DRAFT-7lxc.pdf`) instead of using the template name like "5V Painted" or "5V Mill Finish".

### Root Cause

The `getFilename()` function in `EstimatePreviewPanel.tsx` has an incomplete fallback chain:

```typescript
// Current (broken)
const getFilename = useCallback(() => {
  if (estimateDisplayName?.trim()) {
    return `${sanitized}.pdf`;
  }
  return `${estimateNumber}.pdf`;  // Falls back to EST-DRAFT-xxx
}, [estimateDisplayName, estimateNumber]);
```

The selected template name (which IS what you want as the filename) is never passed to this component.

---

## Solution

Pass the template name to `EstimatePreviewPanel` and use it in the filename fallback chain.

### Changes

#### 1. Update `EstimatePreviewPanel.tsx`

Add new prop `templateName` and update the `getFilename()` fallback:

```typescript
interface EstimatePreviewPanelProps {
  // ... existing props
  templateName?: string;  // NEW
}

const getFilename = useCallback(() => {
  // Priority: user-set display name > template name > estimate number
  const displaySource = estimateDisplayName?.trim() || templateName?.trim();
  
  if (displaySource) {
    const sanitized = displaySource
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 50);
    return `${sanitized}.pdf`;
  }
  return `${estimateNumber}.pdf`;
}, [estimateDisplayName, templateName, estimateNumber]);
```

#### 2. Update `MultiTemplateSelector.tsx`

Pass the selected template's name to `EstimatePreviewPanel`:

```typescript
<EstimatePreviewPanel
  // ... existing props
  templateName={templates.find(t => t.id === selectedTemplateId)?.name}
/>
```

---

## Expected Result

After this fix:

| Scenario | Current Filename | Fixed Filename |
|----------|-----------------|----------------|
| User sets display name "Smith Roof" | `Smith_Roof.pdf` | `Smith_Roof.pdf` |
| Template "5V Painted" selected, no display name | `EST-DRAFT-7lxc.pdf` | `5V_Painted.pdf` |
| Template "5V Mill Finish", no display name | `EST-DRAFT-xxxx.pdf` | `5V_Mill_Finish.pdf` |
| No template, no display name | `EST-DRAFT-xxxx.pdf` | `EST-DRAFT-xxxx.pdf` |

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/EstimatePreviewPanel.tsx` | Add `templateName` prop, update `getFilename()` fallback chain |
| `src/components/estimates/MultiTemplateSelector.tsx` | Pass `templateName` prop to `EstimatePreviewPanel` |

