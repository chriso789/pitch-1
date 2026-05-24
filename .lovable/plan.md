## Goal

Stop the registration block from ever showing `coordinate_registration_gate_passed = true` while required transform evidence is null. The post-hoc `registration_field_conflict` detector is doing the job the gate itself should have done. Ship Registration Gate **v2.3** so the gate fails directly, and make the persisted row honest about it.

---

## Root cause

In `supabase/functions/_shared/registration-gate.ts`, strict mode (which downgrades the booleans) is only activated when the caller passes `candidate_selection_started=true`. On the Fonsica run the final write went through with strict=false, so:

- `geo_to_dsm_px_success` and `dsm_pixel_transform_valid` stayed `true` even though `geo_to_dsm_transform` / `geo_to_raster_transform` / `confirmed_roof_center_px` were `null`.
- `confirmed_center_inside_candidate` defaulted to `true` (legacy "no candidate yet = pass").
- `missing_required_fields` came back `[]`.
- `coordinate_registration_gate_passed` was `true`, and only the conflict detector in `registration-precedence.ts` caught the contradiction after the fact.

The fix is to (1) introduce an explicit evaluation stage, (2) make the **final** stage always strict regardless of caller flag, (3) populate `missing_required_fields` even outside strict mode, and (4) stop persisting stale Phase 3A/perimeter payloads when registration blocks.

---

## Changes

### 1. `supabase/functions/_shared/registration-gate.ts` → v2.3

- Bump `REGISTRATION_GATE_VERSION` to `registration-gate-v2.3`.
- Add `evaluation_stage: "target_preflight" | "source_preflight" | "candidate_final"` to `RegistrationGateInput`. Default `"candidate_final"`.
- Treat `evaluation_stage === "candidate_final"` as implicitly strict (in addition to the existing `candidate_selection_started` trigger). Persist `registration.evaluation_stage`.
- In `candidate_final`, require ALL of:
  - `user_confirmed_roof_target` (or `roof_target_admin_override`)
  - `original_geocode_lat_lng`, `confirmed_roof_center_lat_lng`, `confirmed_roof_center_px`
  - `geo_to_raster_transform`, `geo_to_dsm_transform`, `dsm_to_raster_transform`
  - `raster_bounds_lat_lng`, `dsm_tile_bounds_lat_lng`
  - `raster_bounds_contain_confirmed_center === true`
  - `geo_to_dsm_px_success === true`, `dsm_pixel_transform_valid === true`
  - `selected_candidate_polygon_px` (≥3 pts)
  - `confirmed_center_inside_candidate === true`
  - `candidate_centroid_offset_from_confirmed_center_px <= candidate_centroid_offset_threshold_px`
- Any missing/false → push exact field name into `missing_required_fields` (no longer empty for final stage), set:
  - `coordinate_registration_gate_passed = false`
  - `failure = { reason: "coordinate_registration_failed", result_state: "ai_failed_source_acquisition", hard_fail_reason: "coordinate_registration_failed", block_customer_report_reason: "coordinate_registration_failed" }`
- Hard rule: if `confirmed_roof_center_px` is null, force `confirmed_center_inside_candidate = false` (no defaulting to true).
- Preflight stages may only set `target_preflight_passed` / `source_preflight_passed`. They must NOT set `coordinate_registration_gate_passed = true`; leave it `null` (or `false`).

### 2. `supabase/functions/_shared/registration-precedence.ts`

- Bump `REGISTRATION_PRECEDENCE_VERSION` to `registration-precedence-v3`.
- Map new reason ordering: prefer `coordinate_registration_failed` over `registration_field_conflict` when the gate already failed honestly. Keep `registration_field_conflict` as a safety net for any historic contradictory rows.
- Extend `detectRegistrationFieldConflicts` to flag when `evaluation_stage !== "candidate_final"` but the row is being written as a final measurement.

### 3. `supabase/functions/start-ai-measurement/index.ts`

- Pass `evaluation_stage: "candidate_final"` (and `candidate_selection_started: true`) on the final pre-write gate call.
- Use `evaluation_stage: "target_preflight"` for the early target-confirm check and `"source_preflight"` for the source-acquisition pre-check, so preflights stay permissive but can never produce a final-pass row.
- When `registration_precedence_applied === true` for the write payload:
  - Move any existing `geometry_report_json.phase3A`, `phase3A_5`, `perimeter_topology`, `perimeter_phase0`, `refinement_diagnostics`, `dsm_planar_graph_debug.phase3A_5`, `roof_lines` into `geometry_report_json.stale_debug_payload`.
  - Zero out top-level perimeter totals: `roof_lines_count = 0`, `footprint_source = "blocked_by_registration_gate"`, `perimeter_topology = null`, `perimeter_phase0 = null`, `refinement_diagnostics = null`.
  - Ensure `phase3_5.executed = false` with `skipped_reason = "blocked_by_registration_gate"`.

### 4. `supabase/functions/debug-measurement-runtime/index.ts`

- Bump `ROUTE_AUDIT_RESPONSE_VERSION` to `debug-measurement-runtime-v4-registration-v2.3`.
- Surface `evaluation_stage`, full `missing_required_fields`, and a `stale_debug_payload_present` flag.

### 5. UI — `src/components/measurements/MeasurementReportDialog.tsx` and `src/lib/measurement/registration-gate.ts`

- Extend frontend `RegistrationBlock` with `evaluation_stage`, `missing_required_fields`, and the `required_transform_evidence` sub-object.
- When `registration_precedence_applied === true` OR `coordinate_registration_gate_passed === false`:
  - Display **Failure Reason** = `coordinate_registration_failed` (fall back to `registration_field_conflict` only when no gate-level reason exists).
  - Show **Registration Gate: failed** and the literal `missing_required_fields` list.
  - Hide stale eave / rake / perimeter / refinement / Phase 3A totals (read only from active fields, not `stale_debug_payload`).
  - Keep manual approval disabled.
  - Do not render any selected perimeter on the editable overlay.

### 6. Regression tests

Add `supabase/functions/start-ai-measurement/__tests__/registration-v2-3-strict.test.ts`:

- **Test A — final stage, transforms null:** asserts `coordinate_registration_gate_passed=false`, `missing_required_fields` includes `confirmed_roof_center_px` / `geo_to_dsm_transform` / `geo_to_raster_transform`, `result_state=ai_failed_source_acquisition`, `hard_fail_reason=coordinate_registration_failed`, `phase3_5.skipped_reason=blocked_by_registration_gate`, no `perimeter_topology` on the written row.
- **Test B — preflight stage:** with transforms missing, gate may return preflight pass but `coordinate_registration_gate_passed` must NOT be `true`; final write rejected unless promoted to `candidate_final`.
- **Test C — contradictory legacy input:** caller forces `coordinate_registration_gate_passed=true` with a null required field → write path normalizes to `false`, emits `registration_field_conflict`, persists `diagram_render_intent=registration_blocked`.
- **Test D — stale payload quarantine:** input contains a prior `phase3A` block; after registration block, written row has `stale_debug_payload.phase3A` set and top-level `phase3A=null` / `roof_lines_count=0`.

Run via `supabase--test_edge_functions` on `start-ai-measurement`.

### 7. Verify

After deploy, request a Fonsica rerun and confirm the new row shows:

- `registration.version = registration-gate-v2.3`
- `registration.evaluation_stage = candidate_final`
- `coordinate_registration_gate_passed = false`
- `missing_required_fields` lists the null transforms + `confirmed_roof_center_px`
- `result_state = ai_failed_source_acquisition`
- `hard_fail_reason = coordinate_registration_failed`
- `phase3_5 / 3C / 3D / 3E` all `skipped: blocked_by_registration_gate`
- No active perimeter/eave/rake/refinement payload; stale data only under `stale_debug_payload`
- UI: Failure Reason = `coordinate_registration_failed`, Registration Gate = failed, manual approval disabled, no overlay perimeter

### Out of scope

No changes to perimeter, topology, vendor benchmark, or PDF rendering logic. No DB migration — the existing `diagram_render_intent` whitelist already covers `registration_blocked`, and `result_state=ai_failed_source_acquisition` is already in the 10-bucket enum.

Skills applied: Canonical Route & Runtime Provenance Auditor, Supabase Schema & DB Drift Guard, Measurement Overlay UI & Visual QA, AI Measurement Regression Harness.