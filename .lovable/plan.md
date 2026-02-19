

# Fix: Make Estimate Photos 100% Larger

## Problem
The project photos in the estimate PDF preview are too small -- they appear as tiny thumbnails that don't show enough detail.

## Changes

### 1. `src/components/estimates/EstimatePDFDocument.tsx` (PhotosPage, line 873-887)

- Change photo height from `h-32` (128px) to `h-64` (256px) -- 100% larger
- Change grid from `grid-cols-2 gap-3` to `grid-cols-1 gap-4` so each photo gets the full width of the page, making them much more prominent
- Remove the 4-photo limit (`slice(0, 4)`) to show all included photos
- Increase caption text from `text-[10px]` to `text-xs`

### 2. `src/components/estimates/EstimatePDFTemplate.tsx` (line 594-613)

- Change photo height from `h-48` (192px) to `h-80` (320px) -- roughly 100% larger when combined with full-width layout
- Change grid from `grid-cols-2 gap-4` to `grid-cols-1 gap-5` for full-width photos
- Increase caption text size from `text-xs` to `text-sm`

## Result
Photos will display at full page width, one per row, at roughly double the current height -- making damage documentation and project photos clearly visible and professional in the estimate PDF.
