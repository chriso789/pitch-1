import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDsmRegistration,
  DSM_DERIVED_TRANSFORM_POLICY_VERSION,
} from "../dsm-registration.ts";
import {
  buildRegistrationTransformPackage,
} from "../source-registration-transform.ts";
import {
  computeRasterDsmRoundtripErrorPx,
  DSM_RASTER_ROUNDTRIP_THRESHOLD_PX,
} from "../dsm-derived-bounds-runtime.ts";

// 4063 Fonsica Ave — confirmed roof center
const CENTER = { lat: 27.0820246, lng: -82.1962156 };

// Approximate raster (static map) footprint: 1280×1280 px, ~0.15 m/px.
// Centered on Fonsica, slightly offset so we can prove the SW/NE pass through.
const RASTER_BOUNDS = {
  sw: { lat: 27.0811634, lng: -82.197181 },
  ne: { lat: 27.0828858, lng: -82.1952502 },
};
const RASTER_SIZE = { width: 1280, height: 1280 };
const DSM_SIZE = { width: 998, height: 998 };

Deno.test(
  "Fonsica: missing Solar metadata + raster overlay aligned → derived_from_raster_bounds",
  () => {
    const r = buildDsmRegistration({
      dsm_loaded: true,
      mask_loaded: true,
      // DSM was decoded (size present) but Google Solar metadata didn't
      // carry usable tiepoints / ModelTransformation bounds.
      effectiveDSM: {
        width: DSM_SIZE.width,
        height: DSM_SIZE.height,
        bounds: null,
        resolution: null,
        bounds_failure: "google_solar_metadata_missing_bounds",
      },
      roofMask: null,
      dsmCoordinateMatchDebug: null,
      confirmedCenterLatLng: CENTER,
      rasterMetersPerPixel: 0.15,
      allow_derived_bounds: true,
      rasterBoundsLatLng: RASTER_BOUNDS,
      rasterSizePx: RASTER_SIZE,
    });

    assertEquals(r.dsm_bounds_source, "derived_from_raster_bounds");
    assertEquals(r.dsm_bounds_derived, true);
    assertEquals(r.dsm_bounds_warning, "derived_bounds_lower_confidence");
    assertEquals(r.dsm_bounds_confidence, 0.6);
    assertEquals(r.dsm_size_px, DSM_SIZE);
    assert(r.dsm_tile_bounds_lat_lng !== null);
    assertEquals(r.dsm_tile_bounds_lat_lng?.sw.lat, RASTER_BOUNDS.sw.lat);
    assertEquals(r.dsm_tile_bounds_lat_lng?.ne.lng, RASTER_BOUNDS.ne.lng);
    assert(r.dsm_meters_per_pixel !== null);
    assertEquals(r.dsm_mpp_source, "derived_from_static_raster");
    assert(
      r.failure_tokens.includes("dsm_tile_bounds_derived_from_raster_bounds"),
    );
    assert(
      !r.failure_tokens.includes(
        "dsm_tile_bounds_missing_from_google_solar_metadata",
      ),
      "missing-metadata token must be cleared when derivation succeeds",
    );
    assertEquals(
      DSM_DERIVED_TRANSFORM_POLICY_VERSION,
      "dsm-registration-derived-bounds-v1",
    );
  },
);

Deno.test(
  "Gate: allow_derived_bounds=false keeps the missing-metadata failure token",
  () => {
    const r = buildDsmRegistration({
      dsm_loaded: true,
      effectiveDSM: {
        width: DSM_SIZE.width,
        height: DSM_SIZE.height,
        bounds: null,
        resolution: null,
      },
      confirmedCenterLatLng: CENTER,
      rasterMetersPerPixel: 0.15,
      allow_derived_bounds: false,
      rasterBoundsLatLng: RASTER_BOUNDS,
      rasterSizePx: RASTER_SIZE,
    });
    assertEquals(r.dsm_tile_bounds_lat_lng, null);
    assertEquals(r.dsm_bounds_derived, false);
    assert(
      r.failure_tokens.includes(
        "dsm_tile_bounds_missing_from_google_solar_metadata",
      ),
    );
  },
);

Deno.test(
  "Gate: missing rasterBoundsLatLng → derivation skipped",
  () => {
    const r = buildDsmRegistration({
      dsm_loaded: true,
      effectiveDSM: {
        width: DSM_SIZE.width,
        height: DSM_SIZE.height,
        bounds: null,
        resolution: null,
      },
      confirmedCenterLatLng: CENTER,
      rasterMetersPerPixel: 0.15,
      allow_derived_bounds: true,
      rasterBoundsLatLng: null,
      rasterSizePx: RASTER_SIZE,
    });
    assertEquals(r.dsm_bounds_source, "missing");
    assertEquals(r.dsm_tile_bounds_lat_lng, null);
  },
);

Deno.test(
  "Priority: Google Solar metadata bounds beat raster-derived fallback",
  () => {
    const SOLAR_BOUNDS = {
      minLat: 27.0810,
      maxLat: 27.0830,
      minLng: -82.1972,
      maxLng: -82.1952,
    };
    const r = buildDsmRegistration({
      dsm_loaded: true,
      effectiveDSM: {
        width: DSM_SIZE.width,
        height: DSM_SIZE.height,
        bounds: SOLAR_BOUNDS,
        resolution: 0.1,
      },
      confirmedCenterLatLng: CENTER,
      rasterMetersPerPixel: 0.15,
      allow_derived_bounds: true,
      rasterBoundsLatLng: RASTER_BOUNDS,
      rasterSizePx: RASTER_SIZE,
    });
    assertEquals(r.dsm_bounds_source, "google_solar_metadata");
    assertEquals(r.dsm_bounds_derived, false);
    assertEquals(r.dsm_bounds_confidence, 1.0);
  },
);
