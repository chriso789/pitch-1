## Scope

Read-side diagnostic propagation only. This will **not** make any report customer-ready. It only guarantees that the new DSM diagnostic fields that already exist in code actually land on the live `roof_measurements` / `ai_measurement_jobs` row's `geometry_report_json.registration`, so the UI stops rendering blanks where the runtime "knows" the answer.

This prompt does not:
- derive DSM bounds
- attempt any heuristic registration
- change topology, pitch, facets, result_state, or customer-ready gating

## Problem

`applyLiveRuntimeHoistToRegistration` already merges the new diagnostic fields (`dsm_tile_bounds_source`, `dsm_tile_bounds_failure_reason`, `dsm_bounds_derived`, `dsm_bounds_warning`, `dsm_bounds_confidence`, `dsm_meters_per_pixel`, `dsm_mpp_source`, `dsm_hoist_failure_tokens`, `dsm_hoist_called/callsite/version`, `dsm_stage_pending=false`). `buildDsmRegistration` already produces them. `dsm_split_status` is already lifted at line 15511.

But the latest live row still shows the legacy shape (`dsm_tile_bounds_lat_lng=null` with no `dsm_tile_bounds_source` or `dsm_hoist_failure_tokens` next to it). That means at least one terminal write path is reaching `update(roof_measurements)` without the hoist running, or with a stale registration object that pre-existed the hoist.

## Fix

1. Add a single canonical pre-write step `ensureDsmDiagnosticsOnRegistration(payload)` that:
   - Runs `applyLiveRuntimeHoistToRegistration` against `geometry_report_json` + current `registration` block.
   - Always writes the diagnostic fields above (even when they resolve to `null`/`"google_solar_tile_bounds_missing"`), so the row never looks "field-absent" — it looks "field-present-and-null-with-reason".
   - Stamps `dsm_diagnostic_propagation_version` + `dsm_diagnostic_propagation_at` so we can grep for legacy rows vs. propagated rows.
   - Is fully idempotent (won't overwrite real values once present).

2. Call `ensureDsmDiagnosticsOnRegistration` from `ensureRegistrationProofBeforeWrite` (which already wraps every persistence write), immediately before returning `next`. This guarantees the diagnostic block is on every write path including:
   - the success path at ~L12566 / L13013 / L13393
   - the failure path at ~L15626 (currently the most common path — DSM bounds missing)
   - the prepareRoofMeasurementPayload merge at ~L1734 / L1810 / L1822

3. Persist `dsm_split_status` alongside the registration block (mirror it onto `registration.dsm_split_status` in addition to the existing `debug.dsm_split_status`) so the report UI doesn't have to chase two locations.

4. Add `dsm_diagnostic_propagation_summary` to `registration` summarizing why bounds are null (e.g. `"google_solar_tile_bounds_missing"`, `"dsm_loaded_without_tiepoints"`, `"derived_bounds_disabled"`). Pure read-only summary string; no logic depends on it.

## Verification

1. Extend existing Deno test `dsm-diagnostic-propagation.test.ts` with:
   - failing-DSM scenario (no tile bounds): assert the persisted payload has `registration.dsm_tile_bounds_lat_lng === null` **and** `registration.dsm_tile_bounds_source === "missing"` **and** `registration.dsm_hoist_failure_tokens` array present **and** `registration.dsm_split_status` mirrored **and** `registration.dsm_diagnostic_propagation_version` set.
   - already-valid DSM scenario: assert the helper is idempotent (no field mutated).
   - legacy-input scenario (registration object missing every new field): assert post-helper all new fields exist.

2. Hit `start-ai-measurement` end-to-end via `supabase--curl_edge_functions` against the same address from the failing report, then `supabase--read_query` the resulting row's `geometry_report_json.registration` and confirm the new fields are present.

## Expected outcome on the live report after this prompt

- `dsm_tile_bounds_lat_lng` remains `null` (unchanged — bounds genuinely do not exist).
- `dsm_tile_bounds_source = "missing"`, `dsm_tile_bounds_failure_reason = "google_solar_tile_bounds_missing"`, `dsm_hoist_failure_tokens = [...]`, `dsm_bounds_confidence = 0`, `dsm_split_status` mirrored — all newly visible.
- `result_state`, `customer_report_ready`, `failure_stage`, perimeter graph, candidate count, aerial scaffold — **unchanged**.
- No new topology phases execute.
- After this lands, the next real unlock is the separate Option B prompt (derived DSM bounds fallback).
