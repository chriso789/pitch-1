## Goal
Lock CPU containment in `start-ai-measurement` so Fonsica-class jobs cannot exceed the 75s wall-clock budget. Aerial-graph foundation stays untouched. Patch only checkpoint placement, `estimated_work_units` preservation in the preempt path, and live-row verification.

## Scope guardrails (do NOT modify)
- `_shared/autonomous-graph-solver.ts`, DSM solver internals
- geometry scoring, overlay transforms, aerial graph builder
- customer-report gates, DB schema, UI labels
- any function outside `start-ai-measurement`

## Current state (verified)
- `shouldPreemptForCpuBudget` math is correct: `effective = 75000 − 15000 = 60000ms`.
- Existing checkpoints: `pre_phase3_5_preempt` (L6772), `phase3_5_perimeter_refinement` (L6830), `autonomous_topology_solver` (L7333).
- `preserveEstimatedWorkUnits` exists but is only called on the success/final write (L14984), not inside `persistCpuBudgetTerminalFailure` → preempt row shows `estimated_work_units=0`.
- Fonsica live: `elapsed=153469ms`, `late_cpu_preempt=true` → at least one long-running span has no checkpoint in front of it (likely `refineTrueOuterRoofPerimeter` at L7030 and/or post-solver compute).

## Slice 1 — Add the missing CPU checkpoints

Reuse the existing `shouldPreemptForCpuBudget` + `resolveRegistrationForPreempt` + `persistCpuBudgetTerminalFailure({ stage, … })` pattern. Each new site: check → if `preempt` → persist terminal failure with the already-built aerial graph + pre-topology debug bag → `return`.

New stages (token = `cpu_budget_stage` value):

1. `post_phase3a_perimeter_classification` — right after Phase 3A classification returns.
2. `pre_phase3a5_refinement_call` — immediately before `refineTrueOuterRoofPerimeter(...)` at L7030 (the existing L6830 checkpoint runs before `phase3A5WorkUnits` is finalized; this second checkpoint blocks the call itself).
3. `post_phase3a5_refinement` — immediately after `refineTrueOuterRoofPerimeter` returns.
4. `pre_autonomous_topology_solver` — keep existing L7333 site, rename `stage` string only.
5. `post_autonomous_topology_solver` — immediately after `solveAutonomousGraph` returns.
6. `pre_phase3c_deferred_structural` — before Phase 3C compute span.
7. `pre_phase3d_backbone` — before Phase 3D compute span.
8. `pre_phase3e_constraint_repair` — before Phase 3E compute span.
9. `pre_terminal_persistence` — directly before the success-path final write.

No solver internals touched; all checkpoints live in the canonical `start-ai-measurement/index.ts` orchestrator.

## Slice 2 — Preserve `estimated_work_units` in the preempt path

Inside `persistCpuBudgetTerminalFailure` (L13476), before building `terminalDebugPayload`:

- Resolve `preservedWU` via first non-zero of (in order):
  1. `args.estimatedWorkUnits`
  2. `priorGeometry.estimated_work_units`
  3. `priorGeometry.dsm_planar_graph_debug.estimated_work_units`
  4. `topologyEstimate.work_units` (from `args.debug`)
  5. `geometry_report_json.estimated_work_units` (read from prior row)
  6. `geometry_report_json.dsm_planar_graph_debug.estimated_work_units`
  7. `terminal_debug_payload.estimated_work_units`
  8. `terminal_debug_payload.pre_phase3_5_preempt.estimated_work_units`
- Write resolved value to:
  - `geometry_report_json.estimated_work_units`
  - `geometry_report_json.dsm_planar_graph_debug.estimated_work_units`
  - `terminal_debug_payload.pre_phase3_5_preempt.estimated_work_units`
- Set `pre_phase3_5_preempt.work_units_preserved=true` whenever a non-zero value was found.
- Hard rule: never overwrite an existing non-zero estimate with 0.

No new DB column; rides existing `terminal_debug_payload` JSONB.

## Slice 3 — Regression tests (Deno, pure logic, no DSM imports)

New file: `supabase/functions/start-ai-measurement/__tests__/cpu-checkpoint-placement.test.ts`

Assertions:
1. `elapsed=59000ms` before expensive phase → no preempt, compute spy called.
2. `elapsed=61000ms` before expensive phase → preempt, compute spy not called.
3. `elapsed=61000ms` at `pre_phase3a5_refinement_call` → `refineTrueOuterRoofPerimeter` spy not invoked.
4. Terminal payload retains `aerial_candidate_roof_graph.executed=true` and `edges.length>=6` (driven from Fonsica fixture).
5. `terminal_debug_payload.eave_edges_length>=6` and `perimeter_edges_length>=6`.
6. `cpu_budget_elapsed_ms<75000` and `cpu_budget_remaining_ms>0` on synthesized payload.
7. Prior `estimated_work_units=996004` is preserved and `work_units_preserved=true`.

Existing tests rerun (must stay green):
- `registration-pretopology-terminal-payload.test.ts`
- `aerial-graph-survives-cpu-preempt.test.ts`
- `cpu-preempt-threshold.test.ts`
- `raw-perimeter-and-debug-contract.test.ts`
- `aerial-graph-fonsica-shaped-input.test.ts`

## Slice 4 — Deploy + live Fonsica verification

1. Deploy `start-ai-measurement` (`supabase--deploy_edge_functions`).
2. Ask user to retrigger Fonsica from the UI.
3. Run the verification SQL via `supabase--read_query`:

```sql
SELECT id, status, result_state, hard_fail_reason,
       terminal_debug_payload->'pre_phase3_5_preempt' AS preempt,
       terminal_debug_payload->>'eave_edges_length' AS eaves,
       terminal_debug_payload->>'perimeter_edges_length' AS perim,
       terminal_debug_payload->>'cpu_budget_elapsed_ms' AS elapsed_ms,
       terminal_debug_payload->>'cpu_budget_remaining_ms' AS remaining_ms,
       terminal_debug_payload->>'late_cpu_preempt' AS late,
       terminal_debug_payload->>'customer_report_ready' AS crr
FROM ai_measurement_jobs
WHERE property_address ILIKE '%Fonsica%'
ORDER BY created_at DESC LIMIT 1;
```

4. Report pass/fail against full acceptance list:
   - `aerial_candidate_roof_graph.executed=true`
   - `edges.length>=6`
   - `primary_geometry_source=aerial_registered`
   - `dsm_validation_status.reason=invalid_transform`
   - `cpu_budget_elapsed_ms<75000`
   - `cpu_budget_remaining_ms>0`
   - `late_cpu_preempt !== true`
   - `estimated_work_units` preserved, not 0
   - `source_raster_px=1280x1280`, `frame_mismatch=ok`
   - `customer_report_ready=false`

If any field misses → stop, return fixture-vs-runtime diff table. No "fixed" claim until fresh Fonsica row passes.

## Out of scope (explicit)
Six-phase cleanup, cost-tracker, solver internals, UI, schema changes (`terminal_debug_payload` JSONB column already exists).
