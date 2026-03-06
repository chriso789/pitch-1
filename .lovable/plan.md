

# Fix Warranty Page Overflow in Estimate PDF

## Problem
The warranty content (manufacturer + workmanship with bullet lists) is too long and gets clipped by the `PageShell`'s `overflow: hidden` + `maxHeight: 1056px`. The content area after header/footer is ~708px, and the lengthy warranty text exceeds this.

## Fix

### `src/components/estimates/EstimatePDFDocument.tsx` — WarrantyPage component (lines 900-932)

Reduce spacing and font sizes to fit the full warranty text within a single page:

1. **Reduce outer spacing**: `space-y-4` → `space-y-2`
2. **Reduce card padding**: `p-3` → `p-2`
3. **Use smaller text**: Already `text-xs` for body, but reduce heading from `text-base` to `text-sm`
4. **Tighter paragraph spacing**: `space-y-3` → `space-y-2`
5. **Reduce line height**: Add `leading-tight` to the paragraph text
6. **Reduce margin on headings**: `mb-1.5` → `mb-1`

This keeps all warranty content visible on one page even with lengthy manufacturer + workmanship terms like the O'Brien Contracting example shown.

### One file changed
- `src/components/estimates/EstimatePDFDocument.tsx` — WarrantyPage styling adjustments

