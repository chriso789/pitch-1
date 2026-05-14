# Wire Phase 3A.5 → 3E with Phase 3A.5 as a hard gatekeeper

The four Phase 3 modules are present in `supabase/functions/_shared/` but unwired. This corrected plan makes Phase 3A.5 a **hard perimeter gate** — if the refined perimeter does not match the actual roof, the run stops as `ai_failed_perimeter` and topology never executes.

## Verified module + export inventory

I read each file. The actual exports differ from the previous plan's names — the wiring will use the real names, not silently skip.

| File | Real exports |
|---|---|
| `supabase/functions/_shared/perimeter-refinement.ts` | `refineTrueOuterRoofPerimeter(input)`, types `PerimeterRefinementInput`/`Result`/`Diagnostics` |
| `supabase/functions/_shared/backbone-seed.ts` | `buildSeedBackbone(input)`, `markBackboneInserted`, `demoteLockedEdge`, `detectBackboneNotApplied` (no `buildLockedBackboneSeed`) |
| `supabase/functions/_shared/deferred-structural-edges.ts` | `categorizeForDeferral(candidate, diag)`, `finalizeDeferredEdges`, `emptyDeferralDiagnostics` (no `deferStructuralEdge`) |
| `supabase/functions/_shared/constraint-solver-repair.ts` | `attemptRepairPass(input)`, `shouldAttemptRepair(candidates, seed)` |
| `supabase/functions/_shared/backbone-network.ts` | `buildBackboneNetwork(...)` — this is the active backbone module Phase 3D will hook into |

Verified integration sites:
- `start-ai-measurement/index.ts` line ~2525: `perimeterPhase0Snapshot` is built; line ~2754: `solveAutonomousGraph` is called. Phase 3A.5 inserts between these two points.
- `autonomous-graph-solver.ts` line ~2940 already references `deferred_connectivity_edges`; the connectivity-pruning step around there is the Phase 3C wire-in.
- `constraint-roof-solver.ts` candidates carry `score`, `rejected`, `rejection_reason` fields (line ~125); after candidate scoring is the Phase 3E wire-in.

## Phase 3A.5 — True outer roof perimeter refinement (HARD GATE)

**File:** `supabase/functions/start-ai-measurement/index.ts`, between perimeterPhase0 build (~L2525) and `solveAutonomousGraph` call (~L2754).

Call `refineTrueOuterRoofPerimeter({...})` with the inputs already in scope at that point:
- `raw_perimeter_px` ← Layer-1 perimeter from `perimeterPhase0Snapshot.true_outer_roof_perimeter_px`
- `raw_perimeter_source` ← existing `perimeter_source` label
- `dsm_grid`, `width`, `height`, `meters_per_pixel` ← from the loaded DSM tile
- `target_mask_grid` ← target roof mask component already used by perimeter-topology
- `rgba` ← RGB/aerial raster
- `solar_segment_masks_px` ← rasterized roofSegmentStats
- `roof_centroid_px` ← confirmed roof PIN reprojected to DSM pixels
- `benchmark_area_sqft` ← from `roof_measurement_benchmarks` lookup if present
- `thresholds` ← defaults (`min_iou=0.88`, `max_ratio=1.10`, `min_confidence=0.85`, `max_snap=6px`)

Persist verbatim into `geometry_report_json`:
- `phase3_5_perimeter_refinement_enabled = true`
- `raw_perimeter_px`, `refined_perimeter_px`, `refined_perimeter_geo`
- `raw_perimeter_area_sqft`, `refined_perimeter_area_sqft`, `target_mask_area_sqft`
- `refinement_iou` (== `perimeter_vs_mask_iou`), `perimeter_to_target_mask_ratio`
- `vertices_snapped_count`, `vertices_added_count`, `vertices_removed_count`
- `tree_shadow_exclusion_regions`, `patio_screen_exclusion_regions`
- `refinement_diagnostics` (the full `PerimeterRefinementDiagnostics` blob, including `debug_perimeter_overlay_svg`)
- `refinement_passed`

**Hard gate.** If `result.passed === false` OR `iou < 0.88` OR `ratio > 1.10` OR `confidence < 0.85`:

```
result_state               = ai_failed_perimeter   (stable bucket — no DB change)
hard_fail_reason           = perimeter_refinement_failed
block_customer_report_reason = perimeter_shape_not_accurate
customer_report_ready      = false
diagram_render_intent      = rejected_only
```

Then **return early**. `solveAutonomousGraph` is not called. Topology, backbone seeding, and constraint solver do not run.

If the gate passes:
- Replace the perimeter handed to `solveAutonomousGraph` with `refined_perimeter_px` / `refined_perimeter_geo`.
- Set `selected_perimeter_source = "refined_true_outer_roof_perimeter"`.
- Continue to Phases 3C/3D/3E.

## Phase 3C — Defer structural edges (only reached when 3A.5 passed)

**File:** `supabase/functions/_shared/autonomous-graph-solver.ts`, around the connectivity pruning step near line ~2940.

Replace the current "delete dangling ridge/valley/hip" body with:

1. Initialize `const deferralDiag = emptyDeferralDiagnostics()` once per solve.
2. For each connectivity-isolated candidate edge, build a `DeferralCandidate` (id, original_type, p1/p2, length, inside_perimeter using refined perimeter, dsm/solar/pre-class scores) and call `categorizeForDeferral(c, deferralDiag)`. Push survivors into `deferred_structural_candidates`.
3. After refinement / face splitting attempts, call `finalizeDeferredEdges(deferralDiag, usedForSplitIds)`.

Persist on solver result (surfaces in `autonomousDebug.phase3C`):
- `phase3C_deferred_edges_version = "v1"`
- `connectivity_edges_deferred`, `connectivity_edges_deleted_pre_refinement`, `connectivity_edges_deleted_post_refinement`
- `deferred_structural_candidates_count`, `deferred_edges_used_for_refinement`, `deferred_edges_rejected_after_refinement`
- `deferred_edge_table` (full `DeferredEdgeDecision[]`)

## Phase 3D — Seed backbone insertion + locking

**File:** `supabase/functions/_shared/backbone-network.ts`, inside `buildBackboneNetwork(...)` BEFORE face extraction / chain pruning.

1. Assemble `RawEdgeEvidence[]` from raw DSM ridge/valley/hip detections + `deferred_structural_candidates` from Phase 3C, scoring each with `dsm_support`, `solar_alignment`, `inside_perimeter` (against refined perimeter), `pre_classification_confidence`.
2. Call `buildSeedBackbone({ raw_edges, perimeter_px: refined_perimeter_px, reflex_corners_px, meters_per_pixel })`.
3. Insert returned `seed_backbone_edges` into the planar graph with `locked: true`. Call `markBackboneInserted(diag, insertedCount)`.
4. In every downstream pruning / merging path, when removing a locked edge, call `demoteLockedEdge(edge, diag, reason)` instead of `splice` — never delete locked edges silently.
5. After face extraction, call `detectBackboneNotApplied(seedResult, { ridge_lf, valley_lf })`. If true, propagate `hard_fail_reason = 'backbone_not_applied'`.

Persist on solver result (`autonomousDebug.phase3D`):
- `phase3D_backbone_seed_version = "v1"`
- `seed_backbone_edges`, `seed_backbone_edges_inserted`, `seed_backbone_edges_survived`, `seed_backbone_edges_pruned`
- `locked_backbone_edges_count`, `backbone_prune_reasons`
- `seed_ridge_lf`, `seed_valley_lf`, `seed_hip_lf`
- `backbone_not_applied`

`backbone_not_applied = true` → `hard_fail_reason = backbone_not_applied`, `result_state = ai_failed_topology` (already mapped in `result-state.ts`).

## Phase 3E — Constraint solver repair pass

**File:** `supabase/functions/_shared/constraint-roof-solver.ts`, after candidate scoring and before returning the best candidate.

1. Build `RepairCandidate[]` from the existing `ConstraintCandidate[]`, copying `id, topology_type, faces, ridge_lf, valley_lf, hip_lf, area_ratio, has_cross_roof_diagonal, rejected_reason, score`.
2. Check `shouldAttemptRepair(repairCandidates, seedBackboneResult)`. If true:
3. Call `attemptRepairPass({ candidates, seed: seedBackboneResult, rescore })` where `rescore(cand, ridgeChains, valleyChains)` is a closure that re-runs the existing scoring with the seed chains force-merged into the candidate's edge set.
4. If `result.selected != null`, replace the chosen candidate with it. Otherwise keep the original best.

Persist on constraint result (`autonomousDebug.phase3E`):
- `phase3E_constraint_repair_version = "v1"`
- `candidate_repair_attempted`, `repaired_ridge_chains_inserted`, `repaired_valley_chains_inserted`
- `repaired_candidate_scores`, `repair_iterations`
- `repair_accepted` (= `selected != null`), `final_selected_candidate`, `final_rejection_reason`

If repair was attempted but no acceptable candidate emerged:
```
hard_fail_reason     = topology_undersegmented_after_backbone_repair
result_state         = ai_failed_topology
customer_report_ready = false
```

## Result-state mapping

`supabase/functions/_shared/result-state.ts` already routes the relevant tokens (verified). Keep the existing 10 stable buckets — **no DB constraint change**. Confirm the following all map correctly:

| hard_fail_reason | → result_state |
|---|---|
| `perimeter_refinement_failed` | `ai_failed_perimeter` |
| `perimeter_shape_not_accurate` | `ai_failed_perimeter` |
| `iou_below_gate` / `ratio_above_gate` | `ai_failed_perimeter` |
| `backbone_not_applied` | `ai_failed_topology` |
| `seed_chain_unlocked` | `ai_failed_topology` |
| `repair_required_but_unavailable` | `ai_failed_topology` |
| `topology_undersegmented_after_backbone_repair` | `ai_failed_topology` |

The current normalizer covers `perimeter`, `eave_rake`, `classification_invalid`, `backbone`, `seed_collapse`, `connectivity_collapse`, `topology`, `undersegment`. I'll extend it with explicit string matches for `perimeter_refinement_failed`, `iou_below_gate`, `ratio_above_gate`, `repair_required_but_unavailable`, `topology_undersegmented_after_backbone_repair` to make routing deterministic regardless of upstream wording.

## Verification on Fonsica (`/lead/0a38230e-…`)

Three valid outcomes — Lovable will not pre-declare which one is "expected":

**A. Perimeter refinement fails (most likely if the visible bulge is a tree/patio):**
- `result_state = ai_failed_perimeter`
- `hard_fail_reason = perimeter_refinement_failed`
- `phase3_5_perimeter_refinement_enabled = true`
- `refinement_iou`, `perimeter_to_target_mask_ratio` populated; `refinement_passed = false`
- `tree_shadow_exclusion_regions` / `patio_screen_exclusion_regions` populated
- `debug_perimeter_overlay_svg` rendered
- **`solveAutonomousGraph` is NOT called.** No phase3D/3E execution.

**B. Perimeter refinement passes, topology fails:**
- `result_state = ai_failed_topology`
- `phase3C_deferred_edges_version = v1`, `connectivity_edges_deferred > 0`
- `phase3D_backbone_seed_version = v1`, `locked_backbone_edges_count > 0`
- `phase3E_constraint_repair_version = v1`, `candidate_repair_attempted = true` if ridge_lf stayed 0
- `hard_fail_reason ∈ { backbone_not_applied, topology_undersegmented_after_backbone_repair }`

**C. Customer-ready** — only if refined perimeter passes AND non-zero ridge/valley AND faces > undersegmentation min AND pitch valid AND vendor-benchmark gate passes. Not pre-declared expected.

## Tests

- `perimeter-refinement-fonsica_test.ts` — feeds a synthesized DSM/mask/RGB tile with a tree bulge; asserts `passed=false`, `iou < 0.88`, exclusion regions populated.
- `phase3a5-gate-blocks-topology_test.ts` — asserts that when `result.passed=false`, `solveAutonomousGraph` is not invoked and the persisted row has `result_state='ai_failed_perimeter'`, `customer_report_ready=false`.
- `backbone-seed-locking_test.ts` — asserts locked edges survive a synthetic prune cycle and `detectBackboneNotApplied` flips when ridge_lf collapses.
- `constraint-repair-pass_test.ts` — asserts `attemptRepairPass` selects a non-zero-ridge candidate when seed chains exist and original candidates all had `ridge_lf=0`.

## Scope / non-goals

- No DB constraint changes. All new failure tokens normalize into existing `ai_failed_perimeter` / `ai_failed_topology` buckets.
- Diagnostics piggyback on `geometry_report_json` JSONB — no new columns.
- No UI changes; the existing Phase 3 visibility report already renders nested phase blocks generically.
- No edits to vendor-benchmark gate, pitch-source contract, or Patent Workflow Rules 1–5.

## Risks

- **Phase 3A.5 inputs depend on raster shapes already loaded at L2525.** If the DSM `Float32Array` and target-mask `Uint8Array` aren't currently in scope at that point, the wiring needs a small refactor to pass them through (not load them again). I'll do that as part of the same edit, not as a follow-up.
- **`buildBackboneNetwork` signature.** I haven't yet read its full param list. I'll thread the seed-backbone result through its existing inputs rather than changing the signature for callers.
- **`rescore` closure inside constraint solver.** The repair pass's `rescore(cand, ridgeChains, valleyChains)` callback needs access to the solver's internal scoring fn. If that fn is module-private, I'll extract it into a named helper inside the same file rather than exporting it.
