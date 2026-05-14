Implement a strict AI Measurement contract in focused phases, replacing patch-by-patch state handling with shared guards and regression coverage.

## 1. Centralize normalized result_state

Create a shared result-state module used by all measurement functions:

- Add `supabase/functions/_shared/result-state.ts` with:
  - `ALLOWED_RESULT_STATES`
  - `ResultState`
  - `normalizeResultState(rawFailureOrState, context?)`
  - `normalizeResultStateForWrite(rawFailureOrState, geometryReportJson?)`
  - `assertAllowedResultState(result_state)`
- Map all specific solver reasons into the stable buckets only:
  - `perimeter_inner_trace_detected`, `invalid_roof_footprint`, `layer1_invalid` → `ai_failed_perimeter`
  - `target_unconfirmed` → `ai_failed_target_unconfirmed`
  - `source_acquisition_failed`, `google_solar_no_dsm_coverage`, `dsm_fetch_failed` → `ai_failed_source_acquisition`
  - `topology_undersegmented_after_refinement`, `ai_failed_complex_topology`, `invalid_edge_classification`, `ridge_network_missing` → `ai_failed_topology`
  - `pitch_invalid`, `collapsed_plane_pitch` → `ai_failed_pitch`
  - schema/cache/constraint/DB insert failures → `ai_failed_schema`
  - unknown/new failures → `ai_failed_unknown`
- Remove the local inline normalizer from `start-ai-measurement/index.ts` and import the shared one.

## 2. Guard every DB write that touches result_state

Audit and update every insert/update to these tables:

- `roof_measurements`
- `ai_measurement_jobs`
- `measurement_jobs` if the column exists in live schema/code paths

Every write will use:

```ts
const normalized = normalizeResultStateForWrite(rawFailureOrState, geometryReportJson)
```

If an invalid value is attempted:

- write `result_state = 'ai_failed_unknown'`
- set `geometry_report_json.raw_result_state_attempted`
- set `geometry_report_json.result_state_normalization_error = true`
- preserve exact details in:
  - `hard_fail_reason`
  - `block_customer_report_reason`
  - `failure_stage`
  - `validation_status`
  - `geometry_report_json.failure_details`

Specific write paths to harden:

- target-confirmation 412 response metadata
- early perimeter failure insert via `insertFailedPreliminaryMeasurement()`
- perimeter target-mask failure `ai_measurement_jobs.update()`
- final `roof_measurements.insert()` publish path
- final `ai_measurement_jobs.update()` promotion path
- override recalculation result-state update
- legacy/measure edge-function mirror insert paths that may write measurement rows

## 3. Keep DB constraint strict and canonical

Add/verify a migration that keeps the CHECK constraints aligned to exactly the canonical enum:

- `roof_measurements_result_state_check`
- `ai_measurement_jobs_result_state_check`
- `measurement_jobs_result_state_check` only if that column exists

Do not add new solver-specific failures to the DB enum. The database remains a final safety net, while exact failure reasons stay in diagnostic/detail fields.

## 4. Enforce confirmed roof target before acquisition

Harden `start-ai-measurement` so source acquisition cannot start unless target confirmation is present:

- If `user_confirmed_roof_target` is false/missing and no admin override:
  - return HTTP 412
  - `result_state = ai_failed_target_unconfirmed`
  - `hard_fail_reason = target_unconfirmed`
  - do not create blank geometry
  - do not call Google Solar/DataLayers/raster/OSM/DSM paths
- Ensure all acquisition coordinates use confirmed roof center:
  - Google Solar Building Insights
  - Google DataLayers
  - static raster tile
  - OSM/Overpass
  - Mapbox/fallbacks
  - DSM/roof mask projection
- Persist the target audit trail:
  - original geocode lat/lng
  - confirmed roof center lat/lng
  - marker offset ft
  - user confirmation flag
  - lat/lng source

## 5. Make Layer-1 perimeter the topology prerequisite

Use the existing `classifyLayer1()` / `requireLayer1()` pattern as a hard contract:

- Layer 1 can only be true outer roof perimeter.
- Forbidden final Layer 1 sources remain blocked:
  - solar union/hull/bbox
  - parcel/global mask/interior contour
  - loose unmatched OSM
- If Layer 1 fails:
  - `result_state = ai_failed_perimeter`
  - `hard_fail_reason = layer1_invalid`
  - `customer_report_ready = false`
  - diagnostics are persisted
- Add a `requireLayer1()` guard immediately before internal topology execution so no ridge/hip/valley solver runs before valid perimeter exists.

## 6. Guarantee Perimeter Phase 0 always runs before perimeter failure

Strengthen the existing Phase 0 path:

```text
selected perimeter candidate
→ isolateTargetRoofMask()
→ buildPerimeterTopology()
→ evaluatePerimeterGate()
→ persist geometry_report_json.perimeter_phase0
→ then pass/fail
```

Remove/neutralize old early returns where these can fail before `perimeter_phase0` exists:

- `perimeter_inner_trace_detected`
- `inner_trace_detected`
- `missed_roof_ratio`
- `perimeter_to_mask_ratio`
- `roof_mask_area_sqft`
- `visible_roof_bbox_px`

If code tries to emit `perimeter_inner_trace_detected` while `perimeter_phase0` is null:

- set `developer_bug = 'phase0_bypassed_before_perimeter_gate'`
- fail as an internal regression, not as a normal roof failure
- show this bug in the report UI

## 7. Make target-mask isolation the only perimeter mask gate

Harden `isolateTargetRoofMask()` behavior:

- Global mask is diagnostic only.
- `global_mask_inflation_ratio > 2` becomes a warning only.
- Perimeter hard-fail can only come from missed target roof logic:

```text
missed_target_roof_pct > 5
AND benchmark_sanity_ok = false
AND solar_sanity_ok = false
```

Persist target/global diagnostics:

- target mask area
- global mask area
- global inflation ratio
- selected target component id
- target bbox
- perimeter overlap
- missed target roof pct
- mask components table
- benchmark sanity
- solar sanity

Fonsica-specific expected behavior:

- selected perimeter around 3255 sqft
- Roofr benchmark 3077 sqft
- about 5.8% delta
- benchmark sanity passes within ±10%
- global mask 11697 sqft does not hard-fail

## 8. Enforce typed roof_lines as report totals source

Finish the typed-lines contract:

- Ensure every persisted measurement gets `roof_lines` rows when geometry exists.
- Required attributes:
  - `perimeter`
  - `eave`
  - `rake`
  - `ridge`
  - `hip`
  - `valley`
  - `wall_flashing`
  - `step_flashing`
  - `common`
  - `unknown`
- Customer/report totals come only from `roof_lines where can_be_customer_reported = true`.
- If roof_lines are missing:
  - `customer_report_ready = false`
  - `result_state = diagnostic_only` or `ai_failed_topology` based on stage
  - block customer PDF/export

## 9. Harden pitch resolution

Create or centralize `resolvePatentPitch()`:

- Prefer pitch derived from ridge/perimeter geometry when topology is valid.
- Use Solar roofSegmentStats pitch when topology is invalid/collapsed.
- If Solar is unavailable and topology is invalid, pitch is unavailable/null.
- Never publish collapsed-plane pitch values like `0.11/12` or `1.67/12`.
- Persist:
  - `pitch_source`
  - `pitch_valid`
  - `pitch_failure_reason`
  - `pitch_resolver_debug`

## 10. Make customer readiness one central gate

Expand `assertCustomerReportReady()` to include the full contract:

- confirmed roof target
- source acquisition passed
- Layer 1 perimeter passed
- `perimeter_phase0` exists
- perimeter gate passed
- typed roof_lines exist
- pitch valid
- topology not undersegmented
- no heuristic/fallback geometry
- no developer bug
- no schema/runtime failure

If perimeter passes but topology fails:

- `result_state = perimeter_only`
- `customer_report_ready = false`
- show perimeter/eave/rake diagnostics
- disable customer PDF/export
- watermark internal topology as diagnostic only

## 11. Upgrade diagnostic report UI

Update `MeasurementReportDialog` and the process viewer integration to show the contract clearly.

At the top show:

- `result_state`
- `hard_fail_reason`
- `customer_report_ready`
- engine version
- created time
- git commit SHA
- perimeter contract version
- Phase 0 control-flow version

Perimeter diagnostics show:

- Phase 0 status
- perimeter source
- perimeter area
- perimeter total LF
- eave LF
- rake LF
- target mask area
- global mask area
- global mask inflation ratio
- missed target roof pct
- benchmark sanity
- solar sanity
- gate failures/warnings

If `perimeter_inner_trace_detected` exists and `perimeter_phase0` is null, display the red bug banner:

```text
BUG: perimeter_inner_trace_detected fired before Perimeter Phase 0 executed. Old global-mask gate is still active.
```

Add/verify the action:

- `Open AI Measurement Process Viewer`

The viewer timeline will expose:

1. Target confirmation
2. Source acquisition
3. Raster tile
4. DSM / roof mask
5. Perimeter candidates
6. Layer-1 true perimeter
7. Target-mask isolation
8. Solar segments
9. Pitch resolver
10. Internal topology
11. Final diagram
12. Customer gate

Layer toggles include aerial raster, original/confirmed markers, Solar segments, DSM, global/target masks, missed roof regions, perimeter/eave/rake lines, candidate/accepted/rejected topology, final diagram, and vendor benchmark when present.

## 12. Add regression tests

Add Deno tests in `supabase/functions/_shared` and targeted function tests for:

### normalizeResultState

- `topology_undersegmented_after_refinement` → `ai_failed_topology`
- `perimeter_inner_trace_detected` → `ai_failed_perimeter`
- `google_solar_no_dsm_coverage` → `ai_failed_source_acquisition`
- `invalid_edge_classification` → `ai_failed_topology`
- `collapsed_plane_pitch` → `ai_failed_pitch`
- `random_new_failure` → `ai_failed_unknown`
- no invalid result_state can reach DB payload construction

### evaluatePerimeterGate

- global mask area never hard-fails
- global inflation > 2 is warning only
- missed target roof only fails against target mask
- benchmark sanity suppresses failure
- solar sanity suppresses failure

### Phase 0 / Fonsica regression

- if `footprint_source != none` and footprint has at least 3 points, `perimeter_phase0` is not null
- benchmark within ±10% suppresses `perimeter_inner_trace_detected`
- global mask 11697 sqft does not hard-fail selected perimeter around 3255 sqft

### UI regression

- `perimeter_phase0 = null` + `perimeter_inner_trace_detected` shows the developer-bug banner

## 13. Validate with Fonsica

Run the test suite and then re-run the live Fonsica AI Measurement.

Completion criteria:

- no `result_state` CHECK constraint error
- `roof_measurements` row saves
- `result_state` is one of the stable enum values
- exact reason is preserved in detail fields
- `perimeter_phase0` is populated
- target mask metrics are populated
- global mask remains diagnostic only
- benchmark sanity is true for Fonsica within ±10% of 3077 sqft
- eave/rake totals come from `roof_lines`
- pitch source is Solar or valid topology, not collapsed planes
- if topology fails, `result_state = perimeter_only`
- customer PDF/export remains disabled until full gate passes