import type { ExecutorContext, ExecutorResult } from "../runner.ts";
import { writeSkillArtifact } from "../artifacts.ts";

export async function runExportGeoJson(ctx: ExecutorContext): Promise<ExecutorResult> {
  // Require validate_geometry to have completed.
  const { data: vg } = await ctx.svc
    .from("mskill_runs")
    .select("status")
    .eq("mskill_job_id", ctx.mskill_job_id)
    .eq("skill_key", "validate_geometry")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!vg || vg.status !== "completed") {
    throw new Error("export_geojson: validate_geometry must be completed first");
  }

  // Build a stub-free FeatureCollection from persisted rows
  const [planesRes, segsRes, edgeRes] = await Promise.all([
    ctx.svc.from("mskill_plane_candidates").select("polygon_geojson, facet_index, pitch_rise_over_12, area_2d_sqft, area_slope_sqft").eq("mskill_job_id", ctx.mskill_job_id),
    ctx.svc.from("mskill_segments").select("segment_type, start_point, end_point, length_ft").eq("mskill_job_id", ctx.mskill_job_id),
    ctx.svc.from("mskill_roof_edge_candidates").select("geometry_geojson, offset_ft").eq("mskill_job_id", ctx.mskill_job_id).eq("is_selected", true).maybeSingle(),
  ]);

  if (!planesRes.data?.length || !segsRes.data?.length) {
    throw new Error("export_geojson: missing planes or segments — refusing stub export");
  }

  const features: any[] = [];
  if (edgeRes.data) {
    features.push({ type: "Feature", properties: { kind: "roof_edge", offset_ft: edgeRes.data.offset_ft }, geometry: edgeRes.data.geometry_geojson });
  }
  for (const p of planesRes.data) {
    features.push({ type: "Feature", properties: { kind: "facet", facet_index: p.facet_index, pitch_rise_over_12: p.pitch_rise_over_12, area_2d_sqft: p.area_2d_sqft, area_slope_sqft: p.area_slope_sqft }, geometry: p.polygon_geojson });
  }
  for (const s of segsRes.data) {
    features.push({
      type: "Feature",
      properties: { kind: s.segment_type, length_ft: s.length_ft },
      geometry: { type: "LineString", coordinates: [s.start_point, s.end_point] },
    });
  }
  const fc = { type: "FeatureCollection", features, properties: { request_hash: ctx.request_hash, mskill_job_id: ctx.mskill_job_id, source_pipeline: "mskill" } };

  // Persist as a report_artifact (inline JSON in metadata is fine for now)
  const { data: ra } = await ctx.svc.from("mskill_report_artifacts").insert({
    tenant_id: ctx.tenant_id,
    mskill_job_id: ctx.mskill_job_id,
    request_hash: ctx.request_hash,
    artifact_type: "geojson",
    source_url: `mskill://report/geojson/${ctx.mskill_job_id}`,
    metadata: { feature_count: features.length, inline_geojson: fc },
  }).select("id").single();

  await writeSkillArtifact(ctx.svc, ctx, {
    artifact_type: "export_geojson",
    source_url: `mskill://report_artifacts/${ra?.id}`,
    metadata: { feature_count: features.length },
  });

  return { output: { feature_count: features.length, report_artifact_id: ra?.id } };
}
