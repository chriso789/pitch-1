# Perimeter: Do No Harm

Covers Rules 1, 4, 5. Applies to Phase 3A.5 (`perimeter-refinement.ts`) and any code that mutates a perimeter polygon.

## Rule 1 — Destructive refinement gate

Before accepting any refined perimeter, compute and persist:

- `raw_perimeter_area_sqft`
- `refined_perimeter_area_sqft`
- `target_mask_area_sqft`
- `benchmark_area_sqft` (if available)
- `raw_to_refined_area_ratio = refined / raw`
- `raw_to_refined_iou`
- `perimeter_vs_target_mask_iou`
- `perimeter_to_target_mask_ratio`

**Hard rule.** If raw perimeter is within 15% of benchmark OR target mask area, AND `raw_to_refined_area_ratio < 0.85`:

- `destructive_refinement_detected = true`
- `refinement_rejected = true`
- `refinement_rejection_reason = "destructive_refinement_collapse"`

Then attempt the **conservative raw fallback gate**:

- `raw_iou_vs_target >= 0.80`
- raw area within 15% of benchmark (or target mask if no benchmark)

If the conservative gate passes:
- `refinement_fallback_used = "raw_perimeter"`
- `selected_perimeter_after_refinement = "raw_perimeter"`
- `provisional_perimeter_ready = true`
- `passed = true`, `hard_fail_reason = null`

If it fails:
- `passed = false`
- `hard_fail_reason = "perimeter_shape_not_accurate"`

## Rule 4 — Region-based exclusion only

Tree, patio, shadow, and screen-enclosure exclusions must operate on connected regions, not single vertices.

**Reject the candidate exclusion** if any of:
- `area_px < 25`
- fewer than 3 unique polygon points
- removes only isolated vertices
- area loss > 15% without strong DSM + RGB support
- IoU vs target mask gets worse after applying

Single-vertex outliers may still be reported in diagnostics with `applied: false`. Track:
- `applied_tree_exclusions_count`
- `rejected_tree_exclusions_count`

## Rule 5 — Bounded snap distance

A perimeter vertex may move at most:

```
max(6px, 0.03 × footprint_bbox_diagonal_px)
```

unless **all** of these support the new position:
- IoU improves
- area sanity improves
- DSM height-break supports it
- RGB / aerial edge supports it

If a snap decreases IoU or causes large area loss, **revert the vertex**. Cap movement and log `vertices_removed_pct`.

## Worked example — Fonsica 4063 Fonsica Ave

```
raw_mask_contour_area_sqft     = 3336.9
benchmark_area_sqft            = 3077
target_mask_area_sqft          = 2829
refined_perimeter_area_sqft    = 557.8
perimeter_vs_mask_iou          = 0.042
perimeter_confidence           = 0.229
```

- raw is within 8.5% of benchmark and 18% of target mask → "mostly valid"
- `raw_to_refined_area_ratio = 557.8 / 3336.9 ≈ 0.167` → far below 0.85
- → `destructive_refinement_detected = true`
- → `refinement_rejected = true`
- → fall back to raw if conservative gate passes; otherwise hard-fail with `perimeter_shape_not_accurate`

Under no circumstances may a 557 sqft polygon be promoted to the selected perimeter for this property.

## Persisted diagnostics for Phase 3A.5

Always write these fields (even on success):

```
raw_to_refined_area_ratio
raw_iou_vs_target
raw_area_vs_benchmark_delta_pct
raw_area_vs_target_delta_pct
vertices_removed_pct
destructive_refinement_detected
refinement_rejected
refinement_rejection_reason
refinement_fallback_used
selected_perimeter_after_refinement
provisional_perimeter_ready
conservative_raw_gate { passed, raw_iou_vs_target, raw_area_delta_pct }
applied_tree_exclusions_count
rejected_tree_exclusions_count
debug_perimeter_overlay_svg
```
