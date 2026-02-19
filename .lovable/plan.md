

# Photo Grid Layout, Arrangement Selector, and Faster PDF Loading

## Problem Summary

1. **Stretched photos**: When more than 2 photos are attached, they display full-width (single column `grid-cols-1`), making each image huge and stretched. Only 3 of several photos were included.
2. **No layout control**: The "Review Estimate" page has no way to adjust how photos are arranged before export.
3. **Slow PDF loading**: The html2canvas pipeline captures each photo at full resolution on a separate row, inflating page count and processing time.

## Solution

### 1. Smart Photo Grid Layout (Auto 2x2, 3x3, etc.)

Replace the single-column photo layout in both PDF renderers with an automatic grid that adapts to the photo count:

| Photo Count | Grid Layout |
|---|---|
| 1 | Full width (1 column) |
| 2 | 2 columns side by side |
| 3-4 | 2x2 grid |
| 5-6 | 3x2 grid |
| 7-9 | 3x3 grid |
| 10+ | 4-column grid, multiple rows |

Photos will use `object-cover` with a fixed aspect ratio to prevent stretching, and all photos will be included (no arbitrary limit).

### 2. Photo Layout Selector in Review Estimate Page

Add a dropdown next to the "Job Photos" toggle in the EstimatePreviewPanel that lets users pick their preferred arrangement:

- **Auto** (default) -- system picks best grid based on count
- **1 Column** -- large, one per row (current behavior)
- **2x2 Grid** -- 2 columns
- **3x3 Grid** -- 3 columns
- **4x4 Grid** -- 4 columns

The selected layout is passed through `PDFComponentOptions` to both `EstimatePDFTemplate` and `EstimatePDFDocument`.

### 3. Faster PDF Generation for Photos

- Resize/compress images in the browser before html2canvas capture using an offscreen canvas (cap at 800px width)
- Use JPEG at 0.7 quality for the photos page specifically
- Pre-load all photo images before capture to avoid the 3-second timeout per image

## Technical Details

### Files to Change

| File | Change |
|---|---|
| `src/components/estimates/PDFComponentOptions.ts` | Add `photoLayout` option: `'auto' \| '1col' \| '2col' \| '3col' \| '4col'` |
| `src/components/estimates/EstimatePDFTemplate.tsx` | Replace `grid-cols-1` photo section with dynamic grid based on `photoLayout` option and photo count |
| `src/components/estimates/EstimatePDFDocument.tsx` | Same grid logic in the `PhotosPage` component |
| `src/components/estimates/EstimatePreviewPanel.tsx` | Add a layout selector dropdown next to the "Job Photos" toggle row |
| `src/components/estimates/EstimateAddonsPanel.tsx` | Add same layout selector if photos are toggled on |
| `src/hooks/useMultiPagePDFGeneration.ts` | Pre-load and downscale images before capture; use JPEG compression for photo pages |

### Grid Logic (shared helper)

```typescript
function getPhotoGridCols(count: number, layout: string): number {
  if (layout === '1col') return 1;
  if (layout === '2col') return 2;
  if (layout === '3col') return 3;
  if (layout === '4col') return 4;
  // Auto mode
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}
```

The grid class becomes `grid-cols-{n}` and each image gets a fixed aspect ratio container with `object-cover` to prevent stretching.

### Performance Optimization

In `useMultiPagePDFGeneration.ts`, before capturing the photos page:
- Create an offscreen canvas for each image, draw it scaled down to max 800px width
- Replace the `src` in the cloned DOM with the compressed data URL
- This reduces pixel count by ~75% and eliminates the per-image loading delay

