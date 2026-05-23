# Phase 3A.5 — Safe Refinement Guard + Conservative Raw Fallback

## Problem (verified in live row `16a7b916…`, 2026-05-23)

`refineTrueOuterRoofPerimeter` collapsed Fonsica from `raw_mask_contour_area = 3336.9 sqft` → `refined = 557.8 sqft` (17% of raw, IoU 0.042) and the run failed `perimeter_shape_not_accurate` even though the raw mask contour was within ~10% of both benchmark (3077) and target mask (2829).

Two root causes in `supabase/functions/_shared/perimeter-refinement.ts`:

1. **No "do no harm" check.** The acceptance gate at lines 194–206 only checks `iou / ratio / confidence` of the *refined* polygon vs target. It never compares refined vs **raw**, so a destructive collapse passes the "we ran" bar and then trips the IoU bar — failing the whole stage instead of falling back to raw.
2. **Vertex-granularity exclusions.** `identifyExcludedRegions` flags single perimeter vertices (`area_px:1`, one `vertex_indices` entry) as `tree_shadow` / `patio_screen` and drops them in step 4 (line 161). Each removal collapses a side of the polygon. Fonsica removed 6 of 7 vertices this way.

Plus a wiring miss: the call site at `start-ai-measurement/index.ts:2838` passes `benchmark_area_sqft: null`, even though `benchmarkForPerimeter.area_sqft` is already computed at line 2381 and stored on the snapshot. The refinement runs blind to the benchmark sanity signal.

## Changes

### 1. `supabase/functions/_shared/perimeter-refinement.ts`

**A. Region-level exclusion gate** in `identifyExcludedRegions` — only emit a `tree_shadow` / `patio_screen` exclusion (and apply its `keepFlags=false`) when ALL of:
- `area_px ≥ 25`
- exclusion polygon has ≥ 3 unique points
- removing it would drop perimeter area by ≤ 15% **or** has strong DSM-low + RGB-vegetation/structure evidence

Single-vertex "outlier" flags must not be allowed to drop perimeter corners. They may still be reported in diagnostics with `applied: false`.

**B. Snap-distance guard** in `snapVerticesToEdges` — cap movement at `max(6px, 0.03 × footprint_bbox_diagonal_px)`. If a candidate snap reduces local IoU or moves the vertex outside that cap, revert to the original.

**C. Safe-refinement post-check** (new block right before line 198, ahead of the existing iou/ratio/confidence gate):

```
const rawToRefinedAreaRatio = rawAreaSqft > 0 ? refinedAreaSqft / rawAreaSqft : 0;
const rawIoUvsTarget = input.target_mask_grid
  ? computePolygonMaskIoU(raw, input.target_mask_grid, input.width, input.height) : null;
const rawAreaVsBenchmarkPct = input.benchmark_area_sqft
  ? Math.abs(rawAreaSqft - input.benchmark_area_sqft) / input.benchmark_area_sqft * 100 : null;
const rawAreaVsTargetPct = targetAreaSqft
  ? Math.abs(rawAreaSqft - targetAreaSqft) / targetAreaSqft * 100 : null;

const rawNearReference =
  (rawAreaVsBenchmarkPct != null && rawAreaVsBenchmarkPct <= 15) ||
  (rawAreaVsTargetPct != null && rawAreaVsTargetPct <= 15);

const destructive = rawNearReference && rawToRefinedAreaRatio < 0.85;
```

If `destructive === true`:
- set `selected_perimeter_after_refinement = "raw_perimeter"`
- set `refinement_rejected = true`, `refinement_rejection_reason = "destructive_refinement_collapse"`, `refinement_fallback_used = "raw_perimeter"`
- evaluate **conservative raw gate**:
  - `rawIoUvsTarget ≥ 0.80`
  - `rawNearReference === true` (≤15% of benchmark or target)
- if conservative raw gate passes: `passed = true`, `hard_fail_reason = null`, `provisional_perimeter_ready = true`, `perimeter_refinement_passed = false` (refinement itself didn't pass, but raw fallback is usable), `returned ring = raw`.
- if conservative raw gate fails: `passed = false`, `hard_fail_reason = "perimeter_shape_not_accurate"`, returned ring still = raw (for downstream diagram), `provisional_perimeter_ready = false`.

If `destructive === false`: keep current `iou/ratio/confidence` gate logic unchanged; the existing line 244 already falls back to raw on fail.

**D. New diagnostics fields** added to `PerimeterRefinementDiagnostics`:
- `raw_to_refined_area_ratio`
- `raw_iou_vs_target`
- `raw_area_vs_benchmark_delta_pct`
- `raw_area_vs_target_delta_pct`
- `vertices_removed_pct`
- `destructive_refinement_detected`
- `refinement_rejected`
- `refinement_rejection_reason`
- `refinement_fallback_used` (`"raw_perimeter" | "refined_perimeter" | null`)
- `selected_perimeter_after_refinement` (`"raw_perimeter" | "refined_perimeter"`)
- `provisional_perimeter_ready`
- `conservative_raw_gate` (`{ iou_ok, area_ok, passed }`)
- `applied_tree_exclusions_count`, `rejected_tree_exclusions_count` (and same for patio) — proves region-level gating worked

### 2. `supabase/functions/start-ai-measurement/index.ts`

**A. Pass the benchmark** (fix bug at line 2838):
```
benchmark_area_sqft: perimeterPhase0Snapshot?.benchmark_area_sqft
  ?? benchmarkForPerimeter?.area_sqft
  ?? null,
```

**B. Update the Phase 3A.5 hard gate (lines 2882–2929)**: change the `if (phase3A5Result && !phase3A5Result.passed)` short-circuit to honor `provisional_perimeter_ready`:
- If `passed === true` **or** `diagnostics.provisional_perimeter_ready === true`, **do not** fail-fast. Continue into topology with `rawPerimDsmPx` as the selected perimeter, and stamp `phase3A5Diagnostics.refinement_fallback_used`, `selected_perimeter_after_refinement` on the geometry report so the audit endpoint can read it.
- Only enter the existing fail path when both `passed === false` and `provisional_perimeter_ready === false`. Keep the current insert/normalize logic for that path unchanged.
- When topology subsequently fails, `result_state` will be `ai_failed_topology` (its own path), not `ai_failed_perimeter` — exactly what the user wants.

**C. Diagram intent**: when refinement is rejected but raw is provisional, set `diagram_render_intent = 'topology_attempt_with_raw_perimeter'` instead of `rejected_only`. When the hard fail path runs, keep `rejected_only` but also surface `selected_perimeter_after_refinement` in the persisted debug payload so the UI overlay (#3) can render.

### 3. `src/components/measurements/MeasurementReportDialog.tsx`

Add a "Phase 3A.5 Perimeter Refinement Overlay" panel that renders whenever `grj.phase3A_5?.debug_perimeter_overlay_svg` exists (regardless of `diagram_render_intent`). Render the existing `debug_perimeter_overlay_svg` (already produced by `renderDebugOverlay`) sanitized via DOMPurify (per project security memory), with a small legend:
- gray = raw perimeter
- green = refined perimeter
- blue = selected/fallback perimeter
- red = rejected vertices
- orange = exclusion regions
- translucent fill = target mask

If `phase3A_5.refinement_rejected === true`, add a chip above the overlay: "Refinement rejected: destructive_refinement_collapse — fell back to raw perimeter."

The current `renderDebugOverlay` already draws raw + refined + vertices. Extend it to additionally draw the selected polygon in blue and the exclusion regions in orange.

## Acceptance criteria (fresh Fonsica re-run)

`geometry_report_json.phase3_5` must show:
- `destructive_refinement_detected: true`
- `refinement_fallback_used: "raw_perimeter"`
- `selected_perimeter_after_refinement: "raw_perimeter"`
- `provisional_perimeter_ready: true`
- `conservative_raw_gate.passed: true` (raw IoU ≥ 0.80, raw area within 15% of benchmark)
- `applied_tree_exclusions_count: 0` and `applied_patio_exclusions_count: 0` (the 1-px vertex flags get rejected)

Row-level expectations:
- Either `result_state = customer_report_ready` (if topology passes), or `result_state = ai_failed_topology` with stage-specific `hard_fail_reason` from 3C/3D/3E. Never `ai_failed_perimeter` while raw passes the conservative gate.
- `MeasurementReportDialog` shows the Phase 3A.5 overlay panel.

## Out of scope

- Changing topology engine, 3C/3D/3E gates, or vendor benchmark gate.
- Back-filling old rows.
- Adding new perimeter sources.
