## Goal
Prove the Registration Gate v2.1 actually fires end-to-end on Fonsica, fix the residual bypass that lets `phase3_5.executed=true` survive a registration failure, and add a deployable runtime stamp so we can verify enforcement on every row.

## What's already in the repo (verified)

| Claim | File / Line | Status |
|---|---|---|
| `derivePhase3ResultState` | `supabase/functions/start-ai-measurement/index.ts:387` | ✅ present, registration overrides perimeter/topology |
| `withPhase3Visibility` | `supabase/functions/start-ai-measurement/index.ts:456` | ✅ present, derives `regFailureReason` |
| `blocked_by_registration_gate` skip stamp | `index.ts:486, 604, 3161` | ✅ written in 3 sites |
| `target_roof_not_confirmed → ai_failed_target_unconfirmed` | `_shared/registration-gate.ts:266`, `result-state.ts:45` + `index.ts:395` | ✅ |
| `coordinate_registration_failed → ai_failed_source_acquisition` | `index.ts:398-407` + `registration-gate.ts` | ✅ |
| Gate B hard-stop in handler | `index.ts:1134-1155` | ✅ |
| `REGISTRATION_GATE_VERSION = "registration-gate-v2.1"` | `_shared/registration-gate.ts:17` | ✅ |

So the module + override logic exists. The user's last Fonsica row predates the fix — the next rerun is what will prove it.

## Why the last Fonsica row was still `ai_failed_perimeter` (root cause we still need to close)

There is a real residual bypass in `withPhase3Visibility` (index.ts 482-510) and in the prepare-payload override (index.ts 600-606):

```text
if (regFailureReason) {
  for k in [phase3_5, phase3A_5, phase3C, phase3D, phase3E]:
    if payload[k] exists: payload[k] = {...blk, executed:false, skipped_reason:'blocked_by_registration_gate'}
}
return { ..., phase3_5: buildPhase3A5Block(payload), phase3C: buildPhase3CBlock(payload), ... }
```

Two problems:

1. The override only mutates blocks that **already exist** on the payload. If phase3A_5 ran partially and is present, it gets stamped; if it didn't run at all, `buildPhase3A5Block` returns its **stage-default** `skipped_reason: 'perimeter_refinement_callsite_not_reached'` — not `blocked_by_registration_gate`.
2. If the registration block isn't populated on the in-memory `debug` object at the failure-write callsite (e.g. `index.ts:8612` `withPhase3Visibility(debug, [], failureReason)`), `regFailureReason` is `null` and the visibility wrapper never knows registration was the cause. The pre-write `prepareRoofMeasurementPayload` then sees `_registration_gate_input` and tries to override the result_state, but by then `phase3_5.executed=true` is already baked into `geometry_report_json`.

Both are why the user's pasted row still showed `result_state=ai_failed_perimeter`, `phase3_5 executed=true`, `Perimeter Phase 0 ran`.

## Fix

### 1. Make registration override unconditional in `withPhase3Visibility`
After the builders run, if `regFailureReason` is truthy, force each phase block to:
```
{ ...block, executed: false, skipped_reason: 'blocked_by_registration_gate', skipped_by: 'registration_precedence_v1' }
```
Do the same in `prepareRoofMeasurementPayload` (index.ts 580-607) after the geometry mutations.

### 2. Add runtime stamp on every write
In both `withPhase3Visibility` and `prepareRoofMeasurementPayload`, write to `geometry_report_json`:
```jsonc
registration_precedence_version: "registration-precedence-v1",
registration_precedence_applied: boolean,         // true when override fired
registration_precedence_reason:                    // matches enum below or null
  "target_roof_not_confirmed"
  | "coordinate_registration_failed"
  | "candidate_does_not_contain_confirmed_roof_center"
  | null,
registration_gate_version: "registration-gate-v2.1"
```

### 3. Guarantee the registration block is populated on every failure-write path
Audit every `withPhase3Visibility(debug, …)` callsite. If `debug.registration` is missing but a `_registration_gate_input` (or equivalent acquisition context) is present, evaluate the gate inline so the wrapper sees the registration block. Specific sites: `index.ts:8612` and the early-failure return at ~866/901/911.

### 4. Surface stamps in `debug-measurement-runtime`
Add the three `registration_precedence_*` fields plus the registration block summary to the row shape returned by `supabase/functions/debug-measurement-runtime/index.ts`.

### 5. Surface stamps in `MeasurementReportDialog`
Show a new "Registration Precedence" row in the diagnostics card:
- version
- applied (yes/no)
- reason
And update the blocked-badge logic so when `registration_precedence_applied===true`, the badge text reads the precedence reason (e.g. `target_roof_not_confirmed`) instead of `perimeter_shape_not_accurate`.

### 6. Regression tests (per AI Measurement Regression Harness skill)
Add to `supabase/functions/start-ai-measurement/__tests__/`:
- `registration-precedence-target-unconfirmed.test.ts` — feeds a Fonsica-shaped payload with `user_confirmed_roof_target=false`, asserts:
  - `result_state === 'ai_failed_target_unconfirmed'`
  - `hard_fail_reason === 'target_roof_not_confirmed'`
  - `block_customer_report_reason === 'target_roof_not_confirmed'`
  - `failure_stage === 'registration'`
  - `phase3_5.executed === false` AND `skipped_reason === 'blocked_by_registration_gate'`
  - same for `phase3A_5`, `phase3C`, `phase3D`, `phase3E`
  - `registration_precedence_applied === true`
  - `registration_precedence_reason === 'target_roof_not_confirmed'`
- `registration-precedence-broken-frame.test.ts` — target confirmed but `geo_to_dsm_px_success=false`, asserts:
  - `result_state === 'ai_failed_source_acquisition'`
  - `hard_fail_reason === 'coordinate_registration_failed'`
  - phase blocks skipped with `blocked_by_registration_gate`
  - `registration_precedence_reason === 'coordinate_registration_failed'`

Run via `supabase--test_edge_functions` on `start-ai-measurement`.

### 7. Manual rerun proof
After deploy, the user reruns Fonsica twice:
- Without confirming PIN → expect Test #1 acceptance shape.
- With PIN but forced bad transform → expect Test #2 acceptance shape.
Verify via `debug-measurement-runtime?lead_id=<fonsica>` that:
- `registration_precedence_version === "registration-precedence-v1"`
- `registration_precedence_applied === true`
- `registration_precedence_reason` matches the scenario
- All five phase blocks carry `skipped_reason: blocked_by_registration_gate`

## Files to edit

- `supabase/functions/start-ai-measurement/index.ts` — fix override, stamp precedence, audit failure-write callsites
- `supabase/functions/debug-measurement-runtime/index.ts` — surface precedence fields
- `src/components/measurements/MeasurementReportDialog.tsx` (and any sibling diagnostics card) — surface precedence row, fix blocked-badge text
- `supabase/functions/start-ai-measurement/__tests__/registration-precedence-target-unconfirmed.test.ts` *(new)*
- `supabase/functions/start-ai-measurement/__tests__/registration-precedence-broken-frame.test.ts` *(new)*

## Out of scope (intentionally deferred until both Fonsica tests pass)

- Any further perimeter shape / Phase 3A.5 tuning
- Topology / backbone / repair changes
- Vendor benchmark gate work

## Acceptance

Plan is complete when:
1. A fresh Fonsica row without target confirmation persists `ai_failed_target_unconfirmed` + `blocked_by_registration_gate` on all 5 phase blocks + `registration_precedence_applied=true`.
2. A fresh Fonsica row with broken registration persists `ai_failed_source_acquisition` + `coordinate_registration_failed`.
3. Both new Deno tests pass under `supabase--test_edge_functions`.
4. `MeasurementReportDialog` blocked badge reads the precedence reason (not `perimeter_shape_not_accurate`) and shows the new precedence row.
