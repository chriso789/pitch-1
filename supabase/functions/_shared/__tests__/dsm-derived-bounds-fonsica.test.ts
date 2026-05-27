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

Deno.test(
  "Roundtrip failure: misaligned raster bounds → derivation rejected with token",
  () => {
    const CENTER = { lat: 27.0820246, lng: -82.1962156 };
    const DSM_SIZE = { width: 998, height: 998 };
    const RASTER_SIZE = { width: 1280, height: 1280 };
    // Misaligned: raster bounds shifted far from where the static-map
    // builder would place them for CENTER+zoom20+scale2, so the derived
    // DSM↔raster transforms disagree and roundtrip explodes.
    const SHIFTED_RASTER_BOUNDS = {
      sw: { lat: 27.0700, lng: -82.2100 },
      ne: { lat: 27.0900, lng: -82.1900 },
    };
    const dsmReg = buildDsmRegistration({
      dsm_loaded: true,
      effectiveDSM: {
        width: DSM_SIZE.width,
        height: DSM_SIZE.height,
        bounds: null,
        resolution: null,
      },
      confirmedCenterLatLng: CENTER,
      rasterMetersPerPixel: 0.149,
      allow_derived_bounds: true,
      rasterBoundsLatLng: SHIFTED_RASTER_BOUNDS,
      rasterSizePx: RASTER_SIZE,
    });
    assertEquals(dsmReg.dsm_bounds_source, "derived_from_raster_bounds");

    // Build the transform package using static-map zoom/scale that the
    // runtime would use — yields raster bounds that DIFFER from
    // SHIFTED_RASTER_BOUNDS, so the roundtrip carries a large error.
    const transformPkg = buildRegistrationTransformPackage({
      confirmed_roof_center_lat_lng: CENTER,
      static_map_center_lat_lng: CENTER,
      zoom: 20,
      size: { width: 640, height: 640 },
      scale: 2,
      dsm_tile_bounds_lat_lng: dsmReg.dsm_tile_bounds_lat_lng,
      dsm_size_px: dsmReg.dsm_size_px,
      dsm_meters_per_pixel: dsmReg.dsm_meters_per_pixel,
    });

    const startPx = transformPkg.confirmed_roof_center_px ??
      [transformPkg.raster_size_px!.width / 2, transformPkg.raster_size_px!.height / 2];
    const err = computeRasterDsmRoundtripErrorPx({
      start_raster_px: startPx as [number, number],
      geo_to_raster_transform: transformPkg.geo_to_raster_transform,
      geo_to_dsm_transform: transformPkg.geo_to_dsm_transform,
      dsm_to_raster_transform: transformPkg.dsm_to_raster_transform,
    });

    // The misalignment must blow past the 8px threshold.
    assert(err !== null);
    assert(
      err! > DSM_RASTER_ROUNDTRIP_THRESHOLD_PX,
      `expected roundtrip error > ${DSM_RASTER_ROUNDTRIP_THRESHOLD_PX}, got ${err}`,
    );

    // Simulate the hoist's rejection block on this failure.
    const failures = ["dsm_raster_roundtrip_exceeds_threshold"];
    const rejected = {
      dsm_tile_bounds_source: "derived_rejected_consistency_failure",
      derived_bounds_validation_failures: failures,
      derived_bounds_validation_passed: false,
      dsm_hoist_failure_tokens: [
        "dsm_derived_bounds_rejected_dsm_raster_roundtrip_exceeds_threshold",
        "dsm_tile_bounds_missing_from_google_solar_metadata",
      ],
    };
    assertEquals(
      rejected.dsm_tile_bounds_source,
      "derived_rejected_consistency_failure",
    );
    assert(
      rejected.derived_bounds_validation_failures.includes(
        "dsm_raster_roundtrip_exceeds_threshold",
      ),
    );
    assert(
      rejected.dsm_hoist_failure_tokens.includes(
        "dsm_tile_bounds_missing_from_google_solar_metadata",
      ),
    );
  },
);
