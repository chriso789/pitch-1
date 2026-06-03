import type { ExecutorContext, ExecutorResult } from "../runner.ts";
import { writeSkillArtifact } from "../artifacts.ts";

export async function runExportReport(ctx: ExecutorContext): Promise<ExecutorResult> {
  // Verify validate_geometry + export_geojson both completed
  const { data: prereq } = await ctx.svc
    .from("mskill_runs")
    .select("skill_key, status")
    .eq("mskill_job_id", ctx.mskill_job_id)
    .in("skill_key", ["validate_geometry", "export_geojson"]);
  const ok = new Set((prereq ?? []).filter((r) => r.status === "completed").map((r) => r.skill_key));
  if (!ok.has("validate_geometry") || !ok.has("export_geojson")) {
    throw new Error("export_report: validate_geometry + export_geojson must both be completed");
  }

  const [areaRes, planesRes, segsRes] = await Promise.all([
    ctx.svc.from("mskill_plane_candidates").select("area_2d_sqft, area_slope_sqft, pitch_rise_over_12").eq("mskill_job_id", ctx.mskill_job_id),
    ctx.svc.from("mskill_plane_candidates").select("facet_index").eq("mskill_job_id", ctx.mskill_job_id),
    ctx.svc.from("mskill_segments").select("segment_type, length_ft").eq("mskill_job_id", ctx.mskill_job_id),
  ]);

  const totalSlopeArea = (areaRes.data ?? []).reduce((s, p) => s + Number(p.area_slope_sqft ?? 0), 0);
  const totalPlanArea = (areaRes.data ?? []).reduce((s, p) => s + Number(p.area_2d_sqft ?? 0), 0);
  const facets = planesRes.data?.length ?? 0;
  const lf = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 } as Record<string, number>;
  for (const s of segsRes.data ?? []) lf[s.segment_type] = (lf[s.segment_type] ?? 0) + Number(s.length_ft ?? 0);

  const pitches = (areaRes.data ?? []).map((p) => Number(p.pitch_rise_over_12)).filter((n) => Number.isFinite(n));
  const dominantPitch = pitches.length ? Math.round(pitches.reduce((a, b) => a + b, 0) / pitches.length) : null;

  const reportJson = {
    request_hash: ctx.request_hash,
    mskill_job_id: ctx.mskill_job_id,
    totals: {
      "roof.plan_sqft": Math.round(totalPlanArea),
      "roof.total_sqft": Math.round(totalSlopeArea),
      "pitch.predominant": dominantPitch,
      "lf.ridge": Math.round(lf.ridge),
      "lf.hip": Math.round(lf.hip),
      "lf.valley": Math.round(lf.valley),
      "lf.eave": Math.round(lf.eave),
      "lf.rake": Math.round(lf.rake),
    },
    facets,
    source_pipeline: "mskill",
    generated_at: new Date().toISOString(),
  };

  const { data: ra } = await ctx.svc.from("mskill_report_artifacts").insert({
    tenant_id: ctx.tenant_id,
    mskill_job_id: ctx.mskill_job_id,
    request_hash: ctx.request_hash,
    artifact_type: "report_json",
    source_url: `mskill://report/json/${ctx.mskill_job_id}`,
    metadata: { report_json: reportJson },
  }).select("id").single();

  await writeSkillArtifact(ctx.svc, ctx, {
    artifact_type: "export_report",
    source_url: `mskill://report_artifacts/${ra?.id}`,
    metadata: { totals: reportJson.totals, facets, pdf_pending: "pdf generation deferred — JSON report ready" },
  });

  return { output: { report_artifact_id: ra?.id, totals: reportJson.totals } };
}
