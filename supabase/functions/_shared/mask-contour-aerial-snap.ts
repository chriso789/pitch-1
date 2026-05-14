/**
 * MaskContourAerialSnap — perimeter-first checkpoint v1
 *
 * Refines the raw roof-mask contour by snapping each vertex toward the
 * strongest visible aerial edge / DSM height-break along the inward normal,
 * preserving corners. Falls back to the raw contour if the snap diverges.
 *
 * Forbidden perimeter sources are rejected upstream by perimeter-topology.ts.
 */

type PxPt = { x: number; y: number };

export interface AerialSnapInput {
  /** Raw outer contour of roof mask in DSM pixel space (closed ring). */
  mask_contour_px: PxPt[];
  /** Aerial RGB tile aligned to DSM grid. */
  aerial_rgb: { width: number; height: number; data: Uint8ClampedArray | null } | null;
  /** DSM grid for height-break detection. */
  dsm: { width: number; height: number; data: Float32Array | number[]; noDataValue?: number } | null;
  /** Roof mask raster (1=roof, 0=ground). */
  mask: { width: number; height: number; data: Uint8Array | number[] } | null;
  /** Search radius along inward normal (px). */
  search_radius_px?: number;
  /** Corner-preservation threshold (degrees). */
  corner_angle_deg?: number;
}

export interface AerialSnapResult {
  perimeter_px: PxPt[];
  perimeter_source: 'mask_contour_aerial_snapped' | 'mask_contour_raw';
  perimeter_confidence: number;
  perimeter_vs_mask_iou: number;
  snap_diagnostics: {
    vertices_in: number;
    vertices_snapped: number;
    avg_snap_distance_px: number;
    max_snap_distance_px: number;
    fell_back_to_raw: boolean;
    fallback_reason: string | null;
    area_ratio_after_snap: number;
  };
}

const DEFAULT_SEARCH_PX = 6;
const DEFAULT_CORNER_DEG = 25;

export function snapMaskContourToAerial(input: AerialSnapInput): AerialSnapResult {
  const search = input.search_radius_px ?? DEFAULT_SEARCH_PX;
  const cornerDeg = input.corner_angle_deg ?? DEFAULT_CORNER_DEG;
  const ring = ensureClosed(input.mask_contour_px);
  const n = ring.length - 1;

  if (n < 3) {
    return raw(ring, 0.30, 'insufficient_vertices');
  }

  const snapped: PxPt[] = [];
  const distances: number[] = [];

  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const curr = ring[i];
    const next = ring[(i + 1) % n];

    // Inward normal = perpendicular to edge bisector, pointing into polygon
    const bx = next.x - prev.x;
    const by = next.y - prev.y;
    const blen = Math.hypot(bx, by) || 1;
    const nx = -by / blen;
    const ny = bx / blen;

    // Corner detection: skip snap if interior angle is sharp
    const ang = interiorAngleDeg(prev, curr, next);
    const isCorner = Math.abs(180 - ang) > cornerDeg;
    if (isCorner) {
      snapped.push({ x: curr.x, y: curr.y });
      distances.push(0);
      continue;
    }

    // Walk inward normal looking for strongest combined evidence
    let bestT = 0;
    let bestScore = 0;
    for (let t = -search; t <= search; t++) {
      const sx = curr.x + nx * t;
      const sy = curr.y + ny * t;
      const aerialEdge = sampleAerialEdge(input.aerial_rgb, sx, sy);
      const dsmBreak = sampleDsmBreak(input.dsm, sx, sy);
      const score = aerialEdge * 0.6 + dsmBreak * 0.4;
      if (score > bestScore) {
        bestScore = score;
        bestT = t;
      }
    }

    snapped.push({ x: curr.x + nx * bestT, y: curr.y + ny * bestT });
    distances.push(Math.abs(bestT));
  }

  const snappedRing = ensureClosed(snapped);

  const rawArea = polygonArea(ring);
  const snapArea = polygonArea(snappedRing);
  const areaRatio = rawArea > 0 ? snapArea / rawArea : 1;

  const selfInt = countSelfIntersections(snappedRing);

  if (areaRatio < 0.88 || areaRatio > 1.12 || selfInt > 0) {
    return raw(ring, 0.55, selfInt > 0 ? 'self_intersection_after_snap' : `area_drift:${areaRatio.toFixed(3)}`);
  }

  const avgSnap = distances.reduce((s, d) => s + d, 0) / Math.max(1, distances.length);
  const maxSnap = distances.reduce((m, d) => Math.max(m, d), 0);
  const iou = maskIou(snappedRing, input.mask);

  return {
    perimeter_px: snappedRing,
    perimeter_source: 'mask_contour_aerial_snapped',
    perimeter_confidence: Math.min(0.95, 0.78 + iou * 0.15),
    perimeter_vs_mask_iou: iou,
    snap_diagnostics: {
      vertices_in: n,
      vertices_snapped: distances.filter(d => d > 0).length,
      avg_snap_distance_px: Number(avgSnap.toFixed(2)),
      max_snap_distance_px: Number(maxSnap.toFixed(2)),
      fell_back_to_raw: false,
      fallback_reason: null,
      area_ratio_after_snap: Number(areaRatio.toFixed(4)),
    },
  };
}

// ─── helpers ───────────────────────────────────────────────────────────

function raw(ring: PxPt[], confidence: number, reason: string | null): AerialSnapResult {
  return {
    perimeter_px: ring,
    perimeter_source: 'mask_contour_raw',
    perimeter_confidence: confidence,
    perimeter_vs_mask_iou: 0,
    snap_diagnostics: {
      vertices_in: Math.max(0, ring.length - 1),
      vertices_snapped: 0,
      avg_snap_distance_px: 0,
      max_snap_distance_px: 0,
      fell_back_to_raw: true,
      fallback_reason: reason,
      area_ratio_after_snap: 1,
    },
  };
}

function ensureClosed(pts: PxPt[]): PxPt[] {
  if (pts.length < 3) return pts;
  const f = pts[0], l = pts[pts.length - 1];
  if (f.x === l.x && f.y === l.y) return pts;
  return [...pts, { x: f.x, y: f.y }];
}

function interiorAngleDeg(a: PxPt, b: PxPt, c: PxPt): number {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  const ang = Math.atan2(Math.abs(cross), dot) * 180 / Math.PI;
  return cross >= 0 ? ang : 360 - ang;
}

function sampleAerialEdge(
  tile: AerialSnapInput['aerial_rgb'],
  x: number,
  y: number,
): number {
  if (!tile?.data) return 0;
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 1 || yi < 1 || xi >= tile.width - 1 || yi >= tile.height - 1) return 0;
  const idx = (yi * tile.width + xi) * 4;
  const idxR = (yi * tile.width + (xi + 1)) * 4;
  const idxD = ((yi + 1) * tile.width + xi) * 4;
  const lum = (i: number) => 0.299 * tile.data![i] + 0.587 * tile.data![i + 1] + 0.114 * tile.data![i + 2];
  const dx = lum(idxR) - lum(idx);
  const dy = lum(idxD) - lum(idx);
  return Math.min(1, Math.hypot(dx, dy) / 64);
}

function sampleDsmBreak(
  dsm: AerialSnapInput['dsm'],
  x: number,
  y: number,
): number {
  if (!dsm) return 0;
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 1 || yi < 1 || xi >= dsm.width - 1 || yi >= dsm.height - 1) return 0;
  const at = (xx: number, yy: number) => {
    const v = (dsm.data as any)[yy * dsm.width + xx];
    if (dsm.noDataValue !== undefined && v === dsm.noDataValue) return null;
    return Number.isFinite(v) ? v : null;
  };
  const c = at(xi, yi); const r = at(xi + 1, yi); const d = at(xi, yi + 1);
  if (c === null || r === null || d === null) return 0;
  const grad = Math.max(Math.abs(r - c), Math.abs(d - c));
  // 0.6m height break is the threshold for roof-to-ground transition
  return Math.min(1, grad / 0.6);
}

function polygonArea(ring: PxPt[]): number {
  let a = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    a += ring[i].x * ring[i + 1].y - ring[i + 1].x * ring[i].y;
  }
  return Math.abs(a) / 2;
}

function countSelfIntersections(ring: PxPt[]): number {
  const n = ring.length - 1;
  let c = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) c++;
    }
  }
  return c;
}

function segIntersect(a1: PxPt, a2: PxPt, b1: PxPt, b2: PxPt): boolean {
  const cr = (p: PxPt, q: PxPt, r: PxPt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cr(b1, b2, a1), d2 = cr(b1, b2, a2), d3 = cr(a1, a2, b1), d4 = cr(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function maskIou(ring: PxPt[], mask: AerialSnapInput['mask']): number {
  if (!mask) return 0;
  let inter = 0, union = 0;
  const distinct = ring.slice(0, -1);
  for (let y = 0; y < mask.height; y += 2) {
    for (let x = 0; x < mask.width; x += 2) {
      const inMask = (mask.data as any)[y * mask.width + x] > 0;
      const inPoly = pointInPolygon({ x, y }, distinct);
      if (inMask || inPoly) union++;
      if (inMask && inPoly) inter++;
    }
  }
  return union > 0 ? inter / union : 0;
}

function pointInPolygon(pt: PxPt, polygon: PxPt[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
