

# Fix First Page Formatting for Added Estimates

## Problem Analysis

After investigating the code, both the primary and added estimates render through the identical `PageShell` component with the same `px-6` padding, `816px` width, and `pdf-render-container` font styles. However, there are two issues that can cause visual inconsistency:

1. **CSS forced padding on table cells**: In `src/index.css` (line 607-610), the rule `.pdf-render-container table td, .pdf-render-container table th { padding: 8px 12px !important; }` applies `!important` padding to ALL table cells. This can interact differently with Tailwind's `py-1.5` classes used in the `ItemsTable` component, potentially causing layout shifts depending on CSS specificity and load order.

2. **Duplicate element IDs**: Each `EstimatePDFDocument` instance creates a `<div id="estimate-pdf-pages">`, resulting in duplicate IDs in the DOM. While not directly a visual issue, it can cause unexpected behavior with CSS or JS targeting.

3. **Font inheritance scope**: The `pdf-render-container` class and inline `fontFamily` style are set per `PageShell`. When two `EstimatePDFDocument` instances are siblings inside `#estimate-preview-template`, the outer `div` wrapper doesn't enforce the font, so any inherited styles from parent containers (the dialog, the preview panel) could leak into gaps between page shells.

## Changes

### File: `src/components/estimates/EstimatePDFDocument.tsx`

- Change the wrapper from `id="estimate-pdf-pages"` to `className`-based identification. Use a `data-estimate-pages` attribute instead of a duplicate ID. Accept an optional `instanceId` prop so each instance is uniquely identifiable.
- Apply `pdf-render-container` class and the inline font styles to the **outer wrapper** div (`estimate-pdf-pages`), not just to individual `PageShell` elements. This ensures consistent font rendering across all pages including gaps.

### File: `src/index.css`

- Scope the forced table cell padding rule more narrowly. Change `.pdf-render-container table td, .pdf-render-container table th` to only apply to the items table context, not ALL tables (which could affect the customer info section or pricing summary differently). Remove the `!important` or reduce the padding to match Tailwind's `py-1.5` (6px vertical) while keeping the horizontal padding.

### File: `src/components/estimates/EstimatePreviewPanel.tsx`

- Add `pdf-render-container` class and the font family inline style to the `#estimate-preview-template` wrapper div so ALL child content inherits consistent font rendering regardless of which `EstimatePDFDocument` instance renders it.
- Pass unique instance identifiers to each `EstimatePDFDocument` to avoid duplicate IDs.

### File: `src/components/estimates/MultiTemplateSelector.tsx`

- Update references from `getElementById('estimate-pdf-pages')` to use `querySelector('[data-estimate-pages]')` to match the new attribute-based identification.

