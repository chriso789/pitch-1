// ============================================================================
// Registration Stage Classifier v1
// ----------------------------------------------------------------------------
// Converts a generic "coordinate_registration_failed" into a stage-specific
// hard_fail_reason and emits the structured DSM-proof / candidate-proof /
// coordinate-space-audit blocks the operator needs to debug which exact
// substage of source registration broke.
//
// Inputs are all optional — anything missing produces an explicit token in
// `missing_required_fields` rather than throwing.
//
// Priority order for hard_fail_reason (first match wins):
//   1. coordinate_space_mismatch   — candidate polygon space ≠ center space
//   2. dsm_bounds_missing          — DSM loaded but bounds not extracted
//   3. dsm_decode_failed           — DSM URL present but decode reported false
//   4. dsm_center_out_of_bounds    — DSM bounds present but confirmed center outside
//   5. dsm_raster_overlap_failed   — DSM ↔ raster bounds do not overlap
//   6. selected_candidate_polygon_missing — no selected candidate polygon
//   7. candidate_does_not_contain_confirmed_center
//   8. coordinate_registration_failed (fallback)
// ============================================================================

export const REGISTRATION_STAGE_CLASSIFIER_VERSION =
  "registration-stage-classifier-v1";

export type LatLng = { lat: number; lng: number };
export type Bounds = { sw: LatLng; ne: LatLng };
export type Px = [number, number];

export interface DsmProofInput {
  dsm_url_present?: boolean | null;
  dsm_loaded?: boolean | null;
  dsm_decode_success?: boolean | null;
  dsm_bounds_source?:
    | "solar_data_layers_metadata"
    | "google_solar_metadata"
    | "derived_from_tile_origin"
    | "derived_from_confirmed_center_and_mpp"
    | "derived_from_dsm_bbox_and_static_mpp"
    | "missing"
    | null;
  dsm_tile_bounds_lat_lng?: Bounds | null;
  dsm_size_px?: { width: number; height: number } | null;
  dsm_meters_per_pixel?: number | null;
  dsm_origin_lat_lng?: LatLng | null;
  dsm_failure_reasons?: string[];
}


export interface CandidateProofInput {
  selected_candidate_polygon_px?: Px[] | null;
  selected_candidate_polygon_geo?: LatLng[] | null;
  candidate_coordinate_space?: "dsm_px" | "raster_px" | null;
  candidate_source?: string | null;
  candidate_area_sqft?: number | null;
  candidate_centroid_px?: Px | null;
  candidate_distance_rank?: number | null;
  candidate_centroid_offset_threshold_px?: number | null;
  candidate_rejection_reason?: string | null;
}

export interface StageClassifierInput {
  confirmed_roof_center_lat_lng?: LatLng | null;
  confirmed_roof_center_px?: Px | null;
  confirmed_roof_center_dsm_px?: Px | null;
  raster_size_px?: { width: number; height: number } | null;
  raster_bounds_lat_lng?: Bounds | null;
  dsm: DsmProofInput;
  candidate: CandidateProofInput;
  // Derived from the transform package.
  geo_to_dsm_px_success?: boolean | null;
  dsm_pixel_transform_valid?: boolean | null;
  dsm_tile_bounds_contain_confirmed_center?: boolean | null;
  dsm_to_raster_bounds_overlap?: boolean | null;
  static_transform_succeeded?: boolean | null;
}

export interface DsmProof {
  dsm_source: string;
  dsm_url_present: boolean;
  dsm_loaded: boolean;
  dsm_decode_success: boolean;
  dsm_bounds_source:
    | "solar_data_layers_metadata"
    | "google_solar_metadata"
    | "derived_from_tile_origin"
    | "derived_from_confirmed_center_and_mpp"
    | "derived_from_dsm_bbox_and_static_mpp"
    | "missing";
  dsm_tile_bounds_lat_lng: Bounds | null;
  dsm_size_px: { width: number; height: number } | null;
  dsm_meters_per_pixel: number | null;
  dsm_origin_lat_lng: LatLng | null;
  dsm_failure_reasons: string[];
}


export interface CandidateProof {
  selected_candidate_polygon_px: Px[] | null;
  selected_candidate_polygon_geo: LatLng[] | null;
  candidate_coordinate_space: "dsm_px" | "raster_px" | null;
  candidate_source: string | null;
  candidate_area_sqft: number | null;
  candidate_centroid_px: Px | null;
  candidate_point_count: number;
  candidate_distance_rank: number | null;
  candidate_centroid_offset_from_confirmed_center_px: number | null;
  candidate_centroid_offset_threshold_px: number | null;
  confirmed_center_inside_candidate: boolean;
  candidate_rejection_reason: string | null;
}

export interface CoordinateSpaceAudit {
  raster_px_available: boolean;
  dsm_px_available: boolean;
  candidate_coordinate_space: "dsm_px" | "raster_px" | null;
  center_used_for_candidate_check: "raster_px" | "dsm_px" | null;
  candidate_polygon_point_count: number;
  mixed_space_detected: boolean;
  mixed_space_failure_reason: string | null;
}

export interface StageClassifierResult {
  version: typeof REGISTRATION_STAGE_CLASSIFIER_VERSION;
  hard_fail_reason: string;
  failure_stage: string;
  result_state: "ai_failed_source_acquisition";
  missing_required_fields: string[];
  dsm_proof: DsmProof;
  candidate_proof: CandidateProof;
  coordinate_space_audit: CoordinateSpaceAudit;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function polygonCentroid(poly: Px[]): Px | null {
  if (!Array.isArray(poly) || poly.length === 0) return null;
  let sx = 0, sy = 0, n = 0;
  for (const p of poly) {
    if (!Array.isArray(p) || !isFiniteNumber(p[0]) || !isFiniteNumber(p[1])) continue;
    sx += p[0]; sy += p[1]; n++;
  }
  return n > 0 ? [sx / n, sy / n] : null;
}

function pointInPolygonPx(pt: Px, poly: Px[]): boolean {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect =
      (yi > pt[1]) !== (yj > pt[1]) &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distancePx(a: Px, b: Px): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function classifyRegistrationStage(
  input: StageClassifierInput,
): StageClassifierResult {
  const missing: string[] = [];

  // ── DSM proof ──
  const dsm = input.dsm ?? {};
  const dsmUrlPresent = dsm.dsm_url_present === true;
  const dsmLoaded = dsm.dsm_loaded === true;
  const dsmDecodeSuccess = dsm.dsm_decode_success === true;
  const dsmBoundsSource: DsmProof["dsm_bounds_source"] =
    dsm.dsm_bounds_source ?? (dsm.dsm_tile_bounds_lat_lng ? "solar_data_layers_metadata" : "missing");
  const dsmFailureReasons = Array.isArray(dsm.dsm_failure_reasons)
    ? [...dsm.dsm_failure_reasons]
    : [];
  if (dsmLoaded && !dsm.dsm_tile_bounds_lat_lng) {
    if (!dsmFailureReasons.includes("dsm_bounds_missing")) {
      dsmFailureReasons.push("dsm_bounds_missing");
    }
  }
  if (dsmUrlPresent && dsmLoaded && dsm.dsm_decode_success === false) {
    if (!dsmFailureReasons.includes("dsm_decode_failed")) {
      dsmFailureReasons.push("dsm_decode_failed");
    }
  }

  const dsmProof: DsmProof = {
    dsm_source: "google_solar_data_layers",
    dsm_url_present: dsmUrlPresent,
    dsm_loaded: dsmLoaded,
    dsm_decode_success: dsmDecodeSuccess,
    dsm_bounds_source: dsmBoundsSource,
    dsm_tile_bounds_lat_lng: dsm.dsm_tile_bounds_lat_lng ?? null,
    dsm_size_px: dsm.dsm_size_px ?? null,
    dsm_meters_per_pixel: isFiniteNumber(dsm.dsm_meters_per_pixel)
      ? dsm.dsm_meters_per_pixel
      : null,
    dsm_origin_lat_lng: dsm.dsm_origin_lat_lng ?? null,
    dsm_failure_reasons: dsmFailureReasons,
  };

  // ── Candidate proof ──
  const cand = input.candidate ?? {};
  const polyPx = Array.isArray(cand.selected_candidate_polygon_px)
    ? cand.selected_candidate_polygon_px
    : null;
  const candidateSpace = cand.candidate_coordinate_space ?? null;
  const centerForCandidate: Px | null =
    candidateSpace === "dsm_px"
      ? input.confirmed_roof_center_dsm_px ?? null
      : candidateSpace === "raster_px"
      ? input.confirmed_roof_center_px ?? null
      : null;
  const centroid = polyPx ? cand.candidate_centroid_px ?? polygonCentroid(polyPx) : null;
  const confirmedInside = !!(polyPx && centerForCandidate && pointInPolygonPx(centerForCandidate, polyPx));
  const centroidOffset = (centroid && centerForCandidate)
    ? distancePx(centroid, centerForCandidate)
    : null;

  const candidateProof: CandidateProof = {
    selected_candidate_polygon_px: polyPx,
    selected_candidate_polygon_geo: cand.selected_candidate_polygon_geo ?? null,
    candidate_coordinate_space: candidateSpace,
    candidate_source: cand.candidate_source ?? null,
    candidate_area_sqft: isFiniteNumber(cand.candidate_area_sqft) ? cand.candidate_area_sqft : null,
    candidate_centroid_px: centroid,
    candidate_point_count: polyPx?.length ?? 0,
    candidate_distance_rank: isFiniteNumber(cand.candidate_distance_rank) ? cand.candidate_distance_rank : null,
    candidate_centroid_offset_from_confirmed_center_px: centroidOffset,
    candidate_centroid_offset_threshold_px: isFiniteNumber(cand.candidate_centroid_offset_threshold_px)
      ? cand.candidate_centroid_offset_threshold_px
      : null,
    confirmed_center_inside_candidate: confirmedInside,
    candidate_rejection_reason: cand.candidate_rejection_reason ?? null,
  };

  // ── Coordinate-space audit ──
  const rasterPxAvail = !!input.confirmed_roof_center_px;
  const dsmPxAvail = !!input.confirmed_roof_center_dsm_px;
  const centerUsed: "raster_px" | "dsm_px" | null =
    candidateSpace === "dsm_px" ? "dsm_px" : candidateSpace === "raster_px" ? "raster_px" : null;
  // Mixed-space is when we have a candidate in one space but only have a
  // center in the *other* space.
  let mixed = false;
  let mixedReason: string | null = null;
  if (polyPx && candidateSpace === "dsm_px" && !dsmPxAvail && rasterPxAvail) {
    mixed = true;
    mixedReason = "candidate_polygon_in_dsm_px_but_only_raster_center_available";
  } else if (polyPx && candidateSpace === "raster_px" && !rasterPxAvail && dsmPxAvail) {
    mixed = true;
    mixedReason = "candidate_polygon_in_raster_px_but_only_dsm_center_available";
  } else if (polyPx && !candidateSpace) {
    mixed = true;
    mixedReason = "candidate_coordinate_space_unspecified";
  }
  const audit: CoordinateSpaceAudit = {
    raster_px_available: rasterPxAvail,
    dsm_px_available: dsmPxAvail,
    candidate_coordinate_space: candidateSpace,
    center_used_for_candidate_check: centerUsed,
    candidate_polygon_point_count: polyPx?.length ?? 0,
    mixed_space_detected: mixed,
    mixed_space_failure_reason: mixedReason,
  };

  // ── Stage-specific missing_required_fields ──
  // Static transform already succeeded → DO NOT report static fields missing.
  const staticOK = input.static_transform_succeeded === true;
  if (!staticOK) {
    if (!input.raster_bounds_lat_lng) missing.push("raster_bounds_lat_lng");
    if (!input.confirmed_roof_center_px) missing.push("confirmed_roof_center_px");
  }
  if (!dsmProof.dsm_size_px) missing.push("dsm_size_px");
  if (!dsmProof.dsm_tile_bounds_lat_lng) missing.push("dsm_tile_bounds_lat_lng");
  if (input.geo_to_dsm_px_success !== true) missing.push("geo_to_dsm_transform");
  if (input.dsm_pixel_transform_valid !== true) missing.push("dsm_to_raster_transform");
  if (!input.confirmed_roof_center_dsm_px) missing.push("confirmed_roof_center_dsm_px");
  if (!polyPx) missing.push("selected_candidate_polygon_px");
  if (!candidateSpace && polyPx) missing.push("candidate_coordinate_space");

  // ── Priority-ordered hard_fail_reason ──
  //
  // Priority order (first match wins):
  //   1. dsm_bounds_missing
  //   2. dsm_size_missing
  //   3. dsm_decode_failed
  //   4. dsm_center_out_of_bounds
  //   5. coordinate_space_mismatch
  //   6. geo_to_dsm_transform_missing
  //   7. dsm_raster_overlap_failed
  //   8. dsm_raster_transform_missing
  //   9. selected_candidate_polygon_missing
  //  10. candidate_centroid_offset_exceeds_target (when threshold provided)
  //  11. candidate_does_not_contain_confirmed_center
  //  12. coordinate_registration_failed (fallback)
  let hardFail = "coordinate_registration_failed";
  let stage = "registration";
  if (dsmLoaded && !dsmProof.dsm_tile_bounds_lat_lng) {
    hardFail = "dsm_bounds_missing";
    stage = "dsm_bounds_extraction";
  } else if (dsmLoaded && !dsmProof.dsm_size_px) {
    hardFail = "dsm_size_missing";
    stage = "dsm_size_extraction";
  } else if (dsmUrlPresent && dsm.dsm_decode_success === false) {
    hardFail = "dsm_decode_failed";
    stage = "dsm_decode";
  } else if (
    dsmProof.dsm_tile_bounds_lat_lng &&
    input.dsm_tile_bounds_contain_confirmed_center === false
  ) {
    hardFail = "dsm_center_out_of_bounds";
    stage = "dsm_bounds_containment";
  } else if (mixed) {
    hardFail = "coordinate_space_mismatch";
    stage = "candidate_coordinate_space";
  } else if (!polyPx) {
    hardFail = "selected_candidate_polygon_missing";
    stage = "candidate_selection";
  } else if (
    dsmProof.dsm_tile_bounds_lat_lng &&
    dsmProof.dsm_size_px &&
    input.geo_to_dsm_px_success !== true
  ) {
    hardFail = "geo_to_dsm_transform_missing";
    stage = "geo_to_dsm_transform";
  } else if (
    dsmProof.dsm_tile_bounds_lat_lng &&
    input.raster_bounds_lat_lng &&
    input.dsm_to_raster_bounds_overlap === false
  ) {
    hardFail = "dsm_raster_overlap_failed";
    stage = "dsm_raster_overlap";
  } else if (
    dsmProof.dsm_tile_bounds_lat_lng &&
    input.raster_bounds_lat_lng &&
    input.dsm_pixel_transform_valid !== true
  ) {
    hardFail = "dsm_raster_transform_missing";
    stage = "dsm_raster_transform";

  } else if (
    polyPx && centerForCandidate &&
    isFiniteNumber(centroidOffset) &&
    isFiniteNumber(candidateProof.candidate_centroid_offset_threshold_px) &&
    (centroidOffset as number) > (candidateProof.candidate_centroid_offset_threshold_px as number)
  ) {
    hardFail = "candidate_centroid_offset_exceeds_target";
    stage = "candidate_centroid_offset";
  } else if (polyPx && centerForCandidate && !confirmedInside) {
    hardFail = "candidate_does_not_contain_confirmed_center";
    stage = "candidate_containment";
  }


  return {
    version: REGISTRATION_STAGE_CLASSIFIER_VERSION,
    hard_fail_reason: hardFail,
    failure_stage: stage,
    result_state: "ai_failed_source_acquisition",
    missing_required_fields: missing,
    dsm_proof: dsmProof,
    candidate_proof: candidateProof,
    coordinate_space_audit: audit,
  };
}
