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

  // ─────────────────────────────────────────────────────────────────────
  // (3.5) Flat DSM diagnostic derivation. Must run BEFORE the summary in
  // step (4) and the nested projection in step (5) so those downstream
  // steps see the populated tokens — otherwise re-running this helper
  // would produce different output (non-idempotent).
  // ─────────────────────────────────────────────────────────────────────
  {
    const splitStatusForDeriv: Record<string, unknown> =
      ((geometry as any).dsm_split_status &&
          typeof (geometry as any).dsm_split_status === "object")
        ? ((geometry as any).dsm_split_status as Record<string, unknown>)
        : {};
    const transformPkgOnRegDeriv: Record<string, unknown> =
      (regNext.transform_package &&
          typeof regNext.transform_package === "object" &&
          !Array.isArray(regNext.transform_package))
        ? (regNext.transform_package as Record<string, unknown>)
        : {};
    const effectiveDsmSize =
      (regNext as any).dsm_size_px ??
        (transformPkgOnRegDeriv as any).dsm_size_px ??
        (splitStatusForDeriv as any).dsm_size_px ?? null;
    const dsmLoaded = (splitStatusForDeriv as any).dsm_loaded === true;
    const boundsMissing =
      (regNext as any).dsm_tile_bounds_lat_lng == null &&
      (transformPkgOnRegDeriv as any).dsm_tile_bounds_lat_lng == null;

    if (effectiveDsmSize && (regNext as any).dsm_size_px == null) {
      (regNext as any).dsm_size_px = effectiveDsmSize;
    }
    if (effectiveDsmSize && (regNext as any).dsm_size_source == null) {
      (regNext as any).dsm_size_source = "dsm_split_status.dsm_size_px";
    }
    if (dsmLoaded && boundsMissing) {
      if ((regNext as any).dsm_tile_bounds_failure_reason == null) {
        (regNext as any).dsm_tile_bounds_failure_reason =
          "dsm_tile_bounds_missing_from_google_solar_metadata";
      }
      if ((regNext as any).dsm_registration_failure_token == null) {
        (regNext as any).dsm_registration_failure_token =
          "dsm_tile_bounds_missing_from_google_solar_metadata";
      }
      if ((regNext as any).dsm_transform_policy_version == null) {
        (regNext as any).dsm_transform_policy_version =
          "dsm-registration-transform-v1";
      }
    }
  }

  // (4) Read-only human summary + version + timestamp for the UI and grep.
  regNext.dsm_diagnostic_propagation_summary = summarizeDsmDiagnosticReason(
    regNext,
  );
  regNext.dsm_diagnostic_propagation_version =
    DSM_DIAGNOSTIC_PROPAGATION_VERSION;
  regNext.dsm_diagnostic_propagation_at = new Date().toISOString();

  // (5) Project flat diagnostic fields into the nested `dsm` and
  // `stage_classifier` sub-objects the UI reads from. The runtime already
  // writes flat fields on registration root (see start-ai-measurement) — the
  // UI binds to registration.dsm.* and registration.stage_classifier.*, so
  // without this projection the row renders blank even when truth is
  // present. We never overwrite an existing nested value.
  const splitStatus = (geometry as any).dsm_split_status ?? {};
  const dsmSizePxFromSplit =
    (splitStatus && typeof splitStatus === "object" &&
        (splitStatus as any).dsm_size_px) || null;

  const existingDsm: Record<string, unknown> =
    (regNext.dsm && typeof regNext.dsm === "object" &&
        !Array.isArray(regNext.dsm))
      ? { ...(regNext.dsm as Record<string, unknown>) }
      : {};
  regNext.dsm = {
    dsm_size_px: existingDsm.dsm_size_px ?? (regNext as any).dsm_size_px ??
      dsmSizePxFromSplit ?? null,
    dsm_tile_bounds_source: existingDsm.dsm_tile_bounds_source ??
      regNext.dsm_tile_bounds_source ?? null,
    dsm_tile_bounds_failure_reason:
      existingDsm.dsm_tile_bounds_failure_reason ??
        regNext.dsm_tile_bounds_failure_reason ?? null,
    dsm_bounds_source: existingDsm.dsm_bounds_source ??
      regNext.dsm_bounds_source ?? null,
    dsm_bounds_derived: existingDsm.dsm_bounds_derived ??
      regNext.dsm_bounds_derived ?? null,
    dsm_bounds_warning: existingDsm.dsm_bounds_warning ??
      regNext.dsm_bounds_warning ?? null,
    dsm_bounds_confidence: existingDsm.dsm_bounds_confidence ??
      regNext.dsm_bounds_confidence ?? null,
    dsm_meters_per_pixel: existingDsm.dsm_meters_per_pixel ??
      regNext.dsm_meters_per_pixel ?? null,
    dsm_mpp_source: existingDsm.dsm_mpp_source ?? regNext.dsm_mpp_source ??
      null,
    geo_to_dsm_transform_source: existingDsm.geo_to_dsm_transform_source ??
      (regNext as any).geo_to_dsm_transform_source ?? null,
    dsm_to_raster_transform_source:
      existingDsm.dsm_to_raster_transform_source ??
        (regNext as any).dsm_to_raster_transform_source ?? null,
    confirmed_roof_center_dsm_px_source:
      existingDsm.confirmed_roof_center_dsm_px_source ??
        (regNext as any).confirmed_roof_center_dsm_px_source ?? null,
    dsm_transform_policy_version: existingDsm.dsm_transform_policy_version ??
      (regNext as any).dsm_transform_policy_version ?? null,
    dsm_hoist_failure_tokens: existingDsm.dsm_hoist_failure_tokens ??
      regNext.dsm_hoist_failure_tokens ?? null,
    dsm_hoist_called: existingDsm.dsm_hoist_called ??
      regNext.dsm_hoist_called ?? null,
    dsm_hoist_callsite: existingDsm.dsm_hoist_callsite ??
      regNext.dsm_hoist_callsite ?? null,
    dsm_hoist_version: existingDsm.dsm_hoist_version ??
      regNext.dsm_hoist_version ?? null,
    dsm_stage_attempted: existingDsm.dsm_stage_attempted ??
      regNext.dsm_stage_attempted ?? null,
    dsm_stage_pending: existingDsm.dsm_stage_pending ??
      regNext.dsm_stage_pending ?? null,
    dsm_registration_version: existingDsm.dsm_registration_version ??
      regNext.dsm_registration_version ?? null,
    dsm_registration_source: existingDsm.dsm_registration_source ??
      regNext.dsm_registration_source ?? null,
  };

  const existingStage: Record<string, unknown> =
    (regNext.stage_classifier &&
        typeof regNext.stage_classifier === "object" &&
        !Array.isArray(regNext.stage_classifier))
      ? { ...(regNext.stage_classifier as Record<string, unknown>) }
      : {};
  regNext.stage_classifier = {
    stage_hard_fail_reason: existingStage.stage_hard_fail_reason ??
      (regNext as any).stage_hard_fail_reason ??
      (geometry as any).hard_fail_reason ?? (next as any).hard_fail_reason ??
      null,
    stage_failure_stage: existingStage.stage_failure_stage ??
      (regNext as any).stage_failure_stage ??
      (geometry as any).failure_stage ?? null,
    stage_classifier_version: existingStage.stage_classifier_version ??
      (regNext as any).stage_classifier_version ?? null,
  };

  // ─────────────────────────────────────────────────────────────────────
  // (6) Flat DSM diagnostic mirroring across ALL active registration
  // surfaces. The UI / persisted row reads flat fields on:
  //   - geometry.registration               (+ .transform_package)
  //   - geometry.registration_gate          (+ .transform_package)
  //   - geometry.dsm_planar_graph_debug.registration (+ .transform_package)
  //   - geometry.dsm_split_status.georegistration_transform
  // Idempotent — never overwrites a non-null existing value.
  // ─────────────────────────────────────────────────────────────────────
  const splitStatusForFlat: Record<string, unknown> =
    ((geometry as any).dsm_split_status &&
        typeof (geometry as any).dsm_split_status === "object")
      ? ((geometry as any).dsm_split_status as Record<string, unknown>)
      : {};

  const transformPkgOnReg: Record<string, unknown> =
    (regNext.transform_package &&
        typeof regNext.transform_package === "object" &&
        !Array.isArray(regNext.transform_package))
      ? (regNext.transform_package as Record<string, unknown>)
      : {};

  const effectiveDsmSize =
    (regNext as any).dsm_size_px ??
      (transformPkgOnReg as any).dsm_size_px ??
      (splitStatusForFlat as any).dsm_size_px ?? null;

  const dsmLoaded = (splitStatusForFlat as any).dsm_loaded === true;

  const boundsMissing =
    (regNext as any).dsm_tile_bounds_lat_lng == null &&
    (transformPkgOnReg as any).dsm_tile_bounds_lat_lng == null;

  if (effectiveDsmSize && (regNext as any).dsm_size_source == null) {
    (regNext as any).dsm_size_source = "dsm_split_status.dsm_size_px";
  }
  if (dsmLoaded && boundsMissing) {
    if ((regNext as any).dsm_tile_bounds_failure_reason == null) {
      (regNext as any).dsm_tile_bounds_failure_reason =
        "dsm_tile_bounds_missing_from_google_solar_metadata";
    }
    if ((regNext as any).dsm_registration_failure_token == null) {
      (regNext as any).dsm_registration_failure_token =
        "dsm_tile_bounds_missing_from_google_solar_metadata";
    }
    if ((regNext as any).dsm_transform_policy_version == null) {
      (regNext as any).dsm_transform_policy_version =
        "dsm-registration-transform-v1";
    }
  }

  const FLAT_DSM_FIELDS = [
    "dsm_size_px",
    "dsm_size_source",
    "dsm_tile_bounds_lat_lng",
    "dsm_tile_bounds_failure_reason",
    "dsm_registration_failure_token",
    "dsm_transform_policy_version",
    "geo_to_dsm_transform_source",
    "dsm_to_raster_transform_source",
    "confirmed_roof_center_dsm_px_source",
  ] as const;

  const flatSource: Record<string, unknown> = {};
  for (const f of FLAT_DSM_FIELDS) {
    flatSource[f] = (regNext as any)[f] ?? null;
  }
  if (flatSource.dsm_size_px == null && effectiveDsmSize) {
    flatSource.dsm_size_px = effectiveDsmSize;
    if ((regNext as any).dsm_size_px == null) {
      (regNext as any).dsm_size_px = effectiveDsmSize;
    }
    if (flatSource.dsm_size_source == null) {
      flatSource.dsm_size_source = "dsm_split_status.dsm_size_px";
      if ((regNext as any).dsm_size_source == null) {
        (regNext as any).dsm_size_source = "dsm_split_status.dsm_size_px";
      }
    }
  }

  function mergeFlatDsmFields(
    target: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    const dst: Record<string, unknown> =
      (target && typeof target === "object" && !Array.isArray(target))
        ? { ...(target as Record<string, unknown>) }
        : {};
    for (const f of FLAT_DSM_FIELDS) {
      const src = (flatSource as any)[f];
      if (src == null) {
        if (!(f in dst)) dst[f] = null;
        continue;
      }
      if (dst[f] == null) dst[f] = src;
    }
    return dst;
  }

  regNext.transform_package = mergeFlatDsmFields(
    (regNext as any).transform_package as any,
  );

  const regGate: Record<string, unknown> =
    ((geometry as any).registration_gate &&
        typeof (geometry as any).registration_gate === "object" &&
        !Array.isArray((geometry as any).registration_gate))
      ? { ...((geometry as any).registration_gate as Record<string, unknown>) }
      : {};
  const regGateMerged = mergeFlatDsmFields(regGate);
  regGateMerged.transform_package = mergeFlatDsmFields(
    (regGate as any).transform_package as any,
  );

  const dsmDebugRaw: Record<string, unknown> =
    ((geometry as any).dsm_planar_graph_debug &&
        typeof (geometry as any).dsm_planar_graph_debug === "object" &&
        !Array.isArray((geometry as any).dsm_planar_graph_debug))
      ? {
        ...((geometry as any).dsm_planar_graph_debug as Record<
          string,
          unknown
        >),
      }
      : {};
  const dsmDebugReg: Record<string, unknown> =
    ((dsmDebugRaw as any).registration &&
        typeof (dsmDebugRaw as any).registration === "object" &&
        !Array.isArray((dsmDebugRaw as any).registration))
      ? { ...((dsmDebugRaw as any).registration as Record<string, unknown>) }
      : {};
  const dsmDebugRegMerged = mergeFlatDsmFields(dsmDebugReg);
  dsmDebugRegMerged.transform_package = mergeFlatDsmFields(
    (dsmDebugReg as any).transform_package as any,
  );
  dsmDebugRaw.registration = dsmDebugRegMerged;

  const splitStatusNext: Record<string, unknown> = { ...splitStatusForFlat };
  splitStatusNext.georegistration_transform = mergeFlatDsmFields(
    (splitStatusForFlat as any).georegistration_transform as any,
  );

  for (const f of FLAT_DSM_FIELDS) {
    const src = (flatSource as any)[f];
    if (src != null && (regNext as any)[f] == null) {
      (regNext as any)[f] = src;
    }
  }

  // (7) dsm_validation_status: keep generic `reason`, add sibling specific.
  const dvsExists = (geometry as any).dsm_validation_status &&
    typeof (geometry as any).dsm_validation_status === "object" &&
    !Array.isArray((geometry as any).dsm_validation_status);
  if (dvsExists || (dsmLoaded && boundsMissing)) {
    const dvs: Record<string, unknown> = dvsExists
      ? {
        ...((geometry as any).dsm_validation_status as Record<
          string,
          unknown
        >),
      }
      : {};
    if (
      boundsMissing &&
      (dvs as any).dsm_validation_status_specific_reason == null
    ) {
      (dvs as any).dsm_validation_status_specific_reason =
        "dsm_tile_bounds_missing_from_google_solar_metadata";
    }
    (geometry as any).dsm_validation_status = dvs;
  }

  (geometry as any).registration = regNext;
  (geometry as any).registration_gate = regGateMerged;
  (geometry as any).dsm_planar_graph_debug = dsmDebugRaw;
  (geometry as any).dsm_split_status = splitStatusNext;
  next.geometry_report_json = geometry;
  return next;
}
