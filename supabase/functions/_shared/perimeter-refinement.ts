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
  /** Confirmed roof centroid in DSM pixels. */
  roof_centroid_px?: PxPt | null;
  /** Acceptance thresholds (override defaults). */
  thresholds?: Partial<RefinementThresholds>;
}

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
}

export interface PerimeterRefinementResult {
  /** Refined perimeter polygon (DSM pixel space). Empty if hard-failed. */
  refined_perimeter_px: PxPt[];
  /** Whether the refinement passed the acceptance gate. */
  passed: boolean;
  /** Hard fail reason when !passed. Persisted into hard_fail_reason. */
  hard_fail_reason: string | null;
  /** Diagnostics bag — persist verbatim into geometry_report_json. */
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
  /** Rendered SVG overlay (gray=raw, blue=target, green=refined, red=rejected). */
  debug_perimeter_overlay_svg: string | null;
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

  if (raw.length < 4) {
    return failResult(input.raw_perimeter_source, raw.length, rawAreaSqft, T,
      'perimeter_shape_not_accurate', 'raw perimeter has <4 vertices');
  }

  // 1. Identify excluded regions (tree / patio / shadow / no-support / outlier).
  const { keepFlags, treeRegions, patioRegions } = identifyExcludedRegions(raw, input, T);

  // 2. Snap surviving vertices to nearest strong DSM/RGB edge.
  const { snapped, moved } = snapVerticesToEdges(raw, keepFlags, input, T);

  // 3. Insert missing corners where polygon segments cross strong perpendicular edges.
  const { withInserted, added } = insertMissingCorners(snapped, input, T);

  // 4. Drop vertices flagged for exclusion.
  const filtered = withInserted.filter((_, i) => keepFlags[i] !== false);
  const removed = withInserted.length - filtered.length;

  // 5. Re-simplify with Douglas-Peucker.
  const refined = filtered.length >= T.min_complex_vertex_count
    ? douglasPeucker(filtered, T.simplify_tolerance_px)
    : filtered;
  const refinedClosed = closeRing(refined);

  // 6. Compute acceptance metrics.
  const refinedAreaPx = polygonAreaPx(refinedClosed);
  const refinedAreaSqft = refinedAreaPx * sqftPerPx;
  const targetAreaPx = input.target_mask_grid
    ? maskAreaPx(input.target_mask_grid)
    : null;
  const targetAreaSqft = targetAreaPx != null ? targetAreaPx * sqftPerPx : null;

  const ratio = targetAreaSqft && targetAreaSqft > 0
    ? refinedAreaSqft / targetAreaSqft
    : null;
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

  const passed = iouPassed && ratioPassed && confidencePassed;
  const failReasons: string[] = [];
  if (!iouPassed) failReasons.push(`iou:${iou?.toFixed(3)}<${T.min_iou_vs_target_mask}`);
  if (!ratioPassed) failReasons.push(`ratio:${ratio?.toFixed(3)}>${T.max_ratio_vs_target_mask}`);
  if (!confidencePassed) failReasons.push(`confidence:${confidence.toFixed(3)}<${T.min_confidence}`);

  const reason = passed
    ? `refined_${input.raw_perimeter_source}:vertices=${refinedClosed.length}:iou=${iou?.toFixed(2)}`
    : `perimeter_shape_not_accurate:${failReasons.join(',')}`;

  const overlay = renderDebugOverlay(input, raw, refinedClosed, treeRegions, patioRegions);

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
    perimeter_confidence: round(confidence, 3),
    tree_shadow_exclusion_regions: treeRegions,
    patio_screen_exclusion_regions: patioRegions,
    aerial_snap_vertices_added: added,
    aerial_snap_vertices_removed: removed,
    aerial_snap_vertices_moved: moved,
    perimeter_refinement_reason: reason,
    perimeter_refinement_passed: passed,
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
    debug_perimeter_overlay_svg: overlay,
  };

  return {
    refined_perimeter_px: passed ? refinedClosed : raw, // keep raw on fail so downstream still has SOMETHING
    passed,
    hard_fail_reason: passed ? null : 'perimeter_shape_not_accurate',
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
): { keepFlags: boolean[]; treeRegions: ExcludedRegion[]; patioRegions: ExcludedRegion[] } {
  const keepFlags = new Array<boolean>(ring.length).fill(true);
  const treeRegions: ExcludedRegion[] = [];
  const patioRegions: ExcludedRegion[] = [];

  // Compute centroid + median radius for outlier detection.
  const centroid = input.roof_centroid_px ?? polygonCentroid(ring);
  const radii = ring.map(([x, y]) => Math.hypot(x - centroid[0], y - centroid[1]));
  const sortedRadii = [...radii].sort((a, b) => a - b);
  const medianRadius = sortedRadii[Math.floor(sortedRadii.length / 2)] || 1;

  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i];
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= input.width || iy >= input.height) {
      keepFlags[i] = false;
      continue;
    }
    const idx = iy * input.width + ix;

    // 1. Centroid outlier
    if (radii[i] > medianRadius * T.max_centroid_distance_factor) {
      keepFlags[i] = false;
      treeRegions.push(makeRegion('centroid_outlier', [i], [ring[i]]));
      continue;
    }

    // 2. Solar support: vertex outside all solar segments → suspect
    if (input.solar_segment_masks_px && !input.solar_segment_masks_px[idx]) {
      // Only exclude if also low DSM or vegetation in RGB
      const dsmHere = input.dsm_grid?.[idx] ?? null;
      const isLowDsm = dsmHere != null && dsmHere < T.dsm_min_roof_height_m;
      if (isLowDsm) {
        keepFlags[i] = false;
        treeRegions.push(makeRegion('no_solar_support', [i], [ring[i]]));
        continue;
      }
    }

    // 3. Vegetation in RGB (high green dominance)
    if (input.rgba) {
      const r = input.rgba[idx * 4];
      const g = input.rgba[idx * 4 + 1];
      const b = input.rgba[idx * 4 + 2];
      const isVegetation =
        g > 80 && g > r * 1.15 && g > b * 1.15;
      const isShadow = r < 35 && g < 35 && b < 35;
      if (isVegetation) {
        keepFlags[i] = false;
        treeRegions.push(makeRegion('tree_canopy', [i], [ring[i]]));
        continue;
      }
      if (isShadow) {
        keepFlags[i] = false;
        treeRegions.push(makeRegion('shadow', [i], [ring[i]]));
        continue;
      }
    }

    // 4. Low DSM = ground / patio cage
    const dsmHere = input.dsm_grid?.[idx] ?? null;
    if (dsmHere != null && dsmHere < T.dsm_min_roof_height_m) {
      keepFlags[i] = false;
      patioRegions.push(makeRegion('low_dsm', [i], [ring[i]]));
      continue;
    }
  }

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
  trees: ExcludedRegion[],
  patios: ExcludedRegion[],
): string | null {
  try {
    const W = input.width;
    const H = input.height;
    const path = (pts: PxPt[]) =>
      pts.length ? 'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L') + ' Z' : '';
    const dots = (regions: ExcludedRegion[], color: string) =>
      regions.map(r => {
        const cx = (r.bbox_px.minX + r.bbox_px.maxX) / 2;
        const cy = (r.bbox_px.minY + r.bbox_px.maxY) / 2;
        return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="${color}" opacity="0.8"/>`;
      }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
      `<path d="${path(raw)}" fill="none" stroke="#888" stroke-width="1.5" opacity="0.8"/>` +
      `<path d="${path(refined)}" fill="none" stroke="#00c853" stroke-width="2" opacity="0.95"/>` +
      dots(trees, '#ff5252') +
      dots(patios, '#ff9800') +
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
      debug_perimeter_overlay_svg: null,
    },
  };
}
