
# Fix overlay coordinate-frame mismatch (Fonsica run c732ade5)

## Problem

`raw_perimeter_px` / `debug_layers.raw_perimeter_px` / `perimeter_topology.perimeter_ring_px` are now persisted and ingested, but the debug viewer draws the polygon in the bottom-right of the aerial tile instead of over the house. The geometry itself is correct (bbox roughly x=580–710, y=550–702, centered near the confirmed [640,640] on a 1280×1280 raster). This is a viewer transform bug, not a geometry bug.

## Root causes (identified in code, no fix yet)

1. **`AIMeasurement3DDebugViewer.DebugCanvas` falls back to an 800×800 raster size** when `overlay_debug.raster_size` and `analysis_image_size` are missing (lines 702–705). The polygon is authored in 1280-pixel space, so points near (640, 640) render at (640, 640) of an 800×800 `viewBox`, which is the lower-right quadrant — exactly the symptom seen.
2. **`<img className="object-contain">` and `<svg preserveAspectRatio="xMidYMid meet">` letterbox independently.** They only line up when the SVG `viewBox` truly equals the raster's native aspect/size. Any wrong raster size in (1) cascades into a horizontal/vertical offset.
3. **No coordinate-space tagging.** Fields like `debug_layers.raw_perimeter_px` are assumed to be raster_px, but DSM-only fields (e.g. `edges_px`) can be drawn in the same canvas with no `dsm_to_raster_transform` applied.
4. **No on-screen overlay transform diagnostics**, so this class of bug is invisible until the user spots it.

## Scope (this slice only)

- Viewer/renderer code only: `AIMeasurement3DDebugViewer.tsx`, `MeasurementVisualQAOverlay.tsx`, plus a small shared resolver in `src/lib/measurements/`.
- **Do not** change: geometry generation, DSM logic, registration gate, `customer_report_ready`, edge functions, persisted JSON. Manual approval stays disabled when registration fails.

## Fix plan

### 1. New shared module: `src/lib/measurements/overlayCoordinateFrame.ts`

Single source of truth for "where does this px polygon live, and how do I draw it on the displayed image?".

- `resolveSourceRasterSize(measurement, rasterUrl)`:
  - Prefer `overlay_debug.raster_size`.
  - Then `geometry_report_json.raster_size`.
  - Then `analysis_image_size`.
  - Then `parseRasterSizeFromUrl(rasterUrl)`.
  - Then infer from the loaded image's `naturalWidth`/`naturalHeight` (passed in by caller).
  - **Remove the silent 800×800 / 1280×1280 hard-coded fallback.** If none resolves, return `{ source: 'unknown', width: null, height: null }` and let the viewer render a "raster size unknown" banner instead of mis-projecting.
- `classifyCoordinateSpace(fieldPath)`:
  - `raw_perimeter_px` / `debug_layers.raw_perimeter_px` / `perimeter_topology.perimeter_ring_px` / `phase3_5.raw_perimeter_px` / `phase3_5.refined_perimeter_px` / `aerial_candidate_roof_graph.perimeter_ring_px` / `true_outer_roof_perimeter_px` / `footprint_px` / `target_mask_*_px` → `raster_px`.
  - `overlay_debug.edges_px`, anything under a `dsm_` prefix → `dsm_px`.
  - Default to `raster_px` and log a console warning if unknown.
- `computeDisplayTransform({ sourceRasterSize, displayedImageSize, fit })`:
  - For `object-contain`: compute `scale = min(dW/sW, dH/sH)`, `offsetX = (dW - sW*scale)/2`, `offsetY = (dH - sH*scale)/2`.
  - For canvas (full-cover scale): `scale = dW/sW` if aspect matches.
  - Return `{ scaleX, scaleY, offsetX, offsetY, source }` with both scale axes (in case of non-uniform display).
- `projectPxPoint(point, transform)`: applies `[x*scaleX + offsetX, y*scaleY + offsetY]`.
- `hasDsmToRasterTransform(measurement)`: boolean; gate DSM-space layer rendering.

### 2. `AIMeasurement3DDebugViewer.DebugCanvas` rewrite of the projection layer

- Replace the inline `W/H = size.width || 800` fallback with `resolveSourceRasterSize(...)`.
- Switch from a static `viewBox="0 0 W H"` + `<img object-contain>` to a **measured container**:
  - Use a `ref` + `ResizeObserver` on the wrapping div to get `displayedImageSize`.
  - Load the aerial `<img>` and capture `naturalWidth/Height` to feed back into the resolver.
  - Render the SVG with `viewBox="0 0 displayedW displayedH"` and project every polygon/line through `projectPxPoint`. The image stays as `object-contain` with its real bounding rect computed identically — both layers now share the exact same scale + letterbox offsets.
- Refuse to render DSM-tagged layers unless `hasDsmToRasterTransform()` is true; show an inline "DSM layer suppressed — no DSM→raster transform persisted" note.

### 3. `MeasurementVisualQAOverlay.tsx` parity

The canvas-based renderer (lines 273–390) is already uniform-scaling correctly **if** `rasterSize` is right, but it shares the same risk via `parseRasterSizeFromUrl` + `{1280,1280}` hard fallback.
- Route `rasterSize` through `resolveSourceRasterSize` and the `naturalWidth/Height` of the loaded `imgRef`.
- If unresolved, render the "raster size unknown" banner and skip polygon draw rather than projecting onto a guessed frame.
- Use `classifyCoordinateSpace` to decide whether to draw `dsmEdges` at all.

### 4. Overlay transform debug readout

In both viewers, add a small collapsible "Overlay transform" panel (default open when registration is failing) showing:

- `overlay_source_field` (which field provided the polygon)
- `overlay_source_coordinate_space` (`raster_px` / `dsm_px` / `unknown`)
- `source_raster_size_px` + where it came from (`overlay_debug` / `analysis_image_size` / `parsed_from_url` / `image_natural` / `unresolved`)
- `displayed_image_size_px`
- `scale_x`, `scale_y`, `offset_x`, `offset_y`
- `first_point_before_transform`, `first_point_after_transform`
- `confirmed_center_px` before/after transform
- `bbox_center_px` before/after transform

This panel reads from the resolver's return value — no new persistence.

### 5. Frame sanity check (warning, not a gate)

After projection, compute the transformed bbox center of the selected perimeter and compare to the transformed `confirmed_roof_center_lat_lng` (or `[640,640]` fallback when in source space). If their distance exceeds `0.15 * min(displayedW, displayedH)`, surface a yellow "Overlay render transform mismatch" badge inside the existing registration warning area. Still draw the polygon so the user can see where it landed.

This is purely a viewer warning. It does **not** flip `approvalAllowed` or `customer_report_ready`.

### 6. Tests

New file `src/lib/measurements/__tests__/overlayCoordinateFrame.test.ts` (Vitest):

- 1280-source projected into a 640×640 display with `object-contain` → scale 0.5, zero offset; (640,640) maps to (320,320).
- 1280-source projected into a 900×600 display (`object-contain`) → uniform scale 0.46875, vertical offset 0, horizontal offset 89.0625; (640,640) maps near display center.
- `classifyCoordinateSpace('debug_layers.raw_perimeter_px')` → `'raster_px'`.
- `classifyCoordinateSpace('overlay_debug.edges_px')` → `'dsm_px'`.
- `resolveSourceRasterSize` prefers `overlay_debug.raster_size` over URL parsing over image natural size.
- `resolveSourceRasterSize` returns `unresolved` (not `1280×1280`) when no source is available.

Component-level test on `AIMeasurement3DDebugViewer`:
- Given fixture with `raster_size = {1280,1280}` and a polygon centered at (640,640), the rendered SVG points (after transform) land within 1px of the displayed image center for a 600×600 mounted container.
- Given fixture with no `raster_size` and no `analysis_image_size`, the viewer renders the "raster size unknown" banner instead of projecting on 800×800.

## Acceptance

- On Fonsica run `c732ade5`, the raw/selected perimeter draws over the actual target roof rather than the bottom-right corner.
- Overlay transform debug panel shows non-zero `scale_x/scale_y` consistent with the displayed image and matching bbox/confirmed centers.
- Manual approval stays disabled (registration gate untouched).
- `customer_report_ready` stays `false`.
- No DSM logic, no geometry gate, and no edge-function code is modified in this slice.

## Files touched

- `src/lib/measurements/overlayCoordinateFrame.ts` (new)
- `src/lib/measurements/__tests__/overlayCoordinateFrame.test.ts` (new)
- `src/components/measurements/AIMeasurement3DDebugViewer.tsx` (canvas projection + transform panel)
- `src/components/measurements/MeasurementVisualQAOverlay.tsx` (raster-size resolution + transform panel + DSM-layer gating)

Uses the `measurement-overlay-visual-qa` skill: keeps aerial-first background, preserves required layer toggles, leaves blocked-topology fallback rendering intact, and does not relax the manual-approval gate.
