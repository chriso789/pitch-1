## Context

The DSM/candidate hoist wiring described in the drop-in is **already implemented** on `main` inside `supabase/functions/start-ai-measurement/index.ts`:

- `buildDsmRegistration` + `hoistSelectedCandidatePolygon` imported from `_shared/dsm-registration.ts` and called (lines ~1425, ~1563, ~6353).
- Runtime proof fields stamped: `dsm_hoist_called`, `dsm_hoist_version = "dsm-bounds-candidate-hoist-v1"`, `dsm_size_source`, `dsm_bounds_source`, `dsm_bounds_derived`, `candidate_hoist_called`, `candidate_hoist_version`.
- Specific hard_fail tokens (`dsm_bounds_missing`, `coordinate_space_mismatch`, `candidate_centroid_offset_exceeds_target`, `dsm_to_raster_transform_missing`, `dsm_center_out_of_bounds`, `dsm_raster_overlap_failed`) replace generic `coordinate_registration_failed`.
- `stale_debug_payload` bucket quarantines pre-block perimeter/topology data.
- `blocked_by_registration_gate` stamped on phase blocks and `footprint_source` when registration fails.

Existing tests in `supabase/functions/_shared/__tests__/dsm-bounds-and-candidate-hoist.test.ts` cover the helper in isolation only.

**Gap**: the latest Fonsica row still shows `hard_fail_reason = coordinate_registration_failed` and `dsm_size_px = null` — meaning either the deployed function is stale, or a code path inside `start-ai-measurement` returns/throws before reaching the hoist for this specific input shape. We have no runtime-shape test that would fail loudly when that happens.

## Goal

Add runtime-shape regression tests (Tests A–G from the drop-in) that exercise the actual `start-ai-measurement` registration-prep code path, not the `_shared` helper. These tests must fail today if a deployed Fonsica run produces `registration.dsm_size_px = null` while `dsm_loaded = true` and `dsm_coordinate_match.dsm_bbox` exists. Then redeploy and rerun Fonsica with the tests as the proof-of-wire.

## Plan

### 1. Extract registration-prep into a testable surface

Inside `supabase/functions/start-ai-measurement/index.ts`, identify the inline block (~lines 1300–1700) that:

- calls `buildDsmRegistration`
- merges DSM hoist fields into `geometry_report_json.registration`
- calls `hoistSelectedCandidatePolygon`
- computes `coordinate_space_audit` and centroid-offset checks
- maps to specific `hard_fail_reason` tokens

Refactor it into one exported pure function:

```ts
export function prepareRegistrationFromRuntimeInputs(input: RuntimeRegistrationInput): {
  registrationPatch,
  geometryPatch,        // includes stale_debug_payload, footprint_source override
  phasePatches,         // phase3_5/3C/3D/3E skipped_reason stamps
  resultState,          // normalized via normalizeResultStateForWrite
  hardFailReason,
  blockCustomerReportReason,
  diagramRenderIntent,
}
```

No behavior change — same fields written, just callable from a test. Call site inside the handler becomes a one-liner merge.

### 2. Test fixtures

Create `supabase/functions/start-ai-measurement/__tests__/__fixtures__/`:

- `fonsica-registration-input.json` — the exact `RuntimeRegistrationInput` shape that the live Fonsica run produces (taken from the persisted row's `geometry_report_json` and `dsm_coordinate_match`).
- `fonsica-no-dsm-bounds.json` — same as above but with no Solar metadata bounds, so derivation must kick in.
- `candidate-stale-only.json` — only `selected_perimeter_after_refinement` label present, no current-run polygon.
- `candidate-dsm-px.json` and `candidate-raster-px.json` — coordinate-space variants.
- `candidate-far-offset.json` — replicates the prior 878px centroid offset.

### 3. Tests A–G (Deno tests)

Create `supabase/functions/start-ai-measurement/__tests__/registration-runtime-wire.test.ts`:

- **Test A — DSM size hoist**: with `dsm_loaded=true`, `dsm_coordinate_match.dsm_bbox={998,998}` → assert `registrationPatch.dsm_hoist_called=true`, `dsm_size_px={998,998}`, `dsm_size_source="dsm_coordinate_match.dsm_bbox"`, `dsm_stage_pending=false`, `dsm_hoist_version="dsm-bounds-candidate-hoist-v1"`.
- **Test B — Bounds derivation or specific fail**: no explicit bounds + confirmed center + mpp → either `dsm_tile_bounds_lat_lng` populated with `dsm_bounds_source="derived_from_confirmed_center_and_mpp"` and `dsm_bounds_derived=true`, OR `hardFailReason="dsm_bounds_missing"`. Explicitly assert `hardFailReason !== "coordinate_registration_failed"`.
- **Test C — Candidate hoist**: with current-run `perimeter_topology.perimeter_ring_px` → `candidate_hoist_called=true`, `selected_candidate_polygon_px` populated, `candidate_hoist_version="candidate-hoist-v1"`.
- **Test D — Coordinate space dsm_px**: `center_used_for_candidate_check === confirmed_roof_center_dsm_px`, `center_used_coordinate_space="dsm_px"`.
- **Test E — Coordinate space raster_px**: `center_used_for_candidate_check === confirmed_roof_center_px`, `center_used_coordinate_space="raster_px"`.
- **Test F — Far-offset reject**: centroid offset 878px → `hardFailReason="candidate_centroid_offset_exceeds_target"`, `confirmed_center_inside_candidate=false`, all `phasePatches.phase3_5.skipped_reason="blocked_by_registration_gate"`.
- **Test G — Stale-payload quarantine on block**: assert `geometryPatch.stale_debug_payload.perimeter_topology` set, top-level `perimeter_topology=null`, `footprint_source="blocked_by_registration_gate"`, `roof_lines=[]`, `diagramRenderIntent="registration_blocked"`.

Each test maps explicitly to the relevant Hard Rule from the AI Measurement Regression Harness skill and the Canonical Route & Runtime Provenance Auditor skill.

### 4. Result-state contract check

Inside `registration-runtime-wire.test.ts`, add a final assertion sweep that every `resultState` produced by Tests B–G is one of the 10 canonical buckets (per Supabase Schema & DB Drift Guard / Result State Contract), and that specific solver tokens live on `hardFailReason` / `blockCustomerReportReason`, never on `resultState`.

### 5. Run tests, then redeploy and rerun Fonsica

- Run `supabase--test_edge_functions` on `start-ai-measurement` and `_shared` until A–G are green.
- Deploy `start-ai-measurement`.
- Trigger an AI measurement on the Fonsica lead from the UI.
- Pull the new row via `debug-measurement-runtime` and assert against the same fixture-derived expectations: `dsm_hoist_called=true`, `dsm_size_px={998,998}`, specific `hard_fail_reason`, `stale_debug_payload` populated, no `coordinate_registration_failed` unless every more specific token is unavailable.

### 6. Done definition

- New tests fail loudly if any runtime-shape regression reappears (the file `__tests__/registration-runtime-wire.test.ts` is the proof, not the helper test).
- A fresh Fonsica row shows the runtime proof fields populated, a specific `hard_fail_reason`, and no perimeter/topology/roof_lines on the visible report.
- If the rerun *still* shows generic `coordinate_registration_failed` despite Tests A–G passing locally, that proves a deploy/cache issue (not a wiring gap) and the next step is forcing a function redeploy + invalidating Supabase function cache.

## Out of scope

- No new business logic, no perimeter-shape changes, no topology changes.
- No DB migrations (no new columns; all proof fields already live under `geometry_report_json.registration`).
- No UI changes; the report dialog already reads `registration.*`.  
  

  ```
  Approved direction, but tighten the runtime test scope so it covers BOTH failure classes we are seeing:

  1. DSM/candidate hoist registration-prep
  2. aerial_candidate_roof_graph preemption payload

  The plan is correct that helper tests are not enough. We need tests against the actual start-ai-measurement runtime/pre-topology path.

  Required additions before implementation:

  A. Include aerial graph assertions in the same runtime-shape test suite

  The Fonsica row currently proves:
  - registration.transform_package.geo_to_raster_transform exists
  - registration.transform_package.raster_bounds_lat_lng exists
  - registration.transform_package.raster_size_px = 1280x1280
  - perimeter_topology.perimeter_ring_px exists
  - perimeter_topology.perimeter_ring_geo exists
  - perimeter_topology.eave_edges.length = 6
  - perimeter_topology.perimeter_edges.length = 6
  - target_mask_isolation.checked = true

  Yet:
  - aerial_candidate_roof_graph.executed = false
  - skipped_reason = raster_transform_unavailable
  - edges = []
  - primary_geometry_source = null
  - dsm_validation_status = null

  Add runtime tests proving that with this Fonsica-shaped input:
  - aerial_candidate_roof_graph.executed === true
  - edges.length >= 6
  - skipped_reason is absent/null
  - primary_geometry_source === "aerial_registered"
  - dsm_validation_status.reason === "invalid_transform"
  - customer_report_ready === false
  - report_blocked === true

  B. Include CPU-preempt terminal payload tests

  The latest rows also show the preemption path can still lose data.

  Add tests proving:
  - pre_phase3_5_preempt does not rebuild graph from null/stale registration
  - preTopologyDebugBag.aerial_candidate_roof_graph survives into buildCpuBudgetTerminalDebugPayload
  - executed graphs cannot be overwritten by skipped graphs
  - skipped graphs always include skip_debug at final persistence
  - estimated_work_units does not downgrade from a known value like 996004 to 0

  C. Include CPU timing assertion

  Latest run regressed to:
  - cpu_budget_elapsed_ms = 96688
  - cpu_budget_ms = 75000
  - cpu_budget_remaining_ms = -21688

  Add a test that with:
  - cpu_budget_ms = 75000
  - cpu_terminal_write_reserve_ms = 15000

  preemption happens before reserve exhaustion:
  - elapsed <= 60000ms + tolerance
  - remaining_ms > 0
  - late_cpu_preempt !== true on the normal path

  D. Keep the proposed DSM tests A–G

  Keep the existing proposed DSM/candidate hoist tests:

  Test A — DSM size hoist:
  - dsm_loaded=true
  - dsm_coordinate_match.dsm_bbox={998,998}
  Expected:
  - registrationPatch.dsm_hoist_called=true
  - dsm_size_px={998,998}
  - dsm_size_source="dsm_coordinate_match.dsm_bbox"
  - dsm_stage_pending=false
  - dsm_hoist_version="dsm-bounds-candidate-hoist-v1"

  Test B — Bounds derivation or specific fail:
  - no explicit bounds + confirmed center + mpp
  Expected:
  - dsm_tile_bounds_lat_lng populated with dsm_bounds_source="derived_from_confirmed_center_and_mpp"
  OR hardFailReason="dsm_bounds_missing"
  - hardFailReason must not be "coordinate_registration_failed"

  Test C — Candidate hoist:
  - current-run perimeter_topology.perimeter_ring_px
  Expected:
  - candidate_hoist_called=true
  - selected_candidate_polygon_px populated
  - candidate_hoist_version="candidate-hoist-v1"

  Test D — Coordinate space dsm_px:
  - center_used_for_candidate_check === confirmed_roof_center_dsm_px
  - center_used_coordinate_space="dsm_px"

  Test E — Coordinate space raster_px:
  - center_used_for_candidate_check === confirmed_roof_center_px
  - center_used_coordinate_space="raster_px"

  Test F — Far-offset reject:
  - centroid offset 878px
  Expected:
  - hardFailReason="candidate_centroid_offset_exceeds_target"
  - confirmed_center_inside_candidate=false
  - all phasePatches.phase3_5.skipped_reason="blocked_by_registration_gate"

  Test G — Stale-payload quarantine:
  - stale perimeter/topology data exists on a registration block
  Expected:
  - geometryPatch.stale_debug_payload.perimeter_topology set
  - top-level perimeter_topology=null
  - footprint_source="blocked_by_registration_gate"
  - roof_lines=[]
  - diagramRenderIntent="registration_blocked"

  E. Result-state contract

  For every runtime test:
  - resultState must be one of the canonical buckets
  - specific failure tokens must live on hardFailReason/blockCustomerReportReason, not resultState

  F. Deployment sequence

  Do not rerun Fonsica until these tests pass.

  Sequence:
  1. Extract prepareRegistrationFromRuntimeInputs or equivalent testable runtime-prep surface.
  2. Add the DSM/candidate hoist tests.
  3. Add aerial graph preempt payload tests.
  4. Add CPU preempt timing tests.
  5. Run start-ai-measurement edge tests.
  6. Deploy start-ai-measurement.
  7. Rerun Fonsica from UI only.
  8. Pull fresh debug-measurement-runtime.

  Acceptance on fresh Fonsica:
  - no generic coordinate_registration_failed if a more specific token exists
  - dsm_hoist_called=true when DSM loaded/match bbox exists
  - dsm_size_px={998,998} when bbox exists
  - aerial_candidate_roof_graph.executed=true
  - aerial_candidate_roof_graph.edges.length >= 6
  - primary_geometry_source="aerial_registered"
  - dsm_validation_status.reason="invalid_transform"
  - estimated_work_units preserved, not 0 if known
  - cpu_budget_elapsed_ms < cpu_budget_ms
  - customer_report_ready=false
  - overlay still aligned

  Guardrails:
  - no DSM solver changes
  - no geometry scoring changes
  - no customer report changes
  - no DB migration
  - no overlay transform changes
  - preserve canonical route start-ai-measurement only
  ```
  My read: **do not choose “force redeploy” yet**. This plan is the right move, but only if it includes the aerial graph/preempt payload tests too. Otherwise they’ll prove the DSM helper is wired and still miss the exact failure you’re seeing in the latest report.