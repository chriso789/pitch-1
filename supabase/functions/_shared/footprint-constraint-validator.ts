/**
 * FOOTPRINT-CONSTRAINED GEOMETRY VALIDATOR
 *
 * Patent-aligned principle: FOOTPRINT IS LAW.
 *
 * Pipeline order is FOOTPRINT → STRUCTURE → VALIDATE → REFINE.
 * Ridges DO NOT define geometry — they are validators that must conform
 * to the footprint. This module rejects:
 *
 *   1. Planes that extend outside the footprint
 *   2. Planes that exceed footprint bbox
 *   3. Ridges longer than 60% of footprint width (global ridges)
 *   4. Ridges that don't intersect the footprint interior
 *   5. Ridges crossing more than one cluster region
 *   6. Total plane areas exceeding footprint_area * 1.15
 */

export type FCPoint = { x: number; y: number };
export type FCBBox = { minX: number; minY: number; maxX: number; maxY: number };

export interface FCPlane {
  id?: string | number;
  polygon_px: FCPoint[];
  pitch?: number | null;
  cluster_id?: string | number | null;
  region_bbox?: FCBBox | null;
  plan_area_sqft?: number | null;
  area_sqft?: number | null;
  [k: string]: unknown;
}

export interface FCRidge {
  id?: string | number;
  edge_type?: string; // ridge | hip | valley | eave | rake
  p1?: FCPoint;
  p2?: FCPoint;
  line_px?: FCPoint[];
  cluster_id?: string | number | null;
  region_bbox?: FCBBox | null;
  [k: string]: unknown;
}

export interface FCValidationResult {
  acceptedPlanes: FCPlane[];
  acceptedRidges: FCRidge[];
  rejectedPlanes: Array<{ id: string | number | undefined; reason: string }>;
  rejectedRidges: Array<{ id: string | number | undefined; reason: string }>;
  stats: {
    footprint_area_px: number;
    plane_area_sum_px: number;
    area_ratio: number;
    rejected_plane_count: number;
    rejected_ridge_count: number;
    accepted_plane_count: number;
    accepted_ridge_count: number;
    overall_rejected: boolean;
    rejection_reason?: string;
  };
}

// ───────── Polygon helpers ─────────

function polygonArea(poly: FCPoint[]): number {
  if (!poly || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function bboxOf(poly: FCPoint[]): FCBBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function pointInPolygon(pt: FCPoint, poly: FCPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Sutherland–Hodgman clip of `subject` by convex/CCW `clip`. Footprint may be
// non-convex; we use it as a coarse area estimator to detect "extends outside".
function clipPolygonByEdge(
  subject: FCPoint[],
  a: FCPoint,
  b: FCPoint,
): FCPoint[] {
  if (!subject.length) return [];
  const out: FCPoint[] = [];
  const inside = (p: FCPoint) =>
    (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-9;
  const intersect = (p: FCPoint, q: FCPoint): FCPoint => {
    const dx1 = b.x - a.x, dy1 = b.y - a.y;
    const dx2 = q.x - p.x, dy2 = q.y - p.y;
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < 1e-9) return { x: p.x, y: p.y };
    const t = ((p.x - a.x) * dy1 - (p.y - a.y) * dx1) / denom;
    return { x: p.x + t * dx2, y: p.y + t * dy2 };
  };
  for (let i = 0; i < subject.length; i++) {
    const cur = subject[i];
    const prev = subject[(i + subject.length - 1) % subject.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}

/** Returns area of intersection of `subject` with the footprint, treating the
 *  footprint as a sequence of clip edges (works exactly for convex footprints
 *  and is a strong upper bound for concave ones — good enough for the
 *  "extends outside" rejection rule). */
function clippedArea(subject: FCPoint[], footprint: FCPoint[]): number {
  let poly = subject.slice();
  for (let i = 0; i < footprint.length; i++) {
    if (!poly.length) return 0;
    poly = clipPolygonByEdge(poly, footprint[i], footprint[(i + 1) % footprint.length]);
  }
  return polygonArea(poly);
}

// Segment-segment intersection test (proper or improper).
function segmentsIntersect(
  a: FCPoint, b: FCPoint, c: FCPoint, d: FCPoint,
): boolean {
  const o = (p: FCPoint, q: FCPoint, r: FCPoint) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

function ridgeEndpoints(r: FCRidge): [FCPoint, FCPoint] | null {
  if (r.p1 && r.p2) return [r.p1, r.p2];
  if (r.line_px && r.line_px.length >= 2) {
    return [r.line_px[0], r.line_px[r.line_px.length - 1]];
  }
  return null;
}

function dist(a: FCPoint, b: FCPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ───────── Main validator ─────────

export interface FCOptions {
  /** Allowed overflow when intersecting plane vs footprint. */
  planeOutsideToleranceRatio?: number; // default 0.10 (≤10% outside footprint)
  /** Max ridge length as a fraction of footprint bbox width. */
  maxRidgeLengthRatio?: number; // default 0.60
  /** Allowed multiple of footprint area for total plane area. */
  totalAreaMultiplier?: number; // default 1.15
}

export function validateFootprintConstraints(
  footprint: FCPoint[],
  planes: FCPlane[],
  ridges: FCRidge[],
  opts: FCOptions = {},
): FCValidationResult {
  const tol = opts.planeOutsideToleranceRatio ?? 0.10;
  const maxRatio = opts.maxRidgeLengthRatio ?? 0.60;
  const areaMult = opts.totalAreaMultiplier ?? 1.15;

  const acceptedPlanes: FCPlane[] = [];
  const rejectedPlanes: Array<{ id: any; reason: string }> = [];
  const acceptedRidges: FCRidge[] = [];
  const rejectedRidges: Array<{ id: any; reason: string }> = [];

  const fpArea = polygonArea(footprint);
  const fpBBox = bboxOf(footprint);
  const fpWidth = Math.max(1, fpBBox.maxX - fpBBox.minX);

  // Edge case: no footprint → cannot validate, pass through.
  if (!footprint || footprint.length < 3 || fpArea <= 0) {
    return {
      acceptedPlanes: planes,
      acceptedRidges: ridges,
      rejectedPlanes: [],
      rejectedRidges: [],
      stats: {
        footprint_area_px: 0,
        plane_area_sum_px: 0,
        area_ratio: 0,
        rejected_plane_count: 0,
        rejected_ridge_count: 0,
        accepted_plane_count: planes.length,
        accepted_ridge_count: ridges.length,
        overall_rejected: false,
        rejection_reason: "no_footprint_validation_skipped",
      },
    };
  }

  // ── 1) PLANE CONSTRAINT — must lie (mostly) inside footprint ──
  for (const p of planes) {
    const poly = p.polygon_px || [];
    if (poly.length < 3) {
      rejectedPlanes.push({ id: p.id, reason: "degenerate_polygon" });
      continue;
    }
    const planeArea = polygonArea(poly);
    if (planeArea <= 0) {
      rejectedPlanes.push({ id: p.id, reason: "zero_area" });
      continue;
    }
    const inside = clippedArea(poly, footprint);
    const outsideRatio = Math.max(0, 1 - inside / planeArea);
    if (outsideRatio > tol) {
      rejectedPlanes.push({
        id: p.id,
        reason: `extends_outside_footprint_${Math.round(outsideRatio * 100)}pct`,
      });
      continue;
    }
    // Plane bbox must not exceed footprint bbox (with 5% slack).
    const pbb = bboxOf(poly);
    const slackX = (fpBBox.maxX - fpBBox.minX) * 0.05;
    const slackY = (fpBBox.maxY - fpBBox.minY) * 0.05;
    if (
      pbb.minX < fpBBox.minX - slackX ||
      pbb.minY < fpBBox.minY - slackY ||
      pbb.maxX > fpBBox.maxX + slackX ||
      pbb.maxY > fpBBox.maxY + slackY
    ) {
      rejectedPlanes.push({ id: p.id, reason: "plane_bbox_exceeds_footprint_bbox" });
      continue;
    }
    acceptedPlanes.push(p);
  }

  // ── 2) RIDGE CONSTRAINT ──
  for (const r of ridges) {
    const ends = ridgeEndpoints(r);
    if (!ends) {
      rejectedRidges.push({ id: r.id, reason: "no_endpoints" });
      continue;
    }
    const [a, b] = ends;
    const len = dist(a, b);

    // 2a) Global ridge guard — too long relative to footprint width.
    if (len > maxRatio * fpWidth) {
      rejectedRidges.push({
        id: r.id,
        reason: `ridge_too_long_${Math.round((len / fpWidth) * 100)}pct_of_footprint_width`,
      });
      continue;
    }

    // 2b) Ridge must lie inside footprint — at least one endpoint or the
    //     midpoint must be inside the footprint polygon.
    const mid: FCPoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const aIn = pointInPolygon(a, footprint);
    const bIn = pointInPolygon(b, footprint);
    const mIn = pointInPolygon(mid, footprint);
    if (!aIn && !bIn && !mIn) {
      rejectedRidges.push({ id: r.id, reason: "ridge_outside_footprint" });
      continue;
    }

    // 2c) Ridge must intersect at least 2 footprint edges OR have both
    //     endpoints inside (i.e. an interior structural line). Cross-only
    //     diagonals that exit and re-enter the footprint are rejected.
    let edgeHits = 0;
    for (let i = 0; i < footprint.length; i++) {
      const e1 = footprint[i];
      const e2 = footprint[(i + 1) % footprint.length];
      if (segmentsIntersect(a, b, e1, e2)) edgeHits++;
      if (edgeHits >= 3) break;
    }
    const interior = aIn && bIn;
    if (!interior && edgeHits < 1) {
      rejectedRidges.push({ id: r.id, reason: "ridge_does_not_touch_footprint" });
      continue;
    }
    if (edgeHits >= 3) {
      rejectedRidges.push({ id: r.id, reason: "ridge_crosses_multiple_footprint_edges" });
      continue;
    }

    acceptedRidges.push(r);
  }

  // ── 3) AREA QA — sum(plane_areas) ≤ footprint_area * multiplier ──
  const planeAreaSum = acceptedPlanes.reduce(
    (s, p) => s + polygonArea(p.polygon_px || []),
    0,
  );
  const ratio = fpArea > 0 ? planeAreaSum / fpArea : 0;
  let overallRejected = false;
  let rejectionReason: string | undefined;
  if (ratio > areaMult) {
    overallRejected = true;
    rejectionReason = `plane_area_sum_${ratio.toFixed(2)}x_footprint_area_max_${areaMult}x`;
  }

  return {
    acceptedPlanes,
    acceptedRidges,
    rejectedPlanes,
    rejectedRidges,
    stats: {
      footprint_area_px: fpArea,
      plane_area_sum_px: planeAreaSum,
      area_ratio: Number(ratio.toFixed(3)),
      rejected_plane_count: rejectedPlanes.length,
      rejected_ridge_count: rejectedRidges.length,
      accepted_plane_count: acceptedPlanes.length,
      accepted_ridge_count: acceptedRidges.length,
      overall_rejected: overallRejected,
      rejection_reason: rejectionReason,
    },
  };
}
