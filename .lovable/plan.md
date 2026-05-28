## Goal

Finish the in-flight PDF export + alignment-UI work so the report PDF leads with the Roof Focus aerial (no black box, no debug-table-first), and so the Visual QA / Overlay Truth area stops calling a valid raster overlay a "coordinate frame mismatch" when the real failure is a missing DSM transform.

Frontend / PDF / report rendering only. No backend, no geometry, no gates.

## Current state (already in place from prior turn)

- `MeasurementReportPdfVisualSection.tsx` exists and renders a `[data-pdf-report-root="true"]` root with a single roof-focused overlay panel.
- `MeasurementReportDialog.downloadVisibleReportPdf` already selects `[data-pdf-report-root="true"]` and logs `PDF export root missing: data-pdf-report-root` when missing.
- `RasterOverlayDebugView` supports a `pdfMode` for white background / no controls.
- `registration-gate.ts` already emits the correct DSM-incomplete banner copy when `frame_mismatch === "ok"`, via `resolveFrameMismatch`.
- A `registrationBanner.frame-ok` test exists.

## Part A — PDF export polish

1. **PDF root contract audit** in `MeasurementReportPdfVisualSection.tsx`:
  - Confirm structure is strictly: header/status → one `[data-pdf-overlay-panel="true"]` Roof Focus visual → compact diagnostic chips → optional compact debug table.
  - Force inline `background:#ffffff` on the root and the overlay panel; strip any `bg-muted`, dark variables, or `<pre>` raw JSON blocks.
  - Aerial-unavailable fallback: white panel with light-gray border + label "aerial unavailable in export"; perimeter SVG still drawn on top.
  - Ensure exactly one aerial panel exists (no stacked Visual QA + Roof Overlay).
2. **PDF visual uses Roof Focus** when any of `selected_perimeter_px`, `aerial_candidate_roof_graph.perimeter_ring_px`, `raw_perimeter_px`, `perimeter_topology.perimeter_ring_px`, or footprint fallback is present — via shared `roofFocusViewport` helper; SVG `viewBox` = crop bbox; source points unchanged.
3. **Capture path** in `MeasurementReportDialog.downloadVisibleReportPdf`:
  - Keep `[data-pdf-report-root="true"]` selector and the loud console error on miss.
  - Remove any leftover "force-open all `<details>`" / multi-`.measurement-report-page` capture path so the dialog DOM is never silently captured.
4. **Compact debug table after visual** (optional section): if present, render inside the PDF root *after* the overlay; never before.

## Part B — Alignment / displacement UI

Files: `MeasurementVisualQAOverlay.tsx`, new `src/lib/measurement/alignmentStatus.ts`.

1. **New pure helper** `alignmentStatus.ts`:
  ```ts
   computeAlignmentStatus(measurement) => {
     raster_overlay_displacement: "ok" | "unknown" | "mismatch",
     dsm_registration_displacement: "missing" | "invalid" | "validated",
     manual_approval_lock_reason: "dsm_registration_missing" | "frame_mismatch" | "target_unconfirmed" | null,
     banner: { title, body } | null,
     metrics: { perimeter_bbox_center_src, confirmed_center_src, raster_center_offset_px,
                target_mask_overlap, perimeter_vs_mask_iou, legacy_centroid_offset_px? }
   }
  ```
   Rules per spec: raster=ok when `coord_space=raster_px` + `source_px`/`raster_size_px` + `crop_bbox_px` + perimeter inside viewport + (`target_mask_overlap>=0.9` OR valid selected perimeter bbox); dsm=missing when all four DSM fields null/false.
2. **New "Measurement Alignment" card** rendered above Overlay Truth with the five lines from the spec (Aerial overlay / Roof focus crop / DSM registration / Manual approval / Displacement source).
3. **Overlay Truth card** (lines 956–971): drive labels from the helper — show `Overlay frame: OK / crop-valid`, `Overlay source: roof_focus_crop / raster_px`, `DSM transform: missing`, `Manual approval: locked by DSM registration` whenever `raster_overlay_displacement === "ok"`. Never render `unknown` if the crop math has the required evidence.
4. **Visual QA banner**: continue to source copy from `registrationBanner` (already correct). Add a guard so any local banner rendered by `MeasurementVisualQAOverlay` also defers to the helper — never render "Coordinate frame mismatch" when `raster_overlay_displacement === "ok"`.
5. **Explicit metrics block** under Overlay Truth: render the five values from the helper. Legacy `perimeter_centroid_offset_px` only appears with the prefix `Legacy centroid offset: N px (legacy/global diagnostic; not Roof Focus visual displacement)`.

## Tests

1. `**alignmentStatus.test.ts**` with the spec fixture; expect `raster_overlay_displacement === "ok"`, `dsm_registration_displacement === "missing"`, `manual_approval_lock_reason === "dsm_registration_missing"`, banner title `DSM registration incomplete — manual approval locked`, and that no output string contains "coordinate frame mismatch".
2. `**MeasurementReportPdfVisualSection.dom.test.tsx**` (jsdom):
  - `[data-pdf-report-root="true"]` exists; contains exactly one `[data-pdf-overlay-panel="true"]`; panel is the first major block.
  - SVG `viewBox` ≠ full tile when perimeter exists (use spec crop bbox fixture).
  - Computed `backgroundColor` of root and panel is white / not black.
  - PDF root text does not include `Raw JSON`, `Edit vertices`, `Approve`, `Reject`, `Reset`, `AI Process Viewer`.
3. **Export wiring smoke test** in the dialog test: assert `downloadVisibleReportPdf` queries `[data-pdf-report-root="true"]` and logs the required error string when absent.

## Out of scope

Backend, DSM registration, derived bounds, CPU policy, topology/pitch/facet logic, customer-report gates, reportable roof line promotion, DB schema, geo/selected_perimeter coordinates, overlay measurement math.

## Acceptance

- PDF page 1: Roof Focus aerial near top, no black rectangle, debug table only after visual, no raw JSON, no controls, single overlay panel.
- Visual QA: no "coordinate frame mismatch" copy for this report; Overlay Truth shows `crop-valid` + `DSM transform: missing` + `locked by DSM registration`; Measurement Alignment card present; explicit displacement metrics shown; legacy 878 px clearly labeled legacy.
- `customer_report_ready` stays false; reportable roof lines stay 0.  
  
I reviewed the latest Lovable plan and it’s correct. The remaining problems are now purely frontend/export clarity issues, not geometry problems.
  The important runtime truth from the latest report is:
  - Roof Focus crop math is now valid.
  - Overlay projection is visually usable.
  - The raster overlay is aligned enough for human verification.
  - DSM registration is still missing.
  - The PDF export path is still capturing/rendering the wrong DOM/layout structure.
  The biggest UX issue is still that the UI says:
  ```

  ```
  ```
  Coordinate frame mismatch — overlay not eligible for manual approval
  ```
  even though:
  - `coord_space = raster_px`  

  - `source_px = 1280×1280`  

  -   
  crop-relative display coordinates are inside viewport  

  -   
  target overlap is `0.976`  

  So the next step absolutely should be:
  -   
  dedicated PDF-only visual export root  

  -   
  single roof-focused overlay panel  

  -   
  white export surfaces  

  -   
  alignment/displacement language split between raster overlay vs DSM registration  

  I approved the plan and pushed the refined implementation/acceptance details into the repo issue.