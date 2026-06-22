import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertPitchResultsArtifactSelfConsistency,
  evaluateFacetPitchSelfConsistency,
  fitPlaneRansac,
  type Point3D,
} from "../pitch-self-consistency.ts";

Deno.test("fitPlaneRansac recovers 6/12 pitch with outliers", () => {
  const points: Point3D[] = [];
  // z = 0.5x means rise/run = 0.5 => 6/12 pitch.
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 5; y++) {
      points.push({ x, y, z: 0.5 * x + (y % 2) * 0.01 });
    }
  }
  points.push({ x: 2, y: 2, z: 9 });
  points.push({ x: 6, y: 1, z: -4 });

  const fit = fitPlaneRansac(points, { residual_threshold_m: 0.08, min_inlier_ratio: 0.85 });

  assertEquals(fit.status, "passed");
  assert(fit.pitch_rise_over_12 != null);
  assert(Math.abs(fit.pitch_rise_over_12 - 6) < 0.25);
  assert(fit.inlier_ratio > 0.9);
});

Deno.test("facet self-consistency passes when DSM, geometry, Solar, and visual cross-check agree", () => {
  const result = evaluateFacetPitchSelfConsistency({
    facet_id: "front-1",
    plane_fit: {
      ok: true,
      plane: null,
      pitch_rise_over_12: 6,
      pitch_degrees: 26.565,
      rmse: 0.06,
      median_abs_residual: 0.03,
      max_abs_residual: 0.11,
      inlier_count: 94,
      point_count: 100,
      inlier_ratio: 0.94,
      residual_threshold_m: 0.18,
      status: "passed",
      failure_reason: null,
    },
    evidences: [
      { source: "dsm_plane_fit", pitch_rise_over_12: 6.0, confidence: 0.95, residual: 0.06 },
      { source: "geometry", pitch_rise_over_12: 6.1, confidence: 0.88 },
      { source: "solar", pitch_rise_over_12: 5.9, confidence: 0.70 },
      { source: "street_view", pitch_rise_over_12: 6.05, confidence: 0.72 },
    ],
  });

  assertEquals(result.status, "passed");
  assert(result.score >= 0.9);
  assert(result.max_delta_rise_over_12 != null && result.max_delta_rise_over_12 <= 0.2);
});

Deno.test("facet self-consistency fails when pitch sources disagree", () => {
  const result = evaluateFacetPitchSelfConsistency({
    facet_id: "front-1",
    plane_fit: {
      ok: true,
      plane: null,
      pitch_rise_over_12: 6,
      pitch_degrees: 26.565,
      rmse: 0.05,
      median_abs_residual: 0.03,
      max_abs_residual: 0.10,
      inlier_count: 92,
      point_count: 100,
      inlier_ratio: 0.92,
      residual_threshold_m: 0.18,
      status: "passed",
      failure_reason: null,
    },
    evidences: [
      { source: "dsm_plane_fit", pitch_rise_over_12: 6, confidence: 0.95 },
      { source: "geometry", pitch_rise_over_12: 9.2, confidence: 0.9 },
      { source: "street_view", pitch_rise_over_12: 9.0, confidence: 0.75 },
    ],
  });

  assertEquals(result.status, "failed");
  assert(result.failed_reasons.includes("pitch_source_delta_high"));
});

Deno.test("pitch artifact gate rejects missing or low self-consistency", () => {
  assertEquals(assertPitchResultsArtifactSelfConsistency({}).ok, false);
  assertEquals(assertPitchResultsArtifactSelfConsistency({ pitch_self_consistency_score: 0.91, status: "passed" }).ok, true);
  assertEquals(assertPitchResultsArtifactSelfConsistency({ pitch_self_consistency_score: 0.81, status: "passed" }).ok, false);
});
