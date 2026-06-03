import type { ExecutorContext, ExecutorResult } from "../runner.ts";
import { writeSkillArtifact } from "../artifacts.ts";

export async function runAcquireDemDtm(ctx: ExecutorContext): Promise<ExecutorResult> {
  const { data: assets } = await ctx.svc
    .from("mskill_elevation_assets")
    .select("id, asset_type, provider_key, source_url")
    .eq("mskill_job_id", ctx.mskill_job_id)
    .eq("request_hash", ctx.request_hash)
    .in("asset_type", ["DEM", "DTM"]);
  if (!assets?.length) {
    throw new Error("acquire_dem_dtm: no DEM/DTM assets discovered");
  }
  // We do NOT download tiles in the edge function (size + runtime constraints).
  // Persist the discovered source as the artifact reference; mark requires_internal_worker
  // for actual raster acquisition.
  for (const a of assets) {
    await writeSkillArtifact(ctx.svc, ctx, {
      artifact_type: a.asset_type === "DTM" ? "dtm_source_pointer" : "dem_source_pointer",
      source_url: a.source_url ?? `mskill://elevation_assets/${a.id}`,
      metadata: { provider_key: a.provider_key, asset_type: a.asset_type, note: "raster acquisition deferred to internal worker" },
    });
  }
  return {
    output: { dem_dtm_assets: assets.length, requires_internal_worker_for_raster: true },
    geometry_status_patch: {},
  };
}
