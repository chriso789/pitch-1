# Fonsica Measurement Pipeline — Phase 3A.5 + 3C/3D/3E

The Phase 3A eave/rake classifier is now passing (eave_lf=225.9, rake_lf=0). Two remaining problems block customer-ready output:

1. **Perimeter shape is still inflated** — `google_solar_mask_contour` 6-point polygon includes tree canopy / screened patio. `perimeter_to_target_mask_ratio = 1.151`, `iou = 0.845`.
2. **Topology collapses** — DSM detects 30 raw edges with 2 ridges + 3 valleys pre-classified, but pruning/connectivity removes them all → 2 facets, 0 ridges, 0 valleys.

We must fix the perimeter FIRST (Phase 3A.5), then preserve structural evidence into the planar graph (3C/3D/3E).

---

## Phase 3A.5 — True Outer Roof Perimeter Snap

**File:** `supabase/functions/_shared/perimeter-refinement.ts` (new)

Pipeline (runs after `google_solar_mask_contour` is selected, before perimeter acceptance gate):

1. **Tree/patio/shadow exclusion** on raw mask:
   - DSM height-break filter (regions <1.5m above ground = excluded)
   - RGB low-contrast / high-green-saturation regions = vegetation
   - Rectangular grid pattern detection = screen cage
   - Solar-segment support map (regions with no roofSegmentStats coverage = suspect)
   - Distance from confirmed roof centroid > 1.5× median radius = reject
2. **Aerial edge snap**:
   - Run Canny on RGB tile inside expanded perimeter buffer
   - For each polygon vertex, snap to nearest strong edge within 6 px
   - Insert new vertices where polygon segment crosses strong perpendicular edges (catches missing corners)
   - Min 8 candidate vertices for complex roofs before simplifying
3. **Re-simplify** with Douglas-Peucker ε=2px after snap
4. **Acceptance gate** (hard block):
   - `iou ≥ 0.88`, `ratio ≤ 1.10`, `confidence ≥ 0.85`
   - Otherwise `hard_fail_reason = perimeter_shape_not_accurate`

**Persisted diagnostics:** `raw_mask_contour_area_sqft`, `refined_perimeter_area_sqft`, `perimeter_area_delta_pct_vs_target_mask`, `tree_shadow_exclusion_regions`, `patio_screen_exclusion_regions`, `aerial_snap_vertices_added/removed`, `refined_perimeter_vertex_count`, `raw_perimeter_vertex_count`, `perimeter_refinement_reason`, `perimeter_refinement_passed`.

**Debug overlay:** four-layer SVG persisted to `geometry_report_json.debug_perimeter_overlay`:
- raw mask contour (gray)
- target mask component (blue)
- refined true_outer_roof_perimeter (green)
- rejected regions (red/orange)

---

## Phase 3C — Defer Connectivity Edges

**File:** `supabase/functions/_shared/autonomous-graph-solver.ts`

Currently `dangling_edges_removed = 13` deletes ridge/valley evidence pre-refinement. Replace with deferral:

```text
edge passes pre-classification (ridge/valley/hip)
  → if connectivity-isolated:
       move to deferred_structural_candidates (don't delete)
  → keep if: inside perimeter, DSM-supported, solar-aligned, OR splits oversized face
  → only delete after refinement proves noise
```

**Persisted:** `phase3C_deferred_edges_version="v1"`, `connectivity_edges_deferred`, `connectivity_edges_deleted_pre_refinement` (target 0), `connectivity_edges_deleted_post_refinement`, `deferred_structural_candidates_count`, `deferred_edges_used_for_refinement`, `deferred_edges_rejected_after_refinement`, `deferred_edge_table[]`.

---

## Phase 3D — Seed Backbone Locked into Planar Graph

**File:** `supabase/functions/_shared/backbone-topology.ts` (extend) + autonomous solver wiring

`buildSeedBackbone()` from raw DSM ridge/valley/hip evidence + Solar azimuth groups + perimeter reflex corners. Insert into planar graph BEFORE face extraction with `locked=true`. Canonical-edge pruning must skip locked edges. If a locked edge fails downstream, mark `provisional/requires_review` but keep it.

If seed ridges/valleys exist but final = 0 → `hard_fail_reason = backbone_not_applied`, `result_state = ai_failed_topology`.

**Persisted:** `phase3D_backbone_seed_version="v1"`, `seed_backbone_edges`, `seed_backbone_edges_inserted`, `seed_backbone_edges_survived`, `seed_backbone_edges_pruned`, `backbone_prune_reasons`, `locked_backbone_edges_count`, `seed_ridge_lf`, `seed_valley_lf`, `seed_hip_lf`, `backbone_not_applied`.

---

## Phase 3E — Constraint Solver Repair Pass

**File:** `supabase/functions/_shared/constraint-roof-solver.ts`

When all candidates rejected for `ridge_lf=0` (currently 8/8 rejected, 0 optimization iterations):
1. Force-insert highest-confidence seed ridge/valley chain as locked provisional
2. Re-score candidates
3. Accept if faces↑, ridge_lf>0, valley_lf>0 (when expected), area conservation 0.95–1.05, no cross-roof diagonal dominates
4. Else `hard_fail_reason = topology_undersegmented_after_backbone_repair`

**Persisted:** `phase3E_constraint_repair_version="v1"`, `candidate_repair_attempted`, `repaired_ridge_chains_inserted`, `repaired_valley_chains_inserted`, `repaired_candidate_scores`, `repair_iterations`, `final_selected_candidate`, `final_rejection_reason`.

---

## Result-State Normalization

Update `supabase/functions/_shared/result-state.ts` mappings:
- `perimeter_shape_not_accurate` → `ai_failed_perimeter`
- `topology_undersegmented_after_refinement` → `ai_failed_topology`
- `backbone_not_applied` → `ai_failed_topology`
- `topology_undersegmented_after_backbone_repair` → `ai_failed_topology`

Once Phase 3A passes (eave_lf>0, rake_lf classified), `result_state` MUST NOT remain `ai_failed_perimeter` due to topology issues.

`customer_report_ready=false`, `diagram_render_intent=rejected_only`, failed geometry watermarked — unchanged.

---

## Acceptance (next Fonsica run)

- `phase3A.5_perimeter_refinement_version = "v1"`
- `refined_perimeter_area_sqft` within ±8% of Roofr benchmark 3,077 sqft
- `perimeter_to_target_mask_ratio ≤ 1.10`, `iou ≥ 0.88`
- OR `hard_fail_reason = perimeter_shape_not_accurate` (do NOT advance to topology)
- If perimeter passes:
  - `connectivity_edges_deferred > 0`, `connectivity_edges_deleted_pre_refinement ≈ 0`
  - `seed_backbone_edges_inserted > 0`, `locked_backbone_edges_count > 0`
  - `candidate_repair_attempted = true` if ridge_lf=0 after first pass
  - Final `ridge_lf > 0` OR `hard_fail_reason ∈ {backbone_not_applied, topology_undersegmented_after_backbone_repair}`
  - `result_state = ai_failed_topology` (not `ai_failed_perimeter`)

---

## Files to change / create

- `supabase/functions/_shared/perimeter-refinement.ts` — NEW (Phase 3A.5 module)
- `supabase/functions/_shared/perimeter-topology.ts` — call refinement before acceptance gate; persist new diagnostics
- `supabase/functions/_shared/autonomous-graph-solver.ts` — deferral instead of delete; lock backbone edges through pruning
- `supabase/functions/_shared/backbone-topology.ts` — `buildSeedBackbone()` + insertion API
- `supabase/functions/_shared/constraint-roof-solver.ts` — repair pass when all candidates fail on ridge_lf=0
- `supabase/functions/_shared/result-state.ts` — new failure-reason mappings
- `supabase/functions/start-ai-measurement/index.ts` — wire 3A.5 → 3C → 3D → 3E sequence; update gate ordering
- `supabase/functions/_shared/__tests__/perimeter-refinement-fonsica_test.ts` — NEW
- `supabase/functions/_shared/__tests__/backbone-seed-locking_test.ts` — NEW
- `mem://architecture/measurement-system/perimeter-refinement-and-backbone-locking` — NEW memory
- `mem://index.md` — add reference

No DB migration. No frontend change. No edge-function HTTP contract change (only response payload diagnostics expand).

---

## Implementation order

1. Phase 3A.5 perimeter refinement (gates everything downstream — biggest visual win)
2. Result-state normalizer mappings (so failures route correctly during 3C/3D/3E development)
3. Phase 3D seed backbone (the lock mechanism is prerequisite for 3C and 3E)
4. Phase 3C deferral (now safe because backbone is locked)
5. Phase 3E repair pass (final fallback)
6. Tests + memory update
