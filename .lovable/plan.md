

## Port Stage 2: Alignment, Calibration & Report Shaping

### What Stage 2 adds (not yet in TypeScript)

The Python script's Stage 2 introduces five capabilities that the current TypeScript pipeline lacks:

| Python Stage 2 Concept | TypeScript Equivalent | Status |
|---|---|---|
| `AlignmentTransform` (diagram → aerial mapping) | Nothing | Missing |
| `estimate_feet_per_pixel()` (pixel→ft calibration from vendor line lengths) | `measurement-calibration` edge function exists but uses zoom math, not vendor truth | Gap |
| `line_measurements_from_geometry()` (polyline length extraction per edge type) | Skeleton edges have lengths but no structured extraction matching report format | Partial |
| `render_overlay_preview()` (draw lines on satellite image) | `generate-roof-overlay` exists but runs via AI vision, not deterministic rendering | Different approach |
| `build_final_report_payload()` (structured report JSON matching Roofr format) | `generate-roofr-style-report` exists but doesn't pull from fused pipeline output | Gap |

### Implementation Plan

**1. Create `geometry-alignment.ts` shared module**
- Port `AlignmentTransform`, `infer_alignment_transform`, `apply_transform_to_polyline`
- Add `flattenGeometrySegments()` to group parsed vendor geometry by edge type (ridge/valley/hip/eave/rake)
- Add `estimateFeetPerPixel()` — uses median of vendor truth line lengths divided by pixel lengths for calibration (matching the Python median-based approach)
- Add `lineMeasurementsFromGeometry()` — returns per-edge-type segment count, pixel length, and calibrated length in feet

**2. Wire calibration into unified pipeline**
- Add optional `vendorGeometry` field to `UnifiedMeasurementRequest` (parsed polylines from ingested reports)
- When vendor geometry + vendor truth are both present, run alignment transform and pixel-to-feet calibration
- Back-fill any missing linear measurements in the fusion input with calibrated values
- Store calibration debug metadata (ft_per_pixel, alignment transform params) on the result

**3. Update report output to match Roofr structure**
- Create `buildFinalReportPayload()` in the pipeline that produces the exact JSON shape from Stage 2:
  - `property` block (address, lat/lng)
  - `report` block (area, squares, pitch, facets, per-line-type totals with segment counts)
  - `calibration` block (debug/provenance info)
- Wire this into the `UnifiedMeasurementResult` as a `finalReport` field
- Update `generate-roofr-style-report` to consume this structured output instead of assembling its own

### Files to create/modify

| File | Change |
|------|--------|
| `supabase/functions/_shared/geometry-alignment.ts` | New — alignment transform, pixel-to-feet calibration, line measurement extraction |
| `supabase/functions/_shared/unified-measurement-pipeline.ts` | Add `vendorGeometry` input, wire alignment step between fusion and QA, add `finalReport` to result |
| `supabase/functions/_shared/measurement-fusion.ts` | No changes needed — already accepts vendor sources |
| `supabase/functions/generate-roofr-style-report/index.ts` | Pull from `finalReport` payload instead of raw measurement data |

### Technical Details

- Pixel-to-feet calibration uses the Python script's median approach: for each line type with both pixel and vendor-truth lengths, compute `ft/px`, then take the median across all types for stability
- Alignment transform is a simple proportional scale (no rotation/skew) — adequate for axis-aligned diagram-to-aerial mapping; affine transforms can be added later with control points
- The `vendorGeometry` field accepts pre-parsed polylines (from `parse-roof-report-geometry` output), not raw PDFs
- Report payload shape matches the Python `build_final_report_payload()` exactly for downstream compatibility

