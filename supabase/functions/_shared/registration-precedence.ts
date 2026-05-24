// ============================================================================
// Registration Precedence v1 — pure helpers.
// ----------------------------------------------------------------------------
// These helpers are the write-time enforcement layer that ensures a
// registration failure (target not confirmed / coordinate frame invalid /
// candidate doesn't contain confirmed center) DOMINATES any downstream
// perimeter/topology classification. Without this enforcement the pipeline
// can silently persist `ai_failed_perimeter` + `phase3_5.executed=true` over
// a row that should have been a hard `ai_failed_target_unconfirmed`.
//
// Imported by:
//   - supabase/functions/start-ai-measurement/index.ts (withPhase3Visibility
//     and prepareRoofMeasurementPayload)
//   - supabase/functions/start-ai-measurement/__tests__/* regression tests
// ============================================================================

export const REGISTRATION_PRECEDENCE_VERSION = "registration-precedence-v1";
export const REGISTRATION_BLOCKED_SKIPPED_REASON = "blocked_by_registration_gate";

export type RegistrationPrecedenceReason =
  | "target_roof_not_confirmed"
  | "coordinate_registration_failed"
  | "candidate_does_not_contain_confirmed_roof_center";

/**
 * Inspect a persisted registration block and return the failure reason
 * (or null if the gate passed / cannot be evaluated).
 *
 * MUST match the routing in `_shared/registration-gate.ts::evaluateRegistrationGate`.
 */
export function deriveRegistrationFailureReason(reg: any): RegistrationPrecedenceReason | null {
  if (!reg || typeof reg !== "object") return null;
  if (reg.user_confirmed_roof_target === false && reg.roof_target_admin_override !== true) {
    return "target_roof_not_confirmed";
  }
  if (reg.geo_to_dsm_px_success === false || reg.dsm_pixel_transform_valid === false) {
    return "coordinate_registration_failed";
  }
  if (reg.confirmed_center_inside_candidate === false) {
    return "candidate_does_not_contain_confirmed_roof_center";
  }
  return null;
}

/**
 * Stamp a phase block with the `blocked_by_registration_gate` skip marker.
 * Always returns a fresh object; never mutates the input.
 */
export function stampPhaseBlockBlockedByRegistration<T extends Record<string, any>>(blk: T): T {
  return {
    ...blk,
    executed: false,
    skipped_reason: REGISTRATION_BLOCKED_SKIPPED_REASON,
    skipped_by: REGISTRATION_PRECEDENCE_VERSION,
  };
}

export function buildRegistrationBlockedPhaseBlock(existing: any = {}): Record<string, any> {
  const base = existing && typeof existing === "object" ? existing : {};
  return stampPhaseBlockBlockedByRegistration({ version: "v1", ...base });
}

export function forceRegistrationBlockedPhaseBlocks<T extends Record<string, any>>(geometry: T): T {
  for (const key of ["phase3_5", "phase3A_5", "phase3C", "phase3D", "phase3E"] as const) {
    geometry[key as keyof T] = buildRegistrationBlockedPhaseBlock((geometry as any)[key]) as any;
  }
  return geometry;
}

export function stripRegistrationBlockedGeometryArtifacts<T extends Record<string, any>>(geometry: T): T {
  delete (geometry as any).perimeter_phase0;
  delete (geometry as any).perimeter_gate_metrics;
  delete (geometry as any).perimeter_inner_trace;
  delete (geometry as any).selected_perimeter_after_refinement;
  delete (geometry as any).debug_perimeter_overlay_svg;
  return geometry;
}

/**
 * Map a registration failure reason to the result_state bucket the row
 * MUST be normalized to. Mirrors `evaluateRegistrationGate`.
 */
export function resultStateForRegistrationFailure(
  reason: RegistrationPrecedenceReason,
): "ai_failed_target_unconfirmed" | "ai_failed_source_acquisition" {
  if (reason === "target_roof_not_confirmed") return "ai_failed_target_unconfirmed";
  return "ai_failed_source_acquisition";
}

/**
 * Compose a registration-precedence stamp block to merge into the persisted
 * `geometry_report_json`. Always written — `applied=false` is itself a
 * provable answer to "did the pipeline check the gate on this row?".
 */
export function buildRegistrationPrecedenceStamp(
  reg: any,
): {
  registration_precedence_version: typeof REGISTRATION_PRECEDENCE_VERSION;
  registration_precedence_applied: boolean;
  registration_precedence_reason: RegistrationPrecedenceReason | null;
  registration_gate_version: string | null;
} {
  const reason = deriveRegistrationFailureReason(reg);
  return {
    registration_precedence_version: REGISTRATION_PRECEDENCE_VERSION,
    registration_precedence_applied: !!reason,
    registration_precedence_reason: reason,
    registration_gate_version: reg?.version ?? null,
  };
}
