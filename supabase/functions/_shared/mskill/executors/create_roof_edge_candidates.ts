import type { ExecutorContext, ExecutorResult } from "../runner.ts";
import { writeSkillArtifact } from "../artifacts.ts";

const OFFSETS_FT = [1.0, 1.5, 2.0, 2.5, 3.0];

export async function runCreateRoofEdgeCandidates(ctx: ExecutorContext): Promise<ExecutorResult> {
  const { data: footprint, error } = await ctx.svc
    .from("mskill_building_footprints")
    .select("*")
    .eq("mskill_request_id", ctx.mskill_request_id)
    .eq("request_hash", ctx.request_hash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !footprint) {
    throw new Error("create_roof_edge_candidates: no building footprint found for this request");
  }
  const fpGeom = footprint.geometry_geojson;
  const fpArea = Number(footprint.area_sqft ?? 0);

  const candidates: string[] = [];
  let selectedId: string | null = null;
  for (const offset of OFFSETS_FT) {
    // We do not synthesize a buffered polygon here (requires turf/geom lib).
    // Persist offset spec so worker can rasterize later — geometry is the footprint
    // tagged with offset_ft for downstream buffer step.
    const { data: cand } = await ctx.svc.from("mskill_roof_edge_candidates").insert({
      tenant_id: ctx.tenant_id,
      mskill_request_id: ctx.mskill_request_id,
      mskill_job_id: ctx.mskill_job_id,
      building_footprint_id: footprint.id,
      request_hash: ctx.request_hash,
      source_type: "auto_buffer_candidate",
      offset_ft: offset,
      geometry_geojson: fpGeom,
      area_sqft: fpArea,
      perimeter_ft: null,
      area_delta_sqft: null,
      confidence: offset === 2.0 ? 0.7 : 0.5,
      is_selected: offset === 2.0,
      status: "proposed",
      metadata: { note: "geometry equals footprint; offset applied at rasterization step" },
    }).select("id").single();
    if (cand) {
      candidates.push(cand.id);
      if (offset === 2.0) selectedId = cand.id;
    }
  }
  await writeSkillArtifact(ctx.svc, ctx, {
    artifact_type: "roof_edge_candidates_set",
    source_url: `mskill://roof_edge_candidates?job=${ctx.mskill_job_id}`,
    metadata: { count: candidates.length, selected_offset_ft: 2.0 },
  });
  return {
    output: { candidate_ids: candidates, selected_id: selectedId, offsets_ft: OFFSETS_FT },
    geometry_status_patch: { has_roof_edge: true },
  };
}
