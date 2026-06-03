import type { ExecutorContext, ExecutorResult } from "../runner.ts";

export async function runResolveBuildingFootprint(_ctx: ExecutorContext): Promise<ExecutorResult> {
  throw new Error(
    "resolve_building_footprint: no county/national footprint provider wired. " +
    "OSM/MS Buildings integration not yet configured (refusing stub completion).",
  );
}
