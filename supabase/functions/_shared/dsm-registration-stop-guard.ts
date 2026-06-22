// ============================================================================
// PR A-2 — DSM Registration Early-Stop Guard
// ----------------------------------------------------------------------------
// Pure decision function used by `start-ai-measurement` to short-circuit
// BEFORE entering `solveAutonomousGraph()` when:
//
//   - DSM was loaded but DSM↔raster transform is missing (no
//     dsm_tile_bounds_lat_lng, no geo_to_dsm_transform, no
//     dsm_to_raster_transform, or dsm_pixel_transform_valid=false), AND
//   - an aerial perimeter is editable (raster_candidate_check_passed=true).
//
// In that case the run MUST stop cleanly with:
//   - result_state = 'perimeter_only'
//   - hard_fail_reason = 'dsm_registration_unavailable'
//   - block_customer_report_reason = 'dsm_registration_unavailable'
//   - customer_report_ready = false
//   - diagram_render_intent = 'perimeter_only'
//
// This prevents the canonical Fonsica failure mode (CPU timeout @ ~108s)
// from ever reaching the autonomous topology solver when the DSM transform
// chain is incomplete. The editable raster perimeter survives for manual
// approval; no topology / pitch is fabricated.
// ============================================================================

export const DSM_STOP_GUARD_VERSION = "dsm-registration-stop-guard-v1";

export interface DsmStopGuardInput {
  dsm_loaded: boolean;
  dsm_tile_bounds_lat_lng: unknown | null;
  geo_to_dsm_transform: unknown | null;
  dsm_to_raster_transform: unknown | null;
  dsm_pixel_transform_valid: boolean | null;
  /** True when the raster-side candidate evaluation passed (PR A-2). */
  raster_candidate_check_passed: boolean | null;
  /** True when the candidate polygon is in raster_px (vs dsm_px). */
  candidate_in_raster_px: boolean | null;
  /** Whether a raster_px aerial perimeter is editable. */
  aerial_perimeter_editable: boolean | null;
}

export interface DsmStopGuardDecision {
  /** When true, caller MUST persist perimeter_only and return — do NOT enter solveAutonomousGraph. */
  stop_before_autonomous_solver: boolean;
  reason:
    | "dsm_transform_chain_incomplete"
    | "dsm_registration_unavailable"
    | "ok_to_run_solver"
    | "stop_no_aerial_fallback";
  hard_fail_reason: string | null;
  block_customer_report_reason: string | null;
  result_state: "perimeter_only" | "ai_failed_source_acquisition" | null;
  diagram_render_intent: "perimeter_only" | "rejected_only" | null;
  dsm_registration_status:
    | "unavailable_but_aerial_perimeter_editable"
    | "unavailable_no_aerial_fallback"
    | "available"
    | null;
  diagnostics: {
    has_dsm_tile_bounds: boolean;
    has_geo_to_dsm_transform: boolean;
    has_dsm_to_raster_transform: boolean;
    dsm_pixel_transform_valid: boolean;
    raster_candidate_check_passed: boolean;
    candidate_in_raster_px: boolean;
    aerial_perimeter_editable: boolean;
  };
  version: typeof DSM_STOP_GUARD_VERSION;
}

export function evaluateDsmRegistrationStopGuard(
  inp: DsmStopGuardInput,
): DsmStopGuardDecision {
  const has_dsm_tile_bounds = inp.dsm_tile_bounds_lat_lng != null;
  const has_geo_to_dsm_transform = inp.geo_to_dsm_transform != null;
  const has_dsm_to_raster_transform = inp.dsm_to_raster_transform != null;
  const dsm_pixel_transform_valid = inp.dsm_pixel_transform_valid === true;
  const raster_candidate_check_passed = inp.raster_candidate_check_passed === true;
  const candidate_in_raster_px = inp.candidate_in_raster_px === true;
  const aerial_perimeter_editable = inp.aerial_perimeter_editable === true;

  const dsm_chain_complete =
    has_dsm_tile_bounds &&
    has_geo_to_dsm_transform &&
    has_dsm_to_raster_transform &&
    dsm_pixel_transform_valid;

  const diagnostics = {
    has_dsm_tile_bounds,
    has_geo_to_dsm_transform,
    has_dsm_to_raster_transform,
    dsm_pixel_transform_valid,
    raster_candidate_check_passed,
    candidate_in_raster_px,
    aerial_perimeter_editable,
  };

  if (dsm_chain_complete) {
    return {
      stop_before_autonomous_solver: false,
      reason: "ok_to_run_solver",
      hard_fail_reason: null,
      block_customer_report_reason: null,
      result_state: null,
      diagram_render_intent: null,
      dsm_registration_status: "available",
      diagnostics,
      version: DSM_STOP_GUARD_VERSION,
    };
  }

  // DSM chain is incomplete. Two routes:
  //  (a) aerial perimeter editable → perimeter_only
  //  (b) no aerial fallback → ai_failed_source_acquisition
  if (aerial_perimeter_editable && (raster_candidate_check_passed || candidate_in_raster_px)) {
    return {
      stop_before_autonomous_solver: true,
      reason: "dsm_registration_unavailable",
      hard_fail_reason: "dsm_registration_unavailable",
      block_customer_report_reason: "dsm_registration_unavailable",
      result_state: "perimeter_only",
      diagram_render_intent: "perimeter_only",
      dsm_registration_status: "unavailable_but_aerial_perimeter_editable",
      diagnostics,
      version: DSM_STOP_GUARD_VERSION,
    };
  }

  return {
    stop_before_autonomous_solver: true,
    reason: "stop_no_aerial_fallback",
    hard_fail_reason: "dsm_registration_unavailable",
    block_customer_report_reason: "dsm_registration_unavailable",
    result_state: "ai_failed_source_acquisition",
    diagram_render_intent: "rejected_only",
    dsm_registration_status: "unavailable_no_aerial_fallback",
    diagnostics,
    version: DSM_STOP_GUARD_VERSION,
  };
}

// ============================================================================
// Raster-space candidate check (PR A-2 coordinate-space guard)
// ----------------------------------------------------------------------------
// When the selected candidate polygon is in raster_px AND the DSM transform
// chain is missing, the gate MUST compare against confirmed_roof_center_px
// (raster space), NEVER against confirmed_roof_center_dsm_px. Compute the
// explicit raster_candidate_check_passed signal here so downstream code can
// surface it without re-deriving.
// ============================================================================

export interface RasterCandidateCheckInput {
  selected_candidate_polygon_px: Array<[number, number]> | null;
  candidate_coordinate_space: string | null;
  confirmed_roof_center_px: [number, number] | null;
  /** Optional tolerance px for "near polygon bbox" containment. Default 24. */
  near_polygon_tolerance_px?: number;
}

export interface RasterCandidateCheckResult {
  raster_candidate_check_passed: boolean;
  dsm_candidate_check_skipped: boolean;
  center_used_for_candidate_check: "confirmed_roof_center_px" | null;
  confirmed_center_inside_candidate_raster: boolean | null;
  confirmed_center_inside_candidate_dsm: null;
  candidate_in_raster_px: boolean;
  reason: string | null;
}

function polygonContains(
  poly: Array<[number, number]>,
  pt: [number, number],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = (yi > pt[1]) !== (yj > pt[1]) &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInBbox(
  poly: Array<[number, number]>,
  pt: [number, number],
  tol: number,
): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return (
    pt[0] >= minX - tol &&
    pt[0] <= maxX + tol &&
    pt[1] >= minY - tol &&
    pt[1] <= maxY + tol
  );
}

export function evaluateRasterCandidateCheck(
  inp: RasterCandidateCheckInput,
): RasterCandidateCheckResult {
  const space = (inp.candidate_coordinate_space ?? "").toLowerCase();
  const candidate_in_raster_px =
    space === "raster_px" || space === "aerial_px" || space === "satellite_px";
  const tol = inp.near_polygon_tolerance_px ?? 24;

  if (!candidate_in_raster_px) {
    return {
      raster_candidate_check_passed: false,
      dsm_candidate_check_skipped: false,
      center_used_for_candidate_check: null,
      confirmed_center_inside_candidate_raster: null,
      confirmed_center_inside_candidate_dsm: null,
      candidate_in_raster_px: false,
      reason: "candidate_not_in_raster_px",
    };
  }

  const poly = inp.selected_candidate_polygon_px;
  const center = inp.confirmed_roof_center_px;
  if (!Array.isArray(poly) || poly.length < 3) {
    return {
      raster_candidate_check_passed: false,
      dsm_candidate_check_skipped: true,
      center_used_for_candidate_check: "confirmed_roof_center_px",
      confirmed_center_inside_candidate_raster: null,
      confirmed_center_inside_candidate_dsm: null,
      candidate_in_raster_px: true,
      reason: "candidate_polygon_missing",
    };
  }
  if (
    !center || !Number.isFinite(center[0]) || !Number.isFinite(center[1])
  ) {
    return {
      raster_candidate_check_passed: false,
      dsm_candidate_check_skipped: true,
      center_used_for_candidate_check: "confirmed_roof_center_px",
      confirmed_center_inside_candidate_raster: null,
      confirmed_center_inside_candidate_dsm: null,
      candidate_in_raster_px: true,
      reason: "confirmed_roof_center_px_missing",
    };
  }

  const inside = polygonContains(poly, center) || pointInBbox(poly, center, tol);
  return {
    raster_candidate_check_passed: inside,
    dsm_candidate_check_skipped: true,
    center_used_for_candidate_check: "confirmed_roof_center_px",
    confirmed_center_inside_candidate_raster: inside,
    confirmed_center_inside_candidate_dsm: null,
    candidate_in_raster_px: true,
    reason: inside ? null : "confirmed_center_outside_candidate_raster",
  };
}
