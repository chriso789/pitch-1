# Required Diagnostics

Every AI Measurement run must persist these blocks on `geometry_report_json`. A missing block is a hard failure. Skipped phases must set `executed: false` and a non-null `skipped_reason`.

## `route_provenance`

```jsonc
{
  "created_by_function": "start-ai-measurement",
  "created_by_component": "PullMeasurementsButton/useMeasurementJob",
  "solver_entrypoint": "_shared/autonomous-graph-solver.solveAutonomousGraph",
  "canonical_measurement_route": true,
  "route_audit_version": "v1",
  "report_renderer_version": "v1"
}
```

`canonical_measurement_route=false` is itself a hard failure for any customer-facing render.

## `phase3_5` — Perimeter refinement (Phase 3A.5)

```jsonc
{
  "version": "v1",
  "executed": true,
  "skipped_reason": null,

  "raw_perimeter_area_sqft": 3336.9,
  "refined_perimeter_area_sqft": 557.8,
  "target_mask_area_sqft": 2829,
  "benchmark_area_sqft": 3077,

  "refinement_iou": 0.042,
  "perimeter_to_target_mask_ratio": 0.197,
  "raw_to_refined_area_ratio": 0.167,
  "raw_to_refined_iou": 0.18,
  "raw_iou_vs_target": 0.88,
  "raw_area_vs_benchmark_delta_pct": 0.085,
  "raw_area_vs_target_delta_pct": 0.18,
  "vertices_removed_pct": 0.62,

  "destructive_refinement_detected": true,
  "refinement_rejected": true,
  "refinement_rejection_reason": "destructive_refinement_collapse",
  "refinement_fallback_used": "raw_perimeter",
  "selected_perimeter_after_refinement": "raw_perimeter",
  "provisional_perimeter_ready": true,
  "conservative_raw_gate": {
    "passed": true,
    "raw_iou_vs_target": 0.88,
    "raw_area_delta_pct": 0.085
  },

  "applied_tree_exclusions_count": 0,
  "rejected_tree_exclusions_count": 4,

  "debug_perimeter_overlay_svg": "<svg ...>"
}
```

## `phase3C` — DSM ingestion & deferred candidates

```jsonc
{
  "version": "v1",
  "executed": true,
  "skipped_reason": null,
  "connectivity_edges_deferred": 6,
  "deferred_structural_candidates_count": 6,
  "deferred_edges_used_for_refinement": 2
}
```

## `phase3D` — Locked backbone

```jsonc
{
  "version": "v1",
  "executed": true,
  "skipped_reason": null,
  "seed_backbone_edges_inserted": 5,
  "locked_backbone_edges_count": 5,
  "seed_ridge_lf": 48.2,
  "seed_valley_lf": 22.1,
  "seed_hip_lf": 0,
  "backbone_not_applied": false
}
```

If `backbone_not_applied: true` → `hard_fail_reason = "backbone_not_applied"`, `result_state = "ai_failed_topology"`.

## `phase3E` — Constraint solver & repair

```jsonc
{
  "version": "v1",
  "executed": true,
  "skipped_reason": null,
  "candidate_repair_attempted": true,
  "repair_iterations": 2,
  "repair_accepted": false,
  "final_rejection_reason": "topology_undersegmented_after_backbone_repair"
}
```

## Stage-specific `hard_fail_reason` values

Never `null` on failure. Always one of (extend via `result-state.ts` normalizer mapping, never via the DB CHECK constraint):

- `perimeter_shape_not_accurate`
- `perimeter_refinement_failed`
- `destructive_refinement_collapse`
- `backbone_not_applied`
- `topology_undersegmented_after_backbone_repair`
- `ridge_network_missing`
- `phase_block_missing` (developer bug)

Always paired with a canonical `result_state` from the 10-bucket normalizer.
