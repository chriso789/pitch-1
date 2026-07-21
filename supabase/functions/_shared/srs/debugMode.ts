// SRS debug-mode gate (Task 2 & 8 of production hardening).
//
// Anything experimental — payload mutation, submit variances, automatic
// multi-submit / auto-sweep — MUST be gated behind this helper. Production
// orders must never generate multiple purchase orders.
//
// Debug mode is ON iff EITHER:
//   - env `SRS_DEBUG_MODE === "true"`, OR
//   - `tenant_settings.srs_debug_mode === true` for the tenant, OR
//   - `tenant_settings.srs_environment === 'debug'` for the tenant.
//
// Callers pass in a Supabase client (service role is fine — we always filter
// by tenant_id and never trust the tenant_id from the request body).

// deno-lint-ignore no-explicit-any
type Supa = any;

export async function isSrsDebugModeEnabled(
  supabase: Supa,
  tenantId: string | null | undefined,
): Promise<boolean> {
  if (
    (typeof Deno !== "undefined" &&
      // deno-lint-ignore no-explicit-any
      (Deno as any).env?.get?.("SRS_DEBUG_MODE") === "true")
  ) {
    return true;
  }
  if (!tenantId) return false;

  try {
    const { data, error } = await supabase
      .from("tenant_settings")
      .select("srs_debug_mode, srs_environment")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !data) return false;
    return Boolean(data.srs_debug_mode) || data.srs_environment === "debug";
  } catch {
    return false;
  }
}

export async function getSrsEnvironment(
  supabase: Supa,
  tenantId: string | null | undefined,
): Promise<"production" | "qa" | "debug"> {
  if (!tenantId) return "production";
  try {
    const { data } = await supabase
      .from("tenant_settings")
      .select("srs_environment")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const env = data?.srs_environment;
    if (env === "qa" || env === "debug") return env;
    return "production";
  } catch {
    return "production";
  }
}
