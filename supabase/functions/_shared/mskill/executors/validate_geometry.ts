// validate_geometry — refuses to pass unless real artifacts exist for every required
// upstream geometry skill. Never invents a confidence score.

import type { ExecutorContext, ExecutorResult } from "../runner.ts";
import { assertPitchResultsArtifactGate } from "../../pitch/artifact-gate.ts";

const REQUIRED_GEOMETRY_SKILLS = [
  "fit_roof_planes","detect_ridges","detect_hips","detect_valleys",
  "detect_eaves","detect_rakes","calculate_pitch","calculate_roof_area",
];

export async function runValidateGeometry(ctx: ExecutorContext): Promise<ExecutorResult> {
  const { data: runs } = await ctx.svc
    .from("mskill_runs")
    .select("skill_key, status, id")
    .eq("mskill_job_id", ctx.mskill_job_id)
    .in("skill_key", REQUIRED_GEOMETRY_SKILLS);

  const byKey = new Map((runs ?? []).map((r) => [r.skill_key, r]));
  const missing: string[] = [];
  const runIds: string[] = [];
  for (const k of REQUIRED_GEOMETRY_SKILLS) {
    const r = byKey.get(k);
    if (!r || r.status !== "completed") missing.push(k);
    else runIds.push(r.id);
  }
  if (missing.length) {
    throw new Error(`validate_geometry: missing completed upstream skills: ${missing.join(", ")}`);
  }

  const { data: arts } = await ctx.svc
    .from("mskill_artifacts")
    .select("artifact_type, mskill_run_id, metadata")
    .in("mskill_run_id", runIds);

  const presentTypes = new Set((arts ?? []).map((a) => a.artifact_type));
  const requiredArtifactTypes = [
    "roof_planes", "ridge_segments", "hip_segments", "valley_segments",
    "eave_segments", "rake_segments", "pitch_results", "roof_area_results",
  ];
  const missingArt = requiredArtifactTypes.filter((t) => !presentTypes.has(t));
  if (missingArt.length) {
    throw new Error(
      `validate_geometry: upstream skills lack required artifacts (${missingArt.join(", ")}). ` +
      `Cannot complete from stub.`,
    );
  }

  const pitchArtifact = (arts ?? []).find((a) => a.artifact_type === "pitch_results");
  const pitchGate = assertPitchResultsArtifactGate(pitchArtifact?.metadata);
  if (!pitchGate.ok) {
    throw new Error(
      `validate_geometry: pitch self-consistency failed (${pitchGate.reason ?? "unknown"}). ` +
      `Runtime validation is vendor-free and requires self-consistent pitch evidence.`,
    );
  }

  return {
    output: {
      validation_status: "passed",
      confidence_source: "artifact_presence_plus_pitch_self_consistency",
      pitch_self_consistency_score: pitchGate.score,
      pitch_self_consistency_status: pitchGate.status,
    },
    geometry_status_patch: {
      has_planes: true,
      has_segments: true,
      has_pitch: true,
      has_area: true,
      pitch_self_consistency_score: pitchGate.score,
      pitch_self_consistency_status: pitchGate.status,
      validation_status: "passed",
      ready_for_bridge: true,
    },
  };
}
