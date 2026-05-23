# Structural Evidence & Topology

Covers Rules 6, 7, 8. Applies to Phase 3C (deferred structural candidates), 3D (locked backbone), and 3E (repair pass).

## Rule 6 — Preserve DSM structural evidence

If DSM detects ridge / valley / hip edges, **do not delete them** before topology refinement.

- Edges that fail connectivity / clustering must be moved to `deferred_structural_candidates`, not discarded.
- Phase 3C diagnostics:
  - `connectivity_edges_deferred`
  - `deferred_structural_candidates_count`
  - `deferred_edges_used_for_refinement`

**Forbidden silent collapse.** You may never produce:
- 30 raw DSM edges → 27 accepted → 24 clustered → final graph with `ridge_lf = 0` and `valley_lf = 0`

without an explicit hard failure (`backbone_not_applied` or `topology_undersegmented_after_backbone_repair`).

## Rule 7 — Locked backbone

Seed ridge / valley / hip chains must be inserted into the planar graph **before** face extraction. Once inserted they are *locked*: canonical pruning, parallel-edge merging, and short-edge collapse may not remove them.

Phase 3D diagnostics:
- `seed_backbone_edges_inserted`
- `locked_backbone_edges_count`
- `seed_ridge_lf`
- `seed_valley_lf`
- `seed_hip_lf`
- `backbone_not_applied`

If `seed_ridge_lf > 0 || seed_valley_lf > 0` pre-solve, but post-solve `ridge_lf == 0 && valley_lf == 0`:

```
hard_fail_reason = "backbone_not_applied"
result_state     = "ai_failed_topology"
customer_report_ready = false
```

## Rule 8 — Repair before rejecting

If the constraint solver rejects every candidate because `ridge_lf == 0`, run a repair pass before failing:

1. Re-insert the highest-confidence seed ridge/valley chains from `deferred_structural_candidates`.
2. Re-extract faces.
3. Re-score candidates.

Phase 3E diagnostics:
- `candidate_repair_attempted`
- `repair_iterations`
- `repair_accepted`
- `final_rejection_reason`

If repair still fails:

```
hard_fail_reason = "topology_undersegmented_after_backbone_repair"
result_state     = "ai_failed_topology"
```

## Phase ordering invariant

```
Phase 3A.5 (perimeter refinement, safe fallback)
   ↓
Phase 3B   (eave/rake classification — independent of ridges)
   ↓
Phase 3C   (DSM edge ingestion + deferred_structural_candidates)
   ↓
Phase 3D   (locked-backbone seeding + face extraction)
   ↓
Phase 3E   (constraint solver + repair pass)
```

Skipping a phase is allowed only with an explicit `skipped_reason` persisted on that phase block. A `null` or missing phase block is itself a hard failure (`developer_bug` / `phase_block_missing`).
