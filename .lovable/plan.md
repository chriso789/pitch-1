# Fix live overlay renderer (dark panel + unknown alignment)

Scope: frontend/presentation only. No backend, DSM, topology, gates, or schema changes.

## Problem (what we now know)

- Live "Roof Focus" panel briefly renders correctly, then becomes a giant dark rectangle as it re-mounts / scrolls.
- First aerial/process image is still full-tile zoom — does not use Roof Focus.
- `overlay_transform` diagnostics already prove the crop math is valid (`crop_bbox_px 500,471→790,782`, `display_px_within_crop 715×768`, `target_mask_overlap 0.976`).
- Yet `Measurement Alignment → Aerial overlay = unknown` and `Overlay Truth → Overlay frame = unknown`.

Root cause: the renderer and the alignment/diagnostics read overlay state from different shapes, and the panel containers (`RasterOverlayDebugView`, MeasurementVisualQAOverlay first aerial) each do their own raster/SVG sizing, so the raster `<img>` and SVG overlay drift out of sync (dark fallback fills the gap).

## Fix

### 1. New shared component: `RoofFocusedOverlayPanel`

`src/components/measurements/RoofFocusedOverlayPanel.tsx` (new). Single panel used by:

- MeasurementVisualQAOverlay first aerial/process view
- MeasurementVisualQAOverlay Roof Focus view
- RasterOverlayDebugView
- MeasurementReportPdfVisualSection (PDF mode)

Contract:

- Inputs: `rasterUrl | dataUrl | null`, `rasterSize`, `perimeterPx` candidates, `overlays` (layer list), `mode: "live" | "pdf"`, `displayWidth`.
- Computes ONE viewport via `roofFocusViewport(...)` + `pickFocusPerimeter(...)`.
- Renders raster `<img>` and SVG in the SAME positioned container, both sized to `displayPxWithinCrop`, both using the same `viewBox` / projection. Raster uses `object-fit: none` + CSS transform `translate(-minX*scale, -minY*scale) scale(cropScale)` so the cropped region of the source raster aligns 1:1 with the SVG viewBox.
- Panel container: `position: relative`, `aspect-ratio: 4/3`, `max-height: 420px` (live) / `360px` (pdf), `min-height: 240px`, `background: transparent`. No dark/black fallback fill in live mode; placeholder only renders when both raster and dataUrl fail.
- Exports `data-overlay-panel="true"` and (in pdf mode) keeps `data-pdf-overlay-panel="true"`.

### 2. Force first aerial/process view through the shared panel

`MeasurementVisualQAOverlay.tsx`:

- Replace inline raster/SVG block of the first aerial diagram with `<RoofFocusedOverlayPanel mode="live" ... />` using the same `perimeterPx` priority as Roof Focus (`pickFocusPerimeter([selected, refined, raw, footprint])`).
- Keep the existing layer toggle UI and metric chips; they feed `overlays` into the panel.

### 3. Retire dark fallback container in live mode

`RasterOverlayDebugView.tsx`:

- Delegate rendering to `RoofFocusedOverlayPanel` (`mode="live"`).
- Remove `bg-black` / dark inner wrappers. Loading state: light neutral skeleton (`bg-muted/40`), not black. Image-error state: render SVG overlay only on white, with the existing "aerial unavailable" copy.

### 4. PDF section uses the same component

`MeasurementReportPdfVisualSection.tsx`:

- Replace the bespoke PDF overlay block with `<RoofFocusedOverlayPanel mode="pdf" imageUrl={dataUrl ?? rasterUrl} ... />`. Existing `fetchAsDataUrl` + `waitForImagesInRoot` flow stays in `MeasurementReportDialog.tsx`.
- Keep the single `[data-pdf-overlay-panel="true"]` invariant.

### 5. Fix alignment helpers to read what diagnostics already show

`src/lib/measurement/alignmentStatus.ts`:

- When `overlay_transform.crop_bbox_px` is valid AND a selected/refined/raw perimeter exists, return `aerial_overlay = aligned` regardless of whether `coord_space` is the literal string `"raster_px"` (the live payload sometimes omits it but still emits valid crop evidence).
- When `overlay_transform.crop_bbox_px` is valid, `Overlay Truth → Overlay frame` resolves to `raster_px` (the de facto frame) instead of `unknown`.
- Preserve explicit `frame_mismatch` lock when overlay reports `mismatch`. Do not weaken DSM-missing lock.

### 6. Tests

- `RoofFocusedOverlayPanel.dom.test.tsx` (new): raster `<img>` and SVG share container size, both honor `cropScale`, no `bg-black`/`bg-neutral-900` in live mode, single panel marker per mode.
- Extend `alignmentStatus.test.ts`: payload with valid `crop_bbox_px` but no `coord_space` → `aerial_overlay = aligned`, `overlay_frame = raster_px`.
- Extend `MeasurementReportPdfVisualSection.dom.test.tsx`: PDF section uses `RoofFocusedOverlayPanel`, dimensions still clamped, placeholder still renders on image failure.
- `MeasurementVisualQAOverlay` smoke test: first aerial view renders `RoofFocusedOverlayPanel` with `isFocused: true` when a perimeter is available.

## Acceptance

- First aerial/process view is Roof-Focused on the house (not full-tile).
- Roof Focus panel never turns into a dark rectangle — image and SVG stay co-sized; failure shows white panel + overlay + label, never black.
- `Measurement Alignment → Aerial overlay = aligned` and `Overlay Truth → Overlay frame = raster_px` on the current Fonsica payload.
- Overlay Transform card, crop math, and the rendered viewport are demonstrably the same numbers.
- PDF export still produces exactly one `[data-pdf-overlay-panel]` and still degrades gracefully when raster fails.
- DSM Size 998×998, Debug Roof Lines 6, Aerial Candidate Graph 12 edges, `customer_report_ready = false`, reportable roof lines = 0 — all unchanged.
- No backend, DSM, topology, gate, or schema changes.

## Out of scope

- Backend DSM registration, derived bounds runtime, CPU policy, topology/pitch/facet logic, `customer_report_ready` promotion, reportable roof line promotion, DB schema.
- Actual Fonsica live rerun (verification via tests + DOM snapshots; live rerun is a separate session action).

## Files

- new `src/components/measurements/RoofFocusedOverlayPanel.tsx`
- edit `src/components/measurements/MeasurementVisualQAOverlay.tsx`
- edit `src/components/measurements/RasterOverlayDebugView.tsx`
- edit `src/components/measurements/MeasurementReportPdfVisualSection.tsx`
- edit `src/lib/measurement/alignmentStatus.ts`
- new/extended tests under `src/components/measurements/__tests__/` and `src/lib/measurement/__tests__/`  
  
Now the issue is finally isolated correctly.
  Your screenshots prove the problem is in the **live renderer itself**, not just PDF export. The crop math is actually good, but the UI renderer is breaking the raster/SVG synchronization and filling the rest of the container with a dark fallback.
  The key evidence:
  ```

  ```
  ```
  crop_bbox_px = 500,471→790,782
  display_px_within_crop = 715×768
  first_pt_disp = 238.3,197.6
  bbox_center_disp = 357.5,384.1
  target_mask_overlap = 0.976
  ```
  That means:
  -   
  the Roof Focus viewport math is valid  

  -   
  the overlay projection math is valid  

  -   
  the renderer/container is what’s failing  

  And the UI contradiction proves the state sources are split:
  ```

  ```
  ```
  Measurement Alignment:
  Aerial overlay = unknown

  Overlay Truth:
  Overlay frame = unknown
  ```
  while the Overlay Transform card already proves the crop is valid and raster-aligned.
  So:
  -   
  diagnostics table uses one overlay state source  

  -   
  alignment/banner renderer uses another  

  -   
  raster image + SVG overlay are not using one unified crop/render component  

  -   
  dark fallback background is leaking into live mode  

  I pushed the corrected implementation plan into the repo issue:
  -   
  one shared `RoofFocusedOverlayPanel`  

  -   
  one crop transform for BOTH raster + SVG  

  -   
  no dark live fallback containers  

  -   
  bounded panel sizing  

  -   
  force first aerial/process image into Roof Focus too  

  -   
  alignment helpers must read the same overlay transform object the diagnostics already display  

  That is the correct next fix.