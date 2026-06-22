// PR #5 — per-facet DSM plane-fit pitch helper.
// Vendor-free: derives pitch from DSM / point-cloud evidence inside a facet polygon.

export type PxPoint = [number, number];

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface DsmGridInput {
  grid: Float32Array | number[];
  width: number;
  height: number;
  meters_per_pixel: number;
  no_data_value?: number | null;
}

export interface FacetDsmPlaneFitInput {
  facet_id: string | number;
  facet_polygon_px: PxPoint[];
  dsm: DsmGridInput;
  max_points?: number;
  ransac?: Partial<RansacOptions>;
}

export interface PlaneModel {
  normal: [number, number, number];
  d: number;
}

export interface RansacOptions {
  residual_threshold_m: number;
  max_iterations: number;
  min_points: number;
  min_inlier_ratio: number;
}

export interface DsmPlaneFitResult {
  facet_id: string | number;
  status: "passed" | "needs_review" | "failed";
  failure_reason: string | null;
  plane: PlaneModel | null;
  pitch_degrees: number | null;
  pitch_rise_over_12: number | null;
  rmse_m: number | null;
  median_abs_residual_m: number | null;
  max_abs_residual_m: number | null;
  point_count: number;
  inlier_count: number;
  inlier_ratio: number;
  residual_threshold_m: number;
  sample_bbox_px: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

const DEFAULT_RANSAC: RansacOptions = {
  residual_threshold_m: 0.18,
  max_iterations: 650,
  min_points: 12,
  min_inlier_ratio: 0.72,
};

export function fitFacetDsmPlane(input: FacetDsmPlaneFitInput): DsmPlaneFitResult {
  const opt: RansacOptions = { ...DEFAULT_RANSAC, ...(input.ransac ?? {}) };
  const points = sampleDsmPointsInsidePolygon(input.dsm, input.facet_polygon_px, input.max_points ?? 900);
  const fit = fitPlaneRansac(points, opt);
  return {
    facet_id: input.facet_id,
    ...fit,
    sample_bbox_px: polygonBBox(input.facet_polygon_px),
  };
}

export function sampleDsmPointsInsidePolygon(
  dsm: DsmGridInput,
  polygon: PxPoint[],
  maxPoints = 900,
): Point3D[] {
  const bbox = polygonBBox(polygon);
  if (!bbox || dsm.width <= 0 || dsm.height <= 0 || dsm.meters_per_pixel <= 0) return [];

  const minX = clampInt(Math.floor(bbox.minX), 0, dsm.width - 1);
  const maxX = clampInt(Math.ceil(bbox.maxX), 0, dsm.width - 1);
  const minY = clampInt(Math.floor(bbox.minY), 0, dsm.height - 1);
  const maxY = clampInt(Math.ceil(bbox.maxY), 0, dsm.height - 1);
  const totalCandidatePx = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
  const stride = Math.max(1, Math.ceil(Math.sqrt(totalCandidatePx / Math.max(1, maxPoints))));

  const points: Point3D[] = [];
  for (let py = minY; py <= maxY; py += stride) {
    for (let px = minX; px <= maxX; px += stride) {
      if (!pointInPolygon([px + 0.5, py + 0.5], polygon)) continue;
      const z = Number(dsm.grid[py * dsm.width + px]);
      if (!Number.isFinite(z)) continue;
      if (dsm.no_data_value != null && z === dsm.no_data_value) continue;
      points.push({
        x: px * dsm.meters_per_pixel,
        y: py * dsm.meters_per_pixel,
        z,
      });
    }
  }
  return points;
}

export function fitPlaneRansac(points: Point3D[], options: Partial<RansacOptions> = {}): Omit<DsmPlaneFitResult, "facet_id" | "sample_bbox_px"> {
  const opt: RansacOptions = { ...DEFAULT_RANSAC, ...options };
  const clean = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  if (clean.length < opt.min_points) return fail(clean.length, opt, "insufficient_dsm_points");

  let bestPlane: PlaneModel | null = null;
  let bestInliers: number[] = [];
  let bestResiduals: number[] = [];
  let iterations = 0;

  outer:
  for (let i = 0; i < clean.length - 2; i++) {
    for (let j = i + 1; j < clean.length - 1; j++) {
      for (let k = j + 1; k < clean.length; k++) {
        const plane = planeFrom3Points(clean[i], clean[j], clean[k]);
        if (!plane) continue;
        const residuals = clean.map((p) => Math.abs(distanceToPlane(p, plane)));
        const inliers: number[] = [];
        for (let idx = 0; idx < residuals.length; idx++) {
          if (residuals[idx] <= opt.residual_threshold_m) inliers.push(idx);
        }
        if (inliers.length > bestInliers.length ||
          (inliers.length === bestInliers.length && rmse(residuals) < rmse(bestResiduals))) {
          bestPlane = plane;
          bestInliers = inliers;
          bestResiduals = residuals;
        }
        iterations++;
        if (iterations >= opt.max_iterations) break outer;
      }
    }
  }

  if (!bestPlane || bestInliers.length === 0) return fail(clean.length, opt, "no_valid_dsm_plane");

  const inlierResiduals = bestInliers.map((idx) => Math.abs(distanceToPlane(clean[idx], bestPlane!)));
  const inlierRatio = bestInliers.length / clean.length;
  const pitch = pitchFromPlane(bestPlane);
  const fitRmse = rmse(inlierResiduals);
  const reasons: string[] = [];
  if (inlierRatio < opt.min_inlier_ratio) reasons.push("plane_inlier_ratio_low");
  if (fitRmse > opt.residual_threshold_m) reasons.push("plane_rmse_high");
  if (pitch.pitch_degrees == null) reasons.push("pitch_unavailable");

  const status = reasons.length === 0 ? "passed" :
    inlierRatio >= opt.min_inlier_ratio * 0.85 ? "needs_review" : "failed";

  return {
    status,
    failure_reason: reasons[0] ?? null,
    plane: bestPlane,
    pitch_degrees: round(pitch.pitch_degrees, 3),
    pitch_rise_over_12: round(pitch.pitch_rise_over_12, 3),
    rmse_m: round(fitRmse, 4),
    median_abs_residual_m: round(median(inlierResiduals), 4),
    max_abs_residual_m: round(inlierResiduals.length ? Math.max(...inlierResiduals) : null, 4),
    point_count: clean.length,
    inlier_count: bestInliers.length,
    inlier_ratio: round(inlierRatio, 4) ?? 0,
    residual_threshold_m: opt.residual_threshold_m,
  };
}

export function planeFrom3Points(a: Point3D, b: Point3D, c: Point3D): PlaneModel | null {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (!Number.isFinite(len) || len < 1e-9) return null;
  const normal: [number, number, number] = [nx / len, ny / len, nz / len];
  const d = -(normal[0] * a.x + normal[1] * a.y + normal[2] * a.z);
  return { normal, d };
}

export function pitchFromPlane(plane: PlaneModel): { pitch_degrees: number | null; pitch_rise_over_12: number | null } {
  const [nx, ny, nz] = plane.normal;
  if (!Number.isFinite(nz) || Math.abs(nz) < 1e-9) return { pitch_degrees: null, pitch_rise_over_12: null };
  const slope = Math.hypot(nx, ny) / Math.abs(nz);
  return {
    pitch_degrees: Math.atan(slope) * 180 / Math.PI,
    pitch_rise_over_12: slope * 12,
  };
}

export function distanceToPlane(p: Point3D, plane: PlaneModel): number {
  return plane.normal[0] * p.x + plane.normal[1] * p.y + plane.normal[2] * p.z + plane.d;
}

function fail(pointCount: number, opt: RansacOptions, reason: string): Omit<DsmPlaneFitResult, "facet_id" | "sample_bbox_px"> {
  return {
    status: "failed",
    failure_reason: reason,
    plane: null,
    pitch_degrees: null,
    pitch_rise_over_12: null,
    rmse_m: null,
    median_abs_residual_m: null,
    max_abs_residual_m: null,
    point_count: pointCount,
    inlier_count: 0,
    inlier_ratio: 0,
    residual_threshold_m: opt.residual_threshold_m,
  };
}

function pointInPolygon(point: PxPoint, polygon: PxPoint[]): boolean {
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonBBox(polygon: PxPoint[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!polygon.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function rmse(values: number[]): number {
  if (!values.length) return Number.POSITIVE_INFINITY;
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round(value: number | null | undefined, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}
