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
  | "opentopography_usgs_3dep_1m"
  | "opentopography_usgs_3dep_10m"
  | "opentopography_srtm_gl1"
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
    /** Explicit provenance override for `dsm_bounds_source` (e.g. OpenTopography fallback). */
    bounds_provenance?: DsmBoundsSource | null;
  } | null;
  /** Roof mask grid (RoofMask shape). */
  roofMask?: {
    width?: number;
    height?: number;
    bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
  } | null;
  /**
   * dsm_coordinate_match debug bag — carries dsm_bbox dims and (post-fix)
   * the parsed DSM lat/lng bounds so this shared registration can produce
   * `dsm_tile_bounds_lat_lng` when `effectiveDSM` was not threaded through.
   */
  dsmCoordinateMatchDebug?: {
    dsm_bbox?: {
      width?: number;
      height?: number;
      bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
      bounds_provenance?: DsmBoundsSource | null;
      resolution?: number | null;
    } | null;
  } | null;
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

export type DerivedBoundsDebug = {
  allow_derived_bounds: boolean;
  dsm_size_px_internal: SizePx | null;
  dsm_size_px_internal_source: DsmSizeSource;
  metadata_bounds_present: boolean;
  raster_bounds_input_present: boolean;
  raster_bounds_input_shape:
    | "sw_ne"
    | "north_south_east_west"
    | "object_unknown_shape"
    | "null";
  raster_bounds_input_keys: string[];
  raster_bounds_sw_lat_numeric: boolean;
  raster_bounds_sw_lng_numeric: boolean;
  raster_bounds_ne_lat_numeric: boolean;
  raster_bounds_ne_lng_numeric: boolean;
  raster_size_px_present: boolean;
  raster_size_px_positive: boolean;
  derived_branch_entered:
    | "derived_from_raster_bounds"
    | "derived_from_confirmed_center_and_mpp"
    | "derived_from_dsm_bbox_and_static_mpp"
    | "none";
  derived_branch_skipped_reason:
    | "metadata_bounds_won"
    | "internal_dsm_size_missing"
    | "raster_bounds_shape_mismatch"
    | "raster_size_invalid"
    | "no_confirmed_center"
    | "no_mpp"
    | null;
};

export interface DsmRegistrationResult {
  dsm_registration_version: typeof DSM_REGISTRATION_VERSION;
  dsm_registration_source:
    | "google_solar_data_layers"
    | "opentopography_usgs_3dep_1m"
    | "opentopography_usgs_3dep_10m"
    | "opentopography_srtm_gl1";
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

  /**
   * Diagnostic-only mirror of the derived-bounds branch decision. Populated
   * whenever `allow_derived_bounds === true`. Pure mirror of the same booleans
   * the existing if-statements already evaluate — adds no logic.
   */
  derived_bounds_debug?: DerivedBoundsDebug;
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
  const debugBboxBounds = input.dsmCoordinateMatchDebug?.dsm_bbox?.bounds ?? null;
  const debugBboxProvenance = input.dsmCoordinateMatchDebug?.dsm_bbox?.bounds_provenance ?? null;
  const fromMetadata = asLL(input.effectiveDSM?.bounds ?? null) ??
    asLL(input.roofMask?.bounds ?? null) ??
    asLL(debugBboxBounds);
  if (fromMetadata) {
    dsm_tile_bounds_lat_lng = fromMetadata;
    dsm_bounds_source = input.effectiveDSM?.bounds_provenance ??
      debugBboxProvenance ??
      "google_solar_metadata";
    dsm_bounds_confidence = 1.0;
  }

  // dsm-registration-derived-bounds-v1: when metadata is missing but the
  // raster (static map) overlay is aligned, the raster bounds + size are the
  // highest-confidence stand-in (DSM and Solar static raster share the same
  // Solar tile footprint). Try this BEFORE the looser center+mpp derivations.
  if (
    !dsm_tile_bounds_lat_lng &&
    allowDerived &&
    dsm_size_px &&
    input.rasterBoundsLatLng &&
    isNum(input.rasterBoundsLatLng.sw?.lat) &&
    isNum(input.rasterBoundsLatLng.sw?.lng) &&
    isNum(input.rasterBoundsLatLng.ne?.lat) &&
    isNum(input.rasterBoundsLatLng.ne?.lng) &&
    input.rasterSizePx &&
    isNum(input.rasterSizePx.width) &&
    isNum(input.rasterSizePx.height) &&
    input.rasterSizePx.width > 0 &&
    input.rasterSizePx.height > 0
  ) {
    dsm_tile_bounds_lat_lng = {
      sw: { lat: input.rasterBoundsLatLng.sw.lat, lng: input.rasterBoundsLatLng.sw.lng },
      ne: { lat: input.rasterBoundsLatLng.ne.lat, lng: input.rasterBoundsLatLng.ne.lng },
    };
    dsm_bounds_source = "derived_from_raster_bounds";
    dsm_bounds_derived = true;
    dsm_bounds_warning = "derived_bounds_lower_confidence";
    dsm_bounds_confidence = 0.6;
    // If DSM mpp was unknown, derive it from raster mpp scaled by size ratio.
    if (!isNum(dsm_meters_per_pixel ?? NaN) && isNum(input.rasterMetersPerPixel ?? NaN)) {
      dsm_meters_per_pixel = input.rasterMetersPerPixel! *
        (input.rasterSizePx.width / dsm_size_px.width);
      dsm_mpp_source = "derived_from_static_raster";
    }
    failure_tokens.push("dsm_tile_bounds_derived_from_raster_bounds");
  }

  if (
    !dsm_tile_bounds_lat_lng &&
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
    !dsm_tile_bounds_lat_lng &&
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

  // ── Derived-bounds diagnostic mirror ────────────────────
  // Pure mirror of the same booleans the if-statements above already
  // evaluate. Populated whenever the caller opted into derived bounds.
  let derived_bounds_debug: DerivedBoundsDebug | undefined;
  if (allowDerived) {
    const rb = input.rasterBoundsLatLng as any;
    const rbPresent = rb != null && typeof rb === "object";
    const rbKeys = rbPresent ? Object.keys(rb) : [];
    const looksSwNe =
      rbPresent && rb.sw != null && rb.ne != null;
    const looksNsew =
      rbPresent && (("north" in rb) || ("south" in rb) || ("east" in rb) ||
        ("west" in rb));
    const shape: DerivedBoundsDebug["raster_bounds_input_shape"] = !rbPresent
      ? "null"
      : looksSwNe
      ? "sw_ne"
      : looksNsew
      ? "north_south_east_west"
      : "object_unknown_shape";
    const swLatOk = !!(rbPresent && isNum(rb.sw?.lat));
    const swLngOk = !!(rbPresent && isNum(rb.sw?.lng));
    const neLatOk = !!(rbPresent && isNum(rb.ne?.lat));
    const neLngOk = !!(rbPresent && isNum(rb.ne?.lng));
    const sizePresent = !!(input.rasterSizePx &&
      isNum(input.rasterSizePx.width) && isNum(input.rasterSizePx.height));
    const sizePositive = !!(input.rasterSizePx &&
      (input.rasterSizePx.width ?? 0) > 0 &&
      (input.rasterSizePx.height ?? 0) > 0);

    let entered: DerivedBoundsDebug["derived_branch_entered"] = "none";
    if (dsm_bounds_source === "derived_from_raster_bounds") {
      entered = "derived_from_raster_bounds";
    } else if (dsm_bounds_source === "derived_from_confirmed_center_and_mpp") {
      entered = "derived_from_confirmed_center_and_mpp";
    } else if (dsm_bounds_source === "derived_from_dsm_bbox_and_static_mpp") {
      entered = "derived_from_dsm_bbox_and_static_mpp";
    }

    let skipped: DerivedBoundsDebug["derived_branch_skipped_reason"] = null;
    if (entered === "none") {
      if (fromMetadata) {
        skipped = "metadata_bounds_won";
      } else if (!dsm_size_px) {
        skipped = "internal_dsm_size_missing";
      } else if (
        !rbPresent || shape !== "sw_ne" ||
        !(swLatOk && swLngOk && neLatOk && neLngOk)
      ) {
        // Raster-bounds branch is the first/highest-confidence derivation;
        // a shape/numeric failure there is the most actionable single reason.
        if (rbPresent && (shape !== "sw_ne" || !(swLatOk && swLngOk && neLatOk && neLngOk))) {
          skipped = "raster_bounds_shape_mismatch";
        } else if (!sizePresent || !sizePositive) {
          skipped = "raster_size_invalid";
        } else if (!input.confirmedCenterLatLng) {
          skipped = "no_confirmed_center";
        } else if (!isNum(dsm_meters_per_pixel ?? NaN) && !isNum(input.rasterMetersPerPixel ?? NaN)) {
          skipped = "no_mpp";
        } else {
          skipped = "raster_bounds_shape_mismatch";
        }
      } else if (!sizePresent || !sizePositive) {
        skipped = "raster_size_invalid";
      } else if (!input.confirmedCenterLatLng) {
        skipped = "no_confirmed_center";
      } else if (!isNum(dsm_meters_per_pixel ?? NaN) && !isNum(input.rasterMetersPerPixel ?? NaN)) {
        skipped = "no_mpp";
      }
    }

    derived_bounds_debug = {
      allow_derived_bounds: true,
      dsm_size_px_internal: dsm_size_px,
      dsm_size_px_internal_source: dsm_size_source,
      metadata_bounds_present: !!fromMetadata,
      raster_bounds_input_present: rbPresent,
      raster_bounds_input_shape: shape,
      raster_bounds_input_keys: rbKeys,
      raster_bounds_sw_lat_numeric: swLatOk,
      raster_bounds_sw_lng_numeric: swLngOk,
      raster_bounds_ne_lat_numeric: neLatOk,
      raster_bounds_ne_lng_numeric: neLngOk,
      raster_size_px_present: sizePresent,
      raster_size_px_positive: sizePositive,
      derived_branch_entered: entered,
      derived_branch_skipped_reason: skipped,
    };
  }

  const registrationSource: DsmRegistrationResult["dsm_registration_source"] =
    dsm_bounds_source === "opentopography_usgs_3dep_1m"
      ? "opentopography_usgs_3dep_1m"
      : dsm_bounds_source === "opentopography_usgs_3dep_10m"
      ? "opentopography_usgs_3dep_10m"
      : dsm_bounds_source === "opentopography_srtm_gl1"
      ? "opentopography_srtm_gl1"
      : "google_solar_data_layers";

  return {
    dsm_registration_version: DSM_REGISTRATION_VERSION,
    dsm_registration_source: registrationSource,
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
    ...(derived_bounds_debug ? { derived_bounds_debug } : {}),
  };
}
