## Goal

Transform PITCH AI Measurement reports into true EagleView-style 6-page reports rendered exclusively from real measured roof geometry. Stop publishing "two generic rectangles" diagrams generated from Google Solar bounding boxes. Keep the same single entry point (Lead/Project → AI Measurements button → `useMeasurementJob` → `start-ai-measurement`).

## Root cause (confirmed)

In `supabase/functions/start-ai-measurement/index.ts`:
- `planesFromSolar()` converts each Google Solar `roofSegmentStats[].boundingBox` into a 4-corner axis-aligned rectangle (sw/se/ne/nw). That is the source of the "two rectangles" output.
- `edgesFromPlanes()` then defaults every non-shared perimeter segment to `eave`.
- The diagram renderer (`_shared/roof-diagram-renderer.ts`) faithfully draws those rectangles — it cannot rescue bad input.
- The current quality gate counts Solar bbox planes as "real planes", so it does not trip `needs_manual_measurement`.

There is already an `internal-unet-client.ts` capable of returning a real footprint polygon + classified features (ridge/hip/valley/eave/rake), but `start-ai-measurement` does not call it.

## Plan

### 1. Database migration (additive only)

Add the columns from the spec to `ai_roof_planes`, `ai_roof_edges`, `ai_measurement_diagrams`, `roof_measurements`. All `add column if not exists`, no destructive changes.

### 2. Geometry source upgrade — `start-ai-measurement/index.ts`

Replace the Solar-bbox-as-truth path with a tiered geometry resolver:

```text
Priority 1: Internal U-Net (callInternalUNet)
  → real footprint_polygon + classified RoofFeatureLine[]
  → build planes via straight-skeleton / facet-generator (already in _shared)
  → classified edges come straight from the model

Priority 2: Mapbox/OSM/Microsoft footprint extractors (already in _shared)
  → real footprint, then plane decomposition
  → edges classified via ridge-detector + eave-rake-classifier + hip-valley-detector

Solar API: pitch + azimuth HINTS only
  → never used as polygon geometry
  → mark plane.source_evidence with solar pitch contribution

If neither P1 nor P2 yields a footprint with ≥3 valid vertices and ≥1 classified non-eave edge, mark every plane is_placeholder=true and force qc.status = 'needs_manual_measurement'.
```

Persist new fields when inserting planes/edges:
- planes: `plane_label` (P-01, P-02…), `label_x`, `label_y` (interior point), `source_evidence`, `is_placeholder`
- edges: `edge_id`, `edge_label` (R-01, V-01…), `label_x`, `label_y` (offset normal to midpoint), `orientation_degrees`, `is_perimeter`, `annotation_point`

### 3. Hard quality gate

Replace `runQualityChecks` flags with the spec's gate:
- `has_real_planes` — ≥1 plane, no `is_placeholder`, every `polygon_px.length >= 3`
- `has_real_edges` — ≥1 edge, every `line_px.length >= 2`, `length_ft > 0`, at least one classified non-eave edge
- `has_valid_area` — `300 ≤ total_area_pitch_adjusted_sqft ≤ 20000`
- `has_valid_calibration` — `feet_per_pixel > 0`, `raster_scale = 2`
- `has_report_geometry` — `report_json` populated

Any failure → `status = needs_manual_measurement`, no `roof_measurements` publish, no diagrams generated. UI shows "Manual measurement required — geometry incomplete" instead of fake report.

### 4. Diagram renderer rewrite — `_shared/roof-diagram-renderer.ts`

Full rewrite to produce 6 pages on a printable 8.5×11 SVG canvas (850×1100, viewBox `0 0 850 1100`). Drawing zone `x=85 y=210 w=600 h=650`, compass anchored bottom-right `(710, 850)`, header with property address + page title, footer with engine version + page number.

Pages produced (in order, all sharing one normalized viewport transform so roof scale/rotation/compass match across pages):

1. **Cover / Satellite Page** — address, job id, generated date, confidence, satellite image, source notes.
2. **Image / Overlay Page** — calibrated satellite image + outline + edge labels + plane labels overlaid in the same coordinate system (no independent stretching).
3. **Length Diagram** — black outline; ridge red, valley blue, hip orange, eave black, rake gray-dashed; midpoint-by-arc-length labels offset along the edge normal with collision detection (8px increments, leader line after 5 attempts); ridge total + valley total top-left; "rounded to nearest foot" note.
4. **Pitch Diagram** — pitch label `r/12` at polygon visual centroid (interior-point fallback for concave); arrow marker; "Pitch units are inches per foot" note.
5. **Area Diagram** — total top-left; rounded sqft of each plane centered inside its polygon (uses `area_pitch_adjusted_sqft`); no overlap with edge labels.
6. **Notes Diagram** — clean outline, compass, notes header, no clutter.

Style rules: white bg, light-gray plane fills, no UI chrome, no badges, no buttons.

Satellite overlay fix: use original raster dims, single shared viewport transform applied to image + planes + edges + labels; satellite 100% / plane fill 15–25% / lines 100%; if image URL missing or cross-origin blocked, skip the page and mark unavailable rather than rendering blurry crop.

### 5. PDF export — new edge function `render-measurement-pdf`

- Loads `ai_measurement_diagrams` for a job (ordered by `page_number`).
- Wraps each SVG into a PDF page (server-side via `pdf-lib` + SVG→PNG fallback for any unsupported nodes; vector preserved where possible).
- Uploads to Storage at `ai-measurement-reports/{ai_measurement_job_id}/measurement-report.pdf`.
- Writes path back to `ai_measurement_jobs.report_pdf_path` + `roof_measurements.report_pdf_path`.
- Triggered automatically at the end of `start-ai-measurement` after successful diagram insert.

### 6. Frontend cleanup

No new buttons, no new entry points. Light edits only:

- `src/components/measurements/MeasurementReportDialog.tsx` / `RoofDiagramViewer.tsx` — render diagrams in fixed order (Cover → Overlay → Length → Pitch → Area → Notes); "Download PDF" button now downloads `roof_measurements.report_pdf_path` instead of printing the browser screen.
- `UnifiedMeasurementPanel.tsx` — when `ai_measurement_jobs.status = needs_manual_measurement`, replace the diagram area with the message "Geometry incomplete — manual review required." (suppress the existing "No WKT geometry available" placeholder).
- `useMeasurementJob.ts` / `PullMeasurementsButton.tsx` — verified already calling `start-ai-measurement`; no contract change.

### 7. Acceptance test pass

After deploy, re-run AI Measurement on 8359 Huntsman Pl and verify the 15 acceptance checks from the spec, including: real polygon_px, classified edges, populated totals, 6 diagram rows, label placement, compass on every page, downloaded PDF clean of UI chrome, and `needs_manual_measurement` correctly returned when geometry is rectangle-only.

## Files touched

- **Migration** (new): add columns to `ai_roof_planes`, `ai_roof_edges`, `ai_measurement_diagrams`, `roof_measurements`.
- **Rewrite**: `supabase/functions/_shared/roof-diagram-renderer.ts`
- **Edit**: `supabase/functions/start-ai-measurement/index.ts` (geometry source + QC gate + diagram payload + PDF trigger)
- **New**: `supabase/functions/render-measurement-pdf/index.ts`
- **Edit**: `src/components/measurements/MeasurementReportDialog.tsx`, `RoofDiagramViewer.tsx`, `UnifiedMeasurementPanel.tsx`

## Out of scope

- No new measurement buttons or report builders.
- No changes to `measure/`, `measure-roof/`, `roof-report/` legacy functions.
- No model retraining — uses the existing internal U-Net deployment on Render.
