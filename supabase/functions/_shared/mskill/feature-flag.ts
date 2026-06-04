// Feature flag for the mskill measurement pipeline rewire.
// See docs/measurement-pipeline-reuse-map.md §6.
//
// Reads (in order of precedence):
//   1. Deno.env.get('USE_MSKILL_MEASUREMENT_PIPELINE')
//   2. default: false (legacy start-ai-measurement remains canonical)
//
// Routes MAY also accept `?legacy=1` to force the legacy code path regardless
// of the flag. That escape hatch is debug-only and stamps the resulting row
// with route_warning='legacy_noncanonical_measurement_path'.

export const MSKILL_PIPELINE_FLAG_KEY = "USE_MSKILL_MEASUREMENT_PIPELINE";

export function isMskillPipelineEnabled(): boolean {
  const raw = (Deno.env.get(MSKILL_PIPELINE_FLAG_KEY) ?? "").toLowerCase().trim();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

export function pipelineRouteDecision(req: Request): {
  use_mskill: boolean;
  legacy_forced: boolean;
  reason: string;
} {
  const url = new URL(req.url);
  const legacyForced = url.searchParams.get("legacy") === "1";
  if (legacyForced) {
    return { use_mskill: false, legacy_forced: true, reason: "query.legacy=1 escape hatch" };
  }
  const enabled = isMskillPipelineEnabled();
  return {
    use_mskill: enabled,
    legacy_forced: false,
    reason: enabled ? "USE_MSKILL_MEASUREMENT_PIPELINE=true" : "USE_MSKILL_MEASUREMENT_PIPELINE=false (default)",
  };
}
