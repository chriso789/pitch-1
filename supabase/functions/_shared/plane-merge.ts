export type Pt = { x: number; y: number };

export type PlaneInput = {
  id?: string | number;
  plane_index?: string | number;
  polygon_px: Pt[];
  pitch?: number | null;          // rise over 12
  pitch_degrees?: number | null;
  azimuth?: number | null;
  azimuthDeg?: number | null;
  azimuth_degrees?: number | null;
  area_sqft?: number | null;
  plan_area_sqft?: number | null;
  source?: string;
  [key: string]: any;
};

export type PlaneMerged = PlaneInput & {
  id: string;
  merge_source_ids: string[];
  source: string;
};

const EPS = 3;
const MIN_FINAL_PLANE_AREA_SQFT = 100;

function pid(p: PlaneInput, i: number): string {
  return String(p.id ?? p.plane_index ?? i);
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dot(a: Pt, b: Pt): number {
  return a.x * b.x + a.y * b.y;
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

function mul(a: Pt, s: number): Pt {
  return { x: a.x * s, y: a.y * s };
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

function getAreaSqft(p: PlaneInput, feetPerPixel: number): number {
  const given = p.plan_area_sqft ?? p.area_sqft;
  if (typeof given === "number" && Number.isFinite(given)) return given;
  return polygonAreaPx(p.polygon_px || []) * feetPerPixel * feetPerPixel;
}

function pitchDegrees(p: PlaneInput): number | null {
  if (typeof p.pitch_degrees === "number" && Number.isFinite(p.pitch_degrees)) {
    return p.pitch_degrees;
  }
  if (typeof p.pitch === "number" && Number.isFinite(p.pitch)) {
    return Math.atan(p.pitch / 12) * 180 / Math.PI;
  }
  return null;
}

function azimuthDeg(p: PlaneInput): number | null {
  const v = p.azimuthDeg ?? p.azimuth_degrees ?? p.azimuth;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function roofNormal(pitchDeg: number, azDeg: number): [number, number, number] {
  const pitch = pitchDeg * Math.PI / 180;
  const az = azDeg * Math.PI / 180;
  const dx = Math.sin(az);
  const dy = -Math.cos(az);
  const nx = -Math.sin(pitch) * dx;
  const ny = -Math.sin(pitch) * dy;
  const nz = Math.cos(pitch);
  return [nx, ny, nz];
}

function normalSimilarity(a: PlaneInput, b: PlaneInput): number {
  const pa = pitchDegrees(a);
  const pb = pitchDegrees(b);
  const aa = azimuthDeg(a);
  const ab = azimuthDeg(b);
  if (pa == null || pb == null || aa == null || ab == null) return 0.5;
  const na = roofNormal(pa, aa);
  const nb = roofNormal(pb, ab);
  return na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
}

function pointToSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const denom = dot(ab, ab) || 1;
  const t = Math.max(0, Math.min(1, dot(ap, ab) / denom));
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

function polygonEdges(poly: Pt[]): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (let i = 0; i < poly.length; i++) {
    out.push([poly[i], poly[(i + 1) % poly.length]]);
  }
  return out;
}

function sharedBoundaryLength(a: PlaneInput, b: PlaneInput): number {
  let total = 0;
  for (const ea of polygonEdges(a.polygon_px || [])) {
    for (const eb of polygonEdges(b.polygon_px || [])) {
      const shared = sharedSegment(ea[0], ea[1], eb[0], eb[1]);
      if (shared) total += dist(shared[0], shared[1]);
    }
  }
  return total;
}

function perimeter(poly: Pt[]): number {
  return polygonEdges(poly).reduce((s, e) => s + dist(e[0], e[1]), 0);
}

function adjacencyScore(a: PlaneInput, b: PlaneInput): number {
  const shared = sharedBoundaryLength(a, b);
  const minPerim = Math.min(perimeter(a.polygon_px || []), perimeter(b.polygon_px || []));
  if (minPerim <= 0) return 0;
  return shared / minPerim;
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

function rectilinearUnionApprox(a: Pt[], b: Pt[]): Pt[] {
  // Robust deterministic approximation; can be replaced with polygon-clipping union later.
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

function weightedAverage(values: { value: number | null; weight: number }[]): number | null {
  const valid = values.filter((v) => v.value !== null && Number.isFinite(v.value as number) && v.weight > 0);
  const total = valid.reduce((s, v) => s + v.weight, 0);
  if (!total) return null;
  return valid.reduce((s, v) => s + (v.value as number) * v.weight, 0) / total;
}

function shouldMerge(a: PlaneInput, b: PlaneInput, feetPerPixel: number): { merge: boolean; reason: string; score: number } {
  const sharedRatio = adjacencyScore(a, b);
  if (sharedRatio < 0.12) {
    return { merge: false, reason: "not_adjacent_enough", score: sharedRatio };
  }

  const areaA = getAreaSqft(a, feetPerPixel);
  const areaB = getAreaSqft(b, feetPerPixel);
  const smallPlane = Math.min(areaA, areaB) < MIN_FINAL_PLANE_AREA_SQFT;

  const pa = pitchDegrees(a);
  const pb = pitchDegrees(b);
  const aa = azimuthDeg(a);
  const ab = azimuthDeg(b);

  const pitchDelta = pa != null && pb != null ? Math.abs(pa - pb) : 0;
  const azDelta = aa != null && ab != null ? angleDiff(aa, ab) : 0;
  const normalSim = normalSimilarity(a, b);

  const sameSlope =
    pitchDelta <= 2.0 &&
    azDelta <= 18 &&
    normalSim >= 0.94 &&
    sharedRatio >= 0.18;

  const sliverMerge =
    smallPlane &&
    sharedRatio >= 0.20 &&
    pitchDelta <= 4.0 &&
    (azDelta <= 30 || normalSim >= 0.88);

  const score =
    sharedRatio * 0.35 +
    (1 - Math.min(pitchDelta / 8, 1)) * 0.25 +
    (1 - Math.min(azDelta / 45, 1)) * 0.25 +
    Math.max(0, Math.min(1, normalSim)) * 0.15;

  if (sameSlope) return { merge: true, reason: "same_slope_adjacent_plane", score };
  if (sliverMerge) return { merge: true, reason: "small_sliver_cleanup", score };
  return { merge: false, reason: "different_plane_orientation", score };
}

function mergePair(a: PlaneMerged, b: PlaneMerged, feetPerPixel: number): PlaneMerged {
  const areaA = getAreaSqft(a, feetPerPixel);
  const areaB = getAreaSqft(b, feetPerPixel);

  const mergedPitchDeg = weightedAverage([
    { value: pitchDegrees(a), weight: areaA },
    { value: pitchDegrees(b), weight: areaB },
  ]);

  const mergedAz = weightedAverage([
    { value: azimuthDeg(a), weight: areaA },
    { value: azimuthDeg(b), weight: areaB },
  ]);

  const mergedPoly = rectilinearUnionApprox(a.polygon_px, b.polygon_px);
  const mergedAreaSqft = polygonAreaPx(mergedPoly) * feetPerPixel * feetPerPixel;

  return {
    ...a,
    id: `${a.id}_${b.id}`,
    plane_index: `${a.id}_${b.id}`,
    polygon_px: mergedPoly,
    pitch_degrees: mergedPitchDeg,
    pitch: mergedPitchDeg == null ? a.pitch ?? b.pitch ?? null : Math.tan(mergedPitchDeg * Math.PI / 180) * 12,
    azimuthDeg: mergedAz,
    azimuth: mergedAz,
    azimuth_degrees: mergedAz,
    plan_area_sqft: mergedAreaSqft,
    area_sqft: mergedAreaSqft,
    merge_source_ids: [...a.merge_source_ids, ...b.merge_source_ids],
    source: "plane_merge_v1",
  };
}

export function mergeRoofPlanes(args: {
  planes: PlaneInput[];
  feetPerPixel: number;
  maxIterations?: number;
}) {
  const feetPerPixel = args.feetPerPixel;
  let planes: PlaneMerged[] = args.planes.map((p, i) => ({
    ...p,
    id: pid(p, i),
    merge_source_ids: [pid(p, i)],
    source: p.source || "ridge_split_recursive",
  }));

  const logs: any[] = [];
  const maxIterations = args.maxIterations ?? 20;

  for (let iter = 0; iter < maxIterations; iter++) {
    let best: null | { i: number; j: number; reason: string; score: number } = null;

    for (let i = 0; i < planes.length; i++) {
      for (let j = i + 1; j < planes.length; j++) {
        const decision = shouldMerge(planes[i], planes[j], feetPerPixel);
        if (!decision.merge) continue;
        if (!best || decision.score > best.score) {
          best = { i, j, reason: decision.reason, score: decision.score };
        }
      }
    }

    if (!best) break;

    const a = planes[best.i];
    const b = planes[best.j];
    const merged = mergePair(a, b, feetPerPixel);

    logs.push({
      iteration: iter,
      merged: [a.id, b.id],
      reason: best.reason,
      score: Number(best.score.toFixed(3)),
      before_count: planes.length,
    });

    const bi = best.i;
    const bj = best.j;
    planes = planes.filter((_, idx) => idx !== bi && idx !== bj);
    planes.push(merged);
  }

  planes = planes.map((p, i) => ({
    ...p,
    id: String(i),
    plane_index: i,
    source: p.source || "plane_merge_v1",
  }));

  console.log("[PLANE_MERGE]", JSON.stringify({
    before: args.planes.length,
    after: planes.length,
    merges: logs.length,
  }));

  return {
    planes,
    debug: {
      before: args.planes.length,
      after: planes.length,
      merges: logs,
    },
  };
}
