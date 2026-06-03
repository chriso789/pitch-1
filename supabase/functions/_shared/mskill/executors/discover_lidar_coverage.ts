import type { ExecutorContext, ExecutorResult } from "../runner.ts";
import { writeSkillArtifact } from "../artifacts.ts";

export async function runDiscoverLidarCoverage(ctx: ExecutorContext): Promise<ExecutorResult> {
  const lat = Number(ctx.request.lat);
  const lon = Number(ctx.request.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("discover_lidar_coverage: request missing lat/lon");
  }
  const county = ctx.request.county as string | null;

  // Query provider catalog. We mark coverage candidates as discovered metadata only —
  // no fabricated polygon coverage.
  const { data: providers } = await ctx.svc
    .from("mskill_provider_sources")
    .select("provider_key, display_name, category, scope, metadata")
    .in("category", ["lidar", "elevation"])
    .eq("is_enabled", true);

  // Look for explicit coverage rows for this county
  const { data: coverage } = await ctx.svc
    .from("mskill_provider_coverage")
    .select("*")
    .or(`county.eq.${county ?? "__none__"},county.is.null`);

  const candidates = (providers ?? []).map((p) => ({
    provider_key: p.provider_key,
    display_name: p.display_name,
    scope: p.scope,
    has_county_coverage_record: (coverage ?? []).some((c) => c.provider_key === p.provider_key),
  }));

  const { data: lwin } = await ctx.svc.from("mskill_lidar_windows").insert({
    tenant_id: ctx.tenant_id,
    mskill_request_id: ctx.mskill_request_id,
    mskill_job_id: ctx.mskill_job_id,
    request_hash: ctx.request_hash,
    aoi_geojson: { type: "Point", coordinates: [lon, lat] },
    buffer_ft: 200,
    provider_key: candidates[0]?.provider_key ?? null,
    coverage_metadata: { candidates },
    has_coverage: candidates.length > 0,
  }).select("id").single();

  if (!lwin) throw new Error("discover_lidar_coverage: failed to persist lidar_window");

  await writeSkillArtifact(ctx.svc, ctx, {
    artifact_type: "lidar_window_metadata",
    source_url: `mskill://lidar_windows/${lwin.id}`,
    metadata: { candidate_count: candidates.length, candidates },
  });

  return {
    output: { lidar_window_id: lwin.id, candidates, has_coverage: candidates.length > 0 },
    geometry_status_patch: { has_lidar_coverage: candidates.length > 0 },
  };
}
