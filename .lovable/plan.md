## Goal

Complete the two-phase registration gate fix by getting all tests green, then deploy `start-ai-measurement` and rerun Fonsica with strict diagnostic proof.

## Steps

### 1. Fix Phase 2 test: "DSM URL present + decode failed"
File: `supabase/functions/_shared/__tests__/registration-stage-classifier.test.ts`

The test currently fails because `dsm_bounds_missing` takes priority over `dsm_decode_failed`. Enrich the fixture so DSM bounds/tile metadata are present (populate `dsm_tile_bounds_lat_lng`, `dsm_size_px`, `geo_to_dsm_transform`, `dsm_to_raster_transform`) and only the decode step fails. Assert `hard_fail_reason === "dsm_decode_failed"` and `failure_stage === "post_source_acquisition_registration_gate"` (or whatever the current Phase 2 stage label is).

### 2. Align stale "candidate polygon" test with current contract
Same test file. Update the expectation from `candidate_polygon_missing` → `selected_candidate_polygon_missing` to match the classifier's actual emitted token. Do NOT rename the production token. Confirm no UI/report consumer depends on the legacy string (grep `candidate_polygon_missing` across `src/` and `supabase/functions/`); if any consumer is found, surface it instead of silently updating.

### 3. Update `source-registration-transform.test.ts` case C
File: `supabase/functions/_shared/__tests__/source-registration-transform.test.ts`

Case C now correctly returns the specific `dsm_size_missing`. Update the expectation from `coordinate_registration_failed` → `dsm_size_missing` only after verifying the fixture has `dsm_fetch_attempted=true` (or equivalent) and genuinely lacks DSM size. If the fixture is actually pre-source-acquisition, instead fix the fixture so the test scenario matches its intent.

### 4. Run full test suite
Run `supabase--test_edge_functions` across `_shared`, `start-ai-measurement`, and any other touched function. Must be 100% green. No deploy on red.

### 5. Deploy `start-ai-measurement`
After green, call `supabase--deploy_edge_functions` with `["start-ai-measurement"]`. Confirm deploy success in logs.

### 6. Clean up stuck Fonsica job (if any) and rerun
- Check `ai_measurement_jobs` for the lead with `status='running'` past the timeout window; if present, mark `status=failed`, `hard_fail_reason=ai_measurement_runtime_timeout`.
- Invoke `start-ai-measurement` for the Fonsica lead.
- Poll job row + `geometry_report_json.failure_details` until terminal.

### 7. Verify Fonsica result against acceptance criteria
Acceptance (all must hold; otherwise patch is not done):
- `failure_stage !== "early_preflight"` for any DSM-derived `missing_required_fields`.
- Source acquisition diagnostics populated: `google_solar_fetch_attempted`, `dsm_url_present`, `dsm_size_px`, `dsm_tile_bounds_lat_lng`, `geo_to_dsm_transform`, `dsm_to_raster_transform`, `confirmed_roof_center_dsm_px` — non-null where the corresponding upstream step succeeded.
- If hard-fail: `hard_fail_reason` is specific (e.g. `dsm_decode_failed`, `dsm_bounds_missing`, `google_solar_dataLayers_unavailable`, `coordinate_space_mismatch`) and on the allow-list — NOT a generic `coordinate_registration_failed`.
- `result_state` written via `normalizeResultStateForWrite()`.
- `customer_report_ready === false` (no fake pass).

## Non-goals / guardrails

- Do NOT relax acceptance criteria to make Fonsica pass. A correct-stage hard fail with full diagnostics IS success for this loop.
- Do NOT change pipeline business logic — only test fixtures/expectations and the already-implemented Phase 1/Phase 2 split.
- Do NOT rename production tokens; only test expectations move toward production reality.
- No schema/DB changes.

## Technical notes

- Phase 1 short-circuit lives in `_shared/registration-stage-classifier.ts` (`classifyRegistrationStage`).
- Phase 2 priority order inside the classifier: `dsm_bounds_missing` > `dsm_size_missing` > `dsm_decode_failed` > `candidate_*` > `coordinate_*`. Test fixtures must satisfy higher-priority gates to reach a lower-priority assertion.
- `insertFailedPreliminaryMeasurement` in `start-ai-measurement/index.ts` now selects `source_preflight` vs `candidate_final` based on DSM attempt detection — keep that behavior intact.
