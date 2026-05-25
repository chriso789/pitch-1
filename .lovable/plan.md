## DSM Bounds + Candidate Polygon Hoist v1

Scope: registration package only. No perimeter shape, topology, or roof_lines changes.

### Files to touch

- `supabase/functions/start-ai-measurement/index.ts` — wire DSM hoist + candidate hoist before final `evaluateRegistrationGate`.
- `supabase/functions/_shared/registration-gate.ts` — extend block schema + center selection per coordinate space.
- `supabase/functions/_shared/registration-stage-classifier.ts` — add new specific failure tokens.
- `supabase/functions/_shared/dsm-registration.ts` *(new)* — `buildDsmRegistration()` extracting size/bounds/transforms.
- `supabase/functions/_shared/candidate-hoist.ts` *(new)* — `hoistSelectedCandidatePolygon()` from `perimeter_candidate_table` / `perimeter_topology`.
- `src/lib/measurement/registration-gate.ts` — mirror new fields for UI banner.
- Tests under `supabase/functions/_shared/__tests__/` and `supabase/functions/start-ai-measurement/__tests__/`.

### Step 1 — DSM stage attempted
If `dsm_loaded || mask_loaded`, call `buildDsmRegistration()`. Always persist:
- `dsm_stage_attempted=true`, `dsm_stage_pending=false`
- `dsm_registration_source="google_solar_data_layers"`, `dsm_registration_version="dsm-registration-v1"`

### Step 2 — DSM size
Read `dsm_coordinate_match.dsm_bbox` (or decoded grid). Persist `dsm_size_px` + `dsm_size_source` (`decoded_dsm_grid` | `dsm_coordinate_match.dsm_bbox`). Hard-fail token `dsm_size_missing` when unavailable.

### Step 3 — DSM bounds (with derivation fallback)
Priority order:
1. Google Solar metadata bounds → `dsm_bounds_source=google_solar_metadata`
2. confirmed center + DSM mpp → `derived_from_confirmed_center_and_mpp`
3. dsm_bbox + static map mpp (diagnostic) → `derived_from_dsm_bbox_and_static_mpp`
4. else → `missing` + token `dsm_bounds_missing`

When derived: `dsm_bounds_derived=true`, `dsm_bounds_warning="derived_bounds_lower_confidence"`, populate `dsm_meters_per_pixel`, `dsm_bounds_confidence`.

### Step 4 — geo_to_dsm_transform
Once size+bounds exist, build affine. Persist `geo_to_dsm_transform`, `confirmed_roof_center_dsm_px`, `dsm_tile_bounds_contain_confirmed_center`, `geo_to_dsm_px_success`. Token `geo_to_dsm_transform_missing` when prereqs exist but build fails.

### Step 5 — dsm_to_raster_transform
When both raster bounds + dsm bounds exist, compute transform + overlap. Persist `dsm_to_raster_transform`, `dsm_raster_bounds_overlap`, `dsm_raster_overlap_ratio`, `dsm_pixel_transform_valid`. Token `dsm_raster_transform_missing`.

### Step 6 — Candidate polygon hoist
Before `evaluateRegistrationGate(candidate_final)`:
- Prefer `perimeter_candidate_table` row with `selected=true` → use ring px points.
- Else `perimeter_topology.perimeter_ring_px` (only if coordinate frame matches/convertible).
- Persist `selected_candidate_polygon_px`, `selected_candidate_polygon_geo`, `candidate_coordinate_space` (`dsm_px`|`raster_px`), `candidate_source`, `selected_candidate_polygon_point_count`, `candidate_area_sqft`, `candidate_centroid_px`. Token `selected_candidate_polygon_missing` if none.

### Step 7 — Center selection per coordinate space
- `dsm_px` candidates → check against `confirmed_roof_center_dsm_px`
- `raster_px` candidates → check against `confirmed_roof_center_px`
Persist `center_used_for_candidate_check`, `confirmed_center_inside_candidate`, `candidate_centroid_offset_from_confirmed_center_px`, `candidate_centroid_offset_threshold_px`. Token `coordinate_space_mismatch` when mismatched and no conversion possible.

### Step 8 — Specific failure tokens (priority order)
`dsm_size_missing` → `dsm_bounds_missing` → `geo_to_dsm_transform_missing` → `dsm_raster_transform_missing` → `selected_candidate_polygon_missing` → `candidate_does_not_contain_confirmed_center` → `candidate_centroid_offset_exceeds_target` → `coordinate_space_mismatch` → `coordinate_registration_failed` (fallback only). Add to `registration-stage-classifier.ts` and `result-state.ts` normalizer mapping (all map to `ai_failed_source_acquisition` bucket).

### Step 9 — Regression tests
Per AI Measurement Regression Harness skill — fixture-driven Deno tests:
- `dsm-size-hoist.test.ts` (Test A)
- `dsm-bounds-derivation.test.ts` (Test B)
- `candidate-polygon-hoist.test.ts` (Test C)
- `candidate-center-coordinate-space.test.ts` (Test D)
- `candidate-centroid-offset-fail.test.ts` (Test E)
Fixture: anonymized Fonsica row under `_shared/__fixtures__/fonsica-dsm-stage-pending.json`.

### Step 10 — Deploy + rerun Fonsica
Deploy `start-ai-measurement` via `supabase--deploy_edge_functions`, then trigger Pull AI Measurement on lead `0a38230e-…`. Verify against the expected report fields in the user's spec.

### Out of scope (explicit)
Perimeter shape gates, topology, roof_lines, Phase 3A/3A.5/3C/3D/3E logic. Only registration package + classifier touched.

Uses Canonical Route & Runtime Provenance Auditor, AI Measurement Regression Harness, and Roof Measurement Vision QA & Geometry Contract skills.