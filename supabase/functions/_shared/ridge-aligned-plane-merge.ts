export type Pt = { x: number; y: number };

export type PlaneIn = {
  id?: string | number;
  plane_index?: string | number;
  polygon_px: Pt[];
  pitch?: number | null;
  pitch_degrees?: number | null;
  azimuth?: number | null;
  azimuthDeg?: number | null;
  azimuth_degrees?: number | null;
  plan_area_sqft?: number | null;
  area_sqft?: number | null;
  source?: string;
};

export type RidgeLine = {
  p1: Pt;
  p2: Pt;
  angleDeg?: number;
  score?: number;
};

export type PlaneOut = PlaneIn & {
  id: string;
  plane_index: number;
  merge_source_ids: string[];
  ridge_side: "left" | "right" | "on_ridge" | "unknown";
  source: "ridge_aligned_plane_merge_v1";
};

const EPS = 3;
const MIN_PLANE_AREA_SQFT = 120;

function idOf(p: PlaneIn, i: number): string {
  return String(p.id ?? p.plane_index ?? i);
}

function sub(a: Pt, b: Pt): Pt { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Pt, b: Pt): Pt { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a: Pt, s: number): Pt { return { x: a.x * s, y: a.y * s }; }
function dot(a: Pt, b: Pt): number { return a.x * b.x + a.y * b.y; }
function cross(a: Pt, b: Pt): number { return a.x * b.y - a.y * b.x; }
function dist(a: Pt, b: Pt): number { return Math.hypot(a.x - b.x, a.y - b.y); }

function centroid(poly: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of poly || []) { x += p.x; y += p.y; }
  const n = Math.max(1, poly?.length || 0);
  return { x: x / n, y: y / n };
}

function polygonAreaPx(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

function areaSqft(p: PlaneIn, feetPerPixel: number): number {
  const given = p.plan_area_sqft ?? p.area_sqft;
  if (typeof given === "number" && Number.isFinite(given)) return given;
  return polygonAreaPx(p.polygon_px || []) * feetPerPixel * feetPerPixel;
}

function pitchDeg(p: PlaneIn): number | null {
  if (typeof p.pitch_degrees === "number" && Number.isFinite(p.pitch_degrees)) return p.pitch_degrees;
  if (typeof p.pitch === "number" && Number.isFinite(p.pitch)) return Math.atan(p.pitch / 12) * 180 / Math.PI;
  return null;
}

function azDeg(p: PlaneIn): number | null {
  const v = p.azimuthDeg ?? p.azimuth_degrees ?? p.azimuth;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function angleDiff180(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

function angleDiff360(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function getDominantRidge(ridges: RidgeLine[] | undefined, planes: PlaneIn[]): RidgeLine {
  if (ridges && ridges.length) {
    const best = [...ridges].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    return best;
  }
  const pts = planes.flatMap((p) => p.polygon_px || []);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  if ((maxX - minX) >= (maxY - minY)) {
    return { p1: { x: minX, y: cy }, p2: { x: maxX, y: cy }, angleDeg: 0, score: 0.5 };
  }
  return { p1: { x: cx, y: minY }, p2: { x: cx, y: maxY }, angleDeg: 90, score: 0.5 };
}

function signedSideOfRidge(p: Pt, ridge: RidgeLine): number {
  const d = sub(ridge.p2, ridge.p1);
  return cross(d, sub(p, ridge.p1));
}

function ridgeSide(poly: Pt[], ridge: RidgeLine): "left" | "right" | "on_ridge" | "unknown" {
  const c = centroid(poly);
  const s = signedSideOfRidge(c, ridge);
  if (!Number.isFinite(s)) return "unknown";
  if (Math.abs(s) < 12) return "on_ridge";
  return s > 0 ? "left" : "right";
}

function planeEdges(poly: Pt[]): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (let i = 0; i < poly.length; i++) out.push([poly[i], poly[(i + 1) % poly.length]]);
  return out;
}

function pointToSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const t = Math.max(0, Math.min(1, dot(ap, ab) / Math.max(dot(ab, ab), 1e-9)));
  const q = add(a, mul(ab, t));
  return dist(p, q);
}

function projectT(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  return dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-9);
}

function sharedSegment(a1: Pt, a2: Pt, b1: Pt, b2: Pt): [Pt, Pt] | null {
  if (pointToSegmentDistance(b1, a1, a2) > EPS) return null;
  if (pointToSegmentDistance(b2, a1, a2) > EPS) return null;
  const t1 = projectT(b1, a1, a2);
  const t2 = projectT(b2, a1, a2);
  const lo = Math.max(0, Math.min(t1, t2));
  const hi = Math.min(1, Math.max(t1, t2));
  if (hi - lo <= 0.05) return null;
  const ab = sub(a2, a1);
  return [add(a1, mul(ab, lo)), add(a1, mul(ab, hi))];
}

function sharedBoundaryLength(a: PlaneIn, b: PlaneIn): number {
  let total = 0;
  for (const ea of planeEdges(a.polygon_px || [])) {
    for (const eb of planeEdges(b.polygon_px || [])) {
      const s = sharedSegment(ea[0], ea[1], eb[0], eb[1]);
      if (s) total += dist(s[0], s[1]);
    }
  }
  return total;
}

function perimeter(poly: Pt[]): number {
  return planeEdges(poly || []).reduce((s, e) => s + dist(e[0], e[1]), 0);
}

function sharedRatio(a: PlaneIn, b: PlaneIn): number {
  const shared = sharedBoundaryLength(a, b);
  const minP = Math.min(perimeter(a.polygon_px || []), perimeter(b.polygon_px || []));
  if (!minP) return 0;
  return shared / minP;
}

function bbox(poly: Pt[]) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function bboxUnionPolygon(a: Pt[], b: Pt[]): Pt[] {
  const ba = bbox(a);
  const bb = bbox(b);
  const minX = Math.min(ba.minX, bb.minX);
  const minY = Math.min(ba.minY, bb.minY);
  const maxX = Math.max(ba.maxX, bb.maxX);
  const maxY = Math.max(ba.maxY, bb.maxY);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

function weighted(values: Array<{ value: number | null; weight: number }>): number | null {
  const valid = values.filter((v) => v.value !== null && Number.isFinite(v.value) && v.weight > 0);
  const total = valid.reduce((s, v) => s + v.weight, 0);
  if (!total) return null;
  return valid.reduce((s, v) => s + (v.value as number) * v.weight, 0) / total;
}

function polygonLongAxisAngle(poly: Pt[]): number {
  const b = bbox(poly);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  return w >= h ? 0 : 90;
}

function shouldMergeRidgeAligned(args: {
  a: PlaneOut;
  b: PlaneOut;
  ridge: RidgeLine;
  feetPerPixel: number;
}) {
  const { a, b, ridge, feetPerPixel } = args;
  const areaA = areaSqft(a, feetPerPixel);
  const areaB = areaSqft(b, feetPerPixel);
  const small = Math.min(areaA, areaB) < MIN_PLANE_AREA_SQFT;

  const sameSide =
    a.ridge_side === b.ridge_side ||
    a.ridge_side === "on_ridge" ||
    b.ridge_side === "on_ridge";

  if (!sameSide) return { merge: false, reason: "opposite_ridge_sides", score: 0 };

  const sr = sharedRatio(a, b);
  if (sr < 0.10 && !small) return { merge: false, reason: "not_adjacent_enough", score: sr };

  const pA = pitchDeg(a);
  const pB = pitchDeg(b);
  const zA = azDeg(a);
  const zB = azDeg(b);

  const pitchDelta = pA !== null && pB !== null ? Math.abs(pA - pB) : 0;
  const azDelta = zA !== null && zB !== null ? angleDiff360(zA, zB) : 0;

  const ridgeAngle = ridge.angleDeg ?? Math.atan2(ridge.p2.y - ridge.p1.y, ridge.p2.x - ridge.p1.x) * 180 / Math.PI;
  const axisA = polygonLongAxisAngle(a.polygon_px || []);
  const axisB = polygonLongAxisAngle(b.polygon_px || []);

  const axisAligned =
    angleDiff180(axisA, ridgeAngle) <= 25 ||
    angleDiff180(axisB, ridgeAngle) <= 25 ||
    angleDiff180(axisA, axisB) <= 15;

  const sameSlope = pitchDelta <= 2.5 && (azDelta <= 25 || Math.abs(azDelta - 180) <= 25);
  const sliverCleanup = small && sr >= 0.08 && pitchDelta <= 5;

  const score =
    sr * 0.35 +
    (sameSide ? 0.20 : 0) +
    (1 - Math.min(pitchDelta / 8, 1)) * 0.20 +
    (axisAligned ? 0.15 : 0) +
    (1 - Math.min(Math.min(azDelta, Math.abs(azDelta - 180)) / 45, 1)) * 0.10;

  if (sameSlope && axisAligned && sr >= 0.10) {
    return { merge: true, reason: "same_side_same_slope_ridge_aligned", score };
  }
  if (sliverCleanup) {
    return { merge: true, reason: "same_side_sliver_cleanup", score };
  }
  return { merge: false, reason: "orientation_or_pitch_mismatch", score };
}

function mergePair(a: PlaneOut, b: PlaneOut, ridge: RidgeLine, feetPerPixel: number): PlaneOut {
  const areaA = areaSqft(a, feetPerPixel);
  const areaB = areaSqft(b, feetPerPixel);

  const mergedPoly = bboxUnionPolygon(a.polygon_px, b.polygon_px);
  const mergedPitchDeg = weighted([
    { value: pitchDeg(a), weight: areaA },
    { value: pitchDeg(b), weight: areaB },
  ]);
  const mergedAz = weighted([
    { value: azDeg(a), weight: areaA },
    { value: azDeg(b), weight: areaB },
  ]);

  return {
    ...a,
    id: `${a.id}_${b.id}`,
    polygon_px: mergedPoly,
    pitch_degrees: mergedPitchDeg,
    pitch: mergedPitchDeg === null
      ? a.pitch ?? b.pitch ?? null
      : Math.tan((mergedPitchDeg * Math.PI) / 180) * 12,
    azimuth: mergedAz,
    azimuthDeg: mergedAz,
    azimuth_degrees: mergedAz,
    plan_area_sqft: polygonAreaPx(mergedPoly) * feetPerPixel * feetPerPixel,
    area_sqft: polygonAreaPx(mergedPoly) * feetPerPixel * feetPerPixel,
    merge_source_ids: [...a.merge_source_ids, ...b.merge_source_ids],
    ridge_side: ridgeSide(mergedPoly, ridge),
    source: "ridge_aligned_plane_merge_v1",
  };
}

export function mergeRidgeAlignedPlanes(args: {
  planes: PlaneIn[];
  dominantRidges?: RidgeLine[];
  feetPerPixel: number;
  maxIterations?: number;
}) {
  const ridge = getDominantRidge(args.dominantRidges, args.planes);
  const feetPerPixel = args.feetPerPixel;

  let planes: PlaneOut[] = args.planes.map((p, i) => ({
    ...p,
    id: idOf(p, i),
    plane_index: i,
    merge_source_ids: [idOf(p, i)],
    ridge_side: ridgeSide(p.polygon_px || [], ridge),
    source: "ridge_aligned_plane_merge_v1",
  }));

  const logs: any[] = [];
  const maxIterations = args.maxIterations ?? 30;

  for (let iter = 0; iter < maxIterations; iter++) {
    let best: null | { i: number; j: number; reason: string; score: number } = null;

    for (let i = 0; i < planes.length; i++) {
      for (let j = i + 1; j < planes.length; j++) {
        const decision = shouldMergeRidgeAligned({
          a: planes[i],
          b: planes[j],
          ridge,
          feetPerPixel,
        });
        if (!decision.merge) continue;
        if (!best || decision.score > best.score) {
          best = { i, j, reason: decision.reason, score: decision.score };
        }
      }
    }

    if (!best) break;

    const a = planes[best.i];
    const b = planes[best.j];
    const merged = mergePair(a, b, ridge, feetPerPixel);

    logs.push({
      iteration: iter,
      merged: [a.id, b.id],
      reason: best.reason,
      score: Number(best.score.toFixed(3)),
      before_count: planes.length,
    });

    planes = planes.filter((_, idx) => idx !== best!.i && idx !== best!.j);
    planes.push(merged);
  }

  planes = planes.map((p, i) => ({
    ...p,
    id: String(i),
    plane_index: i,
    ridge_side: ridgeSide(p.polygon_px || [], ridge),
    source: "ridge_aligned_plane_merge_v1",
  }));

  console.log("[RIDGE_ALIGNED_PLANE_MERGE]", {
    before: args.planes.length,
    after: planes.length,
    dominant_ridge: ridge,
    merges: logs.length,
  });

  return {
    planes,
    debug: {
      before: args.planes.length,
      after: planes.length,
      dominant_ridge: ridge,
      merges: logs,
    },
  };
}
