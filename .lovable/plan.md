## Goal

Split `start-ai-measurement` validation into two distinct phases so DSM-dependent registration checks never run before DSM has been fetched. Today the preflight at `EARLY_TRANSFORM_STAGE = "early_preflight"` builds a static-only transform package, marks `dsm_stage_pending=true`, but the classifier still emits `dsm_bounds_missing` as a hard fail — short-circuiting the run before Google Solar / DSM / mask are even attempted (the Fonsica rerun proved this: all source-acquisition + DSM diagnostics were `null`).

## The two phases

### Phase 1 — `early_preflight` (request validation only)

Only validate:
- `job_id` exists and not already terminal
- lead / property / address present
- `lat`/`lng` present and numeric
- user / company / tenant authorization
- required env / config (Google Solar key, etc.)
- static map transform inputs (zoom, size, scale, static_map_center) — these are derivable without DSM

Must NOT require or report missing:
- `geo_to_dsm_transform`
- `dsm_tile_bounds_lat_lng`
- `dsm_to_raster_transform`
- `confirmed_roof_center_dsm_px`
- `selected_candidate_polygon_px`
- `dsm_size_px`
- roof mask / Google Solar payload fields

Must NOT emit `dsm_bounds_missing`, `dsm_size_missing`, `selected_candidate_polygon_missing`, or any DSM-derived hard_fail_reason.

### Phase 2 — `post_source_acquisition_registration_gate`

Runs only after:
- Google Solar `dataLayers` fetch attempted (success or fail recorded)
- DSM fetch attempted (success or fail recorded)
- Roof mask fetch attempted (success or fail recorded)
- DSM-derived transforms attempted (`geo_to_dsm`, `dsm_to_raster`)
- Candidate polygon selection attempted

Only here may the classifier emit:
- `dsm_bounds_missing`
- `dsm_size_missing`
- `dsm_decode_failed`
- `dsm_center_out_of_bounds`
- `geo_to_dsm_transform_missing`
- `dsm_to_raster_transform_missing`
- `selected_candidate_polygon_missing`
- `candidate_centroid_offset_exceeds_target`
- `coordinate_space_mismatch`
- `coordinate_registration_failed` (fallback only when no specific token applies)

## Files to change

1. **`supabase/functions/_shared/registration-stage-classifier.ts`**
   - Add a guard at the top of `classifyRegistrationStage()`: if `input.dsm_stage_pending === true` OR `input.dsm_fetch_attempted !== true`, return a soft `{ stage: "early_preflight", hardFail: null, registration_gate_passed: null, missing_required_fields: <static-only> }` instead of cascading into the DSM hard_fail ladder.
   - Restrict the `missing` list during early preflight to static-transform fields only (`raster_bounds_lat_lng`, `confirmed_roof_center_px`).
   - Keep the existing priority ladder unchanged for the post-acquisition call.

2. **`supabase/functions/start-ai-measurement/index.ts`**
   - At the existing early preflight (~L880–906): keep it as today (build static transform package, set `dsm_stage_pending=true`) but **never** translate it into a terminal `hard_fail_reason`. Persist `registration.failed_stage = null` and `transform_build_stage = "early_preflight"`.
   - Move the registration-gate-as-hard-fail evaluation to a new chokepoint after source acquisition (after Google Solar / DSM / mask fetches and transform derivation). Reuse `classifyRegistrationStage()` with `dsm_stage_pending=false` and the actual fetch-attempt flags.
   - Always persist these diagnostics on the failure payload regardless of which phase failed:
     - `google_solar_status`, `google_solar_error`, `datalayers_url_present`
     - `dsm_fetch_attempted`, `dsm_fetch_status`, `dsm_fetch_error`, `dsm_fetch_duration_ms`
     - `roof_mask_fetch_attempted`, `roof_mask_fetch_status`, `roof_mask_fetch_error`
     - `registration.dsm_hoist_called`, `dsm_size_px`, `dsm_tile_bounds_lat_lng`
     - `registration.geo_to_dsm_transform`, `dsm_to_raster_transform`
     - `registration.selected_candidate_polygon_px_present`
     - `registration.coordinate_registration_gate_passed`
     - `registration.failed_stage` ∈ {`early_preflight`, `source_acquisition`, `registration_gate`, `topology`, …}

3. **`supabase/functions/_shared/__tests__/registration-gate_test.ts`** (extend, don't replace the 34 existing tests)
   - New test: early_preflight call with `dsm_stage_pending=true` MUST return `hardFail=null` and MUST NOT list any DSM field in `missing_required_fields`.
   - New test: post-acquisition call with `dsm_fetch_attempted=true` and `dsmLoaded=true` but missing bounds MUST still emit `dsm_bounds_missing`.
   - New test: post-acquisition call where Google Solar failed (`dsm_fetch_attempted=true`, `dsm_fetch_status='failed'`) MUST emit a Google-Solar-specific token (`google_solar_mask_timeout` / `google_solar_roof_mask_missing` / etc.), not `coordinate_registration_failed`.
   - New test: a failure payload from either phase MUST carry the full diagnostic field set listed above (non-null where the stage was attempted, explicit `null` where it was not).

## Out of scope

- No deploy, no Fonsica rerun, no stuck-job cleanup in this loop. The previous loop already deployed `09e2df7` and marked `6d93693d-…` failed; the next rerun happens only after this ordering fix ships.
- No business-logic changes to Google Solar / DSM / mask fetch helpers themselves — only the gate ordering.
- No DB schema changes; `result_state` continues to flow through `normalizeResultStateForWrite()`.

## Acceptance

- All 34 existing tests still pass; ≥4 new tests added and passing.
- Fonsica rerun (next loop) MUST NOT terminate at `early_preflight` with `dsm_bounds_missing`. If it still fails, it must fail at `source_acquisition` or `registration_gate` with populated Google Solar / DSM / mask diagnostics so we can finally see why source acquisition is incomplete.
