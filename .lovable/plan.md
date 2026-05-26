## Narrow slice: fix `pre_phase3_5_preempt` terminal-payload contract

Scope is intentionally limited. Six-phase cleanup stays paused until this lands and a fresh Fonsica row confirms the acceptance criteria.

### Files touched (only these)
- `supabase/functions/start-ai-measurement/index.ts`
- `supabase/functions/_shared/pre-topology-debug-bag.ts`
- `supabase/functions/_shared/aerial-candidate-graph.ts`
- `supabase/functions/start-ai-measurement/__tests__/registration-pretopology-terminal-payload.test.ts` (new)
- `supabase/functions/_shared/__fixtures__/fonsica-pretopology-payload.json` (new)

Explicitly NOT touched: DSM solver, geometry scoring, overlay transforms, customer-report gates, DB schema, UI labels, any broader phase cleanup.

---

### Change 1 — Preempt before CPU budget exhaustion

In `start-ai-measurement/index.ts`, in the `pre_phase3_5_preempt` evaluator:

- Read `cpu_budget_ms` and `cpu_terminal_write_reserve_ms` (default 15000) from config.
- Trigger preempt when `elapsed_ms >= (cpu_budget_ms - cpu_terminal_write_reserve_ms)` — i.e. ~60000ms for the 75000/15000 config — instead of after budget is already negative.
- Evaluate the gate at each phase boundary AND on the wall-clock tick already in place (whichever is sooner).
- If preempt nevertheless fires after `elapsed_ms >= cpu_budget_ms`, persist `late_cpu_preempt = true` on `geometry_report_json` so we can detect regressions.

Acceptance: `cpu_budget_elapsed_ms < 75000` and `cpu_budget_remaining_ms > 0` at preempt time.

---

### Change 2 — Resolve transform package from live locals, then fallbacks

In `pre-topology-debug-bag.ts`, replace the current resolver with explicit precedence:

```ts
const resolvedRegPkg =
  hoistedTransformPackage ??
  _transformPkg ??
  registration?.transform_package ??
  registrationGate?.transform_package ??
  geometry?.registration?.transform_package ??
  geometry?.registration_gate?.transform_package ??
  null;
```

Derive `geo_to_raster_transform`, `raster_bounds_lat_lng`, `confirmed_roof_center_px`, `raster_size_px` from `resolvedRegPkg` (with the same fallback chain through `geometry.registration.*`).

`buildPreTopologyDebugBag()` returns a bag containing:
- `resolvedRegPkg` and the four derived fields above
- `perimeterTopology`, `debugLayers`, `dsmPlanarGraphDebug`, `debugRoofLines`, `targetMaskIsolation`

Caller in `index.ts` builds the bag at the preempt site and passes it directly into `persistCpuBudgetTerminalFailure(...)`. No second rebuild from null/stale vars downstream.

---

### Change 3 — Final-payload fallback rebuild

In `aerial-candidate-graph.ts`, export `buildAerialCandidateGraph({ registration, perimeterTopology, targetMaskIsolation, debugLayers, debugRoofLines })` (extract from existing logic if needed; do not change its scoring).

In `index.ts`, immediately before the final `geometry_report_json` write, add a guarded rebuild:

```ts
const g = geometry_report_json;
const acg = g.aerial_candidate_roof_graph;
if (
  acg?.skipped_reason === 'raster_transform_unavailable' &&
  g.registration?.transform_package?.geo_to_raster_transform &&
  g.registration?.transform_package?.raster_bounds_lat_lng &&
  g.perimeter_topology?.perimeter_ring_px &&
  (g.perimeter_topology?.eave_edges?.length || g.perimeter_topology?.perimeter_edges?.length)
) {
  g.aerial_candidate_roof_graph = {
    ...buildAerialCandidateGraph({
      registration: g.registration,
      perimeterTopology: g.perimeter_topology,
      targetMaskIsolation: g.target_mask_isolation,
      debugLayers: g.debug_layers,
      debugRoofLines: g.debug_roof_lines,
    }),
    aerial_graph_rebuilt_from_final_payload: true,
  };
}
```

---

### Change 4 — Skip diagnostics are mandatory

Wrap the persistence of `aerial_candidate_roof_graph` so any `executed=false` row MUST carry `skip_debug` (which inputs were missing, which fallbacks were attempted). If `skip_debug` is absent at write time, synthesize it from the resolver state.

After Change 3 runs, if the graph is STILL `skipped_reason === 'raster_transform_unavailable'` while the final payload contains both `registration.transform_package` and `perimeter_topology`, persist:

- `aerial_graph_impossible_skip = true`
- `aerial_graph_impossible_skip_reason = 'final_payload_has_registration_and_perimeter_topology'`

---

### Change 5 — Preserve `estimated_work_units`

Add a small `preserveEstimatedWorkUnits()` helper used at terminal write. Source precedence (first non-zero, non-null wins):

1. `estimatedWorkUnits` (local)
2. `priorGeometry.estimated_work_units`
3. `priorGeometry.dsm_planar_graph_debug.estimated_work_units`
4. `topologyEstimate.work_units`
5. `geometry_report_json.estimated_work_units`
6. `geometry_report_json.dsm_planar_graph_debug.estimated_work_units`

Write the resolved value to both:
- `geometry_report_json.estimated_work_units`
- `geometry_report_json.dsm_planar_graph_debug.estimated_work_units`

Never overwrite a known value with `0` or `null`.

---

### Change 6 — Targeted tests

New file: `supabase/functions/start-ai-measurement/__tests__/registration-pretopology-terminal-payload.test.ts`
New fixture: `supabase/functions/_shared/__fixtures__/fonsica-pretopology-payload.json` (anonymized snapshot of the current Fonsica row — registration.transform_package, perimeter_topology with 6 eave/perimeter edges, debug_layers, target_mask_isolation, estimated_work_units=996004).

Assertions:

| ID | Assertion |
|----|-----------|
| A | Fixture → `aerial_candidate_roof_graph.executed === true` |
| B | `aerial_candidate_roof_graph.edges.length >= 6` |
| C | `primary_geometry_source === 'aerial_registered'` |
| D | `dsm_validation_status.reason === 'invalid_transform'` |
| E | Simulated slow run preempts with `cpu_budget_elapsed_ms < cpu_budget_ms` and `cpu_budget_remaining_ms > 0` |
| F | `estimated_work_units` stays `996004` (not 0) through terminal write |
| G | Any synthesized `executed=false` graph carries `skip_debug` |
| H | Payload with registration + perimeter_topology but `raster_transform_unavailable` → `aerial_graph_impossible_skip === true` with the documented reason |

Run via `supabase--test_edge_functions` on `start-ai-measurement`.

---

### Acceptance on a fresh Fonsica run

- `aerial_candidate_roof_graph.executed === true`
- `edges.length >= 6`
- `skipped_reason` absent / null
- `primary_geometry_source === 'aerial_registered'`
- `dsm_validation_status.reason === 'invalid_transform'`
- `estimated_work_units` preserved (not 0)
- `cpu_budget_elapsed_ms < 75000`, `cpu_budget_remaining_ms > 0`
- overlay alignment unchanged
- `customer_report_ready === false` (this slice does not flip the gate)

Only after these are confirmed on a fresh row do we revisit the six-phase plan.