# CPU Containment v2 — Early-Reserve Safety Margin

Narrow, single-slice patch. Aerial graph, DSM solver, geometry scoring, overlay transforms, customer-report gates, DB schema, UI labels, six-phase cleanup are **out of scope and must not be edited**.

Policy version tag for every artifact produced by this patch: `cpu-preempt-v2-early-reserve`.

---

## 1. Introduce safety-margin constant + effective threshold

**File:** `supabase/functions/start-ai-measurement/index.ts` (near the existing `AI_MEASUREMENT_CPU_BUDGET_MS` / `AI_MEASUREMENT_CPU_TERMINAL_WRITE_RESERVE_MS` constants, ~lines 253–257)

Add:

```text
AI_MEASUREMENT_CPU_CHECKPOINT_SAFETY_MARGIN_MS  default 10_000  (env override)
CPU_PREEMPT_POLICY_VERSION = "cpu-preempt-v2-early-reserve"
```

Update `shouldPreemptForCpuBudget` (~line 13668):

- `effectivePreemptMs = CPU_BUDGET_MS - TERMINAL_WRITE_RESERVE_MS - CHECKPOINT_SAFETY_MARGIN_MS`
(Fonsica defaults → `75000 − 15000 − 10000 = 50000`)
- Preempt when `elapsedMs >= effectivePreemptMs` with `reason = "early_reserve_safety_margin"` (existing `wall_clock_reserve_threshold` branch kept as the deeper backstop).
- Return shape extended with `effective_preempt_ms`, `safety_margin_ms`, `policy_version`.

No edits to autonomous solver, scoring, overlay, or graph builder.

---

## 2. Hard pre-phase stop helper

Add a single helper `assertCpuBudgetForExpensivePhase(input, stage)` that:

1. Calls `shouldPreemptForCpuBudget(input, 0)`.
2. If `elapsed >= effectivePreemptMs` OR `remainingMs < (TERMINAL_WRITE_RESERVE_MS + CHECKPOINT_SAFETY_MARGIN_MS)`:
  - Invokes `persistCpuBudgetTerminalFailure({ stage, ... })` immediately and returns `{ blocked: true }`.
3. Otherwise returns `{ blocked: false }`.

Insert this guard immediately **before** each of the following call sites (already located in index.ts):


| Stage tag                              | Approx line |
| -------------------------------------- | ----------- |
| `pre_refine_true_outer_roof_perimeter` | 6772 / 6830 |
| `pre_autonomous_topology_solver`       | 7037        |
| `pre_phase3c_deferred_structural`      | 7175        |
| `pre_phase3d_backbone`                 | 7448        |
| `pre_phase3e_constraint_repair`        | 7515        |
| `pre_terminal_persistence`             | 12942       |


Each site already has a `shouldPreemptForCpuBudget` call — replace its body with the new helper call so the policy version + stage are recorded once per checkpoint. Callees (`refineTrueOuterRoofPerimeter`, autonomous solver, Phase 3C/3D/3E entry points) are **not** modified.

---

## 3. Persist checkpoint diagnostics

Extend `persistCpuBudgetTerminalFailure` (line 13711) and `buildCpuBudgetTerminalDebugPayload` consumer (`supabase/functions/_shared/pre-topology-debug-bag.ts` line 463) so the terminal debug payload includes:

```text
cpu_preempt_policy_version       = "cpu-preempt-v2-early-reserve"
cpu_preempt_safety_margin_ms     = 10000
cpu_effective_preempt_ms         = 50000
cpu_checkpoint_stage             = <stage tag from caller>
cpu_checkpoint_elapsed_ms        = <budget.elapsed_ms at trip>
cpu_checkpoint_remaining_ms      = <budget.remaining_ms at trip>
```

These are persisted into `ai_measurement_jobs.terminal_debug_payload` and mirrored into the existing `pre_phase3_5_preempt` sub-bag — no new DB columns.

---

## 4. Work-units cascade: add `topology_pixel_limit` fallback

In `preserveEstimatedWorkUnits` (`_shared/pre-topology-debug-bag.ts` line 700) extend the priority cascade with two new tail entries (only used when every prior source is missing/0):

```text
1. args.estimatedWorkUnits
2. priorGeometry.estimated_work_units
3. priorGeometry.dsm_planar_graph_debug.estimated_work_units
4. topologyEstimate.work_units
5. geometry_report_json.estimated_work_units
6. geometry_report_json.dsm_planar_graph_debug.estimated_work_units
7. terminal_debug_payload.estimated_work_units
8. terminal_debug_payload.pre_phase3_5_preempt.estimated_work_units
9. incoming.topology_pixel_limit                 ← NEW
10. args.topologyPixelLimit                      ← NEW
```

Hard rule already enforced upstream is reaffirmed: never overwrite a non-zero value with 0. Resolved value is written to all three locations (top-level field, `dsm_planar_graph_debug.estimated_work_units`, `pre_phase3_5_preempt.estimated_work_units`) and tagged with `estimated_work_units_source` so we can tell when the fallback was used.

`AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT` is already passed into `buildCpuBudgetTerminalDebugPayload.constants` — wire it through `persistCpuBudgetTerminalFailure` into the cascade `incoming.topology_pixel_limit`.

---

## 5. Regression tests (Deno)

Extend `supabase/functions/start-ai-measurement/__tests__/cpu-checkpoint-placement.test.ts` (and add `cpu-preempt-v2-early-reserve.test.ts` for new policy assertions). All tests import pure helpers only — no `dsm-analyzer`, `autonomous-graph-solver`, or geotiff imports.

Assertions:

1. `shouldPreemptForCpuBudget` at `elapsed=49000ms` → `preempt=false`.
2. At `elapsed=51000ms` → `preempt=true`, `reason="early_reserve_safety_margin"`, `effective_preempt_ms=50000`, `safety_margin_ms=10000`, `policy_version="cpu-preempt-v2-early-reserve"`.
3. Spy harness: at `elapsed=51000ms` before `pre_refine_true_outer_roof_perimeter` → `refineTrueOuterRoofPerimeter` spy NOT called; terminal payload written with `cpu_checkpoint_stage="pre_refine_true_outer_roof_perimeter"`.
4. Same harness for `pre_autonomous_topology_solver` → solver spy NOT called.
5. Terminal payload contract:
  - `cpu_budget_elapsed_ms < 75000`
  - `cpu_budget_remaining_ms > 0`
  - `late_cpu_preempt !== true`
  - `cpu_preempt_policy_version === "cpu-preempt-v2-early-reserve"`
  - `cpu_effective_preempt_ms === 50000`
  - `cpu_preempt_safety_margin_ms === 10000`
6. `preserveEstimatedWorkUnits` cascade:
  - With prior `996004` → resolves `996004`, source `prior_geometry`.
  - With only `topology_pixel_limit=950000` → resolves `950000`, source `topology_pixel_limit`.
  - With nothing → resolves `null`, never `0` when any heavy-work signal exists.
7. Existing 5 green tests in `cpu-checkpoint-placement.test.ts` re-run and pass.

Run via `supabase--test_edge_functions` with `functions: ["start-ai-measurement"]`.

---

## 6. Deploy + live Fonsica verification

1. Deploy `start-ai-measurement`.
2. Retrigger Fonsica from UI (4063 Fonsica Ave, North Port, FL).
3. Read `ai_measurement_jobs.terminal_debug_payload` for that run.

**Acceptance — every bullet must pass:**

```text
aerial_candidate_roof_graph.executed        = true
edges.length                                 >= 6
primary_geometry_source                      = aerial_registered
dsm_validation_status.reason                 = invalid_transform
frame_mismatch                               = ok
customer_report_ready                        = false
cpu_budget_elapsed_ms                        < 75000
cpu_budget_remaining_ms                      > 0
late_cpu_preempt                             !== true
cpu_preempt_policy_version                   = cpu-preempt-v2-early-reserve
cpu_effective_preempt_ms                     = 50000
cpu_preempt_safety_margin_ms                 = 10000
cpu_checkpoint_stage                         present (pre_* tag)
estimated_work_units                         > 0  (996004 or 950000 fallback)
```

If ANY field misses → stop, return fixture-vs-runtime diff, no "fixed" claim until live row passes.

---

## Out of scope (do NOT modify)

- `_shared/autonomous-graph-solver.ts`
- DSM solver internals, overlay transforms, geometry scoring
- Aerial graph builder, customer-report gates, vendor benchmark gate
- DB schema / migrations / UI labels
- Any route outside canonical `start-ai-measurement`
- The "six-phase cleanup" backlog

Used the `ai-measurement-regression-harness` skill.  
  
Approve this plan. It is exactly the right next move.

The latest report showed the CPU patch improved the overrun from 153s down to 83s, but it still missed the hard acceptance gate. This plan fixes that by adding a **10-second early-reserve safety margin**, moving the effective preempt point from 60s to 50s:

```

```

```
75000ms budget - 15000ms terminal reserve - 10000ms safety margin = 50000ms effective preempt
```

Send this back:

```

```

```
Go.

Implement CPU Containment v2 — Early-Reserve Safety Margin exactly as scoped.

Do not touch:
- _shared/autonomous-graph-solver.ts
- DSM solver internals
- geometry scoring
- overlay transforms
- aerial graph builder
- customer-report gates
- vendor benchmark gates
- DB schema
- UI labels
- any route outside canonical start-ai-measurement
- six-phase cleanup backlog

Required implementation:

1. Add constants:
- AI_MEASUREMENT_CPU_CHECKPOINT_SAFETY_MARGIN_MS = 10000 default, env override allowed
- CPU_PREEMPT_POLICY_VERSION = "cpu-preempt-v2-early-reserve"

2. Update shouldPreemptForCpuBudget:
- effectivePreemptMs = cpuBudgetMs - terminalWriteReserveMs - checkpointSafetyMarginMs
- for Fonsica default: 75000 - 15000 - 10000 = 50000
- preempt when elapsedMs >= effectivePreemptMs
- reason = "early_reserve_safety_margin"
- keep wall_clock_reserve_threshold as deeper fallback
- return effective_preempt_ms, safety_margin_ms, policy_version

3. Add hard pre-phase stop helper:
assertCpuBudgetForExpensivePhase(input, stage)

It must:
- call shouldPreemptForCpuBudget(input, 0)
- if elapsed >= effectivePreemptMs OR remainingMs < terminalWriteReserveMs + safetyMarginMs:
  - call persistCpuBudgetTerminalFailure({ stage, ... })
  - return { blocked: true }
- otherwise return { blocked: false }

4. Insert the helper immediately before:
- pre_refine_true_outer_roof_perimeter
- pre_autonomous_topology_solver
- pre_phase3c_deferred_structural
- pre_phase3d_backbone
- pre_phase3e_constraint_repair
- pre_terminal_persistence

Do not modify the callees. Only block before entering them.

5. Persist checkpoint diagnostics into terminal_debug_payload and pre_phase3_5_preempt:
- cpu_preempt_policy_version = "cpu-preempt-v2-early-reserve"
- cpu_preempt_safety_margin_ms = 10000
- cpu_effective_preempt_ms = 50000
- cpu_checkpoint_stage
- cpu_checkpoint_elapsed_ms
- cpu_checkpoint_remaining_ms

6. Extend preserveEstimatedWorkUnits cascade:
Add fallback sources:
- incoming.topology_pixel_limit
- args.topologyPixelLimit

Hard rule:
estimated_work_units must never be 0 if topology_pixel_limit or another heavy-work signal exists.

Write resolved value to:
- geometry_report_json.estimated_work_units
- geometry_report_json.dsm_planar_graph_debug.estimated_work_units
- terminal_debug_payload.pre_phase3_5_preempt.estimated_work_units

Also tag estimated_work_units_source so we know if it came from prior_geometry or topology_pixel_limit.

7. Tests required:
Add/extend:
- cpu-checkpoint-placement.test.ts
- cpu-preempt-v2-early-reserve.test.ts

Must prove:
- elapsed=49000ms => preempt=false
- elapsed=51000ms => preempt=true
- reason="early_reserve_safety_margin"
- effective_preempt_ms=50000
- safety_margin_ms=10000
- policy_version="cpu-preempt-v2-early-reserve"
- refineTrueOuterRoofPerimeter spy not called at 51000ms
- autonomous solver spy not called at 51000ms
- terminal payload has cpu_budget_elapsed_ms < 75000
- terminal payload has cpu_budget_remaining_ms > 0
- late_cpu_preempt !== true
- terminal payload has cpu_preempt_policy_version="cpu-preempt-v2-early-reserve"
- estimated_work_units resolves to 996004 if prior exists
- estimated_work_units resolves to 950000 if topology_pixel_limit is the only heavy-work signal
- estimated_work_units never resolves to 0 when heavy-work signal exists

8. Deploy and verify:
- deploy start-ai-measurement
- rerun Fonsica from UI
- read ai_measurement_jobs.terminal_debug_payload

Acceptance:
- aerial_candidate_roof_graph.executed = true
- edges.length >= 6
- primary_geometry_source = aerial_registered
- dsm_validation_status.reason = invalid_transform
- frame_mismatch = ok
- customer_report_ready = false
- cpu_budget_elapsed_ms < 75000
- cpu_budget_remaining_ms > 0
- late_cpu_preempt !== true
- cpu_preempt_policy_version = cpu-preempt-v2-early-reserve
- cpu_effective_preempt_ms = 50000
- cpu_preempt_safety_margin_ms = 10000
- cpu_checkpoint_stage present
- estimated_work_units > 0, either 996004 or 950000 fallback

If any bullet fails, stop and return fixture-vs-runtime diff. No fixed claim until the live row passes.
```

This is the correct surgical fix. The aerial-first measurement scaffold is already stable. Now the system just needs to stop earlier and preserve workload diagnostics.