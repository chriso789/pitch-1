export type Pt = { x: number; y: number };

export type BBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ClusterAwarePlane = {
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
  confidence?: number | null;
  source?: string;
  cluster_id?: string | number | null;
  ridge_group_id?: string | number | null;
  region_bbox?: BBox | null;
  source_ridge_ids?: Array<string | number>;
  multi_part_px?: Pt[][];
  merge_source_ids?: string[];
  [key: string]: unknown;
};

export type BlockingEdge = {
  edge_type?: string;
  line_px?: Pt[];
};

export type RidgeLine = {
  id?: string | number;
  ridge_id?: string | number;
  p1: Pt;
  p2: Pt;
};

type PlaneOut = ClusterAwarePlane & {
  id: string;
  plane_index: number;
  merge_source_ids: string[];
  source: string;
};

const EPS = 3;
const REGION_TOLERANCE_PX = 2;

function idOf(p: ClusterAwarePlane, i: number): string {
  return String(p.id ?? p.plane_index ?? i);
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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

function dot(a: Pt, b: Pt): number {
  return a.x * b.x + a.y * b.y;
}

function cross(a: Pt, b: Pt): number {
  return a.x * b.y - a.y * b.x;
}

function polygonAreaPx(poly: Pt[] = []): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area / 2);
}

function areaSqft(p: ClusterAwarePlane, feetPerPixel: number): number {
  const explicit = p.plan_area_sqft ?? p.area_sqft;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  if (Array.isArray(p.multi_part_px) && p.multi_part_px.length) {
    return p.multi_part_px.reduce((sum, part) => sum + polygonAreaPx(part) * feetPerPixel * feetPerPixel, 0);
  }
  return polygonAreaPx(p.polygon_px || []) * feetPerPixel * feetPerPixel;
}

function pitchDeg(p: ClusterAwarePlane): number | null {
  if (typeof p.pitch_degrees === "number" && Number.isFinite(p.pitch_degrees)) return p.pitch_degrees;
  if (typeof p.pitch === "number" && Number.isFinite(p.pitch)) return Math.atan(p.pitch / 12) * 180 / Math.PI;
  return null;
}

function azDeg(p: ClusterAwarePlane): number | null {
  const value = p.azimuthDeg ?? p.azimuth_degrees ?? p.azimuth;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function planeEdges(poly: Pt[] = []): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (let i = 0; i < poly.length; i++) out.push([poly[i], poly[(i + 1) % poly.length]]);
  return out;
}

function perimeter(poly: Pt[] = []): number {
  return planeEdges(poly).reduce((sum, [a, b]) => sum + dist(a, b), 0);
}

function pointToSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const denom = Math.max(dot(ab, ab), 1e-9);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / denom));
  return dist(p, add(a, mul(ab, t)));
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
  if (hi - lo <= 0.03) return null;
  const ab = sub(a2, a1);
  return [add(a1, mul(ab, lo)), add(a1, mul(ab, hi))];
}

function sharedBoundaryLength(a: ClusterAwarePlane, b: ClusterAwarePlane): number {
  let total = 0;
  for (const ea of planeEdges(a.polygon_px || [])) {
    for (const eb of planeEdges(b.polygon_px || [])) {
      const shared = sharedSegment(ea[0], ea[1], eb[0], eb[1]);
      if (shared) total += dist(shared[0], shared[1]);
    }
  }
  return total;
}

function bboxOf(poly: Pt[] = []): BBox & { area: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, area: 0 };
  return { minX, minY, maxX, maxY, area: Math.max(0, (maxX - minX) * (maxY - minY)) };
}

function withinBBox(poly: Pt[] = [], box?: BBox | null): boolean {
  if (!box) return false;
  return poly.every((p) =>
    p.x >= box.minX - REGION_TOLERANCE_PX &&
    p.x <= box.maxX + REGION_TOLERANCE_PX &&
    p.y >= box.minY - REGION_TOLERANCE_PX &&
    p.y <= box.maxY + REGION_TOLERANCE_PX
  );
}

function cent(poly: Pt[] = []): Pt {
  const n = Math.max(1, poly.length);
  return poly.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), { x: 0, y: 0 });
}

function lineSide(p: Pt, ridge: RidgeLine): number {
  return cross(sub(ridge.p2, ridge.p1), sub(p, ridge.p1));
}

function sharedRidgeIds(a: ClusterAwarePlane, b: ClusterAwarePlane): string[] {
  const set = new Set((a.source_ridge_ids || []).map(String));
  return (b.source_ridge_ids || []).map(String).filter((id) => set.has(id));
}

function isOppositeSidesOfRidge(a: ClusterAwarePlane, b: ClusterAwarePlane, ridgesById: Map<string, RidgeLine>): boolean {
  for (const rid of sharedRidgeIds(a, b)) {
    const ridge = ridgesById.get(rid);
    if (!ridge) continue;
    const sa = lineSide(cent(a.polygon_px), ridge);
    const sb = lineSide(cent(b.polygon_px), ridge);
    if (Math.abs(sa) > 8 && Math.abs(sb) > 8 && sa * sb < 0) return true;
  }
  return false;
}

function boundaryBlocked(a: ClusterAwarePlane, b: ClusterAwarePlane, blockingEdges: BlockingEdge[] = []): boolean {
  const blockers = blockingEdges.filter((e) => ["ridge", "valley", "hip"].includes(String(e.edge_type || "").toLowerCase()) && (e.line_px || []).length >= 2);
  if (!blockers.length) return false;
  for (const ea of planeEdges(a.polygon_px || [])) {
    for (const eb of planeEdges(b.polygon_px || [])) {
      const shared = sharedSegment(ea[0], ea[1], eb[0], eb[1]);
      if (!shared) continue;
      for (const edge of blockers) {
        const line = edge.line_px || [];
        for (let i = 1; i < line.length; i++) {
          const overlap = sharedSegment(shared[0], shared[1], line[i - 1], line[i]);
          if (overlap && dist(overlap[0], overlap[1]) >= Math.max(6, dist(shared[0], shared[1]) * 0.35)) return true;
        }
      }
    }
  }
  return false;
}

function edgeKey(a: Pt, b: Pt): string {
  const q = (n: number) => Math.round(n * 10) / 10;
  return `${q(a.x)},${q(a.y)}>${q(b.x)},${q(b.y)}`;
}

function reverseKey(a: Pt, b: Pt): string {
  const q = (n: number) => Math.round(n * 10) / 10;
  return `${q(b.x)},${q(b.y)}>${q(a.x)},${q(a.y)}`;
}

function unionAdjacentPolygons(a: Pt[], b: Pt[]): Pt[] | null {
  const all = [...planeEdges(a), ...planeEdges(b)];
  const kept = new Map<string, [Pt, Pt]>();
  for (const [u, v] of all) {
    const rk = reverseKey(u, v);
    if (kept.has(rk)) {
      kept.delete(rk);
    } else {
      kept.set(edgeKey(u, v), [u, v]);
    }
  }
  const edges = Array.from(kept.values());
  if (edges.length < 3) return null;
  const used = new Array(edges.length).fill(false);
  const loop: Pt[] = [edges[0][0], edges[0][1]];
  used[0] = true;
  for (let guard = 0; guard < edges.length + 2; guard++) {
    const tail = loop[loop.length - 1];
    if (dist(tail, loop[0]) <= EPS && loop.length >= 4) {
      loop.pop();
      break;
    }
    let nextIdx = -1;
    let reversed = false;
    for (let i = 0; i < edges.length; i++) {
      if (used[i]) continue;
      if (dist(edges[i][0], tail) <= EPS) { nextIdx = i; break; }
      if (dist(edges[i][1], tail) <= EPS) { nextIdx = i; reversed = true; break; }
    }
    if (nextIdx < 0) return null;
    used[nextIdx] = true;
    loop.push(reversed ? edges[nextIdx][0] : edges[nextIdx][1]);
  }
  if (loop.length < 3 || used.some((u) => !u)) return null;
  return polygonAreaPx(loop) > 0 ? loop : null;
}

function weightedAverage(values: Array<{ value: number | null; weight: number }>): number | null {
  const valid = values.filter((v) => v.value !== null && Number.isFinite(v.value) && v.weight > 0);
  const total = valid.reduce((sum, v) => sum + v.weight, 0);
  if (!total) return null;
  return valid.reduce((sum, v) => sum + (v.value as number) * v.weight, 0) / total;
}

function rejectLog(reason: string, a: PlaneOut, b: PlaneOut, areaInflationPct: number, sharedBoundaryRatio: number) {
  const payload = {
    reason,
    plane_a: a.id,
    plane_b: b.id,
    cluster_a: a.cluster_id ?? null,
    cluster_b: b.cluster_id ?? null,
    area_inflation_pct: Number(areaInflationPct.toFixed(3)),
    shared_boundary_ratio: Number(sharedBoundaryRatio.toFixed(3)),
  };
  console.log("[MERGE_REJECTED]", JSON.stringify(payload));
  return payload;
}

function mergePair(a: PlaneOut, b: PlaneOut, feetPerPixel: number): PlaneOut | { rejected: string; areaInflationPct: number } {
  const areaA = areaSqft(a, feetPerPixel);
  const areaB = areaSqft(b, feetPerPixel);
  const sourceArea = areaA + areaB;
  const union = unionAdjacentPolygons(a.polygon_px || [], b.polygon_px || []);
  const parts = union ? [union] : [a.polygon_px || [], b.polygon_px || []].sort((u, v) => polygonAreaPx(v) - polygonAreaPx(u));
  const polygon = union || parts[0];
  const mergedArea = union ? polygonAreaPx(union) * feetPerPixel * feetPerPixel : sourceArea;
  const areaInflationPct = sourceArea > 0 ? ((mergedArea - sourceArea) / sourceArea) * 100 : 0;
  if (mergedArea > sourceArea * 1.08) return { rejected: "merge_area_inflation", areaInflationPct };

  const mergedBBoxAreaSqft = bboxOf(polygon).area * feetPerPixel * feetPerPixel;
  if (sourceArea > 0 && mergedBBoxAreaSqft / sourceArea > 1.15) return { rejected: "merged_bbox_inflation", areaInflationPct };
  const looksRectangular = polygon.length <= 4 && sourceArea > 0 && mergedBBoxAreaSqft / sourceArea > 1.05;
  if (looksRectangular && (a.polygon_px || []).length + (b.polygon_px || []).length > 8) return { rejected: "giant_rectangle_output", areaInflationPct };

  const pitch = weightedAverage([
    { value: pitchDeg(a), weight: areaA },
    { value: pitchDeg(b), weight: areaB },
  ]);
  const azimuth = weightedAverage([
    { value: azDeg(a), weight: areaA },
    { value: azDeg(b), weight: areaB },
  ]);
  const sourceRidgeIds = Array.from(new Set([...(a.source_ridge_ids || []), ...(b.source_ridge_ids || [])].map(String)));
  return {
    ...a,
    id: `${a.id}_${b.id}`,
    polygon_px: polygon,
    multi_part_px: union ? undefined : parts,
    plan_area_sqft: mergedArea,
    area_sqft: mergedArea,
    pitch_degrees: pitch,
    pitch: pitch === null ? a.pitch ?? b.pitch ?? null : Math.tan(pitch * Math.PI / 180) * 12,
    azimuth,
    azimuthDeg: azimuth,
    azimuth_degrees: azimuth,
    source_ridge_ids: sourceRidgeIds,
    merge_source_ids: [...a.merge_source_ids, ...b.merge_source_ids],
    source: "cluster_aware_plane_merge_v1",
  };
}

export function mergeClusterAwarePlanes(args: {
  planes: ClusterAwarePlane[];
  feetPerPixel: number;
  blockingEdges?: BlockingEdge[];
  ridges?: RidgeLine[];
  maxIterations?: number;
}) {
  const feetPerPixel = args.feetPerPixel;
  const ridgesById = new Map<string, RidgeLine>();
  for (const ridge of args.ridges || []) {
    const id = String(ridge.ridge_id ?? ridge.id ?? "");
    if (id) ridgesById.set(id, ridge);
  }

  let planes: PlaneOut[] = args.planes.map((p, i) => ({
    ...p,
    id: idOf(p, i),
    plane_index: i + 1,
    merge_source_ids: Array.isArray(p.merge_source_ids) ? p.merge_source_ids.map(String) : [idOf(p, i)],
    source: p.source || "ridge_split_recursive",
  }));

  const before = planes.length;
  const preMergeArea = planes.reduce((sum, p) => sum + areaSqft(p, feetPerPixel), 0);
  const rejected: unknown[] = [];
  const accepted: unknown[] = [];
  const maxIterations = args.maxIterations ?? 40;

  for (let iter = 0; iter < maxIterations; iter++) {
    let best: null | { i: number; j: number; sharedRatio: number; score: number } = null;
    for (let i = 0; i < planes.length; i++) {
      for (let j = i + 1; j < planes.length; j++) {
        const a = planes[i], b = planes[j];
        const shared = sharedBoundaryLength(a, b);
        const minPerim = Math.min(perimeter(a.polygon_px || []), perimeter(b.polygon_px || []));
        const sharedRatio = minPerim > 0 ? shared / minPerim : 0;
        const areaA = areaSqft(a, feetPerPixel);
        const areaB = areaSqft(b, feetPerPixel);
        const sourceArea = areaA + areaB;
        const clusterCompatible = a.cluster_id != null && b.cluster_id != null && String(a.cluster_id) === String(b.cluster_id);
        const ridgeGroupCompatible = a.ridge_group_id != null && b.ridge_group_id != null && String(a.ridge_group_id) === String(b.ridge_group_id);
        const pitchA = pitchDeg(a), pitchB = pitchDeg(b);
        const azA = azDeg(a), azB = azDeg(b);
        const pitchDelta = pitchA !== null && pitchB !== null ? Math.abs(pitchA - pitchB) : Infinity;
        const azDelta = azA !== null && azB !== null ? angleDiff(azA, azB) : Infinity;
        let reason: string | null = null;
        if (!clusterCompatible && !ridgeGroupCompatible) reason = "cross_cluster_or_ridge_group";
        else if (sharedRatio <= 0.15) reason = "insufficient_shared_boundary";
        else if (pitchDelta > 2) reason = "pitch_delta_gt_2deg_or_missing";
        else if (azDelta > 25) reason = "azimuth_delta_gt_25deg_or_missing";
        else if (!withinBBox(a.polygon_px, a.region_bbox) || !withinBBox(b.polygon_px, b.region_bbox)) reason = "plane_outside_cluster_region_bbox";
        else if (isOppositeSidesOfRidge(a, b, ridgesById)) reason = "opposite_sides_of_ridge";
        else if (boundaryBlocked(a, b, args.blockingEdges)) reason = "shared_edge_is_ridge_valley_or_hip";

        if (reason) {
          rejected.push(rejectLog(reason, a, b, 0, sharedRatio));
          continue;
        }

        const union = unionAdjacentPolygons(a.polygon_px || [], b.polygon_px || []);
        const candidatePoly = union || (areaA >= areaB ? a.polygon_px : b.polygon_px);
        const candidateArea = union ? polygonAreaPx(union) * feetPerPixel * feetPerPixel : sourceArea;
        const areaInflationPct = sourceArea > 0 ? ((candidateArea - sourceArea) / sourceArea) * 100 : 0;
        const bboxRatio = sourceArea > 0 ? (bboxOf(candidatePoly).area * feetPerPixel * feetPerPixel) / sourceArea : 0;
        if (candidateArea > sourceArea * 1.08) {
          rejected.push(rejectLog("merge_area_inflation", a, b, areaInflationPct, sharedRatio));
          continue;
        }
        if (bboxRatio > 1.15) {
          rejected.push(rejectLog("merged_bbox_area_ratio_gt_1_15", a, b, areaInflationPct, sharedRatio));
          continue;
        }
        if (candidatePoly.length <= 4 && bboxRatio > 1.05 && ((a.polygon_px || []).length + (b.polygon_px || []).length > 8)) {
          rejected.push(rejectLog("giant_rectangle_output", a, b, areaInflationPct, sharedRatio));
          continue;
        }

        const score = sharedRatio * 0.5 + (1 - Math.min(pitchDelta / 2, 1)) * 0.25 + (1 - Math.min(azDelta / 25, 1)) * 0.25;
        if (!best || score > best.score) best = { i, j, sharedRatio, score };
      }
    }
    if (!best) break;
    const a = planes[best.i];
    const b = planes[best.j];
    const merged = mergePair(a, b, feetPerPixel);
    if ("rejected" in merged) {
      rejected.push(rejectLog(merged.rejected, a, b, merged.areaInflationPct, best.sharedRatio));
      break;
    }
    accepted.push({ iteration: iter, merged: [a.id, b.id], shared_boundary_ratio: Number(best.sharedRatio.toFixed(3)) });
    planes = planes.filter((_, idx) => idx !== best!.i && idx !== best!.j);
    planes.push(merged);
  }

  planes = planes.map((p, i) => ({ ...p, id: String(i + 1), plane_index: i + 1, source: p.source || "cluster_aware_plane_merge_v1" }));
  const postMergeArea = planes.reduce((sum, p) => sum + areaSqft(p, feetPerPixel), 0);
  const areaInflationPct = preMergeArea > 0 ? ((postMergeArea - preMergeArea) / preMergeArea) * 100 : 0;
  const debug = {
    before,
    after: planes.length,
    rejected_merges: rejected.length,
    accepted_merges: accepted.length,
    pre_merge_area: Number(preMergeArea.toFixed(2)),
    post_merge_area: Number(postMergeArea.toFixed(2)),
    area_inflation_pct: Number(areaInflationPct.toFixed(3)),
    rejected,
    accepted,
  };
  console.log("[CLUSTER_AWARE_PLANE_MERGE]", JSON.stringify(debug));
  return { planes, debug };
}

export function lineWithinBBox(line: Pt[] = [], bbox?: BBox | null, tolerancePx = REGION_TOLERANCE_PX): boolean {
  if (!bbox || line.length < 2) return false;
  return line.every((p) =>
    p.x >= bbox.minX - tolerancePx && p.x <= bbox.maxX + tolerancePx &&
    p.y >= bbox.minY - tolerancePx && p.y <= bbox.maxY + tolerancePx
  );
}