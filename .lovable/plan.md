# Fonsica Safe-Refinement Guard Verification Run

No code changes unless Step 3 finds a UI gap. This plan executes the deployed guard against 4063 Fonsica and reports back the runtime evidence.

## Step 1 — Trigger fresh AI Measurement

`POST /start-ai-measurement` for lead `0a38230e-57ad-4f22-9caa-ac7707a6962f` (4063 FONSICA AVE) with `user_confirmed_roof_target=true` and `roof_target_admin_override=true`. Poll `ai_measurement_jobs` until the new row reaches a terminal `result_state`.

## Step 2 — Pull runtime evidence

`POST /debug-measurement-runtime { "address": "fonsica", "limit": 5 }` and paste the full JSON of the newest row.

Pass/fail check each expected field:

- `phase3_5.executed === true`
- `phase3_5.raw_to_refined_area_ratio` populated (~0.167)
- `phase3_5.raw_iou_vs_target` populated
- `phase3_5.destructive_refinement_detected === true`
- `phase3_5.refinement_rejected === true`
- `phase3_5.refinement_rejection_reason` contains `absolute_collapse_ratio` AND (`vertex_loss_pct` OR `refined_lost_gt15pct_of_sane_raw`)
- `phase3_5.refinement_fallback_used === 'raw_perimeter'`
- `phase3_5.selected_perimeter_after_refinement === 'raw_perimeter'`
- `phase3_5.conservative_raw_gate.iou_threshold` populated (dynamic value)
- `phase3_5.provisional_perimeter_ready` true/false reported

Branch A — `provisional_perimeter_ready === true`:
- `phase3C` executed, `connectivity_pruning_callsite_not_reached` absent
- `phase3D` executed, `backbone_seed_not_inserted_before_face_extraction` absent
- `phase3E` executed if all candidates rejected on `ridge_lf=0`
- On topology failure: `result_state === 'ai_failed_topology'` (NOT `ai_failed_perimeter`)

Branch B — raw fallback fails conservative gate:
- `result_state === 'ai_failed_perimeter'`
- `hard_fail_reason === 'perimeter_shape_not_accurate'`
- `debug_perimeter_overlay_svg` present in `phase3_5`

## Step 3 — Verify UI overlay renders

Open `MeasurementReportDialog` for the new job. Confirm the perimeter debug overlay panel shows: raw perimeter (gray), rejected refined perimeter (green), selected fallback (blue), target mask (translucent), rejected vertices (red/orange). If `debug_perimeter_overlay_svg` exists in the job row but the dialog shows a blank diagram, add a sanitized (`DOMPurify`) `<PerimeterDebugOverlayPane>` block in `MeasurementReportDialog.tsx` gated on `diagram_render_intent ∈ {'rejected_only','perimeter_debug_only'}`. UI-only change; no backend edits.

## Step 4 — Report

Reply with:
1. Full `debug-measurement-runtime` JSON of the newest Fonsica row
2. Pass/fail table for each expected field above
3. Branch A or B verdict
4. UI overlay screenshot or confirmation it rendered (or note the patch applied in Step 3)

## Out of scope

- No changes to `perimeter-refinement.ts`, `start-ai-measurement`, or topology code
- No widening of conservative-gate thresholds
- No new diagnostics fields
