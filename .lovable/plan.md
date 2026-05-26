## Scope (locked)

Only CPU containment in `supabase/functions/start-ai-measurement/index.ts`. No touches to aerial graph builder, DSM solver, geometry scoring, overlay transforms, customer-report gates, DB schema, UI labels, or six-phase cleanup.

## Slice 1 — Test isolation

Rewrite `__tests__/cpu-checkpoint-placement.test.ts` so it imports ONLY pure helpers and never pulls `dsm-analyzer` / `geotiff` / `autonomous-graph-solver` through the import graph:

- `shouldPreemptForCpuBudget`
- `buildCpuBudgetTerminalDebugPayload` (+ payload helpers)
- `preserveEstimatedWorkUnits`
- pre-topology debug bag helpers
- Fonsica fixture JSON

If any of these currently live in a module that transitively imports DSM/geotiff, extract them into a leaf file under `start-ai-measurement/_cpu/` (pure logic, no side-effect imports) and re-export from `index.ts`. No behavior change.

## Slice 2 — Checkpoint placement

Effective threshold = `cpuBudgetMs - cpuTerminalWriteReserveMs` = `75000 - 15000 = 60000ms`.

Verify or add the `shouldPreemptForCpuBudget` → `persistCpuBudgetTerminalFailure(stage, …)` → `return` pattern at every site:

1. `post_phase3a_perimeter_classification`
2. `pre_phase3a5_refinement_call` (blocks the `refineTrueOuterRoofPerimeter` call)
3. `post_phase3a5_refinement`
4. `pre_autonomous_topology_solver` (rename existing L7333 stage string)
5. `post_autonomous_topology_solver`
6. `pre_phase3c_deferred_structural`
7. `pre_phase3d_backbone`
8. `pre_phase3e_constraint_repair`
9. `pre_terminal_persistence`

Each preempt write must carry the already-built aerial graph + pre-topology debug bag (no recomputation).

## Slice 3 — `estimated_work_units` preservation

Inside `persistCpuBudgetTerminalFailure`, resolve `preservedWU` as first non-zero of:

1. `args.estimatedWorkUnits`
2. `priorGeometry.estimated_work_units`
3. `priorGeometry.dsm_planar_graph_debug.estimated_work_units`
4. `topologyEstimate.work_units`
5. `geometry_report_json.estimated_work_units`
6. `geometry_report_json.dsm_planar_graph_debug.estimated_work_units`
7. `terminal_debug_payload.estimated_work_units`
8. `terminal_debug_payload.pre_phase3_5_preempt.estimated_work_units`

Write `preservedWU` to:

- `geometry_report_json.estimated_work_units`
- `geometry_report_json.dsm_planar_graph_debug.estimated_work_units`
- `terminal_debug_payload.pre_phase3_5_preempt.estimated_work_units`

Set `pre_phase3_5_preempt.work_units_preserved = true` when a non-zero source was found. Hard rule: never overwrite non-zero with 0.

## Slice 4 — Tests (must pass before deploy)

`__tests__/cpu-checkpoint-placement.test.ts` assertions:

- elapsed=59000ms → expensive-phase spy called once.
- elapsed=61000ms → expensive-phase spy NOT called, terminal write occurred.
- elapsed=61000ms at `pre_phase3a5_refinement_call` → `refineTrueOuterRoofPerimeter` spy not invoked.
- elapsed=61000ms at `pre_autonomous_topology_solver` → solver spy not invoked.
- Terminal payload: `aerial_candidate_roof_graph.executed === true`, `edges.length >= 6`, `eave_edges_length >= 6`, `perimeter_edges_length >= 6`.
- `cpu_budget_elapsed_ms < 75000`, `cpu_budget_remaining_ms > 0`, `late_cpu_preempt !== true`.
- Prior `estimated_work_units=996004` survives across all 3 persisted locations; `work_units_preserved=true`.

Rerun existing green tests: `registration-pretopology-terminal-payload`, `aerial-graph-survives-cpu-preempt`, `cpu-preempt-threshold`, `raw-perimeter-and-debug-contract`, `aerial-graph-fonsica-shaped-input`.

## Slice 5 — Deploy + live Fonsica verification

1. `supabase--deploy_edge_functions(["start-ai-measurement"])`.
2. Ask user to retrigger Fonsica from the UI.
3. Run the exact verification SQL provided in the request against `ai_measurement_jobs.terminal_debug_payload`.
4. Compare against full 10-bullet acceptance list:
  - aerial graph `executed=true`, `edges.length>=6`
  - `primary_geometry_source=aerial_registered`
  - `dsm_validation_status.reason=invalid_transform`
  - `cpu_budget_elapsed_ms<75000`, `cpu_budget_remaining_ms>0`, `late_cpu_preempt!==true`
  - `estimated_work_units` preserved, non-zero
  - `source_raster_px=1280x1280`, `frame_mismatch=ok`
  - `customer_report_ready=false`

If ANY bullet fails → stop and return a fixture-vs-runtime diff table. No "fixed" claim until the live row passes.

## Out of scope (explicit)

Aerial graph builder, DSM solver internals, geometry scoring, overlay transforms, customer-report gates, DB schema (`terminal_debug_payload` JSONB already exists), UI labels, six-phase cleanup, cost-tracker P2+.  
  
This is the correct next slice. The scope is finally disciplined.

The important thing now is that the plan explicitly locks:

- aerial graph builder
- DSM solver
- geometry scoring
- overlay transforms
- customer report gates

out of scope.

That’s correct, because the latest Fonsica run already proved the aerial-first/EagleView-style scaffold is working in production:

```

```

```
aerial_candidate_roof_graph.executed = true
edges.length = 12
primary_geometry_source = aerial_registered
dsm_validation_status.reason = invalid_transform
frame_mismatch = ok
customer_report_ready = false
```

The remaining issue is purely:

```

```

```
runtime containment / checkpoint placement
```

The CPU path is still running too long before it checks the budget:

```

```

```
cpu_budget_elapsed_ms = 153469
cpu_budget_ms = 75000
cpu_budget_remaining_ms = -78469
late_cpu_preempt = true
```

That’s not a geometry failure anymore.

The plan is also correct to isolate the tests away from:

- `geotiff`  

- `dsm-analyzer`  

- `_shared/autonomous-graph-solver`  


because those imports are unrelated to CPU containment and are masking the regression tests.

The most important acceptance criteria now are:

```

```

```
cpu_budget_elapsed_ms < 75000
cpu_budget_remaining_ms > 0
late_cpu_preempt !== true
estimated_work_units preserved and non-zero
```

while keeping the already-green aerial graph intact.

That’s the right target.