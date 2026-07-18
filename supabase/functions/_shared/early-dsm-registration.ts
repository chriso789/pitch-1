// ============================================================================
// early-dsm-registration.ts
// ----------------------------------------------------------------------------
// Pure helper that runs the dsm-registration-derived-bounds-v1 path BEFORE
// Phase 3A/3A.5/topology work can consume the CPU budget. This is the
// "early_dsm_registration_before_topology" callsite.
//
// Contract:
//   • Pure: no I/O, never throws.
//   • Idempotent: gating-failure returns { success: false, skipped_reason }.
//   • Reuses already-tested helpers (buildDsmRegistration,
//     buildRegistrationTransformPackage, computeRasterDsmRoundtripErrorPx).
//   • Does NOT change any DSM math.
//
// On success the returned `fields` object is the canonical v1 diagnostic
// surface that the caller stashes into the runtime geometry payload and
// merges into any CPU-preempt terminal failure debug bag so the derived
// transform is never silently dropped.
// ============================================================================

import {
  buildDsmRegistration,
  type DsmRegistrationResult,
} from "./dsm-registration.ts";
import {
  buildRegistrationTransformPackage,
  type Bounds,
  type LatLng,
  type Px,
  type SizePx,
  type RasterTransform,
} from "./source-registration-transform.ts";
import {
  computeRasterDsmRoundtripErrorPx,
  DSM_DERIVED_BOUNDS_RUNTIME_VERSION,
  DSM_RASTER_ROUNDTRIP_THRESHOLD_PX,
} from "./dsm-derived-bounds-runtime.ts";

export const EARLY_DSM_REGISTRATION_CALLSITE =
  "early_dsm_registration_before_topology";

export interface EarlyDsmRegistrationInput {
  /** True once Google Solar DSM (or masked DSM) is decoded into memory. */
  dsm_loaded: boolean;
  /** DSM grid size in pixels (e.g. Fonsica = 998x998). */
  dsm_size_px: SizePx | null;
  /** DSM meters per pixel from the decoded DSM grid (preferred). */
  dsm_meters_per_pixel: number | null;
  /** Raster (static map) geographic bounds. */
  raster_bounds_lat_lng: Bounds | null;
  /** Raster size in pixels (e.g. Fonsica = 1280x1280). */
  raster_size_px: SizePx | null;
  /** Raster (static map) meters per pixel — fallback mpp. */
  raster_meters_per_pixel: number | null;
  /** Existing geo→raster transform (must be present). */
  geo_to_raster_transform: RasterTransform | null;
  /** "ok" / "raster_outside_dsm" / etc. */
  frame_mismatch: string | null;
  /** target_mask_overlap_with_perimeter; gate requires >= 0.90. */
  target_mask_overlap_with_perimeter: number | null;
  /** Whether a selected perimeter / target mask is present. */
  selected_perimeter_present: boolean;
  /** Confirmed roof center used for derivation. */
  confirmed_roof_center_lat_lng: LatLng | null;
  /** Static map center (geocode). */
  static_map_center_lat_lng: LatLng | null;
  /** Static map zoom (default 19). */
  zoom?: number | null;
  /** Logical image size (default 640x640). */
  logical_image_size?: SizePx | null;
  /** Static map scale (default 2). */
  scale?: number | null;
  /** dsm_coordinate_match debug bag — may carry dsm_bbox dims. */
  dsmCoordinateMatchDebug?:
    | { dsm_bbox?: { width?: number; height?: number } | null }
    | null;
  /** Decoded DSM grid (for buildDsmRegistration evidence). */
  effectiveDSM?: any;
  /** Roof mask grid (for buildDsmRegistration evidence). */
  roofMask?: any;
  mask_loaded?: boolean;
}

export type EarlyDsmSkippedReason =
  | "dsm_not_loaded"
  | "dsm_size_px_missing"
  | "raster_bounds_missing"
  | "raster_size_px_missing"
  | "geo_to_raster_transform_missing"
  | "frame_mismatch_not_ok"
  | "selected_perimeter_missing"
  | "target_mask_overlap_below_gate"
  | "confirmed_roof_center_missing"
  | "derived_bounds_not_produced"
  | "derived_rejected_validation_failure"
  | "derived_rejected_consistency_failure";

export interface EarlyDsmRegistrationSuccess {
  success: true;
  callsite: typeof EARLY_DSM_REGISTRATION_CALLSITE;
  /** Canonical v1 diagnostic surface for stashing on geometry + preempt bag. */
  fields: {
    dsm_bounds_derived: true;
    dsm_tile_bounds_source: "derived_from_raster_bounds";
    dsm_bounds_source: "derived_from_raster_bounds";
    dsm_tile_bounds_lat_lng: Bounds;
    dsm_size_px: SizePx;
    dsm_meters_per_pixel: number | null;
    geo_to_dsm_transform: any;
    dsm_to_raster_transform: any;
    confirmed_roof_center_dsm_px: Px | null;
    geo_to_dsm_px_success: true;
    dsm_pixel_transform_valid: true;
    dsm_tile_bounds_contain_confirmed_center: true;
    derived_bounds_enabled: true;
    derived_bounds_policy: typeof DSM_DERIVED_BOUNDS_RUNTIME_VERSION;
    derived_bounds_validation_passed: true;
    derived_bounds_validation_failures: [];
    dsm_raster_roundtrip_error_px: number;
    dsm_validation_status: {
      available: true;
      reason: "derived_bounds_validated";
    };
    dsm_registration_callsite: typeof EARLY_DSM_REGISTRATION_CALLSITE;
    dsm_bounds_warning:
      | "google_solar_dsm_bounds_missing_using_raster_bounds_fallback";
  };
  /** Full transform package — caller overwrites hoistedTransformPackage. */
  transformPackage: any;
  rasterBoundsLatLng: Bounds;
  geoToRasterTransform: RasterTransform;
  confirmedRoofCenterPx: Px | null;
  /** Underlying DSM registration result for downstream diagnostics. */
  dsmRegistration: DsmRegistrationResult;
}

export interface EarlyDsmRegistrationSkipped {
  success: false;
  callsite: typeof EARLY_DSM_REGISTRATION_CALLSITE;
  skipped_reason: EarlyDsmSkippedReason;
  /** Always-emitted diagnostic surface so failure reasons are queryable. */
  fields: {
    dsm_bounds_derived: false;
    derived_bounds_enabled: false;
    derived_bounds_policy: typeof DSM_DERIVED_BOUNDS_RUNTIME_VERSION;
    derived_bounds_validation_passed: false;
    derived_bounds_validation_failures: EarlyDsmSkippedReason[];
    dsm_registration_callsite_attempted: typeof EARLY_DSM_REGISTRATION_CALLSITE;
    dsm_registration_callsite_skipped_reason: EarlyDsmSkippedReason;
  };
}

export type EarlyDsmRegistrationResult =
  | EarlyDsmRegistrationSuccess
  | EarlyDsmRegistrationSkipped;

function skip(
  reason: EarlyDsmSkippedReason,
): EarlyDsmRegistrationSkipped {
  return {
    success: false,
    callsite: EARLY_DSM_REGISTRATION_CALLSITE,
    skipped_reason: reason,
    fields: {
      dsm_bounds_derived: false,
      derived_bounds_enabled: false,
      derived_bounds_policy: DSM_DERIVED_BOUNDS_RUNTIME_VERSION,
      derived_bounds_validation_passed: false,
      derived_bounds_validation_failures: [reason],
      dsm_registration_callsite_attempted: EARLY_DSM_REGISTRATION_CALLSITE,
      dsm_registration_callsite_skipped_reason: reason,
    },
  };
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function runEarlyDerivedDsmRegistration(
  inp: EarlyDsmRegistrationInput,
): EarlyDsmRegistrationResult {
  try {
    // ── Gate inputs ───────────────────────────────────────────────────
    if (!inp.dsm_loaded) return skip("dsm_not_loaded");
    if (
      !inp.dsm_size_px || !isNum(inp.dsm_size_px.width) ||
      !isNum(inp.dsm_size_px.height) ||
      inp.dsm_size_px.width <= 0 || inp.dsm_size_px.height <= 0
    ) return skip("dsm_size_px_missing");
    if (!inp.raster_bounds_lat_lng) return skip("raster_bounds_missing");
    if (
      !inp.raster_size_px || !isNum(inp.raster_size_px.width) ||
      !isNum(inp.raster_size_px.height) ||
      inp.raster_size_px.width <= 0 || inp.raster_size_px.height <= 0
    ) return skip("raster_size_px_missing");
    if (!inp.geo_to_raster_transform) {
      return skip("geo_to_raster_transform_missing");
    }
    if (inp.frame_mismatch !== "ok") return skip("frame_mismatch_not_ok");
    if (!inp.selected_perimeter_present) {
      return skip("selected_perimeter_missing");
    }
    if (
      !isNum(inp.target_mask_overlap_with_perimeter ?? NaN) ||
      (inp.target_mask_overlap_with_perimeter as number) < 0.90
    ) return skip("target_mask_overlap_below_gate");
    if (!inp.confirmed_roof_center_lat_lng) {
      return skip("confirmed_roof_center_missing");
    }

    // ── buildDsmRegistration with allow_derived_bounds: true ─────────
    const dsmReg = buildDsmRegistration({
      dsm_loaded: true,
      mask_loaded: !!inp.mask_loaded,
      effectiveDSM: inp.effectiveDSM ?? null,
      roofMask: inp.roofMask ?? null,
      dsmCoordinateMatchDebug: inp.dsmCoordinateMatchDebug ?? null,
      confirmedCenterLatLng: inp.confirmed_roof_center_lat_lng,
      rasterMetersPerPixel: inp.raster_meters_per_pixel ?? null,
      allow_derived_bounds: true,
      rasterBoundsLatLng: inp.raster_bounds_lat_lng,
      rasterSizePx: inp.raster_size_px,
    });

    // Accept any authoritative or derived bounds source that produced a valid
    // tile bounds + size. Historically this early gate only allowed
    // "derived_from_raster_bounds" which caused runs with actual Google Solar
    // GeoTIFF metadata OR the new OpenTopography (USGS 3DEP) fallback to be
    // rejected here and short-circuit into perimeter_only, even though the
    // bounds are strictly better than the derived fallback.
    const ACCEPTED_EARLY_BOUNDS_SOURCES = new Set([
      "derived_from_raster_bounds",
      "google_solar_metadata",
      "opentopography_usgs_3dep_1m",
      "opentopography_usgs_3dep_10m",
      "opentopography_srtm_gl1",
    ]);
    if (
      !ACCEPTED_EARLY_BOUNDS_SOURCES.has(dsmReg.dsm_bounds_source as string) ||
      !dsmReg.dsm_tile_bounds_lat_lng ||
      !dsmReg.dsm_size_px
    ) {
      const r = skip("derived_bounds_not_produced");
      (r.fields as any).dsm_bounds_source_actual = dsmReg.dsm_bounds_source;
      (r.fields as any).dsm_tile_bounds_lat_lng_present =
        !!dsmReg.dsm_tile_bounds_lat_lng;
      (r.fields as any).dsm_size_px_present_in_inner = !!dsmReg.dsm_size_px;
      (r.fields as any).derived_bounds_debug =
        (dsmReg as any).derived_bounds_debug ?? null;
      return r;
    }
    const _acceptedBoundsSource = dsmReg.dsm_bounds_source as string;

    // ── buildRegistrationTransformPackage with derived bounds ────────
    const transformPkg = buildRegistrationTransformPackage({
      confirmed_roof_center_lat_lng: inp.confirmed_roof_center_lat_lng,
      static_map_center_lat_lng: inp.static_map_center_lat_lng ??
        inp.confirmed_roof_center_lat_lng,
      zoom: isNum(inp.zoom ?? NaN) ? (inp.zoom as number) : 19,
      size: inp.logical_image_size ?? { width: 640, height: 640 },
      scale: isNum(inp.scale ?? NaN) ? (inp.scale as number) : 2,
      dsm_tile_bounds_lat_lng: dsmReg.dsm_tile_bounds_lat_lng,
      dsm_size_px: dsmReg.dsm_size_px,
      dsm_meters_per_pixel: dsmReg.dsm_meters_per_pixel,
    });

    if (
      !transformPkg ||
      transformPkg.geo_to_dsm_px_success !== true ||
      transformPkg.dsm_pixel_transform_valid !== true ||
      transformPkg.dsm_tile_bounds_contain_confirmed_center !== true
    ) {
      const r = skip("derived_rejected_validation_failure");
      (r.fields as any).transform_package_valid = !!transformPkg;
      (r.fields as any).geo_to_dsm_px_success =
        transformPkg?.geo_to_dsm_px_success ?? false;
      (r.fields as any).dsm_pixel_transform_valid =
        transformPkg?.dsm_pixel_transform_valid ?? false;
      (r.fields as any).dsm_tile_bounds_contain_confirmed_center =
        transformPkg?.dsm_tile_bounds_contain_confirmed_center ?? false;
      (r.fields as any).derived_bounds_debug =
        (dsmReg as any).derived_bounds_debug ?? null;
      return r;
    }

    // ── Roundtrip consistency check (raster → geo → DSM → raster) ────
    const startPx: Px = [
      inp.raster_size_px.width / 2,
      inp.raster_size_px.height / 2,
    ];
    const roundtrip = computeRasterDsmRoundtripErrorPx({
      start_raster_px: startPx,
      geo_to_raster_transform: inp.geo_to_raster_transform,
      geo_to_dsm_transform: transformPkg.geo_to_dsm_transform,
      dsm_to_raster_transform: transformPkg.dsm_to_raster_transform,
    });
    if (
      roundtrip == null ||
      roundtrip >= DSM_RASTER_ROUNDTRIP_THRESHOLD_PX
    ) {
      const r = skip("derived_rejected_consistency_failure");
      (r.fields as any).dsm_raster_roundtrip_error_px = roundtrip ?? null;
      (r.fields as any).derived_bounds_debug =
        (dsmReg as any).derived_bounds_debug ?? null;
      return r;
    }


    return {
      success: true,
      callsite: EARLY_DSM_REGISTRATION_CALLSITE,
      fields: {
        dsm_bounds_derived: true,
        dsm_tile_bounds_source: "derived_from_raster_bounds",
        dsm_bounds_source: "derived_from_raster_bounds",
        dsm_tile_bounds_lat_lng: dsmReg.dsm_tile_bounds_lat_lng,
        dsm_size_px: dsmReg.dsm_size_px,
        dsm_meters_per_pixel: dsmReg.dsm_meters_per_pixel,
        geo_to_dsm_transform: transformPkg.geo_to_dsm_transform,
        dsm_to_raster_transform: transformPkg.dsm_to_raster_transform,
        confirmed_roof_center_dsm_px:
          transformPkg.confirmed_roof_center_dsm_px ?? null,
        geo_to_dsm_px_success: true,
        dsm_pixel_transform_valid: true,
        dsm_tile_bounds_contain_confirmed_center: true,
        derived_bounds_enabled: true,
        derived_bounds_policy: DSM_DERIVED_BOUNDS_RUNTIME_VERSION,
        derived_bounds_validation_passed: true,
        derived_bounds_validation_failures: [],
        dsm_raster_roundtrip_error_px: roundtrip,
        dsm_validation_status: {
          available: true,
          reason: "derived_bounds_validated",
        },
        dsm_registration_callsite: EARLY_DSM_REGISTRATION_CALLSITE,
        dsm_bounds_warning:
          "google_solar_dsm_bounds_missing_using_raster_bounds_fallback",
      },
      transformPackage: transformPkg,
      rasterBoundsLatLng: inp.raster_bounds_lat_lng,
      geoToRasterTransform: inp.geo_to_raster_transform,
      confirmedRoofCenterPx:
        (transformPkg as any).confirmed_roof_center_px ?? null,
      dsmRegistration: dsmReg,
    };
  } catch (_e) {
    return skip("derived_rejected_validation_failure");
  }
}

/**
 * Merge the early derived-DSM-registration `fields` into a debug bag without
 * overwriting non-null values that the bag already carries (the early result
 * is the floor, not the ceiling — except for the dsm_validation_status /
 * dsm_registration_callsite tokens which must always reflect the early run).
 */
export function mergeEarlyDsmRegistrationIntoDebug(
  debug: Record<string, unknown> | undefined | null,
  early: EarlyDsmRegistrationResult | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(debug ?? {}) };
  // Always surface gate inputs if the caller attached them (skipped or not).
  const gateInputs = (early as any)?.gate_inputs ?? null;
  if (gateInputs) {
    (out as any).derived_bounds_gate_inputs = gateInputs;
  }
  if (!early || !early.success) {
    if (early && !early.success) {
      (out as any).dsm_registration_callsite_attempted =
        early.fields.dsm_registration_callsite_attempted;
      (out as any).dsm_registration_callsite_skipped_reason =
        early.fields.dsm_registration_callsite_skipped_reason;
      // Diagnostic-only: propagate inner derived-bounds debug + extra
      // skip-path fields so failure cause is visible without code changes.
      const f = early.fields as any;
      const debugExtras: Record<string, unknown> = {
        skip_reason: f.dsm_registration_callsite_skipped_reason,
        dsm_bounds_source_actual: f.dsm_bounds_source_actual ?? null,
        dsm_tile_bounds_lat_lng_present:
          f.dsm_tile_bounds_lat_lng_present ?? null,
        dsm_size_px_present_in_inner: f.dsm_size_px_present_in_inner ?? null,
        transform_package_valid: f.transform_package_valid ?? null,
        geo_to_dsm_px_success: f.geo_to_dsm_px_success ?? null,
        dsm_pixel_transform_valid: f.dsm_pixel_transform_valid ?? null,
        dsm_tile_bounds_contain_confirmed_center:
          f.dsm_tile_bounds_contain_confirmed_center ?? null,
        dsm_raster_roundtrip_error_px:
          f.dsm_raster_roundtrip_error_px ?? null,
        derived_bounds_debug: f.derived_bounds_debug ?? null,
      };
      (out as any).early_dsm_registration = debugExtras;
      if (f.derived_bounds_debug) {
        (out as any).derived_bounds_debug = f.derived_bounds_debug;
      }
    }
    return out;
  }

  const f = early.fields;
  // Authoritative tokens — always overwrite so terminal failure can't drop them.
  (out as any).dsm_bounds_derived = true;
  (out as any).dsm_tile_bounds_source = f.dsm_tile_bounds_source;
  (out as any).dsm_bounds_source = f.dsm_bounds_source;
  (out as any).geo_to_dsm_transform = f.geo_to_dsm_transform;
  (out as any).dsm_to_raster_transform = f.dsm_to_raster_transform;
  (out as any).confirmed_roof_center_dsm_px = f.confirmed_roof_center_dsm_px;
  (out as any).geo_to_dsm_px_success = true;
  (out as any).dsm_pixel_transform_valid = true;
  (out as any).dsm_tile_bounds_contain_confirmed_center = true;
  (out as any).derived_bounds_enabled = true;
  (out as any).derived_bounds_policy = f.derived_bounds_policy;
  (out as any).derived_bounds_validation_passed = true;
  (out as any).derived_bounds_validation_failures = [];
  (out as any).dsm_raster_roundtrip_error_px = f.dsm_raster_roundtrip_error_px;
  (out as any).dsm_validation_status = f.dsm_validation_status;
  (out as any).dsm_registration_callsite = f.dsm_registration_callsite;
  (out as any).dsm_tile_bounds_lat_lng = (out as any).dsm_tile_bounds_lat_lng ??
    f.dsm_tile_bounds_lat_lng;
  (out as any).dsm_size_px = (out as any).dsm_size_px ?? f.dsm_size_px;
  (out as any).dsm_meters_per_pixel = (out as any).dsm_meters_per_pixel ??
    f.dsm_meters_per_pixel;
  (out as any).dsm_bounds_warning = (out as any).dsm_bounds_warning ??
    f.dsm_bounds_warning;
  return out;
}

