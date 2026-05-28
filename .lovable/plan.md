Build a PDF-only export path for measurement reports, scoped strictly to frontend PDF/export rendering.

Implementation plan:

1. Add a dedicated PDF-only report component

- In `src/components/measurements/MeasurementReportDialog.tsx`, add `MeasurementReportPdfVisualSection`.
- It will render a single PDF root marked with `data-pdf-report-root="true"`.
- Content order:
  1. Header: address, diagnostic/export-only status, `result_state`, blocker/failure reason.
  2. One roof-focused aerial overlay panel marked `data-pdf-overlay-panel="true"`.
  3. Compact diagnostic chips: DSM Status, DSM Size, Aerial Candidate Graph edge count, Debug Roof Lines, Reportable Roof Lines, Customer Ready, CPU status.
  4. Optional compact detailed summary/debug table after the visual.
- It will exclude Visual QA controls, buttons, override/edit controls, layer toggles, AI process viewer, raw JSON, hidden/collapsible panels, and large interactive/debug DOM.

2. Make the PDF overlay export-safe

- Use the existing Roof Focus data from `getRasterOverlayData()` and the shared `roofFocusViewport`/`focusPerimeterPx` priority already used by Visual QA.
- Prefer a purpose-built PDF overlay view or a PDF mode for `RasterOverlayDebugView` that hides controls and renders only the aerial + SVG overlay.
- Force white export surfaces in the PDF-only root/panel.
- If the aerial image fails to load during html2canvas export, render a white placeholder with a light border and the label `aerial unavailable in export`, while keeping perimeter/roof lines visible where possible.
- Ensure the PDF root contains exactly one aerial overlay visual.

3. Change PDF capture selection

- Update `downloadVisibleReportPdf()` so it selects `[data-pdf-report-root="true"]` from `reportContentRef`, instead of collecting every `.measurement-report-page` from the interactive dialog.
- Stop force-opening all interactive `<details>` elements for export.
- Capture the dedicated PDF root as the first page/section, then only append an optional PDF-safe debug table section after it if present.
- Keep the server fallback only as an emergency fallback; the client capture should use the PDF-only DOM first.

4. Block dark/black export artifacts

- In `createExportReadyClone()` or the PDF-only component styles, sanitize the cloned export root so its root/body/panel backgrounds are `#ffffff`.
- Remove or avoid `bg-muted`, dark code panels, raw JSON `<pre>` blocks, black fallback rectangles, and dark wrappers inside `[data-pdf-report-root="true"]`.
- Preserve the existing measurement geometry/crop math without changing persisted data.

5. Add DOM/export test coverage

- Add a Vitest/Testing Library test under `tests/components/` for the PDF-only measurement report root.
- Assertions:
  - `[data-pdf-report-root="true"]` exists.
  - first major visual block is `[data-pdf-overlay-panel="true"]`.
  - no `Raw JSON` text appears inside the PDF root.
  - no interactive control text such as `Edit vertices`, `Approve`, `Reject`, `AI Process Viewer`, or layer toggle labels appears inside the PDF root.
  - overlay panel background is white.
  - no element inside the PDF root has black/dark computed background.
  - SVG `viewBox` is not full-tile when a perimeter exists.
  - exactly one `[data-pdf-overlay-panel="true"]` exists.

Technical boundaries:

- No backend measurement logic changes.
- No DSM registration, derived bounds, CPU policy, topology/pitch/facet, `customer_report_ready`, reportable roof-line promotion, DB schema, selected perimeter/geo coordinate, or overlay measurement math changes.
- Only `MeasurementReportDialog.tsx`, possibly `RasterOverlayDebugView.tsx` for a PDF-safe mode, and a component test should change.

Acceptance target:

- New PDF page 1 starts with the roof-focused aerial overlay, not the Measurement Data Summary grid.
- No black rectangle/black box under or around the aerial.
- Roof is zoomed enough for visual verification and overlay lines remain aligned.
- Debug table appears only after the visual.
- Raw JSON and interactive controls are excluded from the PDF.  
  
Approve the plan, but **add the measurement displacement/alignment card back into it before sending**. Lovable’s plan correctly targets the PDF black-box problem, but it drops the displacement wording cleanup you asked for.
  Here is the full one-drop prompt:
  ```

  ```
  ```
  Go.

  Implement PDF-only measurement report export + measurement displacement/alignment cleanup.

  Scope:
  Frontend/PDF/report rendering only.

  Do not touch:
  - backend measurement logic
  - DSM registration
  - derived bounds runtime
  - CPU policy
  - topology / pitch / facet logic
  - customer_report_ready gates
  - reportable roof line promotion
  - DB schema
  - selected_perimeter_px
  - geo coordinates
  - overlay measurement math

  Current proof from latest Fonsica:
  - PDF still shows the large black/dark box / missing useful aerial visual.
  - PDF page is still dominated by Measurement Data Summary / debug grid.
  - Roof-focused aerial overlay is not the primary visual in the PDF.
  - Visual QA DOM has valid Roof Focus crop math:
    crop_bbox_px = 500,471→790,782
    display_px_within_crop = 715×768
    first_pt_disp = 238.3,197.6
    bbox_center_disp = 357.5,384.1
  - The issue is PDF export/capture/layout, not measurement geometry.
  - UI still says “Coordinate frame mismatch” even though raster/crop projection is usable.
  - The real manual-approval blocker is DSM georegistration missing, not aerial overlay displacement.

  PART A — Dedicated PDF-only export path

  1. Add a dedicated PDF-only report component.

  In src/components/measurements/MeasurementReportDialog.tsx, add:

  MeasurementReportPdfVisualSection

  It must render a single root marked:

  data-pdf-report-root="true"

  Content order:
  1. Header:
     - address
     - diagnostic/export-only status
     - result_state
     - blocker / failure reason

  2. One roof-focused aerial overlay panel marked:
     data-pdf-overlay-panel="true"

  3. Compact diagnostic chips:
     - DSM Status
     - DSM Size
     - Aerial Candidate Graph edge count
     - Debug Roof Lines
     - Reportable Roof Lines
     - Customer Ready
     - CPU status

  4. Optional compact detailed summary/debug table after the visual.

  Exclude from this PDF root:
  - Visual QA controls
  - buttons
  - override/edit controls
  - layer toggles
  - AI Process Viewer
  - raw JSON
  - hidden/collapsible panels
  - large interactive/debug DOM

  2. Use one roof-focused visual only.

  PDF root must contain exactly one aerial overlay visual.

  Use either:
  - purpose-built PdfRoofOverlayView using roofFocusViewport
  OR
  - RasterOverlayDebugView in a PDF-safe mode

  Do not stack:
  - full-tile Roof Overlay
  - Visual QA overlay
  - duplicated RasterOverlayDebugView
  - old full-tile view when Roof Focus data exists

  3. Make the PDF overlay export-safe.

  Use the existing Roof Focus data from getRasterOverlayData() and the shared roofFocusViewport / focusPerimeterPx priority already used by Visual QA.

  When any focus source exists:
  - selected_perimeter_px
  - aerial_candidate_roof_graph.perimeter_ring_px
  - raw_perimeter_px
  - perimeter_topology.perimeter_ring_px
  - footprint/perimeter fallback

  Then:
  - use roofFocusViewport
  - set SVG viewBox to crop bbox
  - draw source points unchanged
  - do not mutate stored coordinates

  Force white export surfaces:
  - PDF root background = #ffffff
  - overlay panel background = #ffffff
  - no bg-muted
  - no dark theme variables
  - no black fallback rectangles
  - no dark code panels

  If Google Static Map image fails during html2canvas export:
  - render a white placeholder with light-gray border
  - label it: aerial unavailable in export
  - keep perimeter/roof lines visible where possible
  - never render a black/dark box

  4. Change PDF capture selection.

  Update downloadVisibleReportPdf() so it selects:

  [data-pdf-report-root="true"]

  from reportContentRef instead of collecting every .measurement-report-page from the interactive dialog.

  Do not silently fall back to the full modal capture.

  If PDF root is missing, log clearly:

  PDF export root missing: data-pdf-report-root

  Stop force-opening all interactive <details> elements for export.

  Capture the dedicated PDF root first. Only append an optional PDF-safe debug table section after it if present.

  Keep server fallback only as emergency fallback.

  5. Block dark/black export artifacts.

  In createExportReadyClone() or PDF-only component styles:
  - sanitize cloned export root background to #ffffff
  - force data-pdf-overlay-panel backgrounds to #ffffff
  - remove/avoid bg-muted inside PDF root
  - remove/avoid raw JSON <pre> blocks
  - remove/avoid black fallback rectangles
  - remove/avoid dark wrappers

  6. PDF acceptance.

  New PDF must show:
  - page 1 starts with roof-focused aerial overlay
  - no black rectangle / black box under or around aerial
  - roof is zoomed enough for visual verification
  - overlay lines remain aligned
  - debug table appears only after the visual
  - raw JSON excluded
  - interactive controls excluded
  - exactly one data-pdf-overlay-panel exists

  PART B — Measurement displacement / alignment cleanup

  The UI currently conflates two different things:
  1. Raster overlay / Roof Focus projection
  2. DSM registration / geo→DSM transform

  For this report:
  Raster overlay is usable because:
  - coord_space = raster_px
  - source_px = 1280×1280
  - crop_bbox_px exists
  - first_pt_disp is inside viewport
  - bbox_center_disp is inside viewport
  - target_mask_overlap = 0.976

  DSM registration is missing because:
  - geo_to_dsm_transform = null
  - dsm_to_raster_transform = null
  - confirmed_roof_center_dsm_px = null
  - dsm_pixel_transform_valid = false

  Do not label this state as coordinate-frame mismatch unless raster overlay itself is actually mismatched.

  1. Add Measurement Alignment card near Visual QA / Overlay Truth.

  Display:

  Measurement Alignment
  Aerial overlay: aligned to raster crop
  Roof focus crop: active
  DSM registration: missing
  Manual approval: locked by DSM registration
  Displacement source: DSM transform unavailable, not aerial overlay drift

  2. Split displacement into two statuses.

  Use:

  Raster overlay displacement: OK / unknown / mismatch
  DSM registration displacement: missing / invalid / validated

  Rules:

  Raster overlay displacement = OK when:
  - coord_space = raster_px
  - source_px or raster_size_px exists
  - crop_bbox_px exists
  - perimeter projects inside Roof Focus viewport
  - target_mask_overlap >= 0.90 OR selected perimeter exists with valid bbox

  DSM registration displacement = missing/invalid when:
  - geo_to_dsm_transform is null
  - dsm_to_raster_transform is null
  - confirmed_roof_center_dsm_px is null
  - dsm_pixel_transform_valid = false

  Manual approval should be locked by DSM registration, not raster coordinate mismatch, when raster overlay displacement is OK.

  3. Fix Visual QA banner.

  When Raster overlay displacement = OK and DSM registration displacement = missing/invalid, show:

  Title:
  DSM registration incomplete — manual approval locked

  Body:
  The aerial perimeter is aligned to the satellite image, but DSM georegistration is missing. Manual approval is locked because the system cannot safely validate pitch/topology until geo→DSM and DSM→raster transforms are available.

  Do NOT show:
  Coordinate frame mismatch — overlay not eligible for manual approval

  Only show coordinate-frame mismatch when raster overlay displacement is actually mismatch.

  4. Fix Overlay Truth card.

  Current bad state:
  Overlay frame: unknown
  Manual approval: locked by frame mismatch

  For this report state, show:

  Overlay frame: OK / crop-valid
  Overlay source: roof_focus_crop / raster_px
  DSM transform: missing
  Manual approval: locked by DSM registration

  Do not use “unknown” when crop math has enough evidence:
  - coord_space = raster_px
  - source_px = 1280×1280
  - crop_bbox_px exists
  - first_pt_disp inside viewport
  - bbox_center_disp inside viewport

  5. Show displacement metrics explicitly.

  Add fields:

  Perimeter bbox center src: 644.9,626.4
  Confirmed center src: 640,640
  Raster center offset: 14.5 px
  Target mask overlap: 0.976
  Perimeter vs mask IoU: 0.845

  Important:
  Do not use legacy perimeter_centroid_offset_px = 878 as visual overlay displacement unless clearly labeled:

  Legacy centroid offset: 878 px (legacy/global diagnostic; not Roof Focus visual displacement)

  PART C — Tests

  1. PDF-only root/export test.

  Add Vitest/Testing Library test under tests/components/ for the PDF-only measurement report root.

  Assert:
  - [data-pdf-report-root="true"] exists
  - first major visual block is [data-pdf-overlay-panel="true"]
  - exactly one [data-pdf-overlay-panel="true"] exists
  - no Raw JSON text appears inside the PDF root
  - no interactive control text appears inside the PDF root:
    - Edit vertices
    - Approve
    - Reject
    - AI Process Viewer
    - layer toggle labels
  - overlay panel background is white
  - no element inside the PDF root has black/dark computed background
  - SVG viewBox is not full-tile when a perimeter exists

  2. Alignment/displacement helper test.

  Add frontend test for pure alignment/displacement helper.

  Fixture:
  coord_space = raster_px
  source_px = 1280×1280
  crop_bbox_px = 500,471→790,782
  first_pt_disp = 238.3,197.6
  bbox_center_disp = 357.5,384.1
  confirmed_center_src = 640,640
  bbox_center_src = 644.9,626.4
  target_mask_overlap = 0.976
  dsm_pixel_transform_valid = false
  geo_to_dsm_transform = null
  dsm_to_raster_transform = null

  Expected:
  - raster_overlay_displacement = OK
  - dsm_registration_displacement = missing
  - manual_approval_lock_reason = dsm_registration_missing
  - banner = DSM registration incomplete — manual approval locked
  - NOT coordinate frame mismatch

  Final acceptance:
  - New PDF page 1 starts with roof-focused aerial overlay, not Measurement Data Summary grid.
  - No black rectangle / black box under or around aerial.
  - Roof is zoomed enough for visual verification.
  - Overlay lines remain aligned.
  - Debug table appears after the visual.
  - Raw JSON and interactive controls are excluded from PDF.
  - Visual QA no longer says coordinate mismatch when Roof Focus projection is valid.
  - Overlay Truth card says crop-valid / DSM missing.
  - Measurement Alignment card explains raster overlay vs DSM transform.
  - No backend changes.
  - No measurement coordinate changes.
  - customer_report_ready remains false.
  - reportable roof lines remain 0.

  Out of scope:
  - derived_bounds_debug visibility in debug table
  - DSM registration fix
  - topology/pitch/facet validation
  - customer report promotion
  ```
  That’s the complete corrected prompt. The Lovable plan was mostly right, but this version adds the displacement language/UI correction so you don’t keep getting “coordinate mismatch” when the actual problem is DSM registration.