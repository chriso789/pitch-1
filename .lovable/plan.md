# Fix: pre_phase3_5_preempt aerial graph handoff (Fonsica)

## Scope (strictly bounded)

Touch only:

- `supabase/functions/start-ai-measurement/index.ts` — preempt call sites + final persistence guard
- `supabase/functions/_shared/pre-topology-debug-bag.ts` — input fallback + skip_debug enforcement
- `supabase/functions/_shared/aerial-candidate-graph.ts` — skip_debug guarantee on every skipped return
- New tests under `supabase/functions/start-ai-measurement/__tests__/`

Do NOT touch: DSM solver, geometry scoring, overlay transforms, customer report gating, DB schema, canonical route.

## Root cause (confirmed from code + payload)

At lines 6766–6804 (pre_phase3_5_preempt) and 6810–6847 (phase3_5_perimeter_refinement), `buildPreTopologyDebugBag` is fed only the `hoisted*` variables. The Fonsica run logs `[AERIAL_GRAPH_HOIST_MISSING] site=pre_phase3_5_preempt — registration package is null`, so the bag is built with `transformPackage=null`, the aerial graph builder returns `executed:false, skipped_reason:"raster_transform_unavailable"`, and (because the null-input early return ran) `skip_debug` is omitted.

Meanwhile the same payload persists `registration.transform_package.geo_to_raster_transform`, `raster_bounds_lat_lng`, `perimeter_ring_px/geo`, and 6 eave/perimeter edges — proving a valid registration object exists in the run, it's just not the `hoisted*` reference being passed in.

## Patch plan

### 1. Resolve a single registration object at preempt sites

In `index.ts`, just above each `persistCpuBudgetTerminalFailure({...})` call at the two preempt sites (and the autonomous_topology_solver site at line 7297), build a local fallback resolver:

```
const resolvedRegPkg =
  hoistedTransformPackage ??
  (geometry as any)?.registration?.transform_package ??
  (geometry as any)?.registration_gate?.transform_package ??
  null;

const resolvedG2R =
  hoistedGeoToRasterTransform ??
  resolvedRegPkg?.geo_to_raster_transform ??
  (geometry as any)?.registration?.geo_to_raster_transform ?? null;

const resolvedBounds =
  hoistedRasterBoundsLatLng ??
  resolvedRegPkg?.raster_bounds_lat_lng ??
  (geometry as any)?.registration?.raster_bounds_lat_lng ?? null;

const resolvedCenterPx =
  hoistedConfirmedRoofCenterPx ??
  resolvedRegPkg?.confirmed_roof_center_px ??
  (geometry as any)?.registration?.confirmed_roof_center_px ?? null;
```

Pass these into `buildPreTopologyDebugBag` instead of the raw `hoisted*` vars. Keep the existing `console.warn` but only fire it when `resolvedRegPkg == null` (i.e., truly unavailable, not just unhoisted).

### 2. Defensive input fallback inside `buildPreTopologyDebugBag`

In `pre-topology-debug-bag.ts`, before constructing the aerial graph inputs, apply the same chained fallback (`registration ?? registration_gate ?? transformPackage`) so callers that pass the partial bag still resolve a usable transform package. This is belt-and-suspenders for sites we don't update directly.

### 3. Stale-skip overwrite guard (merge precedence)

The merge-precedence block (`pre-topology-debug-bag.ts:471–478`) already protects against an executed graph being clobbered. Extend it: when `_incomingGraph.executed === true`, also preserve its `edges`, `nodes`, `primary_geometry_source`, and drop any `skipped_reason`/`skip_debug` fields. Add an assertion: if the freshly built graph reports `executed:false` while inputs include both a transform package and a perimeter ring, log `[AERIAL_GRAPH_BUILDER_REGRESSION]` and prefer the prior executed graph if present.

### 4. Mandatory `skip_debug` on every skipped return

In `aerial-candidate-graph.ts`, the early-return at line ~366 (the null-input branch) does not attach `skip_debug`. Wrap every `executed:false` return through a helper `withSkipDebug(reason, ctx)` so no skipped graph can leak without `skip_debug`. Then in `index.ts`, immediately before the final `geometry_report_json` persistence, run:

```
function ensureAerialGraphSkipDebug(graph, ctx) {
  if (!graph || graph.executed === true) return graph;
  return { ...graph, skip_debug: graph.skip_debug ?? buildAerialGraphSkipDebugFromContext(ctx) };
}
```

### 5. Impossible-skip diagnostic (non-throwing in prod)

At the terminal persistence boundary in `persistCpuBudgetTerminalFailure` / `buildCpuBudgetTerminalDebugPayload`, compute:

```
const hasFonsicaAerialInputs =
  !!(resolvedG2R && resolvedBounds && perimeter_ring_px &&
     ((eave_edges?.length ?? 0) > 0 || (perimeter_edges?.length ?? 0) > 0));
```

If `hasFonsicaAerialInputs && aerial_candidate_roof_graph?.skipped_reason === 'raster_transform_unavailable'`, persist a diagnostic flag `aerial_graph_impossible_skip = true` on the debug payload (do not throw). Tests assert this flag is never true on Fonsica-shaped fixtures.

### 6. Preserve `estimated_work_units` through preempt

In `persistCpuBudgetTerminalFailure`, replace the current `estimatedWorkUnits: 0` write with:

```
estimated_work_units =
  args.estimatedWorkUnits ??
  priorEstimatedWorkUnits ??
  topologyEstimate?.work_units ??
  0
```

Source `priorEstimatedWorkUnits` from the existing row's `geometry_report_json.cpu_budget.estimated_work_units` if present (single SELECT before the UPDATE, already done for other fields).

### 7. Regression tests (skill: ai-measurement-regression-harness)

Add under `supabase/functions/start-ai-measurement/__tests__/`:

- `fonsica-pre-phase3_5-preempt-aerial-handoff.test.ts`
  - Fixture mirrors current Fonsica payload (registration exists, hoisted vars null).
  - Asserts: `aerial_candidate_roof_graph.executed === true`, `edges.length >= 6`, no `skipped_reason`, `primary_geometry_source === 'aerial_registered'`.
- `aerial-graph-skip-debug-mandatory.test.ts`
  - Every `executed:false` return carries `skip_debug` with non-empty `reason_inputs`.
- `aerial-graph-merge-precedence-stale-skip.test.ts`
  - Incoming executed graph cannot be overwritten by a freshly built skipped graph.
- `aerial-graph-impossible-skip-flag.test.ts`
  - Fonsica-shaped inputs + `raster_transform_unavailable` → `aerial_graph_impossible_skip === true`.
- `cpu-preempt-estimated-work-units-preserved.test.ts`
  - Preempt with prior `estimated_work_units = 996004` preserves the value (not 0).

Run via `supabase--test_edge_functions` (function: `start-ai-measurement`).

## Acceptance (next Fonsica rerun)

- `aerial_candidate_roof_graph.executed = true`
- `edges.length >= 6`, `skipped_reason` absent
- `primary_geometry_source = aerial_registered`
- `dsm_validation_status.reason = invalid_transform`
- `estimated_work_units` preserved (≈996004)
- Overlay alignment unchanged, `customer_report_ready = false`
- No DSM solver / geometry gate / customer report changes  
  
This plan is finally targeting the exact remaining failure correctly.
  The latest pull proves something important:
  # The aerial graph SHOULD already be executing
  Because the payload already has:
  - raster registration
  - perimeter ring
  - perimeter geo
  - eave edges
  - perimeter edges
  - target-mask isolation
  - aligned overlay
  - correct raster authority
  This is no longer a “missing geometry” problem.
  The system already has enough information to build the aerial candidate graph.
  ---
  # The actual bug
  The exact failure is now:
  ```

  ```
  ```
  pre_phase3_5_preempt
  ```
  That path is still feeding:
  -   
  stale registration  

  -   
  null transform package  

  -   
  null raster inputs  

  into:
  -   
  buildPreTopologyDebugBag()  

  -   
  buildAerialCandidateGraph()  

  That’s why you still get:
  ```

  ```
  ```
  executed = false
  skipped_reason = raster_transform_unavailable
  ```
  even though the SAME row contains all the required raster data.
  ---
  # The biggest clue
  This matters enormously:
  ```

  ```
  ```
  skip_debug is still missing
  ```
  That means:
  -   
  the wrong graph builder path is still active  
    
  OR  

  -   
  the final persisted graph bypasses the new helper  
    
  OR  

  -   
  stale graph overwrite still exists  

  That’s why the plan’s:
  -   
  skip_debug enforcement  

  -   
  final persistence normalization  

  -   
  merge-precedence guard  

  are all correct.
  ---
  # The 3 things I corrected in the plan
  I reinforced:
  ## 1. Use live locals BEFORE stale geometry object
  This matters.
  You do NOT want:
  ```

  ```
  ```
  geometry?.registration
  ```
  winning over:
  -   
  live `_transformPkg`  

  -   
  live registration package  

  -   
  live hoisted transform  

  The geometry object may already be stale.
  So:
  -   
  live locals first  

  -   
  persisted geometry last  

  Correct.
  ---
  ## 2. Force skip_debug at the FINAL write boundary
  This is critical because:  
    
  Lovable already “implemented” skip_debug.
  But the latest row still has none.
  Meaning:  
    
  the final write path still bypasses it.
  So now:
  -   
  normalize before final persistence  

  -   
  impossible to persist skipped graph without skip_debug  

  That is the right move.
  ---
  ## 3. Preserve estimated_work_units
  You previously had:
  ```

  ```
  ```
  estimated_work_units = 996004
  ```
  Now suddenly:
  ```

  ```
  ```
  estimated_work_units = 0
  ```
  That’s a regression caused by the preemption path.
  Your plan correction is right:
  -   
  preserve the earliest known estimate  

  -   
  do not wipe it during terminal persistence  

  ---
  # What SHOULD happen after this deploy
  The next Fonsica pull should finally show:
  ```

  ```
  ```
  aerial_candidate_roof_graph.executed = true
  ```
  with:
  -   
  perimeter ring  

  -   
  candidate edges  

  -   
  corner nodes  

  -   
  debug-only eaves  

  -   
  primary_geometry_source = aerial_registered  

  -   
  dsm_validation_status = invalid_transform  

  while still correctly showing:
  ```

  ```
  ```
  customer_report_ready = false
  ```
  That is the correct intermediate state.
  ---
  # My assessment now
  This is the closest the repo has ever been to a stable architecture.
  You now have:
  -   
  stable overlay registration  

  -   
  stable raster authority  

  -   
  stable perimeter extraction  

  -   
  stable mask isolation  

  -   
  stable CPU preemption  

  -   
  stable debug/reportable separation  

  The remaining issue is:
  -   
  stale preemption-path handoff  

  That is a very isolated engineering bug now.
  You are no longer fighting the core concept.