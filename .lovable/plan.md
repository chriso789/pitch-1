I’ll implement this as a measurement pipeline hardening pass, not as looser gates.

## Plan

### 1. Add an authoritative footprint registration gate before footprint acceptance
In `supabase/functions/start-ai-measurement/index.ts`, I’ll extend footprint candidate scoring so every candidate is evaluated against the exact raster frame used for the satellite/DSM overlay.

For each candidate, persist and score:
- `footprint_projected_bbox`
- `visible_roof_bbox`
- `centroid_offset_px`
- `roof_image_overlap_score`
- `candidate_bbox_vs_visible_roof_bbox`
- `imagery_tile_bounds`
- `dsm_bounds`
- `raster_transform`

The candidate will fail with `footprint_registration_mismatch` if it projects onto yard/driveway instead of the visible roof/mask/edge target.

### 2. Stop solar union/hull from winning unless registered to roof evidence
For `google_solar_segments_union` and `google_solar_segments_hull`, I’ll add stricter acceptance rules:
- Require overlap with DSM roof mask or DSM edge/visible roof evidence.
- Require `centroid_offset_px <= 20`.
- Require `roof_image_overlap_score >= 0.75`.
- Otherwise reject with `footprint_registration_mismatch`.

This specifically targets Palm Harbor, where the solar footprint appears shifted off the roof onto driveway/yard.

### 3. Add visible-roof fallback acquisition before declaring `missing_valid_footprint`
If Solar segment footprints fail registration:
1. Try Google Solar roof mask connected-component contour, projected into the same satellite raster frame.
2. If mask is absent/invalid, try existing imagery segmentation footprint if available.
3. If no automatic footprint can register, fail as `missing_valid_footprint` with full debug data.

I will not use parcel or broad bbox as a production footprint.

### 4. Make failed diagnostic reports show registration evidence
I’ll enrich failed `roof_measurements.geometry_report_json` / job `source_context` debug payloads so failed reports include:
- attempted footprint
- visible roof bbox
- projected bbox
- centroid offset
- roof image overlap score
- DSM loaded/mask loaded status
- DSM/imagery bounds
- rejection reason

Then I’ll update `src/components/measurements/MeasurementReportDialog.tsx` to surface these fields in the diagnostic summary and PDF download, so failed reports are useful for debugging even when not customer-ready.

### 5. Keep customer report gate strict
I’ll ensure `customer_report_ready` remains false unless both are true:
- `footprint_registration_passed = true`
- `topology_fidelity_passed = true`

This keeps debug downloads available while preventing bad customer-ready reports.

### 6. Fix Fonsica topology collapse classification separately
In `supabase/functions/_shared/autonomous-graph-solver.ts`, I’ll tighten topology fidelity detection so a roof like Fonsica cannot report as an edge-classification problem when the real failure is collapsed structure.

Rules to add/strengthen:
- If many raw DSM edges collapse into too few planes, fail `topology_undersegmented` before `invalid_edge_classification`.
- For complex footprints, require `expected_min_faces >= 8`.
- Prevent any single plane from covering more than 35% of roof area.
- Preserve local ridge/valley clusters through clustering diagnostics/gates.
- Persist `topology_fidelity` summary with raw edges, clustered edges, faces attempted, faces validated, max plane area ratio, expected min faces, and failure reason.

### 7. Add the requested return metrics into persisted diagnostics
For each rerun, the measurement/job debug payload will expose:
- `footprint_registration_passed`
- `centroid_offset_px`
- `roof_image_overlap_score`
- `dsm_loaded`
- `raw_edges`
- `clustered_edges`
- `faces_attempted`
- `faces_validated`
- `topology_fidelity`
- `customer_report_ready`

### 8. Deploy and re-run the three measurements
After implementation I’ll deploy the updated edge function pipeline and re-run/audit:
- 4063 Fonsica
- 9 Palm Harbor
- 309 Montelluna

Then I’ll report back the exact metrics requested for all three.

## Technical notes

Current code already has basic projection diagnostics and DSM coordinate matching, but it does not yet gate candidate footprints against a visible roof/mask/edge target before acceptance. The missing piece is a pre-solver registration contract: candidate footprint must overlap the visible roof evidence in the same raster frame before DSM topology is allowed to run.

Fonsica will remain blocked unless topology fidelity passes; Palm Harbor and Montelluna should be blocked earlier as footprint registration/acquisition failures until their footprint aligns to actual roof evidence.