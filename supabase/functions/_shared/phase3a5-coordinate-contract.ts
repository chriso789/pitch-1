export type Phase3A5CoordinateSpace =
  | "aerial_px"
  | "dsm_px"
  | "mask_px"
  | "unknown";

export type Phase3A5Point = [number, number];

export type Phase3A5Bbox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type Phase3A5FrameInput = {
  perimeter_coordinate_space?: string | null;
  target_mask_coordinate_space?: string | null;
  scorer_coordinate_space?: string | null;
  transform_used?: string | null;
};

export type Phase3A5FrameContract = {
  ok: boolean;
  hard_fail_reason:
    | "coordinate_space_contract_unknown"
    | "coordinate_space_mismatch"
    | null;
  perimeter_coordinate_space: Phase3A5CoordinateSpace;
  target_mask_coordinate_space: Phase3A5CoordinateSpace;
  scorer_coordinate_space: Phase3A5CoordinateSpace;
  transform_used: string | null;
  scoring_allowed: boolean;
};

export function resolvePhase3A5CoordinateSpace(
  value: unknown,
): Phase3A5CoordinateSpace {
  const s = String(value ?? "").toLowerCase().trim();
  if (
    s === "aerial_px" || s === "satellite_px" || s === "raster_px" ||
    s === "pixel"
  ) return "aerial_px";
  if (s === "dsm_px") return "dsm_px";
  if (s === "mask_px") return "mask_px";
  return "unknown";
}

export function evaluatePhase3A5FrameContract(
  input: Phase3A5FrameInput,
): Phase3A5FrameContract {
  const perimeter = resolvePhase3A5CoordinateSpace(
    input.perimeter_coordinate_space,
  );
  const target = resolvePhase3A5CoordinateSpace(
    input.target_mask_coordinate_space,
  );
  const scorer = resolvePhase3A5CoordinateSpace(input.scorer_coordinate_space);
  const transformUsed = input.transform_used ?? null;
  const hasUnknown = perimeter === "unknown" || target === "unknown" ||
    scorer === "unknown";
  if (hasUnknown) {
    return {
      ok: false,
      hard_fail_reason: "coordinate_space_contract_unknown",
      perimeter_coordinate_space: perimeter,
      target_mask_coordinate_space: target,
      scorer_coordinate_space: scorer,
      transform_used: transformUsed,
      scoring_allowed: false,
    };
  }
  const sameFrame = perimeter === scorer && target === scorer;
  if (!sameFrame && !transformUsed) {
    return {
      ok: false,
      hard_fail_reason: "coordinate_space_mismatch",
      perimeter_coordinate_space: perimeter,
      target_mask_coordinate_space: target,
      scorer_coordinate_space: scorer,
      transform_used: transformUsed,
      scoring_allowed: false,
    };
  }
  return {
    ok: true,
    hard_fail_reason: null,
    perimeter_coordinate_space: perimeter,
    target_mask_coordinate_space: target,
    scorer_coordinate_space: scorer,
    transform_used: transformUsed,
    scoring_allowed: true,
  };
}

export function bboxOfPhase3A5Polygon(
  points: Phase3A5Point[],
): Phase3A5Bbox | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

export function bboxDiagonalPx(bbox: Phase3A5Bbox | null): number {
  if (!bbox) return 0;
  return Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
}

export function polygonCentroidPx(
  points: Phase3A5Point[],
): Phase3A5Point | null {
  if (!points.length) return null;
  let sx = 0, sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  return [sx / points.length, sy / points.length];
}

export function bboxOverlapRatio(
  a: Phase3A5Bbox | null,
  b: Phase3A5Bbox | null,
): number {
  if (!a || !b) return 0;
  const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  const inter = ix * iy;
  const minArea = Math.min(
    Math.max(0, (a.maxX - a.minX) * (a.maxY - a.minY)),
    Math.max(0, (b.maxX - b.minX) * (b.maxY - b.minY)),
  );
  return minArea > 0 ? inter / minArea : 0;
}

export type Phase3A5ComponentCandidate = {
  id: number;
  pixels: number;
  cx: number;
  cy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  insidePerimeterPixels: number;
};

export type Phase3A5ComponentSelectionRow = {
  id: number;
  selected: boolean;
  score: number;
  area_sqft: number;
  inside_perimeter_ratio: number;
  centroid_px: [number, number];
  centroid_offset_px: number;
  centroid_offset_threshold_px: number;
  bbox_overlap_ratio: number;
  area_score: number;
  anchor_supported: boolean;
  anchor_distance_px: number | null;
  anchor_radius_px: number | null;
  rejection_reason: string | null;
  bbox_px: Phase3A5Bbox;
};

function distancePointToBboxPx(
  point: Phase3A5Point,
  bbox: Phase3A5Bbox,
): number {
  const [x, y] = point;
  const dx = x < bbox.minX ? bbox.minX - x : x > bbox.maxX ? x - bbox.maxX : 0;
  const dy = y < bbox.minY ? bbox.minY - y : y > bbox.maxY ? y - bbox.maxY : 0;
  return Math.hypot(dx, dy);
}

export function selectPhase3A5TargetMaskComponent(input: {
  components: Phase3A5ComponentCandidate[];
  perimeter: Phase3A5Point[];
  sqft_per_px2: number;
  reference_area_sqft?: Array<number | null | undefined>;
  /** Confirmed roof center / Solar centroid in the scorer pixel frame. */
  anchor_points?: Array<Phase3A5Point | null | undefined>;
  /** Max bbox distance from an anchor before a component is treated as non-target. */
  anchor_radius_px?: number | null;
  /** When true, a component must be supported by at least one anchor. */
  require_anchor_support?: boolean;
}): {
  selected: Phase3A5ComponentCandidate | null;
  rows: Phase3A5ComponentSelectionRow[];
  selected_component_id: number | null;
} {
  const perimeterBbox = bboxOfPhase3A5Polygon(input.perimeter);
  const perimeterCentroid = polygonCentroidPx(input.perimeter);
  const footprintDiag = Math.max(1, bboxDiagonalPx(perimeterBbox));
  const centroidThreshold = 0.5 * footprintDiag;
  const anchors = (input.anchor_points ?? [])
    .filter((pt): pt is Phase3A5Point =>
      Array.isArray(pt) && pt.length === 2 &&
      Number.isFinite(pt[0]) && Number.isFinite(pt[1])
    );
  const anchorRadius = anchors.length
    ? Math.max(
      24,
      Number.isFinite(Number(input.anchor_radius_px))
        ? Number(input.anchor_radius_px)
        : Math.min(96, Math.max(36, 0.22 * footprintDiag)),
    )
    : null;
  const requireAnchorSupport = Boolean(input.require_anchor_support) &&
    anchors.length > 0;
  const refs = (input.reference_area_sqft ?? [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);

  let selected: Phase3A5ComponentCandidate | null = null;
  let bestScore = -Infinity;
  const rows: Phase3A5ComponentSelectionRow[] = [];

  for (const c of input.components) {
    const bbox = { minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY };
    const componentAreaSqft = c.pixels * input.sqft_per_px2;
    const insideRatio = c.insidePerimeterPixels / Math.max(1, c.pixels);
    const centroidOffset = perimeterCentroid
      ? Math.hypot(c.cx - perimeterCentroid[0], c.cy - perimeterCentroid[1])
      : Infinity;
    const bboxOverlap = bboxOverlapRatio(perimeterBbox, bbox);
    const nearestAnchorDistance = anchors.length
      ? Math.min(...anchors.map((pt) => distancePointToBboxPx(pt, bbox)))
      : null;
    const anchorSupported = !anchors.length ||
      (nearestAnchorDistance != null && anchorRadius != null &&
        nearestAnchorDistance <= anchorRadius);
    const anchorScore = nearestAnchorDistance == null || anchorRadius == null
      ? 0.5
      : Math.max(0, 1 - nearestAnchorDistance / Math.max(1, anchorRadius * 2));
    const areaScore = refs.length
      ? Math.max(
        ...refs.map((ref) =>
          Math.max(0, 1 - Math.abs(componentAreaSqft - ref) / Math.max(ref, 1))
        ),
      )
      : 0.5;
    const missingRequiredAnchor = requireAnchorSupport && !anchorSupported;
    const centroidTooFar = centroidOffset > centroidThreshold &&
      !(anchors.length > 0 && anchorSupported);
    const rejectionReason = missingRequiredAnchor
      ? "component_missing_confirmed_roof_anchor"
      : centroidTooFar
      ? "component_centroid_offset_exceeds_half_footprint_diagonal"
      : null;
    const insideWeight = centroidTooFar ? 0 : 1.3;
    const score = (1 / (1 + centroidOffset / 80)) * 2.2 +
      bboxOverlap * 2.0 +
      areaScore * 1.4 +
      insideRatio * insideWeight +
      anchorScore * 3.0;

    const row: Phase3A5ComponentSelectionRow = {
      id: c.id,
      selected: false,
      score: Number(score.toFixed(4)),
      area_sqft: Math.round(componentAreaSqft),
      inside_perimeter_ratio: Number(insideRatio.toFixed(3)),
      centroid_px: [Math.round(c.cx), Math.round(c.cy)],
      centroid_offset_px: Number(centroidOffset.toFixed(2)),
      centroid_offset_threshold_px: Number(centroidThreshold.toFixed(2)),
      bbox_overlap_ratio: Number(bboxOverlap.toFixed(3)),
      area_score: Number(areaScore.toFixed(3)),
      anchor_supported: anchorSupported,
      anchor_distance_px: nearestAnchorDistance == null
        ? null
        : Number(nearestAnchorDistance.toFixed(2)),
      anchor_radius_px: anchorRadius == null ? null : Number(anchorRadius.toFixed(2)),
      rejection_reason: rejectionReason,
      bbox_px: bbox,
    };
    rows.push(row);

    if (!rejectionReason && score > bestScore) {
      bestScore = score;
      selected = c;
    }
  }

  for (const row of rows) {
    row.selected = selected?.id === row.id;
  }

  return { selected, rows, selected_component_id: selected?.id ?? null };
}
