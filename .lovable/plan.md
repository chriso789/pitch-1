I’ll treat this as a perimeter-first correction and stop improving inner topology until the outer eave/rake boundary is trustworthy.

## Plan

### 1. Make the data model explicit in the measurement pipeline
In `supabase/functions/start-ai-measurement/index.ts`, I’ll separate and persist these as different concepts:

- `roof_outer_perimeter` — the true roof eave/rake outline used for perimeter, reports, and topology input.
- `solar_segment_union` — internal Google Solar plane/segment approximation only.
- `DSM_edge_cloud` — structural edge evidence only.
- `roof_mask_component` — raster roof region / connected component evidence.

I’ll rename/structure the diagnostics so report JSON makes it obvious which polygon came from which source.

### 2. Stop Solar segment union/hull from being selected as the final perimeter
The current code still creates `google_solar_segments_hull` and `google_solar_segments_union` as footprint candidates, and those can win selection. I’ll change that behavior:

- Solar segment union/hull will be stored as `solar_segment_union_px` / internal guidance.
- It will not be eligible as `roof_outer_perimeter`.
- It can only guide internal segmentation after a valid outer perimeter exists.
- `google_solar_bbox` remains crop/debug evidence only, never a publishable perimeter.

This directly addresses the Fonsica failure where the green outline is an inner solar/plane trace.

### 3. Build the outer perimeter from mask/boundary evidence first
I’ll update perimeter selection to prioritize actual outer boundary evidence:

1. Google Solar roof mask connected-component outer contour.
2. Visible satellite roof boundary / image edge evidence.
3. DSM height break from roof to ground.
4. Overhang/eave shadow edge.
5. Solar segment union only as internal guidance/refinement, never final perimeter.

The existing `extractMaskContour()` uses a selected component but then returns a convex hull of boundary pixels. I’ll replace/add a true outer contour extraction path that preserves concavities and real corners better than a convex hull.

### 4. Add outer-boundary expansion from inner traces
If a selected candidate is inside the roof mask, I’ll expand it outward toward the mask boundary instead of accepting it:

- Detect inward offset against `roof_mask_component`.
- Expand rays/edges outward until reaching the mask boundary / visible roof edge.
- Snap expanded corners to strong image/DSM/eave-shadow edges.
- Preserve real corners and concavities where mask evidence supports them.
- Include rear roof-covered/screen-enclosure areas when the mask/imagery shows continuous roof surface.

This replaces the current limited bbox-based expansion against Solar bbox, which is not enough and can still follow the inner solar geometry.

### 5. Add hard under-tracing detection
Before calling `solveAutonomousGraph`, I’ll add a new gate:

`perimeter_inner_trace_detected`

It will fail when any of these are true:

- `selected_perimeter_area / roof_mask_component_area < 0.95`
- selected perimeter is fully inside the roof mask with missed roof regions
- perimeter misses visible roof boundary/eave evidence
- unknown/missed perimeter regions remain
- eave/rake perimeter length is zero or implausible for a non-flat residential roof

When this triggers, the pipeline will persist a diagnostic row and stop before internal topology. No customer report will be generated.

### 6. Feed only the validated outer perimeter into topology
After the new perimeter gate passes:

- `solveAutonomousGraph()` receives `roof_outer_perimeter`, not `solar_segment_union`.
- `boundaryEdges` will be built from the validated outer ring.
- Eave/rake lengths must come from the outer perimeter gate.
- Internal topology failure will remain separate from perimeter failure.

### 7. Correct pitch handling
I’ll prevent nonsense pitch values like `0.11/12` from being saved or shown as a valid pitch.

Rules:

- Prefer Google Solar `roofSegmentStats.pitchDegrees` when available and plausible.
- Use DSM plane normals only after both valid perimeter and valid faces exist.
- Never calculate final pitch from collapsed topology / 3 invalid planes.
- If topology is invalid, save pitch as unavailable/null and show `Unavailable` instead of `0.11/12`.
- Persist `pitch_source` and `pitch_valid` in diagnostics.

### 8. Enforce customer/report readiness rules
Customer-ready output will require all of these:

- true outer perimeter passed
- eave/rake perimeter validated
- pitch source valid
- internal topology passed independently
- existing DSM/topology fidelity promotion gates passed

If perimeter passes but internal topology fails, the report can remain internal-debug only. It must not become a customer-ready measurement.

### 9. Add the requested overlay debug layers
I’ll update persisted `geometry_report_json.overlay_debug` and `src/components/measurements/RasterOverlayDebugView.tsx` to show four separate layers:

- outer roof mask contour
- selected final perimeter
- solar segment union
- missed roof regions, filled red

The layer controls will let us visually confirm whether the green/yellow outline is the real roof boundary or an internal trace.

### 10. Improve diagnostics in the report dialog
In `src/components/measurements/MeasurementReportDialog.tsx`, I’ll add rows for:

- outer perimeter source
- outer perimeter area
- roof mask component area
- selected/mask area ratio
- inner-trace detected
- missed roof region area
- eave/rake validation status
- pitch source
- pitch valid

This makes the exact Fonsica failure obvious without opening logs.

### 11. Deploy and rerun Fonsica
After implementation, I’ll deploy the updated function and rerun/audit Fonsica. Expected outcome:

- The selected perimeter expands to the actual eave/rake outline.
- Eave and rake lengths become non-zero and realistic.
- Pitch is either near the Roofr report from Solar pitch evidence, or marked unavailable if invalid.
- Internal hips/ridges remain blocked until topology passes.
- If the system still cannot trace the true outer perimeter, it fails as `perimeter_inner_trace_detected` and does not produce a customer-ready report.

## Technical notes

Current code already has a registration gate and a perimeter phase, but the key bug is that `google_solar_segments_hull` / `google_solar_segments_union` are still treated as selectable footprint candidates. That allows the inner Solar plane geometry to become the perimeter. The fix is to remove solar segment geometry from the final perimeter candidate pool and make outer mask/boundary evidence authoritative before any topology work runs.