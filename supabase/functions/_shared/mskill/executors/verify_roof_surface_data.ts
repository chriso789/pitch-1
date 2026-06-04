import type { ExecutorContext, ExecutorResult } from "../runner.ts";
import { writeSkillArtifact } from "../artifacts.ts";
import { verifyRoofSurfaceDataAvailability } from "../verify-roof-surface-data.ts";

/**
 * Phase-1 executor — wraps verifyRoofSurfaceDataAvailability so the mskill
 * pipeline can gate downstream geometry skills on real roof-surface data.
 */
export async function runVerifyRoofSurfaceData(ctx: ExecutorContext): Promise<ExecutorResult> {
  const lat = Number(ctx.request.lat);
  const lon = Number(ctx.request.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("verify_roof_surface_data: request missing lat/lon");
  }
  const lidar_window_id = (ctx.request.lidar_window_id as string | undefined) ?? null;
  const county = (ctx.request.county as string | undefined) ?? null;
  const state = (ctx.request.state as string | undefined) ?? null;

  const availability = await verifyRoofSurfaceDataAvailability({
    svc: ctx.svc,
    tenant_id: ctx.tenant_id,
    lidar_window_id,
    lat,
    lon,
    county,
    state,
  });

  await writeSkillArtifact(ctx.svc, ctx, {
    artifact_type: "roof_surface_availability",
    source_url: availability.source_url,
    metadata: availability as unknown as Record<string, unknown>,
  });

  // Hard gate — if not possible, mark skill_run needs_review so the runner
  // refuses to dispatch DSM/DTM/CHM and downstream geometry skills.
  if (!availability.roof_geometry_possible) {
    return {
      output: availability as unknown as Record<string, unknown>,
      qa_flags: ["roof_geometry_not_possible", availability.blocking_reason ?? "unknown"],
      status: "needs_review",
      geometry_status_patch: {
        roof_geometry_possible: false,
        blocking_reason: availability.blocking_reason,
      },
    };
  }

  return {
    output: availability as unknown as Record<string, unknown>,
    geometry_status_patch: {
      roof_geometry_possible: true,
      roof_surface_source_type: availability.source_type,
      roof_surface_data_year: availability.data_year,
      roof_surface_resolution_m: availability.resolution_m,
    },
  };
}
