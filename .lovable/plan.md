
# Stop-the-Bleeding: Target Roof Registration Gate v2 enforcement

The wiring exists (`evaluateTargetConfirmation`, `evaluateRegistrationGate`, `evaluateCandidate`, `registration_gate` block, `debug-measurement-runtime` reads the fields) but there are three escape hatches that still let bad runs through:

1. **`useMeasurementJob.ts:171`** defaults `user_confirmed_roof_target: params.userConfirmedRoofTarget ?? true`. Any caller that doesn't pass the flag silently bypasses Gate A.
2. **PullMeasurementsButton** opens `StructureSelectionMap` but does not require the user to drop a confirmation PIN before invoking `startJob` — and even when it does, the truthy default above masks regressions.
3. **Candidate loop in `start-ai-measurement`** calls `evaluateCandidate` but still allows fallbacks (best-of remaining, mask-union fallback, hull rescue) to become the *selected* perimeter — so a wrong-house polygon can still surface in the editor.

This plan closes those three escape hatches and tightens diagnostics + UI + tests so the failure path is unambiguous.

## Scope (no business-logic rewrites beyond gating)

### 1. Frontend: never invoke the pipeline without an explicit confirmed target

- `src/hooks/useMeasurementJob.ts`
  - Change the default: `user_confirmed_roof_target` MUST be passed explicitly; if absent or falsy AND no `roof_target_admin_override`, throw before invoking — never send `?? true`.
  - Forward `confirmed_roof_lat`, `confirmed_roof_lng`, and `original_geocode_*` exactly as supplied.
- `src/components/measurements/PullMeasurementsButton.tsx`
  - The "Start AI Measurement" button stays disabled until `StructureSelectionMap` reports a placed confirmation PIN (or master uses the admin override toggle).
  - When the user proceeds, pass `userConfirmedRoofTarget: true` + the PIN coords. Otherwise it's not allowed to call `startJob`.
- `src/components/measurements/StructureSelectionMap.tsx`
  - Emit a single `onTargetConfirmed({ lat, lng })` callback only after the user explicitly places/accepts the pin. No auto-confirm on open.

### 2. Backend: tighten the three gates already in `start-ai-measurement`

- **Gate A (target confirmation)** — already present at ~L694. Add a hard assertion that if `user_confirmed_roof_target !== true` and `roof_target_admin_override !== true`, the function returns immediately with the diagnostic row already specified (no Solar fetch, no DSM fetch). Verify no code path after this block can re-enter source acquisition.
- **Gate B (registration)** — already at ~L1084 / L3092. Make both call sites share one helper `assertRegistrationGateOrFail(input, ctx)` in `_shared/registration-gate.ts` so the failure shape (result_state, hard_fail_reason, diagram_render_intent, phase3_5.skipped_reason, registration_gate block) is identical and can't drift. Remove any path that proceeds to perimeter refinement when `gateB.passed === false`.
- **Gate C (containment)** — at ~L1955 / L2046. Today rejected candidates are tracked but the loop can still select a fallback. Change the contract: if **no** candidate contains `confirmed_roof_center_px`, fail hard with `hard_fail_reason = candidate_does_not_contain_confirmed_roof_center` and `result_state = ai_failed_source_acquisition`. Forbidden fallbacks: `solar_segment_union`, `solar_segment_hull`, `mask_union`, `bbox_rescue`. Wrong-house polygons may only be persisted under `rejected_candidates[]`, never as `selected_perimeter`.
- All three failure paths must persist `_registration_gate_input` so `prepareRoofMeasurementPayload` writes a canonical `registration` snapshot (already wired at L7198 / L8816 — verify both call sites).

### 3. Result-state + render-intent contract

In `supabase/functions/_shared/result-state.ts`, confirm the mapping (already partly present):

| condition | result_state | hard_fail_reason | diagram_render_intent | phase3_5.skipped_reason |
|---|---|---|---|---|
| Gate A fail | `ai_failed_target_unconfirmed` | `target_roof_not_confirmed` | `target_confirmation_required` | `blocked_by_target_confirmation` |
| Gate B fail | `ai_failed_source_acquisition` | `coordinate_registration_failed` | `coordinate_registration_debug_only` | `blocked_by_registration_gate` |
| Gate C fail | `ai_failed_source_acquisition` | `candidate_does_not_contain_confirmed_roof_center` | `coordinate_registration_debug_only` | `blocked_by_registration_gate` |

`customer_report_ready` forced `false` and `block_customer_report_reason` set to the same `hard_fail_reason` in all three.

### 4. UI: report dialog + manual editor

- `MeasurementReportDialog.tsx`
  - Header banner reads from `hard_fail_reason` directly — never show "blocked: perimeter_shape_not_accurate" if `registration_gate.coordinate_registration_gate_passed !== true`.
  - When any gate fails: hide editable blue selected perimeter; show aerial with original geocode marker, confirmed-center marker (if any), static-map center marker, and rejected candidate polygons in red/orange.
  - Disable "Save edited perimeter", "Approve & rerun", "Approve only" buttons. Re-use `canApproveManualPerimeter()` which already requires all five registration flags — wire it to every approval button.
  - On Gate A fail: render the Confirm Roof Target CTA that opens `StructureSelectionMap`.
- `src/lib/measurement/registration-gate.ts`
  - Keep the historical-row fallback that already detects pre-v2 rows.

### 5. Debug endpoint

`supabase/functions/debug-measurement-runtime/index.ts` already returns most fields. Add to the selected columns / response:
- `registration_gate.version`
- `coordinate_registration_gate_passed`
- `phase3_5.executed`, `phase3_5.skipped_reason`
- `diagram_render_intent`
- `manual_approval_allowed` (derived via `canApproveManualPerimeter`)

POST contract unchanged: `{ address, limit }`.

### 6. Regression tests

Add under `supabase/functions/_shared/__tests__/registration-gate_test.ts` (extend existing file):

1. `evaluateTargetConfirmation` — missing flag ⇒ Gate A failure shape exact match.
2. `evaluateRegistrationGate` — `geo_to_dsm_px_success=false` ⇒ Gate B failure; `dsm_pixel_transform_valid=false` ⇒ Gate B failure; missing `dsm_to_raster_transform` ⇒ Gate B failure.
3. `evaluateCandidate` — polygon not containing confirmed center ⇒ rejected; no candidate containing center ⇒ Gate C hard fail.
4. `canApproveManualPerimeter` — returns false when any of the five flags missing; true only when all five present.
5. `normalizeResultStateForWrite` — the three `hard_fail_reason` values map to the correct buckets.

Add a Vitest snapshot under `src/components/measurements/__tests__/MeasurementReportDialog.registration-gate.test.tsx`:
- Gate A row ⇒ shows Confirm Target CTA, no editable perimeter, all approve buttons disabled.
- Gate B row ⇒ shows registration debug overlay, no editable perimeter, approvals disabled.
- Gate C row ⇒ shows rejected candidate in red, no selected perimeter, approvals disabled.

### 7. Acceptance (Fonsica West Coast rerun)

The plan is done when, on a fresh Fonsica run:

- If the user hasn't confirmed: `result_state=ai_failed_target_unconfirmed`, `hard_fail_reason=target_roof_not_confirmed`, no perimeter diagram, Phase 3A.5 `skipped_reason=blocked_by_target_confirmation`, debug endpoint shows all eleven fields, manual approval disabled.
- If transforms invalid: `result_state=ai_failed_source_acquisition`, `hard_fail_reason=coordinate_registration_failed`, no selected perimeter, registration debug overlay visible.
- If wrong candidate: `hard_fail_reason=candidate_does_not_contain_confirmed_roof_center`, candidate shown only under rejected.
- `perimeter_shape_not_accurate` can only appear when all three gates passed.

### Out of scope (later prompts)

- Perimeter shape gate tuning, topology fixes, roof_lines generation, vendor benchmark — none of these run until this gate is solid.

## Skills applied
- Roof Measurement Vision QA & Geometry Contract (gate ordering, customer-report contract)
- Canonical Route & Runtime Provenance Auditor (single canonical entrypoint, debug endpoint fields)
- Measurement Overlay UI & Visual QA (blocked-topology UI, rejected-candidate rendering, approval gating)
- AI Measurement Regression Harness (test list, Fonsica acceptance)
