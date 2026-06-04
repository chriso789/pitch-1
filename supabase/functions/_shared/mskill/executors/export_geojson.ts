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
  const [planesRes, segsRes, edgeRes, allCandidatesRes, footprintRes] = await Promise.all([
    ctx.svc.from("mskill_plane_candidates").select("polygon_geojson, facet_index, pitch_rise_over_12, area_2d_sqft, area_slope_sqft").eq("mskill_job_id", ctx.mskill_job_id),
    ctx.svc.from("mskill_segments").select("segment_type, start_point, end_point, length_ft").eq("mskill_job_id", ctx.mskill_job_id),
    ctx.svc.from("mskill_roof_edge_candidates")
      .select("id, geometry_geojson, roof_perimeter_geojson, offset_ft, effective_offset_ft, eave_offset_ft, rake_offset_ft, source_type, area_sqft, perimeter_ft, confidence, status, validation_source")
      .eq("mskill_job_id", ctx.mskill_job_id).eq("is_selected", true).maybeSingle(),
    ctx.svc.from("mskill_roof_edge_candidates")
      .select("id, geometry_geojson, roof_perimeter_geojson, offset_ft, effective_offset_ft, eave_offset_ft, rake_offset_ft, source_type, area_sqft, perimeter_ft, confidence, status, validation_source, is_selected")
      .eq("mskill_job_id", ctx.mskill_job_id),
    ctx.svc.from("mskill_building_footprints")
      .select("id, geometry_geojson, area_sqft, source_provider")
      .eq("mskill_request_id", ctx.mskill_request_id).eq("request_hash", ctx.request_hash)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (!planesRes.data?.length || !segsRes.data?.length) {
    throw new Error("export_geojson: missing planes or segments — refusing stub export");
  }

  const features: any[] = [];

  // Building footprint (wall-line anchor) — never overwritten.
  if (footprintRes.data) {
    features.push({
      type: "Feature",
      properties: {
        kind: "building_footprint",
        layer: "wall_line",
        source_provider: footprintRes.data.source_provider,
        area_sqft: footprintRes.data.area_sqft,
        note: "Wall-line / county GIS footprint. Not the roof edge.",
      },
      geometry: footprintRes.data.geometry_geojson,
    });
  }

  // All roof perimeter candidates (gray dashed in the UI; selected in orange).
  for (const c of (allCandidatesRes.data ?? [])) {
    features.push({
      type: "Feature",
      properties: {
        kind: "roof_perimeter_candidate",
        candidate_id: c.id,
        source_type: c.source_type,
        offset_ft: c.offset_ft,
        effective_offset_ft: c.effective_offset_ft,
        eave_offset_ft: c.eave_offset_ft,
        rake_offset_ft: c.rake_offset_ft,
        area_sqft: c.area_sqft,
        perimeter_ft: c.perimeter_ft,
        confidence: c.confidence,
        status: c.status,
        validation_source: c.validation_source,
        is_selected: c.is_selected,
      },
      geometry: c.roof_perimeter_geojson ?? c.geometry_geojson,
    });
  }

  // Back-compat: legacy `roof_edge` feature pointing at the selected candidate.
  if (edgeRes.data) {
    features.push({
      type: "Feature",
      properties: {
        kind: "roof_edge",
        layer: "selected_roof_perimeter_candidate",
        offset_ft: edgeRes.data.offset_ft,
        effective_offset_ft: edgeRes.data.effective_offset_ft,
        source_type: edgeRes.data.source_type,
        warning: "Roof perimeter candidate only. Final eave/rake classification requires roof plane validation.",
      },
      geometry: edgeRes.data.roof_perimeter_geojson ?? edgeRes.data.geometry_geojson,
    });
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
