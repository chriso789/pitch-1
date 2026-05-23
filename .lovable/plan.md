## Goal
Stop Fonsica/West Coast wrong-house overlays by making target registration a hard upstream gate. If the target is unconfirmed, the DSM/raster frame is invalid, or the selected candidate does not contain the confirmed roof center, the run must fail as source/target registration — not perimeter shape — and the UI must not allow manual approval.

## Rules this implements
- **Roof Measurement Vision QA & Geometry Contract**
  - Rule 3: true target/perimeter before topology.
  - Rule 11: customer report stays blocked on registration failure.
  - Required diagnostics: `route_provenance`, `phase3_5`, `phase3C`, `phase3D`, `phase3E` must be present or explicitly skipped.
- **Canonical Route & Runtime Provenance Auditor**
  - Canonical path remains:
    ```text
    PullMeasurementsButton -> useMeasurementJob.startJob -> start-ai-measurement -> autonomous graph solver -> MeasurementReportDialog/render PDF
    ```
  - Registration failures must still stamp canonical provenance.
- **Gate math to enforce**
  - Gate A: `!user_confirmed_roof_target && !roof_target_admin_override` OR missing confirmed roof center => `ai_failed_target_unconfirmed` / `target_roof_not_confirmed`, no source acquisition.
  - Gate B: `geo_to_dsm_px_success=false` OR `dsm_pixel_transform_valid=false` OR `dsm_to_raster_transform=null` OR confirmed center outside raster bounds => `ai_failed_source_acquisition` / `coordinate_registration_failed`, no candidate selection/perimeter refinement.
  - Gate C: candidate polygon must contain `confirmed_roof_center_px`; otherwise reject candidate with `candidate_does_not_contain_confirmed_roof_center`.

## Current audit findings

### Active route table
| Caller | Hook/API | Edge function | Writes | Solver/renderer | Status |
|---|---|---|---|---|---|
| `PullMeasurementsButton` | `useMeasurementJob.startJob` | `start-ai-measurement` | `measurement_jobs`, `ai_measurement_jobs`, `roof_measurements` | `_shared/autonomous-graph-solver.solveAutonomousGraph`, `MeasurementReportDialog` | Canonical, but registration failure rows are not being persisted early enough. |
| `MeasurementVisualQAOverlay` | `verify-perimeter-manually` | `verify-perimeter-manually` | `ai_measurement_jobs` | canonical rerun expected through `start-ai-measurement` | UI disables some buttons only when a readable `geometry_report_json.registration` exists; latest Fonsica rows have no registration block. |
| `MeasurementReportDialog` | report UI / PDF | `render-measurement-pdf` | reads `roof_measurements`; updates render fields | report renderer | Needs registration-aware diagnostic display; must not draw selected perimeter as valid on gate failure. |

### Legacy route table
| Route | Writes | Current risk |
|---|---|---|
| `analyze-roof-aerial` | `roof_measurements` | Has legacy provenance constants, but still capable of writing measurement rows. Must stay non-canonical. |
| `measure` | `roof_measurements` | Legacy measurement route used by older hooks. Must not be used for manual reruns or canonical report rows. |
| `measure-roof` | `roof_measurements` | Legacy/manual measurement path. |
| `generate-roof-overlay` | invokes `analyze-roof-aerial` | Legacy route path. |
| `save-manual-footprint`, `detect-building-footprint`, `useVertexEditing` | `roof_measurements` | Manual/edit paths; should not create customer-ready AI rows. |

### Canonical row proof from current DB
Recent Fonsica rows are canonical by route but missing registration diagnostics:
- Example: `fd8cce32-8f1d-4e64-a7ca-2d39ed9b0963`
- `created_by_function = start-ai-measurement`
- `canonical_measurement_route = true`
- `route_provenance` exists
- But `geometry_report_json.registration = null`
- `geometry_report_json.registration_gate = null`
- `result_state = ai_failed_perimeter`
- `hard_fail_reason = perimeter_shape_not_accurate`

### Missing provenance/diagnostic fields
- Current Fonsica rows have route provenance, but no registration block.
- Registration failure is being overwritten/misclassified as perimeter failure.
- Failed registration should persist:
  - `geometry_report_json.registration_gate`
  - `geometry_report_json.registration`
  - `result_state`
  - `hard_fail_reason`
  - `block_customer_report_reason`
  - `diagram_render_intent`
  - phase blocks with `executed:false`, `skipped_reason:'blocked_by_registration_gate'`

## Implementation plan

### 1. Add canonical registration-failure row publishing in `start-ai-measurement`
- Import and use `evaluateTargetConfirmation()` directly.
- After resolving tenant/source, create `measurement_jobs` and `ai_measurement_jobs` as canonical failed jobs when Gate A fails.
- Insert a diagnostic `roof_measurements` row with:
  - `result_state = ai_failed_target_unconfirmed`
  - `hard_fail_reason = target_roof_not_confirmed`
  - `block_customer_report_reason = target_roof_not_confirmed`
  - `customer_report_ready = false`
  - `diagram_render_intent = target_confirmation_required`
  - canonical route DB columns
  - `geometry_report_json.registration_gate` and `geometry_report_json.registration`
  - `phase3_5`, `phase3C`, `phase3D`, `phase3E` skipped with `blocked_by_registration_gate`
- Return `412` after the failed jobs/diagnostic row are persisted.

### 2. Add Gate B immediately after raster/DSM/Solar frame construction
- Build the registration input from actual frame diagnostics, not hardcoded `geo_to_dsm_px_success:true`.
- Evaluate `evaluateRegistrationGate()` immediately after raster/DSM/Solar frame values are known and before candidate selection/perimeter refinement.
- If Gate B fails:
  - Do not select/render a perimeter.
  - Do not run Phase 0 or Phase 3A.5.
  - Persist a diagnostic row as `ai_failed_source_acquisition` / `coordinate_registration_failed`.
  - Set `diagram_render_intent = coordinate_registration_debug_only`.
  - Mark Phase 3A.5/3C/3D/3E as skipped by registration gate.

### 3. Harden Gate C candidate ranking
- Keep the existing `evaluateCandidate()` loop, but ensure all required per-candidate fields are persisted for every candidate:
  - `confirmed_center_inside_candidate`
  - `candidate_centroid_offset_from_confirmed_center_px`
  - `nearest_neighbor_structure_distance_px`
  - `rejected`
  - `rejection_reason`
- If all candidates fail containment, persist `ai_failed_source_acquisition` / `candidate_does_not_contain_confirmed_roof_center` instead of falling back to mask contour or perimeter refinement.
- Never let a candidate marked rejected become `selected`.

### 4. Make the registration block authoritative in payload prep
- Update `prepareRoofMeasurementPayload()` so registration is persisted under both:
  - `geometry_report_json.registration`
  - `geometry_report_json.registration_gate`
- If registration failure exists, it must override any later perimeter-derived `result_state`, `hard_fail_reason`, `block_customer_report_reason`, and `diagram_render_intent`.

### 5. Fix the UI approval gate and wrong-house overlay display
- Update `src/lib/measurement/registration-gate.ts` to read both `registration` and `registration_gate`.
- Treat missing registration on an AI failed row as invalid; show the warning instead of silently omitting it.
- Update `MeasurementVisualQAOverlay`:
  - Disable Save edited perimeter, Approve & rerun, Approve only, and Reject when registration is invalid.
  - Show exact red warning: `Cannot approve perimeter: target roof registration failed.`
  - If registration fails, do not draw the selected perimeter as valid/editable.
  - Render registration debug only: geocode marker, confirmed center marker, static map center marker, rejected candidates, wrong-house candidate in red, target-confirmation warning.
- Update `MeasurementReportDialog` so it passes the canonical rerun handler to `MeasurementVisualQAOverlay` and displays registration-failure diagnostics instead of a customer-style preview.

### 6. Regression tests

#### Test file paths
- `supabase/functions/_shared/__tests__/registration-gate_test.ts` — extend existing pure tests.
- `supabase/functions/start-ai-measurement/__tests__/registration-enforcement-fonsica_test.ts` — new edge regression for pre-source and pre-perimeter blocking.
- `src/lib/measurement/__tests__/registration-gate.test.ts` — frontend mirror extraction and approval gating.
- `src/components/measurements/__tests__/MeasurementVisualQAOverlay.registration.test.tsx` — UI buttons disabled and warning visible.

#### Fixtures
- `supabase/functions/_shared/__fixtures__/fonsica-registration-failure.json`
  - Anonymized persisted Fonsica row shape using the observed failure: no target confirmation, invalid geo→DSM/raster frame, wrong-house candidate.
- `src/test/fixtures/fonsica-registration-failure.ts`
  - Frontend version of the same row for visual QA tests.

#### Assertions
- No `user_confirmed_roof_target` -> `ai_failed_target_unconfirmed`, `target_roof_not_confirmed`, no source acquisition status.
- `geo_to_dsm_px_success=false` -> `ai_failed_source_acquisition`, `coordinate_registration_failed`, no Phase 3A.5 execution.
- `dsm_pixel_transform_valid=false` -> same source-acquisition failure.
- Candidate outside `confirmed_roof_center_px` -> candidate `rejected=true`, `rejection_reason='candidate_does_not_contain_confirmed_roof_center'`.
- UI `canApproveManualPerimeter=false` disables Save / Approve & rerun / Approve only / Reject.
- Phase 3A.5 block exists with `executed=false`, `skipped_reason='blocked_by_registration_gate'` when registration fails.
- Fonsica acceptance thresholds remain: area ±2%, perimeter ±5%, facets within 25%, pitch ±1/12 — but these are not evaluated until registration passes.

#### Test commands I will run after implementation
- `supabase--test_edge_functions` for `start-ai-measurement` and shared registration tests.
- `bunx vitest run src/lib/measurement/__tests__/registration-gate.test.ts src/components/measurements/__tests__/MeasurementVisualQAOverlay.registration.test.tsx`

### 7. Fonsica / West Coast validation
After deployment, rerun the current Fonsica lead through the canonical path and verify:
- `selected perimeter` is not rendered over the neighboring house.
- Target confirmation is required when missing.
- `registration_gate` and `registration` blocks are populated.
- Manual approval buttons are disabled.
- `result_state` is `ai_failed_target_unconfirmed` or `ai_failed_source_acquisition`.
- Phase 3A.5 has `executed=false`, `skipped_reason='blocked_by_registration_gate'`.

## Database changes
No schema migration is planned unless the existing columns reject the diagnostic row payload. The fix is edge-function/control-flow and frontend gating.