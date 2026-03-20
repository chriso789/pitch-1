

# Fix Margin Consistency Across Estimate Pages

## Problem
When the estimate overflows to additional pages, those continuation pages appear to have wider margins compared to the first page. This is because all pages are wrapped in a single outer container (`bg-white shadow-lg rounded-lg overflow-hidden`) which applies its own visual chrome (rounded corners, shadow) on top of the individual page shells.

## Root Cause
The preview wrapper at line 1398 of `EstimatePreviewPanel.tsx` applies `bg-white shadow-lg rounded-lg overflow-hidden` around ALL pages. Since each `PageShell` already has its own `bg-white` background and fixed 816px width, this outer wrapper adds redundant styling. The `overflow-hidden` combined with `rounded-lg` clips the corners of subsequent pages, and the wrapping creates a visual effect where continuation pages look more padded.

Additionally, the `EstimatePDFDocument` uses `gap-4` (16px) between pages in the flex container, creating visible separation that makes each page look like a card with extra spacing.

## Changes

### `src/components/estimates/EstimatePreviewPanel.tsx`
Remove the visual chrome from the outer wrapper so each page renders independently:
- Change line 1398 from `className="bg-white shadow-lg rounded-lg overflow-hidden"` to just `className=""` (no extra styling — let individual `PageShell` pages handle their own appearance)
- Each `PageShell` already has `bg-white` and the fixed 816px width

### `src/components/estimates/EstimatePDFDocument.tsx`  
Ensure consistent spacing and appearance:
- The `flex flex-col gap-4` on the pages container (line 652) is fine for preview separation between pages
- No content-level changes needed — both `FirstPage` and `ItemsContinuationPage` use the same `PageShell` with `px-6` padding

This is a one-line CSS class change that removes the extra outer container styling, letting each page stand on its own with consistent margins.

