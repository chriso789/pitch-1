// ============================================================================
// Target Roof Registration Gate v2.2 — shared utilities
// ----------------------------------------------------------------------------
// Pure, dependency-free helpers used by start-ai-measurement, the autonomous
// graph solver, debug-measurement-runtime, and the UI to decide whether a
// run is "registered" — i.e. the displayed aerial, DSM tile, solar mask, and
// candidate footprints all line up with the user-confirmed roof target.
//
// v2.2 hardening (Fonsica-driven):
//   - `candidate_selection_started=true` activates STRICT mode. In strict
//     mode the gate REFUSES to pass with null transforms / null confirmed
//     center pixel / missing selected candidate, and a candidate centroid
//     offset above `max(150px, 0.35 * footprint_bbox_diagonal_px)` is a
//     hard rejection (not "n/a" or "pass").
//   - Never defaults `confirmed_center_inside_candidate=true` once
//     candidate selection has started.
//   - Persists `missing_required_fields` and a conflict-detector signal so
//     the registration block cannot pretend to pass while transforms are
//     null or top-level booleans disagree.
//   - New failure reason: `registration_field_conflict`.
//
// A registration failure means the editable perimeter is drawn over the wrong
// house (or in a different coordinate frame than the displayed raster). When
// any gate fails the run MUST NOT produce a customer report and the UI MUST
// disable manual approval — otherwise we lock the wrong structure.
// ============================================================================

export const REGISTRATION_GATE_VERSION = "registration-gate-v2.3";
export const REGISTRATION_SKIPPED_REASON = "blocked_by_registration_gate";

export type RegistrationEvaluationStage =
  | "target_preflight"
  | "source_preflight"
  | "candidate_final";

export type LatLng = { lat: number; lng: number };
export type Px = [number, number];
export type Polygon = Px[];

export type RegistrationFailureReason =
  | "target_roof_not_confirmed"
  | "coordinate_registration_failed"
  | "candidate_does_not_contain_confirmed_roof_center"
  | "registration_field_conflict"
  | "missing_selected_candidate";

export interface RegistrationGateInput {
  // Target confirmation
  user_confirmed_roof_target: boolean;
  roof_target_admin_override?: boolean;
  original_geocode_lat_lng?: LatLng | null;
  confirmed_roof_center_lat_lng?: LatLng | null;
  confirmed_roof_center_px?: Px | null;

  // Frame registration
  geo_to_dsm_px_success?: boolean | null;
  dsm_pixel_transform_valid?: boolean | null;
  dsm_to_raster_transform?: unknown | null;
  raster_bounds_lat_lng?: { sw: LatLng; ne: LatLng } | null;

  // Frames (for persistence — opaque to gate logic, but required in strict
  // mode so we can prove the transform actually exists).
  static_map_center_lat_lng?: LatLng | null;
  google_solar_building_center_lat_lng?: LatLng | null;
  dsm_tile_origin_lat_lng?: LatLng | null;
  dsm_tile_bounds_lat_lng?: { sw: LatLng; ne: LatLng } | null;
  raster_size_px?: { width: number; height: number } | null;
  dsm_size_px?: { width: number; height: number } | null;
  meters_per_pixel?: number | null;
  geo_to_raster_transform?: unknown | null;
  geo_to_dsm_transform?: unknown | null;

  // Selected candidate
  selected_candidate_polygon_px?: Polygon | null;
  footprint_bbox_diagonal_px?: number | null;

  // v2.2 — strict mode flag. When true, the gate enforces real transform
  // evidence and rejects "no candidate yet = pass".
  candidate_selection_started?: boolean;
}

export interface RegistrationGateResult {
  // The 5 UI gate flags
  user_confirmed_roof_target: boolean;
  geo_to_dsm_px_success: boolean;
  dsm_pixel_transform_valid: boolean;
  confirmed_center_inside_candidate: boolean;
  coordinate_registration_gate_passed: boolean;

  // Persistence block (drop straight into geometry_report_json.registration)
  registration: Record<string, unknown>;

  // Failure routing (null when gate passed)
  failure: null | {
    reason: RegistrationFailureReason;
    result_state: "ai_failed_target_unconfirmed" | "ai_failed_source_acquisition";
    hard_fail_reason: string;
    block_customer_report_reason: string;
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers (pure)
// ---------------------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isFiniteLatLng(v: unknown): v is LatLng {
  return (
    !!v &&
    typeof v === "object" &&
    isFiniteNumber((v as any).lat) &&
    isFiniteNumber((v as any).lng) &&
    Math.abs((v as any).lat) <= 90 &&
    Math.abs((v as any).lng) <= 180
  );
}

function isFinitePx(v: unknown): v is Px {
  return Array.isArray(v) && v.length === 2 && isFiniteNumber(v[0]) && isFiniteNumber(v[1]);
}

export function polygonContainsPoint(poly: Polygon | null | undefined, pt: Px | null | undefined): boolean {
  if (!poly || poly.length < 3 || !pt) return false;
  const [x, y] = pt;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects =
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(poly: Polygon | null | undefined): Px | null {
  if (!poly || poly.length < 3) return null;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x0, y0] = poly[j];
    const [x1, y1] = poly[i];
    const f = x0 * y1 - x1 * y0;
    area += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    const n = poly.length;
    const sx = poly.reduce((a, p) => a + p[0], 0) / n;
    const sy = poly.reduce((a, p) => a + p[1], 0) / n;
    return [sx, sy];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

export function pointDistancePx(a: Px | null | undefined, b: Px | null | undefined): number | null {
  if (!a || !b) return null;
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function polygonBBoxDiagonalPx(poly: Polygon | null | undefined): number | null {
  if (!poly || poly.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
}

function latLngInBounds(p: LatLng, b: { sw: LatLng; ne: LatLng }): boolean {
  return (
    p.lat >= b.sw.lat &&
    p.lat <= b.ne.lat &&
    p.lng >= b.sw.lng &&
    p.lng <= b.ne.lng
  );
}

/** v2.2 — centroid offset threshold per spec. */
export function maxAllowedCentroidOffsetPx(footprintBBoxDiagonalPx: number | null | undefined): number {
  const diag = isFiniteNumber(footprintBBoxDiagonalPx) ? footprintBBoxDiagonalPx : 0;
  return Math.max(150, 0.35 * diag);
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/**
 * Gate A precondition: target confirmation present.
 * Caller should pre-flight this BEFORE running source acquisition.
 */
export function evaluateTargetConfirmation(
  input: Pick<
    RegistrationGateInput,
    "user_confirmed_roof_target" | "roof_target_admin_override" | "confirmed_roof_center_lat_lng"
  >,
): { ok: true } | { ok: false; reason: string; message: string } {
  if (!input.user_confirmed_roof_target && !input.roof_target_admin_override) {
    return {
      ok: false,
      reason: "user_confirmed_roof_target_required",
      message:
        "AI Measurement requires a confirmed roof target. Place the marker on the actual roof before retrying.",
    };
  }
  if (!input.roof_target_admin_override && !isFiniteLatLng(input.confirmed_roof_center_lat_lng)) {
    return {
      ok: false,
      reason: "confirmed_roof_center_required",
      message:
        "AI Measurement requires explicit confirmed roof center lat/lng. The marker payload is missing or invalid.",
    };
  }
  return { ok: true };
}

/**
 * Full gate evaluation. Returns the 5 flags + persistence block + failure
 * routing.
 *
 * v2.2: STRICT MODE — when `candidate_selection_started=true`, the gate
 * requires real transform evidence (non-null confirmed_roof_center_px,
 * geo_to_raster_transform, geo_to_dsm_transform, dsm_to_raster_transform,
 * raster_bounds_lat_lng, dsm_tile_bounds_lat_lng, selected_candidate_polygon_px).
 * Missing any of these is `coordinate_registration_failed` — never silent pass.
 */
export function evaluateRegistrationGate(input: RegistrationGateInput): RegistrationGateResult {
  const strict = input.candidate_selection_started === true;
  const user_confirmed_roof_target = !!input.user_confirmed_roof_target;
  const geo_to_dsm_px_success_raw = !!input.geo_to_dsm_px_success;
  const dsm_pixel_transform_valid_raw = !!input.dsm_pixel_transform_valid;

  // Frame validity check (legacy lenient)
  const rasterBoundsContainConfirmedCenter =
    input.raster_bounds_lat_lng && isFiniteLatLng(input.confirmed_roof_center_lat_lng)
      ? latLngInBounds(input.confirmed_roof_center_lat_lng, input.raster_bounds_lat_lng)
      : null;

  // v2.2 strict transform-evidence enforcement.
  const missing_required_fields: string[] = [];
  if (strict) {
    if (!isFinitePx(input.confirmed_roof_center_px ?? null)) missing_required_fields.push("confirmed_roof_center_px");
    if (input.geo_to_raster_transform == null) missing_required_fields.push("geo_to_raster_transform");
    if (input.geo_to_dsm_transform == null) missing_required_fields.push("geo_to_dsm_transform");
    if (input.dsm_to_raster_transform == null) missing_required_fields.push("dsm_to_raster_transform");
    if (input.raster_bounds_lat_lng == null) missing_required_fields.push("raster_bounds_lat_lng");
    if (input.dsm_tile_bounds_lat_lng == null) missing_required_fields.push("dsm_tile_bounds_lat_lng");
    if (!input.selected_candidate_polygon_px || input.selected_candidate_polygon_px.length < 3) {
      missing_required_fields.push("selected_candidate_polygon_px");
    }
    if (!geo_to_dsm_px_success_raw) missing_required_fields.push("geo_to_dsm_px_success");
    if (!dsm_pixel_transform_valid_raw) missing_required_fields.push("dsm_pixel_transform_valid");
  } else {
    // Legacy permissive mode (pre-candidate). Still require the transform
    // object exists when the caller claimed pixel transform validity.
    if (
      (geo_to_dsm_px_success_raw || dsm_pixel_transform_valid_raw) &&
      input.dsm_to_raster_transform == null
    ) {
      missing_required_fields.push("dsm_to_raster_transform");
    }
  }

  // In strict mode, downgrade the published booleans when evidence is missing.
  // Truth-in-advertising: never report success when transform evidence is null.
  const geo_to_dsm_px_success =
    strict && missing_required_fields.length > 0 ? false : geo_to_dsm_px_success_raw;
  const dsm_pixel_transform_valid =
    strict && missing_required_fields.length > 0 ? false : dsm_pixel_transform_valid_raw;

  const frame_valid =
    geo_to_dsm_px_success &&
    dsm_pixel_transform_valid &&
    input.dsm_to_raster_transform != null &&
    (rasterBoundsContainConfirmedCenter == null || rasterBoundsContainConfirmedCenter === true);

  // Candidate-contains-confirmed-center
  let confirmed_center_inside_candidate = false;
  let candidate_centroid_offset_from_confirmed_center_px: number | null = null;
  const polyDiagonalPx = polygonBBoxDiagonalPx(input.selected_candidate_polygon_px ?? null);
  const footprintDiagonalPx = isFiniteNumber(input.footprint_bbox_diagonal_px)
    ? input.footprint_bbox_diagonal_px
    : polyDiagonalPx;
  const maxOffset = maxAllowedCentroidOffsetPx(footprintDiagonalPx);
  let centroid_offset_exceeds_threshold = false;

  if (input.confirmed_roof_center_px && input.selected_candidate_polygon_px) {
    confirmed_center_inside_candidate = polygonContainsPoint(
      input.selected_candidate_polygon_px,
      input.confirmed_roof_center_px,
    );
    const centroid = polygonCentroid(input.selected_candidate_polygon_px);
    candidate_centroid_offset_from_confirmed_center_px = pointDistancePx(
      centroid,
      input.confirmed_roof_center_px,
    );
    if (
      candidate_centroid_offset_from_confirmed_center_px != null &&
      candidate_centroid_offset_from_confirmed_center_px > maxOffset
    ) {
      centroid_offset_exceeds_threshold = true;
      // Strict mode: a candidate far from the confirmed center is the wrong
      // building. Treat it as containment failure regardless of the polygon
      // outline contains check (loose polys can still wrap the wrong house).
      if (strict) confirmed_center_inside_candidate = false;
    }
  } else if (strict) {
    // v2.2 strict: missing candidate or missing confirmed center is NOT
    // pass. The legacy "no candidate yet = pass" behavior is removed.
    confirmed_center_inside_candidate = false;
  } else if (!input.selected_candidate_polygon_px) {
    // Legacy permissive: pre-candidate stage, treat as n/a so we don't
    // false-fail at source acquisition.
    confirmed_center_inside_candidate = true;
  }

  const coordinate_registration_gate_passed =
    (user_confirmed_roof_target || !!input.roof_target_admin_override) &&
    frame_valid &&
    confirmed_center_inside_candidate &&
    (!strict || missing_required_fields.length === 0);

  // Persistence block — drift guard.
  const registration: Record<string, unknown> = {
    version: REGISTRATION_GATE_VERSION,
    candidate_selection_started: !!strict,
    missing_required_fields,
    required_transform_evidence: strict
      ? {
          confirmed_roof_center_px_present: isFinitePx(input.confirmed_roof_center_px ?? null),
          geo_to_raster_transform_present: input.geo_to_raster_transform != null,
          geo_to_dsm_transform_present: input.geo_to_dsm_transform != null,
          dsm_to_raster_transform_present: input.dsm_to_raster_transform != null,
          raster_bounds_lat_lng_present: input.raster_bounds_lat_lng != null,
          dsm_tile_bounds_lat_lng_present: input.dsm_tile_bounds_lat_lng != null,
          selected_candidate_polygon_px_present:
            !!input.selected_candidate_polygon_px && input.selected_candidate_polygon_px.length >= 3,
        }
      : null,
    original_geocode_lat_lng: input.original_geocode_lat_lng ?? null,
    confirmed_roof_center_lat_lng: input.confirmed_roof_center_lat_lng ?? null,
    confirmed_roof_center_px: input.confirmed_roof_center_px ?? null,
    static_map_center_lat_lng: input.static_map_center_lat_lng ?? null,
    google_solar_building_center_lat_lng: input.google_solar_building_center_lat_lng ?? null,
    dsm_tile_origin_lat_lng: input.dsm_tile_origin_lat_lng ?? null,
    dsm_tile_bounds_lat_lng: input.dsm_tile_bounds_lat_lng ?? null,
    raster_bounds_lat_lng: input.raster_bounds_lat_lng ?? null,
    raster_size_px: input.raster_size_px ?? null,
    dsm_size_px: input.dsm_size_px ?? null,
    meters_per_pixel: input.meters_per_pixel ?? null,
    geo_to_raster_transform: input.geo_to_raster_transform ?? null,
    geo_to_dsm_transform: input.geo_to_dsm_transform ?? null,
    dsm_to_raster_transform: input.dsm_to_raster_transform ?? null,
    geo_to_dsm_px_success,
    dsm_pixel_transform_valid,
    raster_bounds_contain_confirmed_center: rasterBoundsContainConfirmedCenter,
    confirmed_center_inside_candidate,
    candidate_centroid_offset_from_confirmed_center_px,
    candidate_centroid_offset_threshold_px: maxOffset,
    centroid_offset_exceeds_threshold,
    footprint_bbox_diagonal_px: footprintDiagonalPx ?? null,
    coordinate_registration_gate_passed,
    user_confirmed_roof_target,
    roof_target_admin_override: !!input.roof_target_admin_override,
  };

  // Failure routing
  let failure: RegistrationGateResult["failure"] = null;
  if (!user_confirmed_roof_target && !input.roof_target_admin_override) {
    failure = {
      reason: "target_roof_not_confirmed",
      result_state: "ai_failed_target_unconfirmed",
      hard_fail_reason: "target_roof_not_confirmed",
      block_customer_report_reason: "target_roof_not_confirmed",
    };
  } else if (strict && missing_required_fields.length > 0) {
    failure = {
      reason: "coordinate_registration_failed",
      result_state: "ai_failed_source_acquisition",
      hard_fail_reason: "coordinate_registration_failed",
      block_customer_report_reason: "coordinate_registration_failed",
    };
  } else if (!frame_valid) {
    failure = {
      reason: "coordinate_registration_failed",
      result_state: "ai_failed_source_acquisition",
      hard_fail_reason: "coordinate_registration_failed",
      block_customer_report_reason: "coordinate_registration_failed",
    };
  } else if (!confirmed_center_inside_candidate) {
    failure = {
      reason: "candidate_does_not_contain_confirmed_roof_center",
      result_state: "ai_failed_source_acquisition",
      hard_fail_reason: "candidate_does_not_contain_confirmed_roof_center",
      block_customer_report_reason: "candidate_does_not_contain_confirmed_roof_center",
    };
  }

  return {
    user_confirmed_roof_target,
    geo_to_dsm_px_success,
    dsm_pixel_transform_valid,
    confirmed_center_inside_candidate,
    coordinate_registration_gate_passed,
    registration,
    failure,
  };
}

/**
 * Per-candidate evaluation.
 */
export interface CandidateEvaluation {
  confirmed_center_inside_candidate: boolean;
  candidate_centroid_offset_from_confirmed_center_px: number | null;
  candidate_centroid_offset_threshold_px: number;
  centroid_offset_exceeds_threshold: boolean;
  nearest_neighbor_structure_distance_px: number | null;
  rejected: boolean;
  rejection_reason: string | null;
}

export function evaluateCandidate(
  candidate_polygon_px: Polygon | null | undefined,
  confirmed_roof_center_px: Px | null | undefined,
  neighbor_structure_centers_px: Px[] = [],
): CandidateEvaluation {
  const inside = polygonContainsPoint(candidate_polygon_px, confirmed_roof_center_px);
  const centroid = polygonCentroid(candidate_polygon_px);
  const offset = pointDistancePx(centroid, confirmed_roof_center_px);
  const diag = polygonBBoxDiagonalPx(candidate_polygon_px);
  const threshold = maxAllowedCentroidOffsetPx(diag);
  const exceeds = offset != null && offset > threshold;

  let nearestNeighbor: number | null = null;
  if (confirmed_roof_center_px && neighbor_structure_centers_px.length) {
    nearestNeighbor = Math.min(
      ...neighbor_structure_centers_px
        .map((c) => pointDistancePx(c, confirmed_roof_center_px))
        .filter((d): d is number => d != null),
    );
    if (!Number.isFinite(nearestNeighbor)) nearestNeighbor = null;
  }

  const rejected = !inside || exceeds;
  let rejection_reason: string | null = null;
  if (!inside) rejection_reason = "candidate_does_not_contain_confirmed_roof_center";
  else if (exceeds) rejection_reason = "candidate_centroid_offset_exceeds_threshold";

  return {
    confirmed_center_inside_candidate: inside && !exceeds,
    candidate_centroid_offset_from_confirmed_center_px: offset,
    candidate_centroid_offset_threshold_px: threshold,
    centroid_offset_exceeds_threshold: exceeds,
    nearest_neighbor_structure_distance_px: nearestNeighbor,
    rejected,
    rejection_reason,
  };
}

/**
 * UI guard: returns true only when ALL manual-approval prerequisites are
 * satisfied.
 */
export function canApproveManualPerimeter(reg: {
  user_confirmed_roof_target?: boolean | null;
  geo_to_dsm_px_success?: boolean | null;
  dsm_pixel_transform_valid?: boolean | null;
  confirmed_center_inside_candidate?: boolean | null;
  coordinate_registration_gate_passed?: boolean | null;
} | null | undefined): boolean {
  if (!reg) return false;
  return (
    !!reg.user_confirmed_roof_target &&
    !!reg.geo_to_dsm_px_success &&
    !!reg.dsm_pixel_transform_valid &&
    !!reg.confirmed_center_inside_candidate &&
    !!reg.coordinate_registration_gate_passed
  );
}
