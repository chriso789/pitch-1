

# Plan: Fix Warranty Page Overflow — Allow Multi-Page Warranty Content

## Problem

The `PageShell` component enforces `maxHeight: 1056px` and `overflow: hidden` on every page. When the workmanship warranty text is long (as shown in the screenshot), it gets clipped at the bottom of the single warranty page. There is no mechanism to continue warranty content onto a second page.

## Root Cause

The `WarrantyPage` component is always rendered as a single page. The content area available per page is approximately `CONTENT_HEIGHT = 1056 - 140 - 160 - 48 = 708px`. Long warranty text (like the detailed workmanship warranty in the screenshot) exceeds this.

## Fix

### 1. `src/components/estimates/EstimatePDFDocument.tsx` — Split warranty into multiple pages

**Replace the single `WarrantyPage` component** with a `WarrantyPages` function that:

1. Renders manufacturer warranty as the first section
2. Renders workmanship warranty below it
3. Uses a ref-based measurement approach (or a content-splitting strategy) to detect overflow

Since we're in a static PDF render context (html2canvas), the simplest reliable approach is to **split the two warranty sections into separate pages when content is long**:

- **Page 1**: "Warranty Information" heading + Manufacturer Warranty section + beginning of Workmanship Warranty (if it fits)
- **Page 2+**: Continuation of Workmanship Warranty if it overflows

**Implementation approach**: Rather than complex DOM measurement, split the warranty content by rendering manufacturer and workmanship as **separate page entries** when the combined text length exceeds a threshold (~800 characters total, which roughly corresponds to the available content height at `text-xs leading-tight`).

```typescript
// In the page list builder (around line 517-521):
if (opts.showWarrantyInfo) {
  const warrantyPages = buildWarrantyPages(warrantyTerms);
  warrantyPages.forEach((page, i) => {
    currentPage++;
    pageList.push(page);
  });
  // Update totalPageCount accordingly
}
```

**New `buildWarrantyPages` function**:
- Parse warranty terms JSON
- If both manufacturer + workmanship text combined length > ~800 chars, split into two pages:
  - Page 1: Heading + Manufacturer Warranty
  - Page 2: Workmanship Warranty (with a small "Warranty Information (continued)" header)
- If short enough, keep as single page (current behavior)
- Update `totalPageCount` to account for extra warranty pages

### 2. Update page count calculation

The current code at line 445 adds exactly 1 for warranty. Change to add the actual number of warranty pages returned by the builder function.

### 3. No changes needed to PageShell

The `maxHeight` and `overflow: hidden` constraints are correct for PDF rendering — we just need to split content across pages properly.

---

**Summary**: Replace the single `WarrantyPage` with a builder that splits long warranty content across multiple pages. Manufacturer warranty on page 1, workmanship warranty on page 2 when content is too long. Two touches in `EstimatePDFDocument.tsx` — the warranty page builder function and the page count calculation.

