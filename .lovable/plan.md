
# EagleView Patent Parity Implementation Plan

Based on the comprehensive review, the system already has strong structural building blocks. The work focuses on five areas: registration quality, failure persistence, solver observability, mask-based QA, and legacy cleanup.

---

## Phase 1: Overlay Registration Hardening (highest priority)

**Problem:** `overlay-transform.ts` is a bbox-based scale+center transform. It has no feature-level residual measurement, no control-point support, and no RMS error metric. This is the largest parity gap.

**Changes:**
- **`supabase/functions/_shared/overlay-transform.ts`** — Extend `OverlayCalibration` type to include `rms_px`, `max_error_px`, `mask_iou`, `inlier_count`, and a `transform` matrix. Add a `computeRegistrationQuality()` function that takes geometry points + roof mask and computes actual residuals instead of just bbox coverage ratios.
- **`supabase/functions/start-ai-measurement/index.ts`** — After computing overlay calibration, call the new registration quality function and store full metrics in the measurement row's `overlay_calibration` JSON field. Enforce publish gate: `rms_px <= 4`, `max_error_px <= 8`, `mask_iou >= 0.85`, `coverage_ratio >= 0.85`. Fail customer PDF but still persist debug data when thresholds are not met.

---

## Phase 2: Always-Persist Debug Reports for Failed Runs

**Problem:** When measurement jobs fail early, no debug artifact is persisted, making the hardest failures the least inspectable.

**Changes:**
- **`supabase/functions/start-ai-measurement/index.ts`** — Wrap the entire pipeline in a try/catch that guarantees: (1) a `roof_measurements` row with `validation_status = 'needs_internal_review'` and `geometry_report_json.block_customer_report_reason`, (2) `ai_measurement_diagrams` rows for a debug report, and (3) `measurement_jobs.error` linked to the debug artifact. Every run produces at least a debug bundle with overlay metrics, solver metrics, and block reason.
- **`src/components/measurements/MeasurementReportDialog.tsx`** — When a measurement has `validation_status = 'needs_internal_review'`, open the Internal Debug Report view by default instead of the customer report.
- **`src/components/measurements/UnifiedMeasurementPanel.tsx`** — Show a distinct "Debug Report Available" link for blocked measurements instead of just the error banner.

---

## Phase 3: Formalize Solver Contract and Observability

**Problem:** The planar solver has the right thresholds but doesn't expose all diagnostic counters, and the contract isn't formally typed for testing.

**Changes:**
- **`supabase/functions/_shared/planar-roof-solver.ts`** — Export explicit `PlanarRoofSolverInput` and `PlanarRoofSolverOutput` types. Add missing metrics to output: `cluster_merges`, `collinear_merges`, `intersection_filter_skipped`, `fragment_merges`, `face_count_before_merge`, `face_count_after_merge`, `faces_rejected_by_plane_fit`, `faces_rejected_by_area`. Document threshold invariants as named constants.
- **`supabase/functions/_shared/autonomous-graph-solver.ts`** — Surface the expanded solver metrics in the `AutonomousGraphResult.debug` object. Add `customer_block_reason` field. Pass expanded metrics through to the measurement row.
- **`src/components/measurements/DSMDebugOverlay.tsx`** — Display the new solver metrics (cluster merges, fragment merges, intersection filter stats, per-face RMS labels, edge source coloring by confidence).

---

## Phase 4: Mask IoU as First-Class Publish Gate

**Problem:** Google Solar provides a roof mask, but it's only used for DSM filtering, not as a publish-time validator.

**Changes:**
- **`supabase/functions/_shared/dsm-analyzer.ts`** — Export a `computeMaskIoU(facetPolygonsPx, roofMaskGrid)` function that rasterizes final geometry polygons and computes intersection-over-union against the Solar building mask.
- **`supabase/functions/start-ai-measurement/index.ts`** — Call `computeMaskIoU` after face extraction. Include result in overlay calibration metrics. Block customer report when `mask_iou < 0.85`.
- **`supabase/functions/_shared/footprint-constraint-validator.ts`** — Add mask IoU to the validation result alongside existing footprint checks.

---

## Phase 5: Legacy Path Removal and Source Tagging

**Problem:** `measure-roof/`, `measure/`, and other legacy functions still exist and could re-enter the runtime path.

**Changes:**
- **`supabase/functions/start-ai-measurement/index.ts`** — Ensure every customer-publishable `roof_measurements` row includes `geometry_source = 'autonomous_dsm_graph_solver'`, `topology_source = 'autonomous_dsm_graph_solver'`, `fallback_used = false`. Block publish if these fields are missing.
- **Legacy functions** (`measure-roof`, `measure`, etc.) — Add deprecation headers and logging. These will not be deleted yet (to avoid breaking any external references) but will log warnings when invoked and return a deprecation notice in responses.

---

## Technical Details

### New types added to overlay-transform.ts:
```text
OverlayRegistrationResult {
  calibrated, transform[], rms_px, max_error_px,
  inlier_count, mask_iou?, coverage_ratio, reason?
}
```

### Publish gate constants:
```text
OVERLAY_RMS_PX_MAX = 4
OVERLAY_MAX_ERROR_PX = 8
MASK_IOU_MIN = 0.85
COVERAGE_RATIO_MIN = 0.85
```

### Files touched (estimated):
- `supabase/functions/_shared/overlay-transform.ts` — registration quality
- `supabase/functions/_shared/planar-roof-solver.ts` — typed contract + metrics
- `supabase/functions/_shared/autonomous-graph-solver.ts` — expanded debug output
- `supabase/functions/_shared/dsm-analyzer.ts` — mask IoU computation
- `supabase/functions/_shared/footprint-constraint-validator.ts` — mask IoU gate
- `supabase/functions/start-ai-measurement/index.ts` — orchestration + fail persistence
- `src/components/measurements/DSMDebugOverlay.tsx` — expanded metrics display
- `src/components/measurements/MeasurementReportDialog.tsx` — debug-first for blocked runs
- `src/components/measurements/UnifiedMeasurementPanel.tsx` — debug report link

### Edge functions to deploy:
- `start-ai-measurement`

### Memory updates:
- Update `mem://features/measurement-system/visualization-and-reporting` with new overlay registration contract
- Create `mem://features/measurement-system/overlay-registration-contract` for publish gate thresholds
