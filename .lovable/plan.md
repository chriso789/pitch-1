# Wire Phase 3A.5 → 3E into the live AI Measurement pipeline

The four modules (`perimeter-refinement.ts`, `backbone-seed.ts`, `deferred-structural-edges.ts`, `constraint-solver-repair.ts`) currently exist but are not imported anywhere. This plan wires each one into the right call site so the next AI Measurement run actually executes them.

## Integration points

### 1. Phase 3A.5 — Perimeter Refinement
**File:** `supabase/functions/start-ai-measurement/index.ts`
- After Phase 3A eave/rake classification succeeds, call `refineTrueOuterRoofPerimeter(...)` with the current Layer-1 perimeter, DSM tile, RGB tile, and solar mask.
- Persist `refined_perimeter_geo`, `refined_perimeter_px`, `refinement_iou`, `perimeter_to_target_mask_ratio`, `vertices_snapped_count`, and `refinement_diagnostics` onto the job/measurement row.
- **Hard gate**: if `iou < 0.88` OR `ratio > 1.10`, set `result_state = ai_failed_perimeter_refinement` (routed via `normalizeResultStateForWrite`) and skip topology.
- If gate passes, replace the perimeter handed to topology with the refined one.

### 2. Phase 3C — Deferred Structural Edges
**File:** `supabase/functions/_shared/autonomous-graph-solver.ts`
- In the connectivity-pruning step (where isolated DSM ridge/valley fragments are currently dropped), call `deferStructuralEdge(edge, reason)` from `deferred-structural-edges.ts` instead of deleting.
- Surface the deferred set on the solver result (`deferred_structural_candidates`).
- Pass the deferred set forward to the backbone seeder and the repair pass.

### 3. Phase 3D — Backbone Seeding & Locking
**File:** `supabase/functions/_shared/backbone-network.ts` (this is the renamed/active backbone module)
- Before face extraction, call `buildLockedBackboneSeed({ dsmRidges, dsmValleys, deferredEdges, perimeterPx })` from `backbone-seed.ts`.
- Insert returned chains into the planar graph with `locked: true` so downstream merge/prune passes cannot remove them.
- Persist `locked_backbone_edges_count`, `seed_chain_count`, and per-chain confidence on the diagnostics blob.

### 4. Phase 3E — Constraint Solver Repair
**File:** `supabase/functions/_shared/constraint-roof-solver.ts`
- After candidate scoring, if the chosen candidate has `ridge_lf === 0` AND high-confidence seed chains exist, call `attemptRepairPass({ candidate, seedChains, solarPriors })` from `constraint-solver-repair.ts`.
- If repair improves the constraint score, replace the candidate. Otherwise keep original and stamp `repair_attempted=true, repair_accepted=false`.

### 5. Result-state mapping
**File:** `supabase/functions/_shared/result-state.ts`
- Extend `normalizeResultStateForWrite` mapping so:
  - `perimeter_refinement_failed` / `iou_below_gate` / `ratio_above_gate` → `ai_failed_perimeter_refinement` (or fold into existing `ai_failed_perimeter` if a new bucket isn't desired — confirm bucket choice during implementation).
  - `backbone_not_applied` / `seed_chain_unlocked` → `ai_failed_topology`.
  - `repair_required_but_unavailable` → `ai_failed_topology`.

## Verification

- Re-deploy `start-ai-measurement` (auto on save).
- Trigger AI Measurement on the Fonsica lead (`/lead/0a38230e-57ad-4f22-9caa-ac7707a6962f`).
- Confirm the measurement diagnostics now include:
  - `phase3_5_perimeter_refinement_enabled: true`
  - `refinement_iou`, `perimeter_to_target_mask_ratio`
  - `deferred_structural_candidates_count`
  - `locked_backbone_edges_count`
  - `repair_attempted`, `repair_accepted`
- Expected first-run outcome for Fonsica: either `customer_report_ready` with non-zero ridge/valley, OR a clean `ai_failed_topology` (not `ai_failed_perimeter`).

## Scope / non-goals

- No new DB columns; everything piggybacks on existing `geometry_report_json` / `diagnostics` JSONB blobs.
- No UI changes — the existing Phase 3 visibility report already renders any new fields it finds.
- No changes to vendor benchmark or pitch-source contracts.
- Tests: I'll add one integration-style Deno test per phase that mocks DSM/solar inputs and asserts the new fields appear on the solver output.

## Risks

- The four modules were authored without seeing the exact shapes used inside `autonomous-graph-solver.ts` and `constraint-roof-solver.ts`. During wiring I may need small adapter functions (e.g. mapping the solver's edge struct into the seed module's `RawEdge` shape). Those adapters live next to the call site, not inside the module.
- If the repair pass's API doesn't match the constraint solver's candidate shape, I'll add a thin converter rather than refactor the solver internals.
