## How the documentation relates to what we have

The runtime report you shared is essentially a **forensic audit** of the same pipeline we have been patching the last few turns. It confirms the exact root causes of what you are seeing:

1. **Diagram drifts on the aerial** because there are at least **three independent projection implementations** (client `DimensionedPlanDrawing`, `gpsCalculations.ts`, edge `roof-diagram-renderer.ts`). Each one re-derives geo→pixel from raw bounds, so the smallest disagreement (image was @2x, image was letterboxed, bounds were computed before decoding) produces the offset white outline you saw on the screenshot.
2. **Perimeter shape is wrong** because the authoritative footprint can fall back to a Mapbox Tilequery point or a Google Solar `boundingBox` rectangle. We then trace edges around a rectangle and label them as eaves/rakes — that is why the lengths "almost" line up with the house but the polygon shape doesn't.
3. **QC is bypassed** because `overlayToPatentModel.ts` hard-codes `imagery_qc.passed: true`, so even when the server flags `needs_review` / `report_blocked`, the patent report renders as if it passed.
4. **Imagery and diagram use different rasters** because we sometimes use the requested 640×640 size to compute bounds while the actual decoded raster is 1280×1280 (@2x).

The EagleView PDFs you uploaded show the **target end-state**: a single-source diagram where every eave/rake/ridge length is tied to the same coordinate frame as the satellite tile, so the line drawing snaps to the roof pixel-for-pixel. Their reports achieve this by (a) doing all geometry in one canonical Web-Mercator transform tied to the exact raster they ship, (b) fusing multiple footprint sources into one authoritative polygon before drawing, and (c) gating publication on QC.

## Plan — bind the diagram to the aerial

### 1. One canonical overlay transform (single source of truth)

Create `src/lib/measurements/overlayProjection.ts` and mirror it at `supabase/functions/_shared/overlay-projection.ts` with **identical** Web-Mercator math:

```ts
projectLngLatToImagePx(lng, lat, { imageWidth, imageHeight, bounds })
projectImagePxToLngLat(x, y, transform)
```

Replace every inline projection in `DimensionedPlanDrawing.tsx`, `gpsCalculations.ts`, `roof-diagram-renderer.ts`, `RoofOverlayViewer.tsx`, and `render-measurement-pdf/index.ts` with calls to this helper. **No file may compute its own geo→pixel math anymore.**

### 2. Decode and persist the real raster

In `start-ai-measurement/index.ts`, after fetching the Mapbox/Google satellite tile:

- Decode the actual raster (`naturalWidth`/`naturalHeight` server-side via image header parse).
- Compute `bounds = [west, south, east, north]` from the **decoded** dimensions, not the requested size.
- Persist a single `overlay_transform` object with `{ imageWidth, imageHeight, bounds, center, zoom, devicePixelRatio, projection: 'web_mercator' }` into both `ai_measurement_images.transform` and the `overlay_schema` returned to the UI.

Every downstream renderer reads this object — never recomputes.

### 3. Fused authoritative footprint (kill the rectangle fallback)

Build `footprintFusion(lat, lng)` that ranks sources and **rejects rectangles**:

```
1. Microsoft Building Footprints / Regrid (true polygon)  → preferred
2. OSM building polygon                                    → accepted
3. Internal U-Net trace from the actual aerial             → accepted
4. Google Solar buildingInsights polygons                  → accepted only if vertices > 4
5. Solar boundingBox rectangle                             → REJECTED (flag needs_review)
6. Mapbox Tilequery point                                  → REJECTED
```

Then **register** the chosen polygon to the aerial using the U-Net mask centroid + Procrustes scale (we already have `alignAuthoritativeToImage` — extend it to also run on the U-Net mask, not just centroid translation). Tag the chosen `geometry_source` on `ai_measurement_results`.

### 4. Multi-signal ridge/edge detection on the same raster

In `start-ai-measurement`, run ridge/hip/valley detection on the **same decoded raster** that produced the transform. Use the detector stack the user previously specified:

- Multi-scale Canny + Sobel edges
- Hough line voting
- Ridge scoring (local intensity maxima)
- Snap detected lines to the fused-footprint perimeter where they fall within ~6 px

Persist every edge as `{ p1_px, p2_px, type, length_ft, confidence }` in `ai_roof_edges` using the **same** transform — `length_ft` is computed via `meters_per_pixel × 3.28084`, never from a separate projection.

### 5. EagleView-style length labels bound to the aerial

In `PatentRoofReport.tsx` / diagram renderer:

- Render the aerial raster as the bottom SVG layer at its native `imageWidth × imageHeight` viewBox.
- Render the fused perimeter polygon and structural lines using `projectLngLatToImagePx` (or directly from stored `*_px` coordinates — same transform).
- Place each length label (e.g. `27' 4"`) at the midpoint of its segment in pixel space, color-coded by type (ridge red, hip orange, valley blue, eave green, rake purple), matching the EagleView report style shown in the uploaded PDFs.
- Add the legend, totals box, and pitch arrows in the same coordinate space.

Because the labels are placed in the same pixel frame as the aerial, every dimension annotation lands exactly on the visible roof feature.

### 6. Honor server QC + parity tests

- Patch `overlayToPatentModel.ts` to read `measurement.imagery_qc` / `measurement.quality_checks.imagery_qc` instead of hard-coding `passed: true`.
- In `MeasurementReportDialog.tsx`, disable Save/PDF when `report_blocked` or `imagery_qc.passed === false`, but keep the overlay preview visible.
- Add parity tests:
  - Same `overlay_transform` produces identical pixels in browser + edge function (≤ 0.5 px).
  - PDF embeds the overlay at the same pixel coordinates as the UI (≤ 1 px).
  - Footprint area within 8 % of fused-source area or job is auto-flagged `needs_review`.

### 7. EagleView PDF parser as a calibration ground truth (optional, high value)

The 8 EagleView PDFs you uploaded are gold-standard labeled data. Add a parser in `roof-training/parser/extract_length_page.py` (already exists) → extract per-edge length + classification + a rasterized diagram, then store as `measurement_truth` rows. Use them to:

- Score our own AI output (`scoring/` already scaffolded).
- Train the U-Net edge classifier on real labeled lengths.
- Auto-validate any new property near these addresses against EagleView ground truth.

## Files that will change

**New:**
- `src/lib/measurements/overlayProjection.ts`
- `supabase/functions/_shared/overlay-projection.ts`
- `supabase/functions/_shared/footprint-fusion.ts` (extend existing)

**Edited:**
- `supabase/functions/start-ai-measurement/index.ts` — decode raster, persist canonical transform, run fusion, reject rectangles, run multi-signal edge detection on same raster
- `supabase/functions/_shared/roof-diagram-renderer.ts` — use shared projector, draw aerial as base layer, place EagleView-style labels in pixel space
- `supabase/functions/render-measurement-pdf/index.ts` — read `overlay_transform`, embed identically
- `src/lib/measurements/overlayToPatentModel.ts` — propagate server QC
- `src/components/measurements/DimensionedPlanDrawing.tsx` — use shared projector
- `src/components/measurements/RoofOverlayViewer.tsx` — render with aerial underneath, length labels at midpoints
- `src/components/measurements/MeasurementReportDialog.tsx` — gate Save/PDF on QC
- `src/components/measurements/PatentRoofReport.tsx` — render overlay + labels on the aerial
- `src/utils/gpsCalculations.ts` — re-export shared projector (delete duplicate math)

## Risk / rollout

- Ship behind feature flag `USE_SHARED_OVERLAY_TRANSFORM` (shadow → dual-render → cutover).
- Old fields preserved one release for rollback.
- Parity tests block merge.

Reply **approve** to implement, or tell me which sections to drop/expand.