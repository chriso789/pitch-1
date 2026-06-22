// Vendor-free pitch verification helpers.
//
// PR #5 contract:
// - Pitch is verified from raw geometry/evidence only.
// - Vendor reports are never runtime inputs, labels, or confidence sources.
// - Per-facet DSM/point-cloud plane fit is the primary pitch evidence.
// - Solar, oblique, and street-view readings are cross-checks, not vendor truth.

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface PlaneModel {
  /** Plane equation ax + by + cz + d = 0. */
  normal: [number, number, number];
  d: number;
}

export interface PlaneFitResult {
  ok: boolean;
  plane: PlaneModel | null;
  pitch_rise_over_12: number | null;
  pitch_degrees: number | null;
  rmse: number | null;
  median_abs_residual: number | null;
  max_abs_residual: number | null;
  inlier_count: number;
  point_count: number;
  inlier_ratio: number;
  residual_threshold_m: number;
  status: "passed" | "needs_review" | "failed";
  failure_reason: string | null;
}

export interface RansacOptions {
  residual_threshold_m?: number;
  max_iterations?: number;
  min_inlier_ratio?: number;
  min_points?: number;
}

const DEFAULT_RANSAC: Required<RansacOptions> = {
  residual_threshold_m: 0.18,
  max_iterations: 600,
  min_inlier_ratio: 0.72,
  min_points: 9,
};

export interface PitchEvidenceInput {
  source: "dsm_plane_fit" | "geometry" | "solar" | "oblique" | "street_view";
  pitch_rise_over_12: number | null;
  confidence?: number | null;
  residual?: number | null;
}

export interface FacetPitchSelfConsistencyInput {
  facet_id: string | number;
  evidences: PitchEvidenceInput[];
  plane_fit?: PlaneFitResult | null;
}

export interface PitchSelfConsistencyThresholds {
  min_score: number;
  max_pitch_delta_rise_over_12: number;
  max_plane_rmse_m: number;
  min_plane_inlier_ratio: number;
}

export interface FacetPitchSelfConsistencyResult {
  facet_id: string | number;
  score: number;
  status: "passed" | "needs_review" | "failed";
  consensus_pitch_rise_over_12: number | null;
  max_delta_rise_over_12: number | null;
  evidence_count: number;
  failed_reasons: string[];
  source_deltas: Record<string, number | null>;
}

export interface RoofPitchSelfConsistencyResult {
  score: number;
  status: "passed" | "needs_review" | "failed";
  facet_count: number;
  passed_facets: number;
  failed_facets: number;
  facet_results: FacetPitchSelfConsistencyResult[];
  thresholds: PitchSelfConsistencyThresholds;
}

export const DEFAULT_PITCH_SELF_CONSISTENCY_THRESHOLDS: PitchSelfConsistencyThresholds = {
  min_score: 0.90,
  max_pitch_delta_rise_over_12: 1.0,
  max_plane_rmse_m: 0.22,
  min_plane_inlier_ratio: 0.72,
};

export function fitPlaneRansac(points: Point3D[], options: RansacOptions = {}): PlaneFitResult {
  const opt = { ...DEFAULT_RANSAC, ...options };
  const clean = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  if (clean.length < opt.min_points) {
    return failedPlaneFit(clean.length, opt.residual_threshold_m, "insufficient_points");
  }

  let best: { plane: PlaneModel; inliers: Point3D[]; residuals: number[] } | null = null;
  let iterations = 0;

  outer:
  for (let i = 0; i < clean.length - 2; i++) {
    for (let j = i + 1; j < clean.length - 1; j++) {
      for (let k = j + 1; k < clean.length; k++) {
        const plane = planeFrom3Points(clean[i], clean[j], clean[k]);
        if (!plane) continue;
        const residuals = clean.map((p) => Math.abs(distanceToPlane(p, plane)));
        const inliers = clean.filter((_, idx) => residuals[idx] <= opt.residual_threshold_m);
        if (!best || inliers.length > best.inliers.length ||
            (inliers.length === best.inliers.length && rmse(residuals) < rmse(best.residuals))) {
          best = { plane, inliers, residuals };
        }
        iterations++;
        if (iterations >= opt.max_iterations) break outer;
      }
    }
  }

  if (!best) return failedPlaneFit(clean.length, opt.residual_threshold_m, "no_valid_plane");

  const inlierResiduals = best.inliers.map((p) => Math.abs(distanceToPlane(p, best!.plane)));
  const inlierRatio = best.inliers.length / clean.length;
  const pitch = pitchFromPlane(best.plane);
  const fitRmse = rmse(inlierResiduals);
  const medianResidual = median(inlierResiduals);
  const maxResidual = inlierResiduals.length ? Math.max(...inlierResiduals) : null;

  const failedReasons: string[] = [];
  if (inlierRatio < opt.min_inlier_ratio) failedReasons.push("plane_inlier_ratio_low");
  if (fitRmse > opt.residual_threshold_m) failedReasons.push("plane_fit_rmse_high");
  if (pitch.pitch_rise_over_12 == null) failedReasons.push("pitch_unavailable");

  const status = failedReasons.length === 0 ? "passed" :
    inlierRatio >= opt.min_inlier_ratio * 0.85 ? "needs_review" : "failed";

  return {
    ok: status === "passed",
    plane: best.plane,
    pitch_rise_over_12: round(pitch.pitch_rise_over_12, 3),
    pitch_degrees: round(pitch.pitch_degrees, 3),
    rmse: round(fitRmse, 4),
    median_abs_residual: round(medianResidual, 4),
    max_abs_residual: round(maxResidual, 4),
    inlier_count: best.inliers.length,
    point_count: clean.length,
    inlier_ratio: round(inlierRatio, 4)!,
    residual_threshold_m: opt.residual_threshold_m,
    status,
    failure_reason: failedReasons[0] ?? null,
  };
}

export function planeFrom3Points(a: Point3D, b: Point3D, c: Point3D): PlaneModel | null {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return null;
  const normal: [number, number, number] = [nx / len, ny / len, nz / len];
  const d = -(normal[0] * a.x + normal[1] * a.y + normal[2] * a.z);
  return { normal, d };
}

export function distanceToPlane(p: Point3D, plane: PlaneModel): number {
  return plane.normal[0] * p.x + plane.normal[1] * p.y + plane.normal[2] * p.z + plane.d;
}

export function pitchFromPlane(plane: PlaneModel): { pitch_rise_over_12: number | null; pitch_degrees: number | null } {
  const [nx, ny, nz] = plane.normal;
  if (!Number.isFinite(nz) || Math.abs(nz) < 1e-9) {
    return { pitch_rise_over_12: null, pitch_degrees: null };
  }
  const slope = Math.hypot(nx, ny) / Math.abs(nz);
  return {
    pitch_rise_over_12: slope * 12,
    pitch_degrees: (Math.atan(slope) * 180) / Math.PI,
  };
}

export function evaluateFacetPitchSelfConsistency(
  input: FacetPitchSelfConsistencyInput,
  thresholds: PitchSelfConsistencyThresholds = DEFAULT_PITCH_SELF_CONSISTENCY_THRESHOLDS,
): FacetPitchSelfConsistencyResult {
  const usable = input.evidences.filter((e) => e.pitch_rise_over_12 != null && Number.isFinite(e.pitch_rise_over_12));
  const failedReasons: string[] = [];

  if (usable.length < 2) failedReasons.push("insufficient_pitch_evidence");
  const consensus = usable.length ? weightedMedianPitch(usable) : null;
  const deltas: Record<string, number | null> = {};
  let maxDelta: number | null = null;

  for (const ev of input.evidences) {
    const delta = consensus == null || ev.pitch_rise_over_12 == null
      ? null
      : Math.abs(ev.pitch_rise_over_12 - consensus);
    deltas[ev.source] = round(delta, 3);
    if (delta != null) maxDelta = Math.max(maxDelta ?? 0, delta);
  }

  if (maxDelta != null && maxDelta > thresholds.max_pitch_delta_rise_over_12) {
    failedReasons.push("pitch_source_delta_high");
  }

  const pf = input.plane_fit;
  if (pf) {
    if ((pf.rmse ?? Number.POSITIVE_INFINITY) > thresholds.max_plane_rmse_m) failedReasons.push("plane_fit_rmse_high");
    if (pf.inlier_ratio < thresholds.min_plane_inlier_ratio) failedReasons.push("plane_inlier_ratio_low");
    if (pf.status === "failed") failedReasons.push("plane_fit_failed");
  }

  const agreementScore = maxDelta == null
    ? 0
    : Math.max(0, 1 - maxDelta / Math.max(thresholds.max_pitch_delta_rise_over_12 * 2, 0.001));
  const residualScore = pf?.rmse == null
    ? 0.75
    : Math.max(0, 1 - pf.rmse / Math.max(thresholds.max_plane_rmse_m * 2, 0.001));
  const inlierScore = pf?.inlier_ratio == null ? 0.75 : Math.max(0, Math.min(1, pf.inlier_ratio));
  const evidenceScore = Math.min(1, usable.length / 3);
  const score = round(agreementScore * 0.42 + residualScore * 0.28 + inlierScore * 0.20 + evidenceScore * 0.10, 4) ?? 0;

  if (score < thresholds.min_score) failedReasons.push("pitch_self_consistency_score_low");

  const status = failedReasons.length === 0 ? "passed" : score >= thresholds.min_score * 0.82 ? "needs_review" : "failed";

  return {
    facet_id: input.facet_id,
    score,
    status,
    consensus_pitch_rise_over_12: round(consensus, 3),
    max_delta_rise_over_12: round(maxDelta, 3),
    evidence_count: usable.length,
    failed_reasons: [...new Set(failedReasons)],
    source_deltas: deltas,
  };
}

export function evaluateRoofPitchSelfConsistency(
  facets: FacetPitchSelfConsistencyInput[],
  thresholds: PitchSelfConsistencyThresholds = DEFAULT_PITCH_SELF_CONSISTENCY_THRESHOLDS,
): RoofPitchSelfConsistencyResult {
  const facetResults = facets.map((f) => evaluateFacetPitchSelfConsistency(f, thresholds));
  const score = facetResults.length
    ? round(facetResults.reduce((sum, r) => sum + r.score, 0) / facetResults.length, 4) ?? 0
    : 0;
  const failedFacets = facetResults.filter((r) => r.status === "failed").length;
  const passedFacets = facetResults.filter((r) => r.status === "passed").length;
  const status = facetResults.length === 0 || failedFacets > 0 || score < thresholds.min_score
    ? "failed"
    : facetResults.some((r) => r.status === "needs_review") ? "needs_review" : "passed";

  return {
    score,
    status,
    facet_count: facetResults.length,
    passed_facets: passedFacets,
    failed_facets: failedFacets,
    facet_results: facetResults,
    thresholds,
  };
}

export function assertPitchResultsArtifactSelfConsistency(metadata: unknown): {
  ok: boolean;
  score: number | null;
  status: string | null;
  reason: string | null;
} {
  const m = (metadata ?? {}) as any;
  const block = m.pitch_self_consistency ?? m.self_consistency ?? m.pitch_verification ?? m;
  const score = Number(block.topology_self_consistency_score ?? block.pitch_self_consistency_score ?? block.score);
  const status = String(block.status ?? block.pitch_verification_status ?? "").trim() || null;
  if (!Number.isFinite(score)) {
    return { ok: false, score: null, status, reason: "pitch_self_consistency_score_missing" };
  }
  if (score < DEFAULT_PITCH_SELF_CONSISTENCY_THRESHOLDS.min_score) {
    return { ok: false, score, status, reason: "pitch_self_consistency_score_below_threshold" };
  }
  if (status && !["passed", "verified"].includes(status)) {
    return { ok: false, score, status, reason: `pitch_self_consistency_status_${status}` };
  }
  return { ok: true, score, status: status ?? "passed", reason: null };
}

function weightedMedianPitch(evidences: PitchEvidenceInput[]): number | null {
  const values = evidences
    .filter((e) => e.pitch_rise_over_12 != null && Number.isFinite(e.pitch_rise_over_12))
    .map((e) => ({ value: e.pitch_rise_over_12!, weight: sourceWeight(e) }))
    .sort((a, b) => a.value - b.value);
  if (!values.length) return null;
  const total = values.reduce((s, v) => s + v.weight, 0);
  let acc = 0;
  for (const v of values) {
    acc += v.weight;
    if (acc >= total / 2) return v.value;
  }
  return values[values.length - 1].value;
}

function sourceWeight(e: PitchEvidenceInput): number {
  const confidence = Math.max(0.1, Math.min(1, Number(e.confidence ?? 0.75)));
  const base = e.source === "dsm_plane_fit" ? 1.0 :
    e.source === "geometry" ? 0.82 :
    e.source === "street_view" ? 0.72 :
    e.source === "oblique" ? 0.72 :
    e.source === "solar" ? 0.55 : 0.5;
  const residualPenalty = e.residual == null ? 1 : Math.max(0.35, 1 - Number(e.residual));
  return base * confidence * residualPenalty;
}

function failedPlaneFit(pointCount: number, residualThresholdM: number, reason: string): PlaneFitResult {
  return {
    ok: false,
    plane: null,
    pitch_rise_over_12: null,
    pitch_degrees: null,
    rmse: null,
    median_abs_residual: null,
    max_abs_residual: null,
    inlier_count: 0,
    point_count: pointCount,
    inlier_ratio: 0,
    residual_threshold_m: residualThresholdM,
    status: "failed",
    failure_reason: reason,
  };
}

function rmse(values: number[]): number {
  if (!values.length) return Number.POSITIVE_INFINITY;
  return Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round(value: number | null | undefined, digits = 3): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}
