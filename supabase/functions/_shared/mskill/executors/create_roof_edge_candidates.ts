import type { ExecutorContext, ExecutorResult } from "../runner.ts";
import { writeSkillArtifact } from "../artifacts.ts";
import {
  DEFAULT_SELECTED_OFFSET_FT,
  OFFSET_PRESETS,
  UNIFORM_OFFSETS_FT,
  presetFor,
  type RoofTypeKey,
} from "../roof-perimeter-offset-defaults.ts";
import { bufferFootprintFeet, measureFootprintFeet } from "../perimeter-offset-geom.ts";

/**
 * Generate roof_perimeter_candidates from the verified building footprint.
 *
 * Terminology contract (see docs/measurement-conflict-lock.md):
 *   building_footprint        = wall-line / county GIS footprint (anchor)
 *   roof_perimeter_candidate  = estimated roof edge (eave/rake offset)
 *   final_roof_perimeter      = only after DSM / point-cloud refinement
 *
 * This executor:
 *  - Never overwrites the building footprint.
 *  - Produces 5 uniform-offset candidates (1.0 / 1.5 / 2.0 / 2.5 / 3.0 ft).
 *  - Produces 1 adaptive-offset candidate from the chosen roof-type preset.
 *  - Records real area_sqft + perimeter_ft + deltas vs. the wall-line.
 *  - Marks status='proposed' / validation_source='footprint_only'.
 *  - Selects the 2.0 ft uniform candidate by default (per spec).
 */
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
  if (!fpGeom || (fpGeom.type !== "Polygon" && fpGeom.type !== "MultiPolygon")) {
    throw new Error("create_roof_edge_candidates: footprint geometry is not a (Multi)Polygon");
  }

  // Baseline metrics for the wall-line footprint itself.
  const base = measureFootprintFeet(fpGeom);

  // Adaptive preset (defaults to "unknown" per spec).
  const roofTypeKey: RoofTypeKey =
    ((ctx as unknown as { input?: { roof_type?: string } }).input?.roof_type as RoofTypeKey | undefined)
    ?? "unknown";
  const preset = presetFor(roofTypeKey);

  const candidates: { id: string; offset_ft: number; source_type: string }[] = [];
  let selectedId: string | null = null;

  // 1) Uniform-offset candidates.
  for (const offset of UNIFORM_OFFSETS_FT) {
    const buf = bufferFootprintFeet(fpGeom, offset);
    const deltaArea = +(buf.area_sqft - base.area_sqft).toFixed(2);
    const deltaPerim = +(buf.perimeter_ft - base.perimeter_ft).toFixed(2);
    const isDefault = offset === DEFAULT_SELECTED_OFFSET_FT;
    const { data: cand, error: insErr } = await ctx.svc
      .from("mskill_roof_edge_candidates")
      .insert({
        tenant_id: ctx.tenant_id,
        mskill_request_id: ctx.mskill_request_id,
        mskill_job_id: ctx.mskill_job_id,
        building_footprint_id: footprint.id,
        request_hash: ctx.request_hash,
        source_type: "uniform_offset",
        offset_ft: offset,
        uniform_offset_ft: offset,
        effective_offset_ft: offset,
        geometry_geojson: buf.geometry_geojson,
        base_building_footprint_geojson: fpGeom,
        roof_perimeter_geojson: buf.geometry_geojson,
        area_sqft: buf.area_sqft,
        perimeter_ft: buf.perimeter_ft,
        area_delta_sqft: deltaArea,
        delta_perimeter_ft: deltaPerim,
        confidence: isDefault ? 0.7 : 0.5,
        is_selected: isDefault,
        status: "proposed",
        validation_source: "footprint_only",
        porch_extension_detected: false,
        lanai_extension_detected: false,
        attached_patios_detected: false,
        metadata: {
          generator: "create_roof_edge_candidates@uniform",
          base_area_sqft: base.area_sqft,
          base_perimeter_ft: base.perimeter_ft,
          note: "Uniform-offset estimate; final eave/rake classification requires roof plane validation.",
        },
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`uniform_offset insert failed: ${insErr.message}`);
    if (cand) {
      candidates.push({ id: cand.id, offset_ft: offset, source_type: "uniform_offset" });
      if (isDefault) selectedId = cand.id;
    }
  }

  // 2) Adaptive-offset candidate (mixes eave and rake offsets).
  // We don't know which edges are eaves vs rakes yet, so the geometry uses
  // the average of the two as an effective offset and we record both values
  // for downstream classification.
  const adaptiveEffective = +((preset.eave_offset_ft + preset.rake_offset_ft) / 2).toFixed(3);
  const adaptiveBuf = bufferFootprintFeet(fpGeom, adaptiveEffective);
  const adaptiveDeltaArea = +(adaptiveBuf.area_sqft - base.area_sqft).toFixed(2);
  const adaptiveDeltaPerim = +(adaptiveBuf.perimeter_ft - base.perimeter_ft).toFixed(2);
  const { data: adaptive, error: adaptiveErr } = await ctx.svc
    .from("mskill_roof_edge_candidates")
    .insert({
      tenant_id: ctx.tenant_id,
      mskill_request_id: ctx.mskill_request_id,
      mskill_job_id: ctx.mskill_job_id,
      building_footprint_id: footprint.id,
      request_hash: ctx.request_hash,
      source_type: "adaptive_offset",
      offset_ft: adaptiveEffective,
      eave_offset_ft: preset.eave_offset_ft,
      rake_offset_ft: preset.rake_offset_ft,
      effective_offset_ft: adaptiveEffective,
      geometry_geojson: adaptiveBuf.geometry_geojson,
      base_building_footprint_geojson: fpGeom,
      roof_perimeter_geojson: adaptiveBuf.geometry_geojson,
      area_sqft: adaptiveBuf.area_sqft,
      perimeter_ft: adaptiveBuf.perimeter_ft,
      area_delta_sqft: adaptiveDeltaArea,
      delta_perimeter_ft: adaptiveDeltaPerim,
      confidence: 0.65,
      is_selected: false,
      status: "proposed",
      validation_source: "footprint_only",
      porch_extension_detected: false,
      lanai_extension_detected: false,
      attached_patios_detected: false,
      metadata: {
        generator: "create_roof_edge_candidates@adaptive",
        preset_key: preset.key,
        preset_label: preset.label,
        base_area_sqft: base.area_sqft,
        base_perimeter_ft: base.perimeter_ft,
        note: "Adaptive eave/rake estimate (uniform average); per-edge classification deferred.",
      },
    })
    .select("id")
    .single();
  if (adaptiveErr) throw new Error(`adaptive_offset insert failed: ${adaptiveErr.message}`);
  if (adaptive) candidates.push({ id: adaptive.id, offset_ft: adaptiveEffective, source_type: "adaptive_offset" });

  await writeSkillArtifact(ctx.svc, ctx, {
    artifact_type: "roof_perimeter_candidates_set",
    source_url: `mskill://roof_perimeter_candidates?job=${ctx.mskill_job_id}`,
    metadata: {
      count: candidates.length,
      uniform_offsets_ft: UNIFORM_OFFSETS_FT,
      selected_offset_ft: DEFAULT_SELECTED_OFFSET_FT,
      adaptive_preset: preset.key,
      adaptive_offsets_ft: { eave: preset.eave_offset_ft, rake: preset.rake_offset_ft },
      base_area_sqft: base.area_sqft,
      base_perimeter_ft: base.perimeter_ft,
      validation_source: "footprint_only",
      note: "Roof perimeter candidates only. Final eave/rake classification requires roof plane validation.",
    },
  });

  return {
    output: {
      candidate_ids: candidates.map((c) => c.id),
      selected_id: selectedId,
      uniform_offsets_ft: UNIFORM_OFFSETS_FT,
      adaptive_preset: preset.key,
      adaptive_offsets_ft: { eave: preset.eave_offset_ft, rake: preset.rake_offset_ft },
      base_area_sqft: base.area_sqft,
      base_perimeter_ft: base.perimeter_ft,
    },
    geometry_status_patch: { has_roof_edge: true },
  };
}

// Re-export the preset table so the orchestrator HTTP layer can serve it
// to the UI without importing the file path directly.
export { OFFSET_PRESETS };
