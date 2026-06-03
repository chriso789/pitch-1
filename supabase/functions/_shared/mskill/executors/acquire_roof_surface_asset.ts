import type { ExecutorContext, ExecutorResult } from "../runner.ts";
import { writeSkillArtifact } from "../artifacts.ts";

export async function runAcquireRoofSurfaceAsset(ctx: ExecutorContext): Promise<ExecutorResult> {
  const { data: assets } = await ctx.svc
    .from("mskill_elevation_assets")
    .select("id, asset_type, provider_key, source_url")
    .eq("mskill_job_id", ctx.mskill_job_id)
    .eq("request_hash", ctx.request_hash)
    .in("asset_type", ["DSM", "point_cloud"]);
  if (!assets?.length) {
    throw new Error(
      "acquire_roof_surface_asset: no DSM or point cloud asset discovered for this AOI. " +
      "DEM-only providers cannot produce roof geometry.",
    );
  }
  // Rank: point_cloud > DSM
  const ranked = assets.sort((a, b) => (a.asset_type === "point_cloud" ? -1 : 1));
  const selected = ranked[0];
  const { data: rsa } = await ctx.svc.from("mskill_roof_surface_assets").insert({
    tenant_id: ctx.tenant_id,
    mskill_job_id: ctx.mskill_job_id,
    request_hash: ctx.request_hash,
    asset_type: selected.asset_type,
    provider_key: selected.provider_key,
    source_url: selected.source_url,
    requires_internal_worker: true,
    blocking_reason: "clipping + DSM generation require internal worker",
    status: "discovered",
    metadata: { selected_from_candidates: assets.length },
  }).select("id").single();

  await writeSkillArtifact(ctx.svc, ctx, {
    artifact_type: "roof_surface_asset_pointer",
    source_url: selected.source_url ?? `mskill://roof_surface_assets/${rsa?.id}`,
    metadata: { asset_type: selected.asset_type, provider_key: selected.provider_key },
  });

  return {
    output: { roof_surface_asset_id: rsa?.id, asset_type: selected.asset_type, requires_internal_worker: true },
    geometry_status_patch: {},
  };
}
