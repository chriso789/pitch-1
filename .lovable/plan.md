

# Compress All PDF Generation Across the System

## Problem

Multiple PDF generators still use high-resolution settings (scale 2-3, PNG format, quality 0.95+), producing 20MB+ files that are too large for email attachments (typical limit: 10-25MB, less with other attachments).

## Files Requiring Changes

| File | Current Settings | Problem |
|------|-----------------|---------|
| `src/hooks/usePDFGeneration.ts` | **scale: 3**, PNG format | Worst offender -- 3x capture + lossless PNG |
| `src/components/measurements/ComprehensiveMeasurementReport.tsx` | scale: 2, PNG format | Lossless PNG inflates size |
| `src/lib/proposalPdfGenerator.ts` | scale: 2, PNG quality 1.0 | Full resolution proposals |
| `src/lib/export-utils.ts` | scale: 2, PNG format | Dashboard exports |
| `src/services/documentationGenerator.ts` | scale: 2, JPEG 0.95 | Nearly lossless JPEG |
| `src/hooks/useMultiPagePDFGeneration.ts` | scale: 1.2-1.5, JPEG 0.6-0.75 | Already optimized (recent fix) -- no change needed |

## Proposed Changes

All files will be standardized to these settings:

- **Scale: 1.5** for text-heavy pages (clear enough for print, 56% fewer pixels than scale 2)
- **Scale: 1.2** for image/photo-heavy pages
- **Format: JPEG at 0.65 quality** (visually indistinguishable from PNG at normal viewing, ~80% smaller)
- **Expected result: typical PDFs drop from 20MB+ to 3-8MB**

### File-by-file changes:

**1. `src/hooks/usePDFGeneration.ts`** (single-page estimate/measurement reports)
- Change default `quality` from `3` to `1.5`
- Switch from `canvas.toDataURL('image/png')` to `canvas.toDataURL('image/jpeg', 0.65)`
- Switch `pdf.addImage(imgData, 'PNG', ...)` to `pdf.addImage(imgData, 'JPEG', ...)`

**2. `src/components/measurements/ComprehensiveMeasurementReport.tsx`**
- Change `scale: 2` to `scale: 1.5`
- Switch from `toDataURL('image/png')` to `toDataURL('image/jpeg', 0.65)`
- Switch `addImage(imgData, 'PNG', ...)` to `addImage(imgData, 'JPEG', ...)`

**3. `src/lib/proposalPdfGenerator.ts`**
- Change `scale: 2` to `scale: 1.5`
- Change `toDataURL("image/png", 1.0)` to `toDataURL("image/jpeg", 0.65)`
- Switch `addImage(imgData, "PNG", ...)` to `addImage(imgData, "JPEG", ...)`

**4. `src/lib/export-utils.ts`**
- Change `scale: 2` to `scale: 1.5`
- Switch from `toDataURL('image/png')` to `toDataURL('image/jpeg', 0.65)`
- Switch `addImage(imgData, 'PNG', ...)` to `addImage(imgData, 'JPEG', ...)`

**5. `src/services/documentationGenerator.ts`**
- Keep `scale: 2` (documentation is text-heavy, keep crisp) but reduce JPEG quality from `0.95` to `0.70`

**6. `src/hooks/useMultiPagePDFGeneration.ts`**
- No changes needed -- already optimized in the previous fix

## Technical Details

### Why JPEG 0.65 is sufficient
- PDF viewers render at 72-150 DPI; at scale 1.5 on a typical 800px-wide element, the effective resolution is 1200px -- well above what's needed
- JPEG artifacts are invisible on printed documents at this quality level
- The biggest savings come from eliminating PNG's lossless overhead on photo/satellite imagery embedded in reports

### Size estimates
- A 10-page estimate with satellite imagery: **~25MB today → ~5MB after**
- A single-page measurement report: **~8MB today → ~2MB after**
- Email-safe threshold: under 10MB comfortably, leaving room for other attachments

