// ============================================================================
// Registration Precedence v2 — pure helpers (paired with registration-gate-v2.2)
// ----------------------------------------------------------------------------
// These helpers are the write-time enforcement layer that ensures a
// registration failure DOMINATES any downstream perimeter/topology
// classification. Without this enforcement the pipeline can silently persist
// `ai_failed_perimeter` + `phase3_5.executed=true` over a row that should
// have been a hard `ai_failed_target_unconfirmed` / `ai_failed_source_acquisition`.
//
// v2 adds `registration_field_conflict` detection — a hard fail when the
// authoritative `geometry_report_json.registration` block contradicts itself
// (claims pass while transforms are null) or contradicts the top-level
// mirrored booleans on `geometry_report_json`.
// ============================================================================

export const REGISTRATION_PRECEDENCE_VERSION = "registration-precedence-v3";
export const REGISTRATION_BLOCKED_SKIPPED_REASON = "blocked_by_registration_gate";

export type RegistrationPrecedenceReason =
  | "target_roof_not_confirmed"
  | "coordinate_registration_failed"
  | "dsm_size_missing"
  | "dsm_bounds_missing"
  | "geo_to_dsm_transform_missing"
  | "dsm_to_raster_transform_missing"
  | "selected_candidate_polygon_missing"
  | "candidate_does_not_contain_confirmed_center"
  | "candidate_centroid_offset_exceeds_target"
  | "no_perimeter_candidate_contains_confirmed_center"
  | "coordinate_space_mismatch"
  | "registration_field_conflict";

function specificReasonFromRegistration(reg: any): RegistrationPrecedenceReason | null {
  const hard = String(reg?.stage_hard_fail_reason ?? reg?.hard_fail_reason ?? reg?.block_customer_report_reason ?? "");
  if ([
    "dsm_size_missing",
    "dsm_bounds_missing",
    "geo_to_dsm_transform_missing",
    "dsm_to_raster_transform_missing",
    "selected_candidate_polygon_missing",
    "candidate_does_not_contain_confirmed_center",
    "candidate_centroid_offset_exceeds_target",
    "no_perimeter_candidate_contains_confirmed_center",
    "coordinate_space_mismatch",
  ].includes(hard)) {
    return hard as RegistrationPrecedenceReason;
  }
  const missing = Array.isArray(reg?.missing_required_fields) ? reg.missing_required_fields : [];
  if (missing.includes("dsm_size_px")) return "dsm_size_missing";
  if (missing.includes("dsm_tile_bounds_lat_lng")) return "dsm_bounds_missing";
  if (missing.includes("geo_to_dsm_transform") || missing.includes("geo_to_dsm_px_success")) {
    return "geo_to_dsm_transform_missing";
  }
  if (missing.includes("dsm_to_raster_transform") || missing.includes("dsm_pixel_transform_valid")) {
    return "dsm_to_raster_transform_missing";
  }
  if (missing.includes("selected_candidate_polygon_px")) return "selected_candidate_polygon_missing";
  return null;
}

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
  const specific = specificReasonFromRegistration(reg);
  if (specific) return specific;
  // Strict-mode missing transform evidence collapses to coordinate_registration_failed.
  if (Array.isArray(reg.missing_required_fields) && reg.missing_required_fields.length > 0) {
    return "coordinate_registration_failed";
  }
  if (reg.geo_to_dsm_px_success === false || reg.dsm_pixel_transform_valid === false) {
    return "coordinate_registration_failed";
  }
  if (reg.coordinate_registration_gate_passed === false) {
    return "coordinate_registration_failed";
  }
  if (reg.centroid_offset_exceeds_threshold === true) {
    return "candidate_centroid_offset_exceeds_target";
  }
  if (reg.confirmed_center_inside_candidate === false) {
    return "candidate_does_not_contain_confirmed_center";
  }
  return null;
}

/**
 * Compare the authoritative `geometry.registration` block against the
 * geometry top-level mirrored booleans and against its own internal claims.
 * Returns an array of conflict descriptors; empty array = no conflict.
 *
 * Detects:
 *   - block vs top-level disagreement on `geo_to_dsm_px_success`
 *   - block vs top-level disagreement on `dsm_pixel_transform_valid`
 *   - `coordinate_registration_gate_passed=true` with null confirmed_roof_center_px
 *   - `coordinate_registration_gate_passed=true` with null geo_to_dsm_transform
 *   - `coordinate_registration_gate_passed=true` with null geo_to_raster_transform
 *   - `coordinate_registration_gate_passed=true` with non-empty missing_required_fields
 */
export interface RegistrationFieldConflict {
  field: string;
  block_value: unknown;
  top_level_value?: unknown;
  detail: string;
}

export function detectRegistrationFieldConflicts(geometry: any): RegistrationFieldConflict[] {
  const conflicts: RegistrationFieldConflict[] = [];
  if (!geometry || typeof geometry !== "object") return conflicts;
  const reg = geometry.registration ?? geometry.registration_gate ?? null;
  if (!reg || typeof reg !== "object") return conflicts;

  const compareBool = (key: string) => {
    const blockVal = reg[key];
    const topVal = geometry[key];
    if (
      (blockVal === true && topVal === false) ||
      (blockVal === false && topVal === true)
    ) {
      conflicts.push({
        field: key,
        block_value: blockVal,
        top_level_value: topVal,
        detail: `registration.${key} (${blockVal}) disagrees with geometry.${key} (${topVal})`,
      });
    }
  };
  compareBool("geo_to_dsm_px_success");
  compareBool("dsm_pixel_transform_valid");

  if (reg.coordinate_registration_gate_passed === true) {
    if (reg.confirmed_roof_center_px == null) {
      conflicts.push({
        field: "confirmed_roof_center_px",
        block_value: null,
        detail: "coordinate_registration_gate_passed=true with null confirmed_roof_center_px",
      });
    }
    if (reg.geo_to_dsm_transform == null) {
      conflicts.push({
        field: "geo_to_dsm_transform",
        block_value: null,
        detail: "coordinate_registration_gate_passed=true with null geo_to_dsm_transform",
      });
    }
    if (reg.geo_to_raster_transform == null) {
      conflicts.push({
        field: "geo_to_raster_transform",
        block_value: null,
        detail: "coordinate_registration_gate_passed=true with null geo_to_raster_transform",
      });
    }
    if (reg.dsm_to_raster_transform == null) {
      conflicts.push({
        field: "dsm_to_raster_transform",
        block_value: null,
        detail: "coordinate_registration_gate_passed=true with null dsm_to_raster_transform",
      });
    }
    if (Array.isArray(reg.missing_required_fields) && reg.missing_required_fields.length > 0) {
      conflicts.push({
        field: "missing_required_fields",
        block_value: reg.missing_required_fields,
        detail: "coordinate_registration_gate_passed=true while strict mode reports missing fields",
      });
    }
  }
  // v3: final write must be evaluation_stage="candidate_final". A preflight
  // block reaching the write path is itself a conflict.
  if (
    reg.evaluation_stage != null &&
    reg.evaluation_stage !== "candidate_final" &&
    reg.coordinate_registration_gate_passed === true
  ) {
    conflicts.push({
      field: "evaluation_stage",
      block_value: reg.evaluation_stage,
      detail: `coordinate_registration_gate_passed=true with non-final evaluation_stage=${reg.evaluation_stage}`,
    });
  }
  return conflicts;
}

/**
 * Stamp a phase block with the `blocked_by_registration_gate` skip marker.
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

export function quarantineRegistrationBlockedVisibleGeometry<T extends Record<string, any>>(geometry: T): T {
  const stale: Record<string, unknown> =
    geometry.stale_debug_payload && typeof geometry.stale_debug_payload === "object" && !Array.isArray(geometry.stale_debug_payload)
      ? { ...(geometry.stale_debug_payload as Record<string, unknown>) }
      : {};
  const stalePhase3B: Record<string, unknown> = {};
  for (const key of [
    "phase3B",
    "phase3B_active",
    "roof_lines_count",
    "reportable_roof_lines_count",
    "roof_lines_by_attribute",
    "roof_line_total_lf_by_attribute",
    "roof_lines",
  ]) {
    if ((geometry as any)[key] != null) stalePhase3B[key] = (geometry as any)[key];
  }
  if (Object.keys(stalePhase3B).length > 0) stale.phase3B = stalePhase3B;
  (geometry as any).stale_debug_payload = stale;
  (geometry as any).phase3B = {
    version: "v1",
    executed: false,
    skipped_reason: REGISTRATION_BLOCKED_SKIPPED_REASON,
    phase3B_active: false,
    roof_lines_count: 0,
    reportable_roof_lines_count: 0,
    roof_lines_by_attribute: {},
    roof_line_total_lf_by_attribute: {},
  };
  (geometry as any).phase3B_active = false;
  (geometry as any).roof_lines_count = 0;
  (geometry as any).reportable_roof_lines_count = 0;
  (geometry as any).roof_lines_by_attribute = {};
  (geometry as any).roof_line_total_lf_by_attribute = {};
  (geometry as any).roof_lines = [];
  return geometry;
}

/**
 * Map a registration failure reason to the result_state bucket.
 */
export function resultStateForRegistrationFailure(
  reason: RegistrationPrecedenceReason,
): "ai_failed_target_unconfirmed" | "ai_failed_source_acquisition" {
  if (reason === "target_roof_not_confirmed") return "ai_failed_target_unconfirmed";
  return "ai_failed_source_acquisition";
}

/**
 * Compose a registration-precedence stamp block to merge into the persisted
 * `geometry_report_json`.
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

/**
 * Convenience: derive the dominant precedence reason, preferring the
 * conflict detector over the lenient block-only inference. Used in the
 * write-time payload preparer so a contradictory persisted block hard-fails.
 */
export function derivePrecedenceReasonWithConflict(
  geometry: any,
): {
  reason: RegistrationPrecedenceReason | null;
  conflicts: RegistrationFieldConflict[];
} {
  const conflicts = detectRegistrationFieldConflicts(geometry);
  const reg = geometry?.registration ?? geometry?.registration_gate ?? null;
  // v3: prefer the honest gate-level failure (e.g. coordinate_registration_failed)
  // when the gate already reported it. registration_field_conflict is only the
  // dominant label when the block has no first-class failure of its own.
  const gateLevel = deriveRegistrationFailureReason(reg);
  if (gateLevel) return { reason: gateLevel, conflicts };
  if (conflicts.length > 0) return { reason: "registration_field_conflict", conflicts };
  return { reason: null, conflicts };
}
