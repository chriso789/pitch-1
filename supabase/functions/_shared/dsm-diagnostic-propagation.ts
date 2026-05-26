// dsm-diagnostic-propagation.ts
//
// Read-side write-time guarantee: every persisted measurement payload that
// goes through ensureRegistrationProofBeforeWrite emerges with the new DSM
// diagnostic fields materialized on geometry_report_json.registration —
// even when DSM bounds are genuinely missing. Without this, the live row
// keeps the legacy "field-absent" shape and the UI renders blanks where
// the runtime has answers.
//
// This module does NOT derive DSM bounds, does NOT run heuristic
// registration, and does NOT change result_state / customer_report_ready.
// It only propagates diagnostics that already exist elsewhere in the
// payload. Fully idempotent — it never overwrites real values.

export const DSM_DIAGNOSTIC_PROPAGATION_VERSION =
  "dsm-diagnostic-propagation-v1";

export const DSM_DIAGNOSTIC_FIELDS = [
  "dsm_tile_bounds_source",
  "dsm_tile_bounds_failure_reason",
  "dsm_bounds_source",
  "dsm_bounds_derived",
  "dsm_bounds_warning",
  "dsm_bounds_confidence",
  "dsm_meters_per_pixel",
  "dsm_mpp_source",
  "dsm_size_source",
  "dsm_hoist_called",
  "dsm_hoist_callsite",
  "dsm_hoist_version",
  "dsm_hoist_failure_tokens",
  "dsm_stage_attempted",
  "dsm_stage_pending",
  "dsm_registration_version",
  "dsm_registration_source",
] as const;

function summarizeDsmDiagnosticReason(reg: Record<string, unknown>): string {
  if (reg.dsm_tile_bounds_lat_lng != null) return "bounds_present";
  if (reg.dsm_bounds_derived === true) {
    return "bounds_derived_lower_confidence";
  }
  if (reg.dsm_tile_bounds_failure_reason) {
    return String(reg.dsm_tile_bounds_failure_reason);
  }
  const tokens = Array.isArray(reg.dsm_hoist_failure_tokens)
    ? (reg.dsm_hoist_failure_tokens as string[])
    : [];
  if (tokens.includes("dsm_tile_bounds_missing_from_google_solar_metadata")) {
    return "google_solar_tile_bounds_missing";
  }
  if (tokens.includes("dsm_bounds_missing")) return "dsm_bounds_missing";
  if (reg.dsm_stage_attempted === false) return "dsm_stage_not_attempted";
  if (reg.dsm_stage_pending === true) return "dsm_stage_pending";
  return "unknown_bounds_unavailable";
}

export interface DsmDiagnosticPropagationOptions {
  /** Optional pre-hoist step provided by the caller (start-ai-measurement
   * wires in applyLiveRuntimeHoistToRegistration). Called only when
   * registration is incomplete. Errors are swallowed and logged. */
  hoist?: (
    registration: Record<string, unknown>,
    geometry: Record<string, unknown>,
  ) => Record<string, unknown> | undefined;
}

export function ensureDsmDiagnosticsOnRegistration(
  payload: Record<string, unknown>,
  options: DsmDiagnosticPropagationOptions = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload };
  const geometry = typeof next.geometry_report_json === "object" &&
      next.geometry_report_json !== null &&
      !Array.isArray(next.geometry_report_json)
    ? { ...(next.geometry_report_json as Record<string, unknown>) }
    : null;
  if (!geometry) return next;

  const reg: Record<string, unknown> =
    ((geometry as any).registration ??
      (geometry as any).registration_gate ??
      {}) as Record<string, unknown>;
  const regNext: Record<string, unknown> = { ...reg };

  // (1) Optional hoist — idempotent, short-circuits when fields are present.
  if (options.hoist) {
    try {
      const hoisted = options.hoist(regNext, geometry);
      if (hoisted && typeof hoisted === "object") {
        for (const [k, v] of Object.entries(hoisted)) {
          if (regNext[k] === undefined || regNext[k] === null) {
            regNext[k] = v;
          }
        }
      }
    } catch (err) {
      console.log(
        "[DSM_DIAGNOSTIC_PROPAGATION] hoist failed (non-fatal)",
        (err as any)?.message ?? err,
      );
    }
  }

  // (2) Always materialize the diagnostic field set so the row never looks
  // "field-absent". Null means "runtime tried and has no value" — NOT
  // "we forgot to compute it".
  for (const f of DSM_DIAGNOSTIC_FIELDS) {
    if (!(f in regNext)) regNext[f] = null;
  }

  // (3) Mirror dsm_split_status off geometry so the UI only reads from
  // registration. Do not overwrite an existing mirror.
  if (
    regNext.dsm_split_status == null &&
    (geometry as any).dsm_split_status != null
  ) {
    regNext.dsm_split_status = (geometry as any).dsm_split_status;
  }

  // (4) Read-only human summary + version + timestamp for the UI and grep.
  regNext.dsm_diagnostic_propagation_summary = summarizeDsmDiagnosticReason(
    regNext,
  );
  regNext.dsm_diagnostic_propagation_version =
    DSM_DIAGNOSTIC_PROPAGATION_VERSION;
  regNext.dsm_diagnostic_propagation_at = new Date().toISOString();

  (geometry as any).registration = regNext;
  (geometry as any).registration_gate = regNext;
  next.geometry_report_json = geometry;
  return next;
}
