## Plan

1. **Centralize target-mask isolation in `perimeter-topology.ts`**
   - Add exported `TargetRoofMaskIsolation` types and `isolateTargetRoofMask()` helper.
   - Move the current BFS component-labeling logic out of `start-ai-measurement/index.ts` so both the start function and autonomous solver use the same target-mask rules.
   - Ensure global mask area and bbox are returned only as diagnostics, while the selected component drives target area, missed-target percentage, and overlap.

2. **Replace global-mask perimeter gate logic**
   - Update `evaluatePerimeterGate()` to accept target-mask isolation/expected-area context instead of using global `roofMaskAreaSqft` as the hard gate reference.
   - Remove any `perimeter_inner_trace_detected` decision based on global `roof_mask_area_sqft`, `visible_roof_bbox_px`, `perimeter_to_mask_ratio`, or `missed_roof_ratio`.
   - Apply the correct gate:
     - `missed_target_roof_pct > 5` only fails if benchmark and solar sanity are not within 10%.
     - `global_mask_inflation_ratio > 2` becomes warning `global_mask_inflated`, not a hard fail.

3. **Force Phase 0 to build before any perimeter hard fail**
   - In `start-ai-measurement/index.ts`, remove the early return at the current target-mask gate path.
   - Always build `perimeter_phase0` immediately after the selected perimeter/footprint exists.
   - Only allow `perimeter_phase0 = null` when no selected perimeter candidate exists at all.
   - If target-mask isolation or perimeter gate fails, persist a failed measurement with populated `perimeter_phase0`, `perimeter_status='fail'`, and `result_state='ai_failed_perimeter'`.

4. **Update autonomous solver Phase 0**
   - In `autonomous-graph-solver.ts`, replace the current `evaluatePerimeterGate(perimeterTopology, roofMaskAreaSqft)` global-mask call.
   - Build Phase 0 from the selected perimeter first, run `isolateTargetRoofMask()`, then evaluate the gate against the selected target component.
   - Return `perimeter_diagnostics` even when internal topology fails, so the start function can save `perimeter_only` instead of blank diagnostics.

5. **Persist complete Phase 0 diagnostics on success and failure**
   - Ensure `geometry_report_json.perimeter_phase0` contains:
     - perimeter source, area, total LF, eave LF, rake LF, unknown LF
     - confidence, gate status, failure reasons, warnings
     - target mask area, global mask area, inflation ratio, component id, overlap, missed target roof %, component table
     - benchmark and solar sanity flags
   - Ensure top-level DB fields mirror Phase 0: `perimeter_status`, `result_state`, `perimeter_area_sqft`, `perimeter_total_lf`, `eave_lf`, `rake_lf`, `perimeter_vs_mask_iou`, `missed_roof_area_pct`, and `perimeter_gate_passed`.
   - Keep `result_state='perimeter_only'` with `customer_report_ready=false` when perimeter passes but topology/promotion fails.

6. **Make the report UI expose stale control-flow bugs**
   - In `MeasurementReportDialog.tsx`, read perimeter metrics from `geometry_report_json.perimeter_phase0` first.
   - Add the red developer banner when `perimeter_inner_trace_detected` exists but `perimeter_phase0` is null:
     - “BUG: perimeter_inner_trace_detected fired before Perimeter Phase 0 executed. Old global-mask gate is still active.”
   - Add/display the missing fields: Benchmark Sanity OK, Solar Sanity OK, Target Mask Area, Global Mask Area, Inflation, Mask Components, Target Overlap, Missed Target Roof, Gate, Area, Eaves LF, Rakes LF.

7. **Validation checkpoint**
   - Re-scan the code for old early-return/global-mask hard-fail patterns.
   - Re-run or inspect the Fonsica AI Measurement output.
   - Expected state after fix:
     - `perimeter_phase0` is not null
     - global mask may remain ~11,697 sqft but only diagnostic
     - target mask area tracks the selected roof component
     - benchmark sanity prevents false `perimeter_inner_trace_detected`
     - `result_state='perimeter_only'` if topology still fails
     - UI shows real perimeter values, not blanks