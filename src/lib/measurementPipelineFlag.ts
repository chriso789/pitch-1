// Frontend feature flag for the mskill measurement pipeline rewire.
// See docs/measurement-pipeline-reuse-map.md §6.
//
// Source order (highest precedence first):
//   1. localStorage.getItem('USE_MSKILL_MEASUREMENT_PIPELINE')
//   2. (window as any).__MSKILL_PIPELINE__
//   3. import.meta.env.VITE_USE_MSKILL_MEASUREMENT_PIPELINE
//   4. default: false
//
// While false, useMeasurementJob MUST continue calling the legacy
// start-ai-measurement function. The rewire of useMeasurementJob is gated on
// the conflict tests in docs/measurement-pipeline-reuse-map.md §7 passing.

export const MSKILL_PIPELINE_FLAG_KEY = "USE_MSKILL_MEASUREMENT_PIPELINE";

function parseBool(v: unknown): boolean | null {
  if (v == null) return null;
  const s = String(v).toLowerCase().trim();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  return null;
}

export function isMskillPipelineEnabled(): boolean {
  try {
    if (typeof localStorage !== "undefined") {
      const v = parseBool(localStorage.getItem(MSKILL_PIPELINE_FLAG_KEY));
      if (v !== null) return v;
    }
  } catch { /* ignore (SSR / sandboxed) */ }

  if (typeof window !== "undefined") {
    const v = parseBool((window as unknown as Record<string, unknown>).__MSKILL_PIPELINE__);
    if (v !== null) return v;
  }

  const envVal = parseBool((import.meta as any)?.env?.VITE_USE_MSKILL_MEASUREMENT_PIPELINE);
  if (envVal !== null) return envVal;

  return false;
}

/** Dev helper — exposed for the admin UI toggle. */
export function setMskillPipelineEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MSKILL_PIPELINE_FLAG_KEY, enabled ? "true" : "false");
    }
  } catch { /* ignore */ }
}
