// ============================================================================
// PHASE 3A.5 — TRUE OUTER ROOF PERIMETER SNAP / TREE-PATIO EXCLUSION
// ----------------------------------------------------------------------------
// Refines a raw `google_solar_mask_contour` (or any low-vertex outer perimeter)
// by:
//   1. Excluding tree canopy / screened patio / shadow-spill regions using
//      DSM height + Solar segment support + RGB color heuristics.
//   2. Snapping vertices to the nearest strong DSM/RGB roof edge.
//   3. Inserting missing corners where polygon segments cross strong
//      perpendicular edges.
//   4. Re-simplifying with Douglas-Peucker after snap.
//   5. Applying a hard acceptance gate (IoU ≥ 0.88, ratio ≤ 1.10).
//
// All inputs are pixel-space arrays. The module is deterministic and pure —
// callers persist the returned diagnostics into geometry_report_json and
// route gate failures through `result-state.ts`.
//
// Wire-in point: `start-ai-measurement/index.ts` immediately AFTER eave-snap
// (`snapFootprintToEaves`) and BEFORE the perimeter Phase 0 acceptance gate.
// ============================================================================

export type PxPt = [number, number];

export interface PerimeterRefinementInput {
  /** Raw perimeter polygon in DSM pixel space (closed or open). */
  raw_perimeter_px: PxPt[];
  /** Source label (e.g. "google_solar_mask_contour"). */
  raw_perimeter_source: string;
  /** DSM height grid (meters above ground), row-major. */
  dsm_grid?: Float32Array | null;
  /** Target mask grid (1 = roof, 0 = not), row-major. */
  target_mask_grid?: Uint8Array | null;
  /** Raster width / height in pixels (DSM space). */
  width: number;
  height: number;
  /** Meters per pixel for area calcs. */
  meters_per_pixel: number;
  /** Optional RGB tile (RGBA, row-major) aligned to DSM space. */
  rgba?: Uint8ClampedArray | Uint8Array | null;
  /**
   * Solar roofSegmentStats projected to DSM pixels. Used as authoritative
   * "this region is roof" support — vertices outside any segment buffer are
   * candidates for tree/patio exclusion.
   */
  solar_segment_masks_px?: Uint8Array | null;
  /** Optional vendor benchmark area (sqft) for sanity comparison. */
  benchmark_area_sqft?: number | null;
  /** Optional vendor benchmark facet count (used for expected_min_vertices). */
  benchmark_facet_count?: number | null;
  /** Solar segment count (used for expected_min_vertices on complex roofs). */
  solar_segment_count?: number | null;
  /** Confirmed roof centroid in DSM pixels. */
  roof_centroid_px?: PxPt | null;
  /** Acceptance thresholds (override defaults). */
  thresholds?: Partial<RefinementThresholds>;
  /**
   * v1.4 — manual visual QA override. When true, the visual-review gate is
   * bypassed and the selected perimeter is locked as `manual_override`.
   * Caller is responsible for proving a human verified the overlay.
   */
  user_verified_perimeter?: boolean;
  /** Optional override thresholds for the manual visual-review gate. */
  visual_review_thresholds?: Partial<VisualReviewThresholds>;
}

export interface VisualReviewThresholds {
  min_visual_edge_alignment_score: number;
  min_aerial_edge_support_pct: number;
  min_corner_snap_confidence: number;
  max_long_segment_corner_cut_count: number;
  max_non_roof_crossing_count: number;
}

const DEFAULT_VISUAL_REVIEW_THRESHOLDS: VisualReviewThresholds = {
  min_visual_edge_alignment_score: 0.85,
  min_aerial_edge_support_pct: 0.80,
  min_corner_snap_confidence: 0.75,
  max_long_segment_corner_cut_count: 0,
  max_non_roof_crossing_count: 0,
};

export interface RefinementThresholds {
  min_iou_vs_target_mask: number;
  max_ratio_vs_target_mask: number;
  min_confidence: number;
  /** Max vertex move distance (px) during snap. */
  max_snap_distance_px: number;
  /** Min candidate vertex count for complex roofs before simplification. */
  min_complex_vertex_count: number;
  /** Douglas-Peucker tolerance after snap. */
  simplify_tolerance_px: number;
  /** DSM height threshold (meters above local ground) to consider as roof. */
  dsm_min_roof_height_m: number;
  /** Max distance from roof centroid as multiple of median radius. */
  max_centroid_distance_factor: number;
}

const DEFAULT_THRESHOLDS: RefinementThresholds = {
  min_iou_vs_target_mask: 0.88,
  max_ratio_vs_target_mask: 1.10,
  min_confidence: 0.85,
  max_snap_distance_px: 6,
  min_complex_vertex_count: 8,
  simplify_tolerance_px: 2,
  dsm_min_roof_height_m: 1.5,
  max_centroid_distance_factor: 1.5,
};

export interface ExcludedRegion {
  reason: 'tree_canopy' | 'patio_screen' | 'shadow' | 'no_solar_support' | 'centroid_outlier' | 'low_dsm';
  vertex_indices: number[];
  bbox_px: { minX: number; minY: number; maxX: number; maxY: number };
  area_px: number;
  /** Whether this candidate exclusion was actually applied (vertex dropped). */
  applied: boolean;
  /** When applied=false, why it was rejected. */
  rejection_reason?: string;
}

export interface PerimeterRefinementResult {
  refined_perimeter_px: PxPt[];
  passed: boolean;
  hard_fail_reason: string | null;
  diagnostics: PerimeterRefinementDiagnostics;
}

export interface PerimeterRefinementDiagnostics {
  phase3A_5_perimeter_refinement_version: 'v1';
  raw_perimeter_source: string;
  raw_perimeter_vertex_count: number;
  refined_perimeter_vertex_count: number;
  raw_mask_contour_area_sqft: number;
  refined_perimeter_area_sqft: number;
  perimeter_area_delta_pct_vs_target_mask: number | null;
  perimeter_area_delta_pct_vs_benchmark: number | null;
  perimeter_to_target_mask_ratio: number | null;
  perimeter_vs_mask_iou: number | null;
  perimeter_confidence: number;
  tree_shadow_exclusion_regions: ExcludedRegion[];
  patio_screen_exclusion_regions: ExcludedRegion[];
  aerial_snap_vertices_added: number;
  aerial_snap_vertices_removed: number;
  aerial_snap_vertices_moved: number;
  perimeter_refinement_reason: string;
  perimeter_refinement_passed: boolean;
  acceptance_gate: {
    iou_threshold: number;
    iou_actual: number | null;
    iou_passed: boolean;
    ratio_threshold: number;
    ratio_actual: number | null;
    ratio_passed: boolean;
    confidence_threshold: number;
    confidence_actual: number;
    confidence_passed: boolean;
  };
  // ── Safe-refinement guard (v1.1) ──────────────────────────────────────────
  raw_to_refined_area_ratio: number | null;
  raw_iou_vs_target: number | null;
  raw_area_vs_benchmark_delta_pct: number | null;
  raw_area_vs_target_delta_pct: number | null;
  vertices_removed_pct: number;
  destructive_refinement_detected: boolean;
  refinement_rejected: boolean;
  refinement_rejection_reason: string | null;
  refinement_fallback_used: 'raw_perimeter' | 'refined_perimeter' | null;
  selected_perimeter_after_refinement: 'raw_perimeter' | 'refined_perimeter';
  provisional_perimeter_ready: boolean;
  conservative_raw_gate: {
    iou_threshold: number;
    iou_actual: number | null;
    iou_ok: boolean;
    area_ok: boolean;
    passed: boolean;
  };
  // ── Benchmark-aware acceptance (v1.2) ─────────────────────────────────────
  benchmark_override_used: boolean;
  benchmark_override_reason: string | null;
  /** v1.3 alias: benchmark match alone NEVER promotes perimeter to valid.
   * It only demotes a low target_mask_iou from hard-fail to warning. */
  benchmark_support_used: boolean;
  benchmark_area_delta_pct: number | null;
  target_mask_iou_demoted_to_warning: boolean;
  perimeter_acceptance_source:
    | 'target_mask_iou'
    | 'benchmark_area_sanity'
    | 'shape_validated'
    | 'raw_fallback'
    | 'manual_override'
    | 'failed';
  confidence_source:
    | 'target_mask_iou'
    | 'benchmark_area_sanity'
    | 'shape_validated'
    | 'raw_fallback'
    | null;
  confidence_warnings: string[];
  ring_closed: boolean;
  ring_self_intersecting: boolean;
  applied_tree_exclusions_count: number;
  rejected_tree_exclusions_count: number;
  applied_patio_exclusions_count: number;
  rejected_patio_exclusions_count: number;
  footprint_bbox_diagonal_px: number;
  snap_distance_cap_px: number;
  // ── v1.3 Shape / visual edge validation ───────────────────────────────────
  expected_min_vertices: number;
  perimeter_status: 'valid' | 'provisional' | 'failed';
  shape_validation: ShapeValidation;
  debug_perimeter_overlay_svg: string | null;
  // ── v1.4 Manual visual-QA gate ────────────────────────────────────────────
  perimeter_visual_review_required: boolean;
  visual_review_gate: {
    thresholds: VisualReviewThresholds;
    metrics: {
      visual_edge_alignment_score: number;
      aerial_edge_support_pct: number | null;
      corner_snap_confidence: number;
      long_segment_corner_cut_count: number;
      non_roof_crossing_count: number;
    };
    passed: boolean;
    failed_metrics: string[];
  };
  user_verified_perimeter: boolean;
  perimeter_source_locked: string | null;
}

export interface PerimeterSegmentDiagnostic {
  edge_id: number;
  p1_px: [number, number];
  p2_px: [number, number];
  length_px: number;
  length_ft: number;
  visual_edge_support_pct: number | null;
  dsm_boundary_support_pct: number | null;
  aerial_edge_support_pct: number | null;
  crosses_non_roof: boolean;
  corner_cut_detected: boolean;
  corner_cut_midpoint_px: [number, number] | null;
  nearest_visible_edge_distance_px_mean: number | null;
  nearest_visible_edge_distance_px_max: number | null;
  alignment_status: 'supported' | 'weak' | 'failed';
}

export interface ShapeValidation {
  area_sanity_passed: boolean;
  vertex_sanity_passed: boolean;
  visual_edge_alignment_score: number;
  aerial_edge_support_pct: number | null;
  aerial_edge_support_sample_count: number;
  aerial_edge_supported_sample_count: number;
  aerial_edge_unsupported_segments: number[];
  dsm_boundary_support_pct: number | null;
  corner_snap_confidence: number;
  long_segment_corner_cut_count: number;
  long_segment_corner_cut_midpoints_px: [number, number][];
  non_roof_crossing_count: number;
  centroid_shift_px: number;
  centroid_shift_threshold_px: number;
  target_overlap_with_perimeter: number | null;
  expected_min_vertices: number;
  actual_vertex_count: number;
  shape_passed: boolean;
  shape_uncertain: boolean;
  shape_failure_reasons: string[];
  warnings: string[];
  segment_diagnostics: PerimeterSegmentDiagnostic[];
}



// ────────────────────────────────────────────────────────────────────────────
// Public entry
// ────────────────────────────────────────────────────────────────────────────

export function refineTrueOuterRoofPerimeter(
  input: PerimeterRefinementInput,
): PerimeterRefinementResult {
  const T: RefinementThresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const raw = closeRing(input.raw_perimeter_px);
  const rawAreaPx = polygonAreaPx(raw);
  const sqftPerPx = (input.meters_per_pixel * input.meters_per_pixel) * 10.7639;
  const rawAreaSqft = rawAreaPx * sqftPerPx;

  // Footprint bbox diagonal — used for snap-distance cap.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of raw) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  const bboxDiagPx = Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 0;
  const snapCapPx = Math.max(T.max_snap_distance_px, Math.round(0.03 * bboxDiagPx));
  const effectiveT: RefinementThresholds = { ...T, max_snap_distance_px: snapCapPx };

  if (raw.length < 4) {
    return failResult(input.raw_perimeter_source, raw.length, rawAreaSqft, T,
      'perimeter_shape_not_accurate', 'raw perimeter has <4 vertices');
  }

  // 1. Identify excluded regions (region-level gated — single-vertex flags are NOT applied).
  const { keepFlags, treeRegions, patioRegions } =
    identifyExcludedRegions(raw, input, T, rawAreaPx);

  // 2. Snap surviving vertices (snap distance capped by bbox diagonal).
  const { snapped, moved } = snapVerticesToEdges(raw, keepFlags, input, effectiveT);

  // 3. Insert missing corners.
  const { withInserted, added } = insertMissingCorners(snapped, input, effectiveT);

  // 4. Drop vertices flagged for exclusion (only those that survived the region gate).
  const filtered = withInserted.filter((_, i) => keepFlags[i] !== false);
  const removed = withInserted.length - filtered.length;

  // 5. Re-simplify.
  const refined = filtered.length >= T.min_complex_vertex_count
    ? douglasPeucker(filtered, T.simplify_tolerance_px)
    : filtered;
  const refinedClosed = closeRing(refined);

  // 6. Acceptance metrics (refined).
  const refinedAreaPx = polygonAreaPx(refinedClosed);
  const refinedAreaSqft = refinedAreaPx * sqftPerPx;
  const targetAreaPx = input.target_mask_grid ? maskAreaPx(input.target_mask_grid) : null;
  const targetAreaSqft = targetAreaPx != null ? targetAreaPx * sqftPerPx : null;

  const ratio = targetAreaSqft && targetAreaSqft > 0 ? refinedAreaSqft / targetAreaSqft : null;
  const iou = input.target_mask_grid
    ? computePolygonMaskIoU(refinedClosed, input.target_mask_grid, input.width, input.height)
    : null;
  const confidence = computeConfidence(refinedClosed, input, T, iou, ratio);

  const deltaVsBenchmark = input.benchmark_area_sqft
    ? ((refinedAreaSqft - input.benchmark_area_sqft) / input.benchmark_area_sqft) * 100
    : null;
  const deltaVsTarget = targetAreaSqft
    ? ((refinedAreaSqft - targetAreaSqft) / targetAreaSqft) * 100
    : null;

  const iouPassed = iou == null ? true : iou >= T.min_iou_vs_target_mask;
  const ratioPassed = ratio == null ? true : ratio <= T.max_ratio_vs_target_mask;
  const confidencePassed = confidence >= T.min_confidence;
  const refinementPassedNative = iouPassed && ratioPassed && confidencePassed;

  // ── Ring sanity (closed + non-self-intersecting) ─────────────────────────
  const ringClosed =
    refinedClosed.length >= 4 &&
    refinedClosed[0][0] === refinedClosed[refinedClosed.length - 1][0] &&
    refinedClosed[0][1] === refinedClosed[refinedClosed.length - 1][1];
  const ringSelfIntersecting = isRingSelfIntersecting(refinedClosed);

  // ── Safe-refinement guard ───────────────────────────────────────────────
  const rawToRefinedAreaRatio = rawAreaSqft > 0 ? refinedAreaSqft / rawAreaSqft : 0;
  const rawIoUvsTarget = input.target_mask_grid
    ? computePolygonMaskIoU(raw, input.target_mask_grid, input.width, input.height)
    : null;
  const rawAreaVsBenchmarkPct = input.benchmark_area_sqft
    ? (Math.abs(rawAreaSqft - input.benchmark_area_sqft) / input.benchmark_area_sqft) * 100
    : null;
  const rawAreaVsTargetPct = targetAreaSqft
    ? (Math.abs(rawAreaSqft - targetAreaSqft) / targetAreaSqft) * 100
    : null;
  const rawNearReference =
    (rawAreaVsBenchmarkPct != null && rawAreaVsBenchmarkPct <= 25) ||
    (rawAreaVsTargetPct != null && rawAreaVsTargetPct <= 25);

  const _verticesRemovedPctEarly = raw.length > 0
    ? (removed / raw.length) * 100
    : 0;
  const _verticesRemovedFractionEarly = _verticesRemovedPctEarly / 100;

  const destructiveByRule = rawNearReference && rawToRefinedAreaRatio < 0.85;
  const destructiveByCollapse = rawToRefinedAreaRatio < 0.50;
  const destructiveByVertexLoss = _verticesRemovedPctEarly > 40;
  const destructive = destructiveByRule || destructiveByCollapse || destructiveByVertexLoss;

  // ── Benchmark-aware demotion (v1.3) ──────────────────────────────────────
  // Benchmark area MATCH alone does NOT promote a perimeter to "valid".
  // It only demotes a low target_mask_iou from hard-fail to a warning.
  // Final pass still requires shape/visual edge evidence (see shape gate below).
  let benchmarkSupportUsed = false;
  let benchmarkOverrideReason: string | null = null;
  let targetMaskIoULowDemoted = false;
  const confidenceWarnings: string[] = [];

  if (
    !destructive &&
    input.benchmark_area_sqft != null &&
    deltaVsBenchmark != null
  ) {
    const benchmarkDeltaAbs = Math.abs(deltaVsBenchmark);
    const eligible =
      benchmarkDeltaAbs <= 8 &&
      rawToRefinedAreaRatio >= 0.85 &&
      _verticesRemovedFractionEarly <= 0.20 &&
      refinedClosed.length >= 5 &&
      ringClosed &&
      !ringSelfIntersecting;
    if (eligible) {
      benchmarkSupportUsed = true;
      benchmarkOverrideReason =
        `benchmark_area_support:delta=${deltaVsBenchmark.toFixed(2)}%,` +
        `raw_to_refined_ratio=${rawToRefinedAreaRatio.toFixed(3)},` +
        `vertices_removed_pct=${_verticesRemovedPctEarly.toFixed(0)},` +
        `vertex_count=${refinedClosed.length}`;
      if (iou != null && iou < T.min_iou_vs_target_mask) {
        targetMaskIoULowDemoted = true;
        confidenceWarnings.push(
          `target_mask_iou_low_but_benchmark_area_passed:iou=${iou.toFixed(3)}<${T.min_iou_vs_target_mask}`,
        );
      }
    }
  }

  // ── Shape / visual edge validation (v1.3) — required gate ────────────────
  // benchmark_support_used kept for back-compat with consumers.
  const benchmarkOverrideUsed = benchmarkSupportUsed;
  const expectedMinVertices = computeExpectedMinVertices(input, refinedClosed.length);
  const shape = validatePerimeterShape({
    ring: refinedClosed,
    input,
    bboxDiagPx,
    rawAreaSqft,
    refinedAreaSqft,
    targetAreaSqft,
    benchmarkAreaSqft: input.benchmark_area_sqft ?? null,
    deltaVsBenchmark,
    deltaVsTarget,
    ringClosed,
    ringSelfIntersecting,
    expectedMinVertices,
    benchmarkSupportUsed,
  });

  // Refinement-native pass is now contingent on shape gate too.
  const refinementPassedNativeWithShape =
    refinementPassedNative && shape.shape_passed;
  const refinementPassed = (refinementPassedNativeWithShape || (benchmarkSupportUsed && shape.shape_passed));

  // Conservative raw gate: raw IoU >= 0.80 normally; relaxed to 0.65 when
  // raw area is shape-sane vs target/benchmark.
  const rawIoUThreshold = rawNearReference ? 0.65 : 0.80;
  const rawIoUOk = rawIoUvsTarget == null ? false : rawIoUvsTarget >= rawIoUThreshold;
  const rawAreaOk = rawNearReference;
  const conservativeRawPassed = rawIoUOk && rawAreaOk;

  let selected: 'raw_perimeter' | 'refined_perimeter';
  let fallbackUsed: 'raw_perimeter' | 'refined_perimeter' | null;
  let refinementRejected = false;
  let refinementRejectionReason: string | null = null;
  let provisionalReady = false;
  let passed: boolean;
  let hardFail: string | null;
  let returnedRing: PxPt[];
  let reason: string;
  let acceptanceSource: PerimeterRefinementDiagnostics['perimeter_acceptance_source'] = 'failed';
  let confidenceSource: PerimeterRefinementDiagnostics['confidence_source'] = null;
  let effectiveConfidence = confidence;
  let perimeterStatus: 'valid' | 'provisional' | 'failed' = 'failed';

  if (destructive) {
    refinementRejected = true;
    const triggers: string[] = [];
    if (destructiveByRule) triggers.push('refined_lost_gt15pct_of_sane_raw');
    if (destructiveByCollapse) triggers.push(`absolute_collapse_ratio=${rawToRefinedAreaRatio.toFixed(2)}`);
    if (destructiveByVertexLoss) triggers.push(`vertex_loss_pct=${_verticesRemovedPctEarly.toFixed(0)}`);
    refinementRejectionReason = `destructive_refinement_collapse:${triggers.join('|')}`;
    fallbackUsed = 'raw_perimeter';
    selected = 'raw_perimeter';
    returnedRing = raw;
    if (conservativeRawPassed) {
      passed = true;
      hardFail = null;
      provisionalReady = true;
      perimeterStatus = 'provisional';
      acceptanceSource = 'raw_fallback';
      confidenceSource = 'raw_fallback';
      reason = `raw_fallback_after_destructive_refinement:rawIoU=${rawIoUvsTarget?.toFixed(2)}:triggers=${triggers.join('|')}`;
    } else {
      passed = false;
      hardFail = 'perimeter_shape_not_accurate';
      perimeterStatus = 'failed';
      acceptanceSource = 'failed';
      reason = `destructive_refinement_collapse_and_raw_failed_conservative_gate:` +
        `rawIoU=${rawIoUvsTarget?.toFixed(2)},rawAreaOk=${rawAreaOk},triggers=${triggers.join('|')}`;
    }
  } else if (!shape.shape_passed) {
    // Shape gate is authoritative: area-only matches are NOT accepted.
    selected = 'refined_perimeter';
    fallbackUsed = null;
    returnedRing = refinedClosed; // keep for diagram
    if (shape.shape_uncertain) {
      passed = false;
      hardFail = 'perimeter_shape_not_accurate';
      perimeterStatus = 'provisional';
      provisionalReady = true;
      acceptanceSource = 'failed';
      reason = `perimeter_shape_uncertain:${shape.shape_failure_reasons.join('|')}`;
    } else {
      passed = false;
      hardFail = 'perimeter_shape_not_accurate';
      perimeterStatus = 'failed';
      acceptanceSource = 'failed';
      reason = `visual_perimeter_alignment_failed:${shape.shape_failure_reasons.join('|')}`;
    }
  } else if (benchmarkSupportUsed) {
    passed = true;
    hardFail = null;
    selected = 'refined_perimeter';
    fallbackUsed = 'refined_perimeter';
    returnedRing = refinedClosed;
    perimeterStatus = 'valid';
    acceptanceSource = 'benchmark_area_sanity';
    confidenceSource = 'benchmark_area_sanity';
    effectiveConfidence = Math.max(confidence, 0.85);
    reason = `benchmark_area_support_plus_shape_validated:delta=${deltaVsBenchmark!.toFixed(2)}%` +
      (targetMaskIoULowDemoted ? `:target_mask_iou_demoted=${iou?.toFixed(3)}` : '') +
      `:edge_align=${shape.visual_edge_alignment_score.toFixed(2)}:vertices=${refinedClosed.length}`;
  } else if (refinementPassedNative) {
    passed = true;
    hardFail = null;
    selected = 'refined_perimeter';
    fallbackUsed = 'refined_perimeter';
    returnedRing = refinedClosed;
    perimeterStatus = 'valid';
    acceptanceSource = 'target_mask_iou';
    confidenceSource = 'target_mask_iou';
    reason = `refined_${input.raw_perimeter_source}:vertices=${refinedClosed.length}:iou=${iou?.toFixed(2)}:edge_align=${shape.visual_edge_alignment_score.toFixed(2)}`;
  } else {
    // Refinement failed but not destructive — try raw fallback if conservative gate passes.
    if (conservativeRawPassed) {
      passed = true;
      hardFail = null;
      selected = 'raw_perimeter';
      fallbackUsed = 'raw_perimeter';
      returnedRing = raw;
      provisionalReady = true;
      perimeterStatus = 'provisional';
      acceptanceSource = 'raw_fallback';
      confidenceSource = 'raw_fallback';
      reason = `raw_fallback_after_refinement_failed_conservative_passed:rawIoU=${rawIoUvsTarget?.toFixed(2)}`;
    } else {
      passed = false;
      hardFail = 'perimeter_shape_not_accurate';
      selected = 'refined_perimeter';
      fallbackUsed = null;
      returnedRing = raw;
      perimeterStatus = 'failed';
      acceptanceSource = 'failed';
      const failReasons: string[] = [];
      if (!iouPassed) failReasons.push(`iou:${iou?.toFixed(3)}<${T.min_iou_vs_target_mask}`);
      if (!ratioPassed) failReasons.push(`ratio:${ratio?.toFixed(3)}>${T.max_ratio_vs_target_mask}`);
      if (!confidencePassed) failReasons.push(`confidence:${confidence.toFixed(3)}<${T.min_confidence}`);
      reason = `perimeter_shape_not_accurate:${failReasons.join(',')}`;
    }
  }


  const appliedTree = treeRegions.filter(r => r.applied).length;
  const appliedPatio = patioRegions.filter(r => r.applied).length;
  const rejectedTree = treeRegions.length - appliedTree;
  const rejectedPatio = patioRegions.length - appliedPatio;
  const verticesRemovedPct = raw.length > 0 ? (removed / raw.length) * 100 : 0;

  const overlay = renderDebugOverlay(input, raw, refinedClosed, returnedRing, treeRegions, patioRegions, selected);

  const diagnostics: PerimeterRefinementDiagnostics = {
    phase3A_5_perimeter_refinement_version: 'v1',
    raw_perimeter_source: input.raw_perimeter_source,
    raw_perimeter_vertex_count: raw.length,
    refined_perimeter_vertex_count: refinedClosed.length,
    raw_mask_contour_area_sqft: round(rawAreaSqft, 1),
    refined_perimeter_area_sqft: round(refinedAreaSqft, 1),
    perimeter_area_delta_pct_vs_target_mask: deltaVsTarget != null ? round(deltaVsTarget, 2) : null,
    perimeter_area_delta_pct_vs_benchmark: deltaVsBenchmark != null ? round(deltaVsBenchmark, 2) : null,
    perimeter_to_target_mask_ratio: ratio != null ? round(ratio, 3) : null,
    perimeter_vs_mask_iou: iou != null ? round(iou, 3) : null,
    perimeter_confidence: round(effectiveConfidence, 3),
    tree_shadow_exclusion_regions: treeRegions,
    patio_screen_exclusion_regions: patioRegions,
    aerial_snap_vertices_added: added,
    aerial_snap_vertices_removed: removed,
    aerial_snap_vertices_moved: moved,
    perimeter_refinement_reason: reason,
    perimeter_refinement_passed: refinementPassed,
    acceptance_gate: {
      iou_threshold: T.min_iou_vs_target_mask,
      iou_actual: iou != null ? round(iou, 3) : null,
      iou_passed: iouPassed,
      ratio_threshold: T.max_ratio_vs_target_mask,
      ratio_actual: ratio != null ? round(ratio, 3) : null,
      ratio_passed: ratioPassed,
      confidence_threshold: T.min_confidence,
      confidence_actual: round(confidence, 3),
      confidence_passed: confidencePassed,
    },
    raw_to_refined_area_ratio: round(rawToRefinedAreaRatio, 3),
    raw_iou_vs_target: rawIoUvsTarget != null ? round(rawIoUvsTarget, 3) : null,
    raw_area_vs_benchmark_delta_pct: rawAreaVsBenchmarkPct != null ? round(rawAreaVsBenchmarkPct, 2) : null,
    raw_area_vs_target_delta_pct: rawAreaVsTargetPct != null ? round(rawAreaVsTargetPct, 2) : null,
    vertices_removed_pct: round(verticesRemovedPct, 2),
    destructive_refinement_detected: destructive,
    refinement_rejected: refinementRejected,
    refinement_rejection_reason: refinementRejectionReason,
    refinement_fallback_used: fallbackUsed,
    selected_perimeter_after_refinement: selected,
    provisional_perimeter_ready: provisionalReady,
    conservative_raw_gate: {
      iou_threshold: rawIoUThreshold,
      iou_actual: rawIoUvsTarget != null ? round(rawIoUvsTarget, 3) : null,
      iou_ok: rawIoUOk,
      area_ok: rawAreaOk,
      passed: conservativeRawPassed,
    },
    benchmark_override_used: benchmarkOverrideUsed,
    benchmark_override_reason: benchmarkOverrideReason,
    benchmark_support_used: benchmarkSupportUsed,
    benchmark_area_delta_pct: deltaVsBenchmark != null ? round(deltaVsBenchmark, 2) : null,
    target_mask_iou_demoted_to_warning: targetMaskIoULowDemoted,
    perimeter_acceptance_source: acceptanceSource,
    confidence_source: confidenceSource,
    confidence_warnings: confidenceWarnings,
    ring_closed: ringClosed,
    ring_self_intersecting: ringSelfIntersecting,
    applied_tree_exclusions_count: appliedTree,
    rejected_tree_exclusions_count: rejectedTree,
    applied_patio_exclusions_count: appliedPatio,
    rejected_patio_exclusions_count: rejectedPatio,
    footprint_bbox_diagonal_px: round(bboxDiagPx, 1),
    snap_distance_cap_px: snapCapPx,
    expected_min_vertices: expectedMinVertices,
    perimeter_status: perimeterStatus,
    shape_validation: shape,
    debug_perimeter_overlay_svg: overlay,
    // ── v1.4 manual visual-QA gate ──────────────────────────────────────────
    perimeter_visual_review_required: false, // populated below
    visual_review_gate: {
      thresholds: { ...DEFAULT_VISUAL_REVIEW_THRESHOLDS, ...(input.visual_review_thresholds ?? {}) },
      metrics: {
        visual_edge_alignment_score: shape.visual_edge_alignment_score,
        aerial_edge_support_pct: shape.aerial_edge_support_pct,
        corner_snap_confidence: shape.corner_snap_confidence,
        long_segment_corner_cut_count: shape.long_segment_corner_cut_count,
        non_roof_crossing_count: shape.non_roof_crossing_count,
      },
      passed: false,
      failed_metrics: [],
    },
    user_verified_perimeter: !!input.user_verified_perimeter,
    perimeter_source_locked: null,
  };

  // ── Compute visual-review gate (v1.4) ──────────────────────────────────────
  const vrT = diagnostics.visual_review_gate.thresholds;
  const vrFails: string[] = [];
  if (shape.visual_edge_alignment_score < vrT.min_visual_edge_alignment_score) {
    vrFails.push(`visual_edge_alignment_score=${shape.visual_edge_alignment_score.toFixed(2)}<${vrT.min_visual_edge_alignment_score}`);
  }
  if (shape.aerial_edge_support_pct == null || shape.aerial_edge_support_pct < vrT.min_aerial_edge_support_pct) {
    vrFails.push(`aerial_edge_support_pct=${shape.aerial_edge_support_pct?.toFixed(2) ?? 'null'}<${vrT.min_aerial_edge_support_pct}`);
  }
  if (shape.corner_snap_confidence < vrT.min_corner_snap_confidence) {
    vrFails.push(`corner_snap_confidence=${shape.corner_snap_confidence.toFixed(2)}<${vrT.min_corner_snap_confidence}`);
  }
  if (shape.long_segment_corner_cut_count > vrT.max_long_segment_corner_cut_count) {
    vrFails.push(`long_segment_corner_cut_count=${shape.long_segment_corner_cut_count}>${vrT.max_long_segment_corner_cut_count}`);
  }
  if (shape.non_roof_crossing_count > vrT.max_non_roof_crossing_count) {
    vrFails.push(`non_roof_crossing_count=${shape.non_roof_crossing_count}>${vrT.max_non_roof_crossing_count}`);
  }
  const visualGatePassed = vrFails.length === 0;
  diagnostics.visual_review_gate.passed = visualGatePassed;
  diagnostics.visual_review_gate.failed_metrics = vrFails;

  // Manual override: human approved the overlay — lock the selected perimeter
  // as authoritative, bypass the visual-review gate, mark source as
  // manual_override. Numeric shape failure still wins (don't promote junk).
  if (input.user_verified_perimeter && shape.shape_passed && !destructive) {
    diagnostics.perimeter_visual_review_required = false;
    diagnostics.perimeter_acceptance_source = 'manual_override';
    diagnostics.perimeter_source_locked = `user_verified_${selected}`;
    diagnostics.perimeter_status = 'valid';
    diagnostics.perimeter_refinement_passed = true;
    diagnostics.perimeter_refinement_reason =
      `manual_override:user_verified_perimeter:${diagnostics.perimeter_refinement_reason}`;
    // Caller is responsible for keeping customer_report_ready=false until
    // downstream topology gates also pass.
  } else {
    // Visual review is required whenever the perimeter is accepted (numerically)
    // but does not meet the stricter visual-QA thresholds.
    diagnostics.perimeter_visual_review_required = passed && !visualGatePassed;
  }

  return {
    refined_perimeter_px: returnedRing,
    passed,
    hard_fail_reason: hardFail,
    diagnostics,
  };
}


// ────────────────────────────────────────────────────────────────────────────
// Exclusion: tree canopy / patio cage / shadow / no-solar-support / outlier
// ────────────────────────────────────────────────────────────────────────────

function identifyExcludedRegions(
  ring: PxPt[],
  input: PerimeterRefinementInput,
  T: RefinementThresholds,
  totalAreaPx: number,
): { keepFlags: boolean[]; treeRegions: ExcludedRegion[]; patioRegions: ExcludedRegion[] } {
  const keepFlags = new Array<boolean>(ring.length).fill(true);
  const treeRegions: ExcludedRegion[] = [];
  const patioRegions: ExcludedRegion[] = [];

  const centroid = input.roof_centroid_px ?? polygonCentroid(ring);
  const radii = ring.map(([x, y]) => Math.hypot(x - centroid[0], y - centroid[1]));
  const sortedRadii = [...radii].sort((a, b) => a - b);
  const medianRadius = sortedRadii[Math.floor(sortedRadii.length / 2)] || 1;

  // Helper — only apply (drop keep flag) if region passes the safety gate.
  // Single-vertex / 1-px-area candidates are recorded with applied=false.
  const MIN_REGION_AREA_PX = 25;
  const MIN_REGION_UNIQUE_POINTS = 3;
  const MAX_AREA_FRACTION_DROP = 0.15;

  function pushCandidate(
    bucket: ExcludedRegion[],
    reason: ExcludedRegion['reason'],
    vertexIndices: number[],
    pts: PxPt[],
    strongEvidence: boolean,
  ): void {
    const region = makeRegion(reason, vertexIndices, pts);
    const uniquePts = new Set(pts.map(p => `${p[0]},${p[1]}`)).size;
    const areaOk = region.area_px >= MIN_REGION_AREA_PX;
    const polyOk = uniquePts >= MIN_REGION_UNIQUE_POINTS;
    // Approximate area-drop guard: each vertex carries ~area/N share.
    const sharePctDrop = ring.length > 0 ? (vertexIndices.length / ring.length) : 1;
    const shareOk = sharePctDrop <= MAX_AREA_FRACTION_DROP || strongEvidence;

    if (areaOk && polyOk && shareOk) {
      region.applied = true;
      for (const idx of vertexIndices) keepFlags[idx] = false;
    } else {
      region.applied = false;
      const why: string[] = [];
      if (!areaOk) why.push(`area_px<${MIN_REGION_AREA_PX}`);
      if (!polyOk) why.push(`unique_pts<${MIN_REGION_UNIQUE_POINTS}`);
      if (!shareOk) why.push(`share>${MAX_AREA_FRACTION_DROP}_without_strong_evidence`);
      region.rejection_reason = why.join(',') || 'unspecified';
    }
    bucket.push(region);
  }

  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i];
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= input.width || iy >= input.height) {
      // Out-of-bounds is always dropped (geometric necessity), not exclusion logic.
      keepFlags[i] = false;
      continue;
    }
    const idx = iy * input.width + ix;

    // 1. Centroid outlier (single vertex flag — recorded but not applied)
    if (radii[i] > medianRadius * T.max_centroid_distance_factor) {
      pushCandidate(treeRegions, 'centroid_outlier', [i], [ring[i]], false);
      continue;
    }

    // 2. No solar support + low DSM
    if (input.solar_segment_masks_px && !input.solar_segment_masks_px[idx]) {
      const dsmHere = input.dsm_grid?.[idx] ?? null;
      const isLowDsm = dsmHere != null && dsmHere < T.dsm_min_roof_height_m;
      if (isLowDsm) {
        pushCandidate(treeRegions, 'no_solar_support', [i], [ring[i]], false);
        continue;
      }
    }

    // 3. Vegetation / shadow in RGB
    if (input.rgba) {
      const r = input.rgba[idx * 4];
      const g = input.rgba[idx * 4 + 1];
      const b = input.rgba[idx * 4 + 2];
      const isVegetation = g > 80 && g > r * 1.15 && g > b * 1.15;
      const isShadow = r < 35 && g < 35 && b < 35;
      if (isVegetation) {
        pushCandidate(treeRegions, 'tree_canopy', [i], [ring[i]], false);
        continue;
      }
      if (isShadow) {
        pushCandidate(treeRegions, 'shadow', [i], [ring[i]], false);
        continue;
      }
    }

    // 4. Low DSM = patio / ground
    const dsmHere = input.dsm_grid?.[idx] ?? null;
    if (dsmHere != null && dsmHere < T.dsm_min_roof_height_m) {
      pushCandidate(patioRegions, 'low_dsm', [i], [ring[i]], false);
      continue;
    }
  }

  void totalAreaPx; // reserved for future region-area accounting
  return { keepFlags, treeRegions, patioRegions };
}

function makeRegion(
  reason: ExcludedRegion['reason'],
  vertex_indices: number[],
  pts: PxPt[],
): ExcludedRegion {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    reason,
    vertex_indices,
    bbox_px: { minX, minY, maxX, maxY },
    area_px: Math.max(1, (maxX - minX) * (maxY - minY)),
    applied: false,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Snap vertices to nearest strong DSM/RGB edge (Sobel magnitude on DSM grid).
// ────────────────────────────────────────────────────────────────────────────

function snapVerticesToEdges(
  ring: PxPt[],
  keepFlags: boolean[],
  input: PerimeterRefinementInput,
  T: RefinementThresholds,
): { snapped: PxPt[]; moved: number } {
  if (!input.dsm_grid) return { snapped: ring, moved: 0 };
  const W = input.width;
  const H = input.height;
  const snapped: PxPt[] = [];
  let moved = 0;
  for (let i = 0; i < ring.length; i++) {
    if (!keepFlags[i]) {
      snapped.push(ring[i]);
      continue;
    }
    const [x, y] = ring[i];
    const cx = Math.round(x);
    const cy = Math.round(y);
    let bestX = cx;
    let bestY = cy;
    let bestMag = sobelMagAt(input.dsm_grid, cx, cy, W, H);
    const r = T.max_snap_distance_px;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
        const m = sobelMagAt(input.dsm_grid, nx, ny, W, H);
        if (m > bestMag * 1.15) { // require 15% stronger to move
          bestMag = m;
          bestX = nx;
          bestY = ny;
        }
      }
    }
    if (bestX !== cx || bestY !== cy) moved++;
    snapped.push([bestX, bestY]);
  }
  return { snapped, moved };
}

function sobelMagAt(grid: Float32Array, x: number, y: number, W: number, H: number): number {
  if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return 0;
  const i = (yy: number, xx: number) => grid[yy * W + xx];
  const gx =
    -i(y - 1, x - 1) - 2 * i(y, x - 1) - i(y + 1, x - 1) +
    i(y - 1, x + 1) + 2 * i(y, x + 1) + i(y + 1, x + 1);
  const gy =
    -i(y - 1, x - 1) - 2 * i(y - 1, x) - i(y - 1, x + 1) +
    i(y + 1, x - 1) + 2 * i(y + 1, x) + i(y + 1, x + 1);
  return Math.hypot(gx, gy);
}

// ────────────────────────────────────────────────────────────────────────────
// Insert missing corners where polygon segments cross strong perpendicular DSM edges.
// ────────────────────────────────────────────────────────────────────────────

function insertMissingCorners(
  ring: PxPt[],
  input: PerimeterRefinementInput,
  T: RefinementThresholds,
): { withInserted: PxPt[]; added: number } {
  if (!input.dsm_grid) return { withInserted: ring, added: 0 };
  const out: PxPt[] = [];
  let added = 0;
  for (let i = 0; i < ring.length; i++) {
    out.push(ring[i]);
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segLen < 24) continue; // only consider long segments
    // Sample 3 candidate insertion points along the segment.
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const perpx = -dy / segLen;
    const perpy = dx / segLen;
    let bestT = -1;
    let bestStep = 0;
    for (let k = 1; k <= 3; k++) {
      const t = k / 4;
      const px = a[0] + dx * t;
      const py = a[1] + dy * t;
      // Probe perpendicular distance for a strong edge crossing.
      let strongest = 0;
      for (let s = -3; s <= 3; s++) {
        const sx = Math.round(px + perpx * s);
        const sy = Math.round(py + perpy * s);
        const m = sobelMagAt(input.dsm_grid, sx, sy, input.width, input.height);
        if (m > strongest) {
          strongest = m;
          if (m > bestStep) {
            bestStep = m;
            bestT = t;
          }
        }
      }
    }
    // Threshold: 1.5× average sobel along the segment baseline.
    const baseline = sobelMagAt(input.dsm_grid, Math.round(a[0]), Math.round(a[1]), input.width, input.height);
    if (bestT > 0 && bestStep > Math.max(8, baseline * 1.5)) {
      const ix = a[0] + dx * bestT;
      const iy = a[1] + dy * bestT;
      out.push([Math.round(ix), Math.round(iy)]);
      added++;
    }
  }
  return { withInserted: out, added };
}

// ────────────────────────────────────────────────────────────────────────────
// Confidence scoring
// ────────────────────────────────────────────────────────────────────────────

function computeConfidence(
  refined: PxPt[],
  input: PerimeterRefinementInput,
  T: RefinementThresholds,
  iou: number | null,
  ratio: number | null,
): number {
  let score = 0.5;
  if (iou != null) score += 0.3 * Math.max(0, Math.min(1, (iou - 0.6) / 0.4));
  if (ratio != null) {
    const ratioPenalty = Math.max(0, Math.abs(ratio - 1) - 0.05);
    score -= 0.3 * Math.min(1, ratioPenalty);
  }
  // Vertex-count signal: complex roofs need more vertices.
  const minVerts = T.min_complex_vertex_count;
  if (refined.length >= minVerts) score += 0.1;
  if (refined.length < 5) score -= 0.2;
  return Math.max(0, Math.min(1, score));
}

// ────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ────────────────────────────────────────────────────────────────────────────

function closeRing(ring: PxPt[]): PxPt[] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, [first[0], first[1]]];
}

function polygonAreaPx(ring: PxPt[]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area) / 2;
}

function polygonCentroid(ring: PxPt[]): PxPt {
  let cx = 0, cy = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) { cx += ring[i][0]; cy += ring[i][1]; }
  return [cx / n, cy / n];
}

function maskAreaPx(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

function computePolygonMaskIoU(ring: PxPt[], mask: Uint8Array, W: number, H: number): number {
  // Rasterize polygon then intersect.
  const poly = new Uint8Array(W * H);
  rasterizePolygon(ring, W, H, poly);
  let inter = 0;
  let union = 0;
  for (let i = 0; i < W * H; i++) {
    const a = poly[i] ? 1 : 0;
    const b = mask[i] ? 1 : 0;
    if (a || b) union++;
    if (a && b) inter++;
  }
  return union > 0 ? inter / union : 0;
}

function rasterizePolygon(ring: PxPt[], W: number, H: number, out: Uint8Array): void {
  // Scanline polygon fill (even-odd rule).
  for (let y = 0; y < H; y++) {
    const xs: number[] = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        const t = (y - y1) / (y2 - y1);
        xs.push(x1 + t * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x1 = Math.max(0, Math.floor(xs[k]));
      const x2 = Math.min(W - 1, Math.ceil(xs[k + 1]));
      for (let x = x1; x <= x2; x++) out[y * W + x] = 1;
    }
  }
}

function douglasPeucker(pts: PxPt[], eps: number): PxPt[] {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistance(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function perpDistance(p: PxPt, a: PxPt, b: PxPt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

function round(x: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(x * f) / f;
}

// ────────────────────────────────────────────────────────────────────────────
// Debug overlay (lightweight inline SVG; persisted into geometry_report_json)
// ────────────────────────────────────────────────────────────────────────────

function renderDebugOverlay(
  input: PerimeterRefinementInput,
  raw: PxPt[],
  refined: PxPt[],
  selected: PxPt[],
  trees: ExcludedRegion[],
  patios: ExcludedRegion[],
  selectedLabel: 'raw_perimeter' | 'refined_perimeter',
): string | null {
  try {
    const W = input.width;
    const H = input.height;
    const path = (pts: PxPt[]) =>
      pts.length ? 'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L') + ' Z' : '';
    const dots = (regions: ExcludedRegion[], appliedColor: string, rejectedColor: string) =>
      regions.map(r => {
        const cx = (r.bbox_px.minX + r.bbox_px.maxX) / 2;
        const cy = (r.bbox_px.minY + r.bbox_px.maxY) / 2;
        const color = r.applied ? appliedColor : rejectedColor;
        return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="${color}" opacity="0.85"/>`;
      }).join('');
    // Don't double-draw selected if it equals raw or refined; still draw blue for clarity.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
      `<path d="${path(raw)}" fill="none" stroke="#888" stroke-width="1.5" opacity="0.8"/>` +
      `<path d="${path(refined)}" fill="none" stroke="#00c853" stroke-width="2" opacity="0.9"/>` +
      `<path d="${path(selected)}" fill="none" stroke="#2196f3" stroke-width="2.5" stroke-dasharray="4,3" opacity="0.95"/>` +
      dots(trees, '#ff9800', '#ff5252') +
      dots(patios, '#ff9800', '#ff5252') +
      `<title>selected=${selectedLabel}</title>` +
      `</svg>`;
  } catch {
    return null;
  }
}

function failResult(
  source: string,
  rawVerts: number,
  rawAreaSqft: number,
  T: RefinementThresholds,
  hardFail: string,
  reason: string,
): PerimeterRefinementResult {
  return {
    refined_perimeter_px: [],
    passed: false,
    hard_fail_reason: hardFail,
    diagnostics: {
      phase3A_5_perimeter_refinement_version: 'v1',
      raw_perimeter_source: source,
      raw_perimeter_vertex_count: rawVerts,
      refined_perimeter_vertex_count: 0,
      raw_mask_contour_area_sqft: round(rawAreaSqft, 1),
      refined_perimeter_area_sqft: 0,
      perimeter_area_delta_pct_vs_target_mask: null,
      perimeter_area_delta_pct_vs_benchmark: null,
      perimeter_to_target_mask_ratio: null,
      perimeter_vs_mask_iou: null,
      perimeter_confidence: 0,
      tree_shadow_exclusion_regions: [],
      patio_screen_exclusion_regions: [],
      aerial_snap_vertices_added: 0,
      aerial_snap_vertices_removed: 0,
      aerial_snap_vertices_moved: 0,
      perimeter_refinement_reason: reason,
      perimeter_refinement_passed: false,
      acceptance_gate: {
        iou_threshold: T.min_iou_vs_target_mask,
        iou_actual: null,
        iou_passed: false,
        ratio_threshold: T.max_ratio_vs_target_mask,
        ratio_actual: null,
        ratio_passed: false,
        confidence_threshold: T.min_confidence,
        confidence_actual: 0,
        confidence_passed: false,
      },
      raw_to_refined_area_ratio: null,
      raw_iou_vs_target: null,
      raw_area_vs_benchmark_delta_pct: null,
      raw_area_vs_target_delta_pct: null,
      vertices_removed_pct: 0,
      destructive_refinement_detected: false,
      refinement_rejected: false,
      refinement_rejection_reason: null,
      refinement_fallback_used: null,
      selected_perimeter_after_refinement: 'refined_perimeter',
      provisional_perimeter_ready: false,
      conservative_raw_gate: {
        iou_threshold: 0.80,
        iou_actual: null,
        iou_ok: false,
        area_ok: false,
        passed: false,
      },
      benchmark_override_used: false,
      benchmark_override_reason: null,
      benchmark_support_used: false,
      benchmark_area_delta_pct: null,
      target_mask_iou_demoted_to_warning: false,
      perimeter_acceptance_source: 'failed',
      confidence_source: null,
      confidence_warnings: [],
      ring_closed: false,
      ring_self_intersecting: false,
      applied_tree_exclusions_count: 0,
      rejected_tree_exclusions_count: 0,
      applied_patio_exclusions_count: 0,
      rejected_patio_exclusions_count: 0,
      footprint_bbox_diagonal_px: 0,
      snap_distance_cap_px: T.max_snap_distance_px,
      expected_min_vertices: 0,
      perimeter_status: 'failed',
      shape_validation: EMPTY_SHAPE_VALIDATION(),
      debug_perimeter_overlay_svg: null,
      perimeter_visual_review_required: false,
      visual_review_gate: {
        thresholds: DEFAULT_VISUAL_REVIEW_THRESHOLDS,
        metrics: {
          visual_edge_alignment_score: 0,
          aerial_edge_support_pct: null,
          corner_snap_confidence: 0,
          long_segment_corner_cut_count: 0,
          non_roof_crossing_count: 0,
        },
        passed: false,
        failed_metrics: ['perimeter_refinement_short_circuit'],
      },
      user_verified_perimeter: false,
      perimeter_source_locked: null,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Ring self-intersection check (O(n²) segment-vs-segment).
// Adjacent (and wrap-adjacent) edges are excluded.
// ────────────────────────────────────────────────────────────────────────────
function isRingSelfIntersecting(ring: PxPt[]): boolean {
  if (ring.length < 5) return false;
  // Treat ring as closed; ignore duplicate closing vertex if present.
  const n =
    ring.length >= 2 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.length - 1
      : ring.length;
  if (n < 4) return false;
  const segs: [PxPt, PxPt][] = [];
  for (let i = 0; i < n; i++) segs.push([ring[i], ring[(i + 1) % n]]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      // Skip adjacent (and wrap-adjacent) segments.
      if (j === i + 1) continue;
      if (i === 0 && j === segs.length - 1) continue;
      if (segmentsIntersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) return true;
    }
  }
  return false;
}

function segmentsIntersect(p1: PxPt, p2: PxPt, p3: PxPt, p4: PxPt): boolean {
  const d = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = d(p3[0], p3[1], p4[0], p4[1], p1[0], p1[1]);
  const d2 = d(p3[0], p3[1], p4[0], p4[1], p2[0], p2[1]);
  const d3 = d(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
  const d4 = d(p1[0], p1[1], p2[0], p2[1], p4[0], p4[1]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}


// ────────────────────────────────────────────────────────────────────────────
// v1.3 — Shape / visual edge validation
// ────────────────────────────────────────────────────────────────────────────

function EMPTY_SHAPE_VALIDATION(): ShapeValidation {
  return {
    area_sanity_passed: false,
    vertex_sanity_passed: false,
    visual_edge_alignment_score: 0,
    aerial_edge_support_pct: null,
    aerial_edge_support_sample_count: 0,
    aerial_edge_supported_sample_count: 0,
    aerial_edge_unsupported_segments: [],
    dsm_boundary_support_pct: null,
    corner_snap_confidence: 0,
    long_segment_corner_cut_count: 0,
    long_segment_corner_cut_midpoints_px: [],
    non_roof_crossing_count: 0,
    centroid_shift_px: 0,
    centroid_shift_threshold_px: 0,
    target_overlap_with_perimeter: null,
    expected_min_vertices: 0,
    actual_vertex_count: 0,
    shape_passed: false,
    shape_uncertain: false,
    shape_failure_reasons: ['not_evaluated'],
    warnings: [],
    segment_diagnostics: [],
  };
}


function computeExpectedMinVertices(input: PerimeterRefinementInput, actualVerts: number): number {
  // Heuristic: complex roofs need ≥ (segments + 2) outer vertices.
  // Benchmark facet count, if available, is the strongest prior.
  const candidates: number[] = [6];
  if (input.benchmark_facet_count && input.benchmark_facet_count > 0) {
    candidates.push(Math.min(40, input.benchmark_facet_count + 2));
  }
  if (input.solar_segment_count && input.solar_segment_count > 0) {
    // Solar over-segments by ~1.5×; ground truth perimeter has fewer outer corners.
    candidates.push(Math.min(40, Math.round(input.solar_segment_count * 0.6) + 4));
  }
  void actualVerts;
  return Math.max(...candidates);
}

interface ShapeValidationInput {
  ring: PxPt[];
  input: PerimeterRefinementInput;
  bboxDiagPx: number;
  rawAreaSqft: number;
  refinedAreaSqft: number;
  targetAreaSqft: number | null;
  benchmarkAreaSqft: number | null;
  deltaVsBenchmark: number | null;
  deltaVsTarget: number | null;
  ringClosed: boolean;
  ringSelfIntersecting: boolean;
  expectedMinVertices: number;
  benchmarkSupportUsed: boolean;
}

function validatePerimeterShape(args: ShapeValidationInput): ShapeValidation {
  const {
    ring, input, bboxDiagPx, refinedAreaSqft,
    targetAreaSqft, benchmarkAreaSqft, deltaVsBenchmark, deltaVsTarget,
    ringClosed, ringSelfIntersecting, expectedMinVertices, benchmarkSupportUsed,
  } = args;

  const reasons: string[] = [];
  const warnings: string[] = [];

  // A. Area sanity
  let areaOk = false;
  if (benchmarkAreaSqft != null && deltaVsBenchmark != null) {
    areaOk = Math.abs(deltaVsBenchmark) <= 8;
    if (!areaOk) reasons.push(`area_delta_vs_benchmark=${deltaVsBenchmark.toFixed(2)}%>8%`);
  } else if (targetAreaSqft != null && deltaVsTarget != null) {
    areaOk = Math.abs(deltaVsTarget) <= 12;
    if (!areaOk) reasons.push(`area_delta_vs_target=${deltaVsTarget.toFixed(2)}%>12%`);
  } else {
    areaOk = refinedAreaSqft > 200;
    if (!areaOk) reasons.push('no_area_reference_and_perimeter_too_small');
  }

  // B. Vertex / ring sanity
  const actualVerts = Math.max(0, ring.length - 1); // drop closing dup
  if (!ringClosed) reasons.push('ring_not_closed');
  if (ringSelfIntersecting) reasons.push('ring_self_intersecting');
  const vertexCountOk = actualVerts >= 5;
  if (!vertexCountOk) reasons.push(`vertex_count=${actualVerts}<5`);
  const underDetailed = actualVerts < expectedMinVertices;
  if (underDetailed) {
    warnings.push(`perimeter_under_detailed_for_complex_roof:actual=${actualVerts}<expected=${expectedMinVertices}`);
  }
  const vertexSanityOk = vertexCountOk && ringClosed && !ringSelfIntersecting;

  // C. Visual edge alignment — sample N points along each segment
  const W = input.width;
  const H = input.height;
  const dsm = input.dsm_grid ?? null;
  const rgba = input.rgba ?? null;
  let dsmSupported = 0, dsmTotal = 0;
  let aerialSupported = 0, aerialTotal = 0;
  let nonRoofCrossing = 0;
  let longCornerCut = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 2) continue;
    const px = -dy / len;
    const py = dx / len;
    const samples = Math.max(2, Math.min(8, Math.round(len / 8)));

    let segMaxPerp = 0;
    for (let s = 1; s <= samples; s++) {
      const t = s / (samples + 1);
      const mx = a[0] + dx * t;
      const my = a[1] + dy * t;

      // DSM perpendicular gradient: max sobel in ±3 perpendicular band
      if (dsm) {
        dsmTotal++;
        let bestMag = 0;
        for (let k = -3; k <= 3; k++) {
          const sx = Math.round(mx + px * k);
          const sy = Math.round(my + py * k);
          const m = sobelMagAt(dsm, sx, sy, W, H);
          if (m > bestMag) bestMag = m;
        }
        if (bestMag > 8) dsmSupported++;
        if (bestMag > segMaxPerp) segMaxPerp = bestMag;
      }

      // Aerial RGB gradient
      if (rgba) {
        aerialTotal++;
        const supported = rgbEdgeStrengthAt(rgba, Math.round(mx), Math.round(my), W, H, px, py) > 18;
        if (supported) aerialSupported++;
      }

      // Non-roof crossing: ~8px inward, check solar/dsm support
      const inx = Math.round(mx - px * 8);
      const iny = Math.round(my - py * 8);
      if (inx >= 0 && iny >= 0 && inx < W && iny < H) {
        const idx = iny * W + inx;
        const noSolar = input.solar_segment_masks_px ? !input.solar_segment_masks_px[idx] : false;
        const lowDsm = dsm ? (dsm[idx] ?? 0) < 1.5 : false;
        if (noSolar && lowDsm) nonRoofCrossing++;
      }
    }

    // Long segment corner-cut detector: long segment with a strong off-axis
    // perpendicular edge mid-span suggests a missed corner.
    if (len > 40 && dsm) {
      const mx = a[0] + dx * 0.5;
      const my = a[1] + dy * 0.5;
      let perpStrong = 0;
      for (let k = -5; k <= 5; k++) {
        if (Math.abs(k) < 2) continue;
        const sx = Math.round(mx + px * k);
        const sy = Math.round(my + py * k);
        const m = sobelMagAt(dsm, sx, sy, W, H);
        if (m > perpStrong) perpStrong = m;
      }
      const baseline = sobelMagAt(dsm, Math.round(mx), Math.round(my), W, H);
      if (perpStrong > Math.max(12, baseline * 1.8)) longCornerCut++;
    }
  }

  const dsmPct = dsmTotal > 0 ? dsmSupported / dsmTotal : null;
  const aerialPct = aerialTotal > 0 ? aerialSupported / aerialTotal : null;

  // Composite visual edge alignment score (0..1).
  let visualScore = 0;
  let weight = 0;
  if (aerialPct != null) { visualScore += aerialPct * 0.6; weight += 0.6; }
  if (dsmPct != null)    { visualScore += dsmPct * 0.4;    weight += 0.4; }
  visualScore = weight > 0 ? visualScore / weight : 0;

  // D. Corner snap confidence — fraction of vertices on a strong DSM/RGB edge
  let cornerOk = 0, cornerTotal = 0;
  for (let i = 0; i < actualVerts; i++) {
    cornerTotal++;
    const [vx, vy] = ring[i];
    const ix = Math.round(vx);
    const iy = Math.round(vy);
    let strong = false;
    if (dsm) {
      const m = sobelMagAt(dsm, ix, iy, W, H);
      if (m > 10) strong = true;
    }
    if (!strong && rgba) {
      const m = rgbEdgeStrengthAt(rgba, ix, iy, W, H, 1, 0);
      if (m > 20) strong = true;
    }
    if (strong) cornerOk++;
  }
  const cornerConfidence = cornerTotal > 0 ? cornerOk / cornerTotal : 0;

  // E. Coverage sanity — target_overlap_with_perimeter
  let targetOverlap: number | null = null;
  if (input.target_mask_grid) {
    const poly = new Uint8Array(W * H);
    rasterizePolygon(ring, W, H, poly);
    let inter = 0, target = 0;
    for (let i = 0; i < W * H; i++) {
      const t = input.target_mask_grid[i] ? 1 : 0;
      target += t;
      if (t && poly[i]) inter++;
    }
    targetOverlap = target > 0 ? inter / target : null;
  }

  // F. Centroid shift vs confirmed roof centroid
  const centroid = polygonCentroid(ring);
  const ref = input.roof_centroid_px ?? centroid;
  const centroidShift = Math.hypot(centroid[0] - ref[0], centroid[1] - ref[1]);
  const centroidThreshold = Math.max(8, bboxDiagPx * 0.10);

  // Gate evaluation
  const edgeAlignOk = visualScore >= 0.75;
  const aerialOk = aerialPct == null || aerialPct >= 0.70;
  const dsmOk = dsmPct == null || dsmPct >= 0.60;
  const cornerSnapOk = cornerConfidence >= 0.65;
  const longCutOk = longCornerCut <= 1;
  const nonRoofOk = nonRoofCrossing === 0;
  const centroidOk = centroidShift <= centroidThreshold;
  const overlapOk = targetOverlap == null ? true : targetOverlap >= 0.90 || (targetOverlap >= 0.85 && edgeAlignOk);

  if (!edgeAlignOk) reasons.push(`visual_edge_alignment_score=${visualScore.toFixed(2)}<0.75`);
  if (!aerialOk)    reasons.push(`aerial_edge_support_pct=${aerialPct?.toFixed(2)}<0.70`);
  if (!dsmOk)       reasons.push(`dsm_boundary_support_pct=${dsmPct?.toFixed(2)}<0.60`);
  if (!cornerSnapOk) reasons.push(`corner_snap_confidence=${cornerConfidence.toFixed(2)}<0.65`);
  if (!longCutOk)   reasons.push(`long_segment_corner_cut_count=${longCornerCut}>1`);
  if (!nonRoofOk)   reasons.push(`non_roof_crossing_count=${nonRoofCrossing}>0`);
  if (!centroidOk)  reasons.push(`centroid_shift_px=${centroidShift.toFixed(1)}>${centroidThreshold.toFixed(1)}`);
  if (!overlapOk)   reasons.push(`target_overlap_with_perimeter=${targetOverlap?.toFixed(2)}<0.90`);

  // Vertex under-detail is a WARNING, not a failure, when visual alignment is strong.
  if (underDetailed && !edgeAlignOk) {
    reasons.push(`vertex_count=${actualVerts}<expected_min=${expectedMinVertices}_and_visual_align_weak`);
  }

  const hardChecks = [areaOk, vertexSanityOk, edgeAlignOk, aerialOk, dsmOk, cornerSnapOk, longCutOk, nonRoofOk, centroidOk, overlapOk];
  const failCount = hardChecks.filter(v => !v).length;
  const shapePassed = failCount === 0;
  // Uncertain: 1–2 soft failures and core area+vertex+overlap still hold
  const shapeUncertain = !shapePassed && failCount <= 2 && areaOk && vertexSanityOk && (overlapOk || (targetOverlap != null && targetOverlap >= 0.80));

  if (benchmarkSupportUsed) {
    warnings.push('benchmark_support_used_but_shape_gate_authoritative');
  }

  return {
    area_sanity_passed: areaOk,
    vertex_sanity_passed: vertexSanityOk,
    visual_edge_alignment_score: round(visualScore, 3),
    aerial_edge_support_pct: aerialPct != null ? round(aerialPct, 3) : null,
    dsm_boundary_support_pct: dsmPct != null ? round(dsmPct, 3) : null,
    corner_snap_confidence: round(cornerConfidence, 3),
    long_segment_corner_cut_count: longCornerCut,
    non_roof_crossing_count: nonRoofCrossing,
    centroid_shift_px: round(centroidShift, 1),
    centroid_shift_threshold_px: round(centroidThreshold, 1),
    target_overlap_with_perimeter: targetOverlap != null ? round(targetOverlap, 3) : null,
    expected_min_vertices: expectedMinVertices,
    actual_vertex_count: actualVerts,
    shape_passed: shapePassed,
    shape_uncertain: shapeUncertain,
    shape_failure_reasons: reasons,
    warnings,
  };
}

function rgbEdgeStrengthAt(
  rgba: Uint8ClampedArray | Uint8Array,
  x: number, y: number, W: number, H: number,
  px: number, py: number,
): number {
  if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return 0;
  const lum = (xx: number, yy: number) => {
    const i = (yy * W + xx) * 4;
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  };
  // Sample perpendicular gradient
  const x1 = Math.round(x - px * 2), y1 = Math.round(y - py * 2);
  const x2 = Math.round(x + px * 2), y2 = Math.round(y + py * 2);
  if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0 || x1 >= W || y1 >= H || x2 >= W || y2 >= H) return 0;
  return Math.abs(lum(x2, y2) - lum(x1, y1));
}
