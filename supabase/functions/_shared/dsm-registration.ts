// ============================================================================
// DSM Registration v1
// ----------------------------------------------------------------------------
// Builds the DSM half of the registration package: dsm_size_px,
// dsm_tile_bounds_lat_lng, dsm_meters_per_pixel, with derivation fallback
// when Google Solar metadata bounds are missing.
//
// Inputs are all optional. Output documents source/derivation/warnings so the
// classifier can emit specific failure tokens instead of generic
// `coordinate_registration_failed`.
// ============================================================================

export const DSM_REGISTRATION_VERSION = "dsm-registration-v1";

export type LatLng = { lat: number; lng: number };
export type Bounds = { sw: LatLng; ne: LatLng };
export type SizePx = { width: number; height: number };

export type DsmBoundsSource =
  | "google_solar_metadata"
  | "derived_from_confirmed_center_and_mpp"
  | "derived_from_dsm_bbox_and_static_mpp"
  | "derived_from_raster_bounds"
  | "derived_rejected_consistency_failure"
  | "missing";

/** Operator-facing policy tag emitted when bounds are derived from raster footprint. */
export const DSM_DERIVED_TRANSFORM_POLICY_VERSION =
  "dsm-registration-derived-bounds-v1";

/** Alias used by the dsm-registration-transform-v1 diagnostic surface. */
export type DsmTileBoundsSource = DsmBoundsSource;

export type DsmSizeSource =
  | "decoded_dsm_grid"
  | "dsm_coordinate_match.dsm_bbox"
  | "roof_mask_grid"
  | "missing";

export interface DsmRegistrationInput {
  dsm_loaded: boolean;
  mask_loaded?: boolean;
  /** Decoded DSM grid (DSMGrid shape). */
  effectiveDSM?: {
    width?: number;
    height?: number;
    bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
    resolution?: number | null;
    /** Optional reason the GeoTIFF decoder could not derive bounds. */
    bounds_failure?: string | null;
  } | null;
  /** Roof mask grid (RoofMask shape). */
  roofMask?: {
    width?: number;
    height?: number;
    bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
  } | null;
  /** dsm_coordinate_match debug bag — may carry dsm_bbox dims. */
  dsmCoordinateMatchDebug?: { dsm_bbox?: { width?: number; height?: number } | null } | null;
  /** Confirmed roof center used for derivation. */
  confirmedCenterLatLng?: LatLng | null;
  /** Raster (static map) meters-per-pixel — used only as last-resort mpp. */
  rasterMetersPerPixel?: number | null;
  /**
   * When false (default), derivation branches do NOT silently substitute
   * raster bounds / mpp for DSM bounds. The result will leave
   * `dsm_tile_bounds_lat_lng=null` and push the specific failure token
   * `dsm_tile_bounds_missing_from_google_solar_metadata`. Callers that want
   * the legacy approximate behavior must explicitly opt in.
   */
  allow_derived_bounds?: boolean;
  /**
   * Raster (static map) geographic bounds — when present alongside
   * raster size and DSM size, enables the `derived_from_raster_bounds`
   * fallback. Only honored when `allow_derived_bounds === true` and the
   * Google Solar metadata branch did not produce bounds.
   */
  rasterBoundsLatLng?: Bounds | null;
  rasterSizePx?: SizePx | null;
}

export interface DsmRegistrationResult {
  dsm_registration_version: typeof DSM_REGISTRATION_VERSION;
  dsm_registration_source: "google_solar_data_layers";
  dsm_stage_attempted: boolean;
  dsm_stage_pending: boolean;

  dsm_size_px: SizePx | null;
  dsm_size_source: DsmSizeSource;

  dsm_tile_bounds_lat_lng: Bounds | null;
  dsm_bounds_source: DsmBoundsSource;
  /** Same value as `dsm_bounds_source`; exposed under the dsm-registration-transform-v1 name. */
  dsm_tile_bounds_source: DsmTileBoundsSource;
  dsm_bounds_derived: boolean;
  dsm_bounds_warning: string | null;
  dsm_bounds_confidence: number; // 0..1
  dsm_meters_per_pixel: number | null;
  dsm_mpp_source: "decoded_dsm_grid" | "derived_from_static_raster" | "missing";

  /** Reason surfaced from the GeoTIFF decoder when bounds were unavailable. */
  dsm_tile_bounds_failure_reason: string | null;

  /** Specific failure tokens for the classifier (priority-ordered upstream). */
  failure_tokens: string[];
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function asLL(b: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null | undefined): Bounds | null {
  if (!b || !isNum(b.minLat) || !isNum(b.maxLat) || !isNum(b.minLng) || !isNum(b.maxLng)) return null;
  return { sw: { lat: b.minLat, lng: b.minLng }, ne: { lat: b.maxLat, lng: b.maxLng } };
}

const METRES_PER_DEG_LAT = 111320;

function deriveBoundsFromCenterAndMpp(
  center: LatLng,
  size: SizePx,
  mppMetres: number,
): Bounds | null {
  if (!isNum(center.lat) || !isNum(center.lng)) return null;
  if (!isNum(size.width) || !isNum(size.height) || size.width <= 0 || size.height <= 0) return null;
  if (!isNum(mppMetres) || mppMetres <= 0) return null;
  const halfWidthM = (size.width / 2) * mppMetres;
  const halfHeightM = (size.height / 2) * mppMetres;
  const metresPerDegLng = METRES_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180);
  if (metresPerDegLng <= 0) return null;
  const dLat = halfHeightM / METRES_PER_DEG_LAT;
  const dLng = halfWidthM / metresPerDegLng;
  return {
    sw: { lat: center.lat - dLat, lng: center.lng - dLng },
    ne: { lat: center.lat + dLat, lng: center.lng + dLng },
  };
}

export function buildDsmRegistration(input: DsmRegistrationInput): DsmRegistrationResult {
  const failure_tokens: string[] = [];
  const dsmLoaded = input.dsm_loaded === true;
  const maskLoaded = input.mask_loaded === true;
  const attempted = dsmLoaded || maskLoaded;

  // ── DSM size ─────────────────────────────────────────────
  let dsm_size_px: SizePx | null = null;
  let dsm_size_source: DsmSizeSource = "missing";
  if (input.effectiveDSM && isNum(input.effectiveDSM.width) && isNum(input.effectiveDSM.height)) {
    dsm_size_px = { width: input.effectiveDSM.width, height: input.effectiveDSM.height };
    dsm_size_source = "decoded_dsm_grid";
  } else if (
    input.dsmCoordinateMatchDebug?.dsm_bbox &&
    isNum(input.dsmCoordinateMatchDebug.dsm_bbox.width) &&
    isNum(input.dsmCoordinateMatchDebug.dsm_bbox.height)
  ) {
    dsm_size_px = {
      width: input.dsmCoordinateMatchDebug.dsm_bbox.width,
      height: input.dsmCoordinateMatchDebug.dsm_bbox.height,
    };
    dsm_size_source = "dsm_coordinate_match.dsm_bbox";
  } else if (input.roofMask && isNum(input.roofMask.width) && isNum(input.roofMask.height)) {
    dsm_size_px = { width: input.roofMask.width, height: input.roofMask.height };
    dsm_size_source = "roof_mask_grid";
  }
  if (attempted && !dsm_size_px) failure_tokens.push("dsm_size_missing");

  // ── DSM mpp ─────────────────────────────────────────────
  let dsm_meters_per_pixel: number | null = null;
  let dsm_mpp_source: DsmRegistrationResult["dsm_mpp_source"] = "missing";
  if (isNum(input.effectiveDSM?.resolution ?? NaN)) {
    dsm_meters_per_pixel = input.effectiveDSM!.resolution!;
    dsm_mpp_source = "decoded_dsm_grid";
  } else if (isNum(input.rasterMetersPerPixel ?? NaN)) {
    dsm_meters_per_pixel = input.rasterMetersPerPixel!;
    dsm_mpp_source = "derived_from_static_raster";
  }

  // ── DSM bounds (priority-ordered) ───────────────────────
  let dsm_tile_bounds_lat_lng: Bounds | null = null;
  let dsm_bounds_source: DsmBoundsSource = "missing";
  let dsm_bounds_derived = false;
  let dsm_bounds_warning: string | null = null;
  let dsm_bounds_confidence = 0;

  const allowDerived = input.allow_derived_bounds === true;
  const fromMetadata = asLL(input.effectiveDSM?.bounds ?? null) ?? asLL(input.roofMask?.bounds ?? null);
  if (fromMetadata) {
    dsm_tile_bounds_lat_lng = fromMetadata;
    dsm_bounds_source = "google_solar_metadata";
    dsm_bounds_confidence = 1.0;
  } else if (
    allowDerived &&
    input.confirmedCenterLatLng &&
    dsm_size_px &&
    isNum(dsm_meters_per_pixel ?? NaN) &&
    dsm_mpp_source === "decoded_dsm_grid"
  ) {
    const derived = deriveBoundsFromCenterAndMpp(input.confirmedCenterLatLng, dsm_size_px, dsm_meters_per_pixel!);
    if (derived) {
      dsm_tile_bounds_lat_lng = derived;
      dsm_bounds_source = "derived_from_confirmed_center_and_mpp";
      dsm_bounds_derived = true;
      dsm_bounds_warning = "derived_bounds_lower_confidence";
      dsm_bounds_confidence = 0.7;
    }
  } else if (
    allowDerived &&
    input.confirmedCenterLatLng &&
    dsm_size_px &&
    isNum(input.rasterMetersPerPixel ?? NaN)
  ) {
    const derived = deriveBoundsFromCenterAndMpp(input.confirmedCenterLatLng, dsm_size_px, input.rasterMetersPerPixel!);
    if (derived) {
      dsm_tile_bounds_lat_lng = derived;
      dsm_bounds_source = "derived_from_dsm_bbox_and_static_mpp";
      dsm_bounds_derived = true;
      dsm_bounds_warning = "derived_bounds_lower_confidence";
      dsm_bounds_confidence = 0.4;
    }
  }

  const decodedButBoundsMissing =
    !!(input.effectiveDSM && (isNum(input.effectiveDSM.width) || isNum(input.effectiveDSM.height))) &&
    !fromMetadata;
  const dsm_tile_bounds_failure_reason: string | null = !dsm_tile_bounds_lat_lng
    ? (input.effectiveDSM?.bounds_failure ?? (decodedButBoundsMissing ? "google_solar_metadata_missing_bounds" : null))
    : null;

  if (attempted && !dsm_tile_bounds_lat_lng) {
    // Prefer the specific token when DSM was actually decoded but Google Solar
    // metadata didn't carry usable tiepoints / ModelTransformation bounds.
    if (decodedButBoundsMissing || dsm_tile_bounds_failure_reason) {
      failure_tokens.push("dsm_tile_bounds_missing_from_google_solar_metadata");
    } else {
      failure_tokens.push("dsm_bounds_missing");
    }
  }

  return {
    dsm_registration_version: DSM_REGISTRATION_VERSION,
    dsm_registration_source: "google_solar_data_layers",
    dsm_stage_attempted: attempted,
    dsm_stage_pending: false,
    dsm_size_px,
    dsm_size_source,
    dsm_tile_bounds_lat_lng,
    dsm_bounds_source,
    dsm_tile_bounds_source: dsm_bounds_source,
    dsm_bounds_derived,
    dsm_bounds_warning,
    dsm_bounds_confidence,
    dsm_meters_per_pixel,
    dsm_mpp_source,
    dsm_tile_bounds_failure_reason,
    failure_tokens,
  };
}
