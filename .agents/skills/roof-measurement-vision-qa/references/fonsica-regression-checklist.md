# Fonsica Regression Checklist (4063 Fonsica Ave)

Canonical regression. Any change touching Phase 3A.5 / 3C / 3D / 3E must be checked against this list before claiming done.

## Latest known-bad inputs

```
raw_mask_contour_area_sqft  = 3336.9
benchmark_area_sqft         = 3077
target_mask_area_sqft       = 2829
refined_perimeter_area_sqft = 557.8
perimeter_vs_mask_iou       = 0.042
perimeter_confidence        = 0.229
```

## Eight hard-fail conditions

The build is broken — and the change must be reverted or fixed — if **any** of these happen on a Fonsica rerun:

1. `refined_perimeter_area_sqft < 0.85 × raw_perimeter_area_sqft` AND raw is within 15% of benchmark — without `destructive_refinement_detected = true`.
2. Raw perimeter is silently replaced by a collapsed polygon (no fallback chip, no rejection reason).
3. `refinement_iou` drops below `raw_iou_vs_target` and no fallback is applied.
4. Topology runs on a destructive refined perimeter (Phase 3C/3D/3E executed with `selected_perimeter_after_refinement != "raw_perimeter"` when destructive collapse was detected).
5. `customer_report_ready = true` with fewer than 8 expected facets.
6. Final `ridge_lf = 0` AND `valley_lf = 0` while `seed_ridge_lf > 0` or `seed_valley_lf > 0` — without `hard_fail_reason = "backbone_not_applied"`.
7. Any of `phase3_5`, `phase3C`, `phase3D`, `phase3E` missing from `geometry_report_json` (or `version` is null).
8. `route_provenance` missing or `canonical_measurement_route != true`.

## Expected safe behavior for Fonsica

After the fixes are correctly applied, a Fonsica rerun must produce:

```jsonc
{
  "route_provenance": {
    "canonical_measurement_route": true,
    "created_by_function": "start-ai-measurement",
    "solver_entrypoint": "_shared/autonomous-graph-solver.solveAutonomousGraph"
  },
  "phase3_5": {
    "executed": true,
    "destructive_refinement_detected": true,
    "refinement_rejected": true,
    "refinement_rejection_reason": "destructive_refinement_collapse",
    "refinement_fallback_used": "raw_perimeter",
    "selected_perimeter_after_refinement": "raw_perimeter",
    "provisional_perimeter_ready": true,
    "conservative_raw_gate": { "passed": true }
  }
}
```

Then one of:

- topology proceeds on raw fallback and either
  - succeeds → `result_state = customer_report_ready` (≥8 facets, valid ridge/valley), OR
  - fails → `result_state = ai_failed_topology`, stage-specific `hard_fail_reason`, diagnostic overlay rendered
- perimeter remains bad (raw fallback also fails the conservative gate) → `result_state = ai_failed_perimeter`, overlay rendered

**Never:** silent acceptance of a 557 sqft polygon, blank dialog, missing phase blocks, or `customer_report_ready = true` for the destructive-collapse run.
