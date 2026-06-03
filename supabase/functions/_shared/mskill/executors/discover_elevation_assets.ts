import type { ExecutorContext, ExecutorResult } from "../runner.ts";
import { writeSkillArtifact } from "../artifacts.ts";

export async function runDiscoverElevationAssets(ctx: ExecutorContext): Promise<ExecutorResult> {
  const { data: lwin } = await ctx.svc
    .from("mskill_lidar_windows")
    .select("id, provider_key, coverage_metadata")
    .eq("mskill_job_id", ctx.mskill_job_id)
    .eq("request_hash", ctx.request_hash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lwin) throw new Error("discover_elevation_assets: no lidar_window found");

  // Classify advertised asset types from provider metadata only. No fabricated source URLs.
  const { data: providers } = await ctx.svc
    .from("mskill_provider_sources")
    .select("provider_key, metadata, category")
    .in("category", ["lidar", "elevation"])
    .eq("is_enabled", true);

  const classified: Array<{ provider_key: string; asset_type: string; supports_roof_geometry: boolean }> = [];
  for (const p of providers ?? []) {
    const types: string[] = Array.isArray((p.metadata as any)?.asset_types) ? (p.metadata as any).asset_types : [];
    for (const t of types) {
      const supports = t === "point_cloud" || t === "DSM";
      classified.push({ provider_key: p.provider_key, asset_type: t, supports_roof_geometry: supports });
      await ctx.svc.from("mskill_elevation_assets").insert({
        tenant_id: ctx.tenant_id,
        mskill_job_id: ctx.mskill_job_id,
        mskill_lidar_window_id: lwin.id,
        request_hash: ctx.request_hash,
        asset_type: t,
        provider_key: p.provider_key,
        supports_roof_geometry: supports,
        metadata: { source: "provider_catalog_advertised" },
      });
    }
  }

  await writeSkillArtifact(ctx.svc, ctx, {
    artifact_type: "elevation_asset_catalog",
    source_url: `mskill://elevation_assets?job=${ctx.mskill_job_id}`,
    metadata: { classified, count: classified.length },
  });

  return {
    output: { classified, count: classified.length },
    geometry_status_patch: {},
  };
}
