
# Target Roof Registration Gate v2

## Problem (confirmed from screenshots + report JSON)

The Fonsica overlay is drawn on the **wrong house** (neighbor SE of 4063 Fonsica). The pipeline itself already knows registration is broken but kept rendering an editable perimeter anyway:

- `target_confirmation.src = none`
- Source acquisition: "No imagery source selected"
- `overlay_debug.coordinate_space = satellite_px` vs `coordinate_space_solver = dsm_px`
- `geo_to_dsm_px_success = false`
- `dsm_pixel_transform_valid = false`
- `raster_url` centered at stale geocode (27.0820246, -82.1962156)
- Perimeter sourced from `google_solar_mask_contour` but rendered on a neighbor
- `coordinate_match = true` is **misleading** — it passed despite frame mismatch

This is a **coordinate registration / target confirmation bug**, not a perimeter shape problem. All Phase 3A.5 / 3C / 3D / 3E perimeter-shape tuning is paused until registration is fixed.

Skills invoked: `roof-measurement-vision-qa`, `canonical-route-provenance-auditor`.

## Scope (Phase 1 — gate + diagnostics only)

Read-only-to-customer: no customer report can be produced from an unregistered run. No deletions, no schema rewrites of existing rows, no auto-recentering of historical jobs. Forward-only enforcement on new runs.

## Hard gates added

### Gate A — Target confirmation required
`start-ai-measurement` rejects (HTTP 412) when:
- `user_confirmed_roof_target ≠ true` AND `roof_target_admin_override ≠ true`
- OR `confirmed_roof_center_lat/lng` missing
- OR `confirmed_roof_center_px` missing in the displayed raster

Persist on the row:
- `result_state = ai_failed_target_unconfirmed`
- `hard_fail_reason = target_roof_not_confirmed`
- `block_customer_report_reason = target_roof_not_confirmed`

### Gate B — Frame registration valid
Block source acquisition and perimeter refinement when any of:
- `geo_to_dsm_px_success = false`
- `dsm_pixel_transform_valid = false`
- `dsm_to_raster_transform` missing / non-invertible
- raster bounds do not contain `confirmed_roof_center_lat_lng`

Persist:
- `result_state = ai_failed_source_acquisition`
- `hard_fail_reason = coordinate_registration_failed`

### Gate C — Candidate must contain confirmed roof center
For every footprint / mask / solar-contour candidate:
- polygon must contain `confirmed_roof_center_px`
- centroid offset within threshold (target: ≤ 0.5 × candidate bbox half-diagonal)
- nearest neighboring structure center must be farther than confirmed center
- otherwise reject with `candidate_does_not_contain_confirmed_roof_center`

Persist per candidate: `confirmed_center_inside_candidate`, `candidate_centroid_offset_from_confirmed_center_px`, `nearest_neighbor_structure_distance_px`, `selected_candidate_distance_rank`.

### Gate D — Manual approval disabled when registration invalid
UI disables Save edited perimeter / Approve & rerun unless ALL true:
- `user_confirmed_roof_target`
- `geo_to_dsm_px_success`
- `dsm_pixel_transform_valid`
- `confirmed_center_inside_candidate`
- `coordinate_registration_gate_passed`

Inline warning: "Cannot approve perimeter until target roof registration passes."

## Recentering rule

When user has confirmed a structure, raster/static-map center MUST be `confirmed_roof_center_lat_lng`, never the stale address geocode. DSM tile fetch uses the same confirmed center for bounds.

## AI Process Viewer additions

Independently toggleable markers/layers, each tagged with its coordinate frame:
- original geocode marker
- confirmed roof center marker (crosshair)
- static map center marker
- Google Solar building center marker
- selected perimeter
- accepted candidate masks/components
- rejected candidate footprints (with reason)
- target component id label

If any layer's frame ≠ the displayed raster frame, render a red banner: "Coordinate frame mismatch — overlay not eligible for manual approval." (no auto-suppress; user sees the mismatch).

## Persisted frame fields (JSONB, not new DB columns)

All of the following written under `geometry_report_json.registration`:
`original_geocode_lat_lng`, `confirmed_roof_center_lat_lng`, `static_map_center_lat_lng`, `google_solar_building_center_lat_lng`, `dsm_tile_origin_lat_lng`, `dsm_tile_bounds_lat_lng`, `raster_bounds_lat_lng`, `raster_size_px`, `dsm_size_px`, `meters_per_pixel`, `geo_to_raster_transform`, `geo_to_dsm_transform`, `dsm_to_raster_transform`, `coordinate_registration_gate_passed`.

Per drift guard skill: JSONB only — no new stable columns.

## Debug endpoint

Extend `debug-measurement-runtime` to return, per row:
address, original geocode, confirmed roof center, static map center, Google Solar building center, selected perimeter centroid, `confirmed_center_inside_selected_perimeter`, `dsm_pixel_transform_valid`, `geo_to_dsm_px_success`, `coordinate_registration_gate_passed`, `result_state`, `hard_fail_reason`, route provenance block.

## Result state contract

All new buckets reuse the existing 10-bucket normalizer (`ai_failed_target_unconfirmed`, `ai_failed_source_acquisition` already canonical). No CHECK constraint change. Specific reasons live in `hard_fail_reason` / `block_customer_report_reason` / `geometry_report_json.failure_details`.

## Files / functions touched

Backend (no new edge function folders):
- `supabase/functions/start-ai-measurement/index.ts` — Gate A pre-flight (HTTP 412); persist confirmation fields
- `supabase/functions/_shared/autonomous-graph-solver.ts` (and callers) — Gate B & C; reject mis-centered candidates; persist `geometry_report_json.registration`
- `supabase/functions/_shared/result-state.ts` — ensure both new failure tokens route through `normalizeResultStateForWrite()`
- `supabase/functions/debug-measurement-runtime/index.ts` — new fields in response
- `supabase/functions/_shared/dsm-geometry-contract.ts` — add registration gate as a prereq to the existing 6 contracts (does not replace them)

Frontend:
- `src/components/measurements/MeasurementReportDialog.tsx` — disable approval CTAs when registration invalid; banner
- `src/components/measurements/AIMeasurement3DDebugViewer.tsx` (and overlay canvas) — frame markers, layer toggles, mismatch banner
- `src/hooks/useMeasurementJob.ts` — surface registration flags; gate the "Approve & rerun" action
- `src/components/measurements/StructureSelectionMap.tsx` — emit `confirmed_roof_center_lat/lng` + `confirmed_roof_center_px` on PIN placement (already the confirmation step per Patent Rule 1)

## Tests (regression harness skill)

New Deno + Vitest tests under existing harness:
- `start-ai-measurement/__tests__/fonsica-target-not-confirmed-412.test.ts` — Gate A
- `start-ai-measurement/__tests__/fonsica-registration-fail-blocks-perimeter.test.ts` — Gate B; assert `result_state=ai_failed_source_acquisition`, no perimeter, no topology
- `_shared/__tests__/candidate-must-contain-confirmed-center.test.ts` — Gate C using a fixture where solar mask centroid lies on the SE neighbor (Fonsica reproducer)
- `MeasurementReportDialog.registration-invalid.test.tsx` — approval CTAs disabled, banner present
- `debug-measurement-runtime/__tests__/registration-fields.test.ts` — endpoint returns all 11 required fields

Fonsica fixture: anonymized copy of the current bad row (confirmed center ≈ target roof, candidate centroid on SE neighbor, `geo_to_dsm_px_success=false`).

## Out of scope (deferred)

- Auto-fixing historical mis-registered rows
- Topology / perimeter-shape scoring changes
- Any change that would let manual approval bypass Gate D
- Schema CHECK constraint changes

## Acceptance for Fonsica

A rerun on 4063 Fonsica must:
1. Refuse to run without PIN confirmation (Gate A).
2. With PIN placed on the actual Fonsica roof: raster recenters on confirmed center; DSM tile fetched at confirmed center.
3. If `geo_to_dsm` / `dsm_to_raster` still invalid → row persists as `ai_failed_source_acquisition` with full `registration` block; no editable perimeter shown.
4. If registration valid → only candidates containing the confirmed center are eligible; SE-neighbor solar contour is rejected with `candidate_does_not_contain_confirmed_roof_center`.
5. Manual approval CTAs remain disabled until all five Gate D flags are true.
6. `debug-measurement-runtime` returns the full 11-field registration proof.
