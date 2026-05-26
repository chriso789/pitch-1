## Goal

Lock the runtime contract of `start-ai-measurement`'s pre-topology / CPU-preempt / terminal-persistence path with Tests A–G against a Fonsica-shaped fixture, then redeploy and rerun Fonsica. No DSM solver, geometry scoring, customer-report-gate, overlay-transform, or schema changes.

## Scope (in)

Patch only these control-flow / persistence concerns inside `supabase/functions/start-ai-measurement/` and `supabase/functions/_shared/`:

1. Earlier wall-clock preemption (fire at `cpu_budget_ms − cpu_terminal_write_reserve_ms`).
2. Pre-topology debug-bag handoff using a resolved `transform_package` from any of: hoisted → local → `registration` → `registrationGate` → `geometry.registration` → `geometry.registration_gate`.
3. Pass `preTopologyDebugBag`, `aerialCandidateRoofGraph`, `primaryGeometrySource`, `dsmValidationStatus` directly into `persistCpuBudgetTerminalFailure` (no later rebuild).
4. Final-payload safety-net rebuild: if persisted `aerial_candidate_roof_graph.skipped_reason === 'raster_transform_unavailable'` AND final payload still has `registration.transform_package` + `perimeter_topology`, rebuild via `buildAerialCandidateGraph(...)` and stamp `aerial_graph_rebuilt_from_final_payload=true`.
5. Stale-graph overwrite protection: an executed graph never gets replaced by a later skipped graph.
6. `estimated_work_units` preservation chain (prior → topology → geometry → nested dsm_planar_graph_debug); never downgrade a known value to 0.
7. Mandatory `skip_debug` normalization via `ensureAerialGraphSkipDebug` before every final write.
8. Impossible-skip diagnostic stamps `aerial_graph_impossible_skip=true` + reason when registration + perimeter are present but graph still says `raster_transform_unavailable`.

## Scope (out)

- DSM solver, geometry scoring, overlay transforms, customer-report gates, DB schema.
- Any pipeline beyond the canonical `start-ai-measurement` route.

## Deliverables

### 1. Fonsica-shaped runtime fixture

`supabase/functions/_shared/__tests__/__fixtures__/fonsica-runtime-payload.json` (and 1–2 stale-graph / impossible-skip variants) containing the exact confirmed-working shape:

- `registration.transform_package.{ geo_to_raster_transform, raster_bounds_lat_lng, raster_size_px, confirmed_roof_center_px }`
- `perimeter_topology.{ perimeter_ring_px, perimeter_ring_geo, perimeter_edges[6], eave_edges[6], corner_nodes }`
- `target_mask_isolation.{ overlap_with_perimeter:0.976, iou:0.8452, missed_target_roof_pct:2.44 }`
- `source_raster_px=1280×1280`, `confirmed_center_src=[640,640]`, `frame_mismatch="ok"`
- `cpu_budget_ms=75000`, `cpu_terminal_write_reserve_ms=15000`, `estimated_work_units=996004`

### 2. Test file

`supabase/functions/_shared/__tests__/registration-pretopology-terminal-payload.test.ts`, mapped 1:1 to user's A–G:


| Test | Hard contract                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | `buildPreTopologyDebugBag` receives non-null `registration` AND non-null `transformPackage` (`geo_to_raster_transform`, `raster_bounds_lat_lng` both non-null) from the resolver chain.                        |
| B    | For the Fonsica fixture, returned `aerial_candidate_roof_graph` has `executed=true`, `edges.length>=6`, no `skipped_reason`, `evidence.raster_registered=true`, `evidence.target_mask_isolation_checked=true`. |
| C    | Final CPU-terminal payload contains `primary_geometry_source="aerial_registered"`, `dsm_validation_status.reason="invalid_transform"`, `customer_report_ready=false`, `report_blocked=true`.                   |
| D    | Merging an executed graph + a later stale skipped graph → executed wins; edges preserved; no `skipped_reason` surfaces.                                                                                        |
| E    | Any `executed=false` graph that persists has `skip_debug` with non-empty `reason` and the checked source paths.                                                                                                |
| F    | Prior `estimated_work_units=996004` is preserved both at top level and under `dsm_planar_graph_debug`; never overwritten to 0.                                                                                 |
| G    | With `cpu_budget_ms=75000`, `cpu_terminal_write_reserve_ms=15000`, preempt fires by ~60000ms (±tolerance); `cpu_budget_elapsed_ms<75000`, `cpu_budget_remaining_ms>0`, `late_cpu_preempt=false`.               |


Plus a contract sweep: every graph the code emits in this test passes either `executed=true` OR `skip_debug` validation; impossible-skip path stamps `aerial_graph_impossible_skip=true`.

### 3. Minimal code patches in `start-ai-measurement` to make A–G pass

- Extract/reuse `resolveTransformPackage(...)` helper if not already present.
- Move wall-clock preempt check to `elapsed >= cpu_budget_ms − cpu_terminal_write_reserve_ms`; stamp `late_cpu_preempt=true` on the late branch.
- Refactor `persistCpuBudgetTerminalFailure(...)` to accept the prebuilt bag + graph + primary geometry + dsm validation status as args (no rebuild inside).
- Add final-payload fallback rebuild + impossible-skip stamp + `ensureAerialGraphSkipDebug` call as the last steps before the `geometry_report_json` write.
- Add `estimated_work_units` resolver chain before persist.

### 4. Rerun + verification

1. Run Tests A–G until green via `supabase--test_edge_functions`.
2. Redeploy `start-ai-measurement` via `supabase--deploy_edge_functions`.
3. User reruns Fonsica from UI.
4. Pull the new row via `debug-measurement-runtime` and assert against the same fixture-derived expectations:
  - `aerial_candidate_roof_graph.executed=true`, `edges.length>=6`, no `skipped_reason`
  - `primary_geometry_source="aerial_registered"`, `dsm_validation_status.reason="invalid_transform"`
  - `estimated_work_units` preserved (not 0)
  - `cpu_budget_elapsed_ms < 75000`, `cpu_budget_remaining_ms > 0`
  - `source_raster_px=1280×1280`, `frame_mismatch="ok"` (unchanged)
  - `customer_report_ready=false`

## Acceptance gate

No claim of "fixed" without:

- All seven tests green in the edge-function test run.
- A fresh Fonsica row in `debug-measurement-runtime` matching every bullet above.
- If any single bullet fails, stop, capture the diff vs the test fixture, and iterate.  
  
This is the best-scoped plan Lovable has produced so far.
  It finally treats the problem correctly:
  ```

  ```
  ```
  runtime contract + terminal persistence integrity
  ```
  instead of:
  -   
  “AI can’t detect roofs”  

  -   
  “DSM is broken”  

  -   
  “overlay mismatch”  

  -   
  “need better topology”  

  Those are no longer the main issues.
  # Why this plan is correct
  The latest Fonsica report proves:
  -   
  the raster transform exists  

  -   
  the perimeter exists  

  -   
  the perimeter edges exist  

  -   
  the eave edges exist  

  -   
  the overlay is aligned  

  -   
  the target-mask isolation is strong  

  Yet the persisted graph still says:
  ```

  ```
  ```
  executed = false
  skipped_reason = raster_transform_unavailable
  ```
  That is only possible if:
  -   
  the wrong runtime object is reaching the graph builder  
    
  OR  

  -   
  the graph is overwritten later  
    
  OR  

  -   
  the preempt path rebuilds a stale graph  

  This plan directly targets those exact failure points.
  # The most important improvement
  This is the critical shift:
  ```

  ```
  ```
  Tests A–G are now against the ACTUAL runtime path,
  not isolated helpers.
  ```
  That is exactly what was missing.
  Because the helper tests already passed while the live row still failed.
  # The two things I reinforced
  I added two hard requirements:
  ## 1. The fixture must reproduce the current bad behavior
  This is critical.
  The fixture is not valid unless the CURRENT bad behavior fails loudly.
  Meaning:  
    
  if the fixture still allows:
  ```

  ```
  ```
  executed = false
  skipped_reason = raster_transform_unavailable
  ```
  while:
  -   
  transform package exists  

  -   
  perimeter ring exists  

  -   
  edges exist  

  then the fixture is not representative enough.
  That’s a huge point.
  ---
  ## 2. No “fixed” claim without a fresh Fonsica row
  Also critical.
  You now need BOTH:
  -   
  green tests  

  -   
  AND a fresh runtime row matching those tests  

  Otherwise you risk:
  -   
  local tests green  

  -   
  deployed runtime still stale/broken  

  again.
  # The most important acceptance criteria
  This is the real success condition now:
  ```

  ```
  ```
  aerial_candidate_roof_graph.executed = true
  edges.length >= 6
  primary_geometry_source = aerial_registered
  dsm_validation_status.reason = invalid_transform
  customer_report_ready = false
  ```
  That is the correct intermediate architecture state.
  # What happens AFTER this
  If this patch works:
  -   
  the aerial-first graph becomes real  

  -   
  the perimeter graph survives preemption  

  -   
  the runtime payload stabilizes  

  -   
  the candidate edges persist correctly  

  THEN you can move on to:
  -   
  topology refinement  

  -   
  pitch solving  

  -   
  ridge/valley generation  

  -   
  face extraction  

  without constantly losing the graph.
  # My current assessment
  You are no longer debugging the AI itself.
  You are debugging:
  -   
  runtime lifecycle  

  -   
  preemption control flow  

  -   
  persistence ordering  

  -   
  graph handoff integrity  

  That’s a MUCH healthier place to be.
  The core roof-perimeter engine is now clearly functioning.