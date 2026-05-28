# Estimate Preview – Page Order + Job Photos Duplication Fix

## Problem

1. **Job Photos appears more than once** in the preview/export.
   - When additional estimates are selected, the appended `<EstimatePDFDocument>` instances are rendered with the same `options` and `jobPhotos`, so Job Photos (and Measurement Details / Warranty) render again at the end of every appended estimate.
   - The "Extra Pages" toggles and the "Page Order" toggles control *two parallel state stores* (`options.showJobPhotos` vs `pageOrder[id=job_photos].enabled`), so flipping one without the other produces inconsistent output that looks like a duplicate.
2. **Page reordering doesn't work.** `PageOrderManager` updates a `pageOrder` array, but `EstimatePDFDocument` never reads it — section order is hardcoded.

## Goals

- One single source of truth for "which extra pages are on" and "in what order they appear".
- Drag-and-drop in Page Order actually reorders the rendered/exported PDF.
- Job Photos (and other extra pages) appear **exactly once** regardless of how many additional estimates are appended.

## Changes

### 1. Single source of truth: `pageOrder`
- `EstimatePreviewPanel.tsx`
  - Treat `pageOrder` as the canonical state for: Cover Page, Measurement Details, Job Photos, Manufacturer Warranty, Workmanship Warranty, Attachments (Estimate Content stays locked).
  - Add a small `useEffect` that syncs `pageOrder[id].enabled` → the matching `options.showXxx` keys whenever `pageOrder` changes, so existing render code keeps working without a large refactor.
  - Remove the duplicate `ToggleRow`s for Cover Page / Measurement Details / Job Photos / Manufacturer Warranty / Workmanship Warranty from the "Extra Pages" block. Keep only the contextual sub‑controls there (Cover Photo source + thumbnail, Photo Layout selector) and gate them on the corresponding `pageOrder` entry being enabled.
  - Keep the Page Order collapsible expanded by default (`useState(true)`).

### 2. Make `pageOrder` actually order pages
- `EstimatePDFDocument.tsx`
  - Add optional prop `pageOrder?: PageOrderItem[]`.
  - Refactor the `useMemo` that builds `pages` so each extra-page section (cover, measurement details, job photos, warranty, change orders treated as part of estimate content) is built into a small map `sectionBuilders: Record<sectionId, () => ReactNode[]>`.
  - The final `pageList` is assembled by iterating `pageOrder` (falling back to `DEFAULT_PAGE_ORDER` when prop not supplied) and only appending sections whose `enabled` is true. Estimate Content stays in its current relative slot.
  - `currentPage` / `totalPageCount` accounting moves inside the iteration so headers/footers stay correct.

### 3. Stop appended estimates from re-emitting extra pages
- `EstimatePreviewPanel.tsx`
  - For every additional estimate rendered in the `selectedAdditionalIds` loop:
    - Pass `jobPhotos={[]}` (or a new `skipExtraPages` prop) so Job Photos / Measurement / Warranty pages only ever render on the **primary** `EstimatePDFDocument`.
    - Already passes `skipCoverPage`; add `skipMeasurementDetails`, `skipJobPhotos`, `skipWarranty` props on `EstimatePDFDocument` (or one combined `skipExtraPages`) and short-circuit those builders.

### 4. Minor UX polish
- `PageOrderManager.tsx`
  - Add a one-line helper text reminding the user that order here is the order pages export in.
  - Keep the existing disabled/auto-add behavior for Attachments / Measurements / Job Photos when no content exists.

## Out of scope
- No backend or schema changes.
- No change to PDF styling, photo chunking math, or the photo grid layout.
- No change to share/export plumbing beyond what's needed to thread the new prop.

## Acceptance
- Toggling Job Photos in the Page Order panel hides/shows exactly one Job Photos section in the preview and exported PDF.
- Dragging "Job Photos" above "Measurement Details" in Page Order reorders them in the rendered preview and exported PDF.
- Selecting additional estimates no longer adds extra Job Photos / Measurement / Warranty pages after each appended estimate.
- The old "Extra Pages" duplicate switches are gone; only Page Order controls visibility for those sections. Photo Layout and Cover Photo source pickers still work and are gated on the corresponding Page Order entry being enabled.

## Files touched
- `src/components/estimates/EstimatePreviewPanel.tsx`
- `src/components/estimates/EstimatePDFDocument.tsx`
- `src/components/estimates/PageOrderManager.tsx` (copy tweak only)
