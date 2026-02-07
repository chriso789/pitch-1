
# Plan: Fix PDF Font Overlapping Issue in Estimate Export

## Problem

Exported estimate PDFs have fonts that are "messed up and overlaying" - text characters overlap or render incorrectly. The preview looks fine in the browser, but the downloaded PDF has rendering artifacts.

## Root Cause

The Estimate Preview Panel displays the document at 75% scale using CSS `transform: scale(0.75)` for visual fit within the dialog. When html2canvas captures the `#estimate-preview-template` element, it inherits the parent's scale transform which causes known font rendering issues:

```text
Current DOM Structure:
┌─────────────────────────────────────────────────┐
│ <div style="transform: scale(0.75)">            │  ← Parent with scale
│   ┌───────────────────────────────────────────┐ │
│   │ <div id="estimate-preview-template">      │ │  ← Captured element
│   │   <EstimatePDFDocument />                 │ │
│   └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

This is a documented html2canvas issue where CSS transforms cause:
- Font rendering errors
- Character spacing problems  
- Text overlapping

---

## Solution

### 1. Reset Transform in onclone Callback

Modify `usePDFGeneration.ts` to reset any CSS transforms on the captured element and its ancestors during the clone phase. This ensures html2canvas renders at 100% scale with proper font rendering.

**File:** `src/hooks/usePDFGeneration.ts`

**Update `applyPDFStyles` function (lines 41-58):**

```typescript
function applyPDFStyles(element: HTMLElement): void {
  // CRITICAL: Reset any CSS transforms that cause font rendering issues
  element.style.transform = 'none';
  element.style.webkitTransform = 'none';
  
  // Also reset transforms on all parent elements in the cloned tree
  let parent = element.parentElement;
  while (parent) {
    parent.style.transform = 'none';
    parent.style.webkitTransform = 'none';
    parent = parent.parentElement;
  }

  // Apply font optimizations to root element
  element.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  element.style.setProperty('-webkit-font-smoothing', 'antialiased');
  element.style.setProperty('-moz-osx-font-smoothing', 'grayscale');
  element.style.setProperty('text-rendering', 'optimizeLegibility');
  element.style.letterSpacing = '0.01em';
  element.classList.add('pdf-render-container');
  
  // Apply to all child elements
  const allElements = element.querySelectorAll('*');
  allElements.forEach(el => {
    if (el instanceof HTMLElement) {
      el.style.transform = 'none';
      el.style.webkitTransform = 'none';
      el.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      el.style.letterSpacing = '0.01em';
    }
  });
}
```

### 2. Apply Same Fix to Multi-Page PDF Generation

The same fix needs to be applied to `useMultiPagePDFGeneration.ts` which is used for the main estimate export flow.

**File:** `src/hooks/useMultiPagePDFGeneration.ts`

Apply identical transform reset logic to the `applyPDFStyles` function (lines 54-71).

### 3. Increase Quality for EstimatePreviewPanel

Update the PDF generation call in `EstimatePreviewPanel.tsx` to use quality 3 instead of 2 for sharper text.

**File:** `src/components/estimates/EstimatePreviewPanel.tsx`

**Line 218:**
```typescript
// Before
quality: 2,

// After
quality: 3,
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/usePDFGeneration.ts` | Add transform reset logic to `applyPDFStyles` function |
| `src/hooks/useMultiPagePDFGeneration.ts` | Add same transform reset logic |
| `src/components/estimates/EstimatePreviewPanel.tsx` | Increase quality from 2 to 3 |

---

## Technical Details

### Why This Works

html2canvas creates a **clone** of the DOM element before rendering. The `onclone` callback gives access to this clone, allowing us to:

1. Remove the CSS transform that causes the font issue
2. Apply explicit font styling for consistent rendering
3. The original DOM remains unchanged (still shows 75% scale in preview)

### Before vs After

```text
BEFORE (with transform: scale(0.75)):
┌────────────────────────────────────┐
│ O'Brien Contracting                │
│ OOFFOOFFFIIICCCEEEE                │  ← Overlapping/garbled text
│ ROOFOFOFING ESTIESTIMATE           │
└────────────────────────────────────┘

AFTER (transform reset):
┌────────────────────────────────────┐
│ O'Brien Contracting                │
│ OFFICE                             │  ← Clean text
│ ROOFING ESTIMATE                   │
└────────────────────────────────────┘
```

---

## Expected Results

- Clean, professional PDF exports with no text overlap
- All fonts render correctly at full resolution
- File size may be slightly larger due to quality 3 (still under 20MB)
- Browser preview remains scaled at 75% for visual fit
