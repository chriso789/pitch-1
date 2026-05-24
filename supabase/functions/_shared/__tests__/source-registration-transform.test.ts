import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRasterBoundsFromStaticMap,
  buildRegistrationTransformPackage,
  projectLatLngToRasterPx,
  SOURCE_REGISTRATION_TRANSFORM_VERSION,
  validateRegistrationTransformPackage,
} from "../source-registration-transform.ts";
import { evaluateRegistrationGate } from "../registration-gate.ts";

Deno.test("A: static map transform projects centre to image centre", () => {
  const built = buildRasterBoundsFromStaticMap({
    centerLatLng: { lat: 28.0, lng: -82.5 },
    zoom: 19,
    sizePx: { width: 640, height: 640 },
    scale: 2,
  });
  assert(built, "expected raster bounds to build");
  assertEquals(built!.rasterSizePx, { width: 1280, height: 1280 });
  const t = {
    kind: "web_mercator_static_map" as const,
    bounds: built!.bounds,
    size_px: built!.rasterSizePx,
    zoom: 19,
    meters_per_pixel: built!.metersPerPixel,
  };
  const px = projectLatLngToRasterPx({ lat: 28.0, lng: -82.5 }, t);
  assert(px, "expected pixel projection");
  assert(Math.abs(px![0] - 640) < 2, `x within ±2 of 640, got ${px![0]}`);
  assert(Math.abs(px![1] - 640) < 2, `y within ±2 of 640, got ${px![1]}`);
});

Deno.test("A: full transform package — raster only, confirmed center contained", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: { lat: 28.0, lng: -82.5 },
    static_map_center_lat_lng: { lat: 28.0, lng: -82.5 },
    zoom: 19,
    size: { width: 640, height: 640 },
    scale: 2,
  });
  assertEquals(pkg.version, SOURCE_REGISTRATION_TRANSFORM_VERSION);
  assert(pkg.raster_bounds_lat_lng, "raster bounds present");
  assert(pkg.geo_to_raster_transform, "geo→raster transform present");
  assert(pkg.confirmed_roof_center_px, "confirmed center px present");
  assertEquals(pkg.raster_bounds_contain_confirmed_center, true);
  // DSM absent → package is not fully valid yet, but raster fields populated.
  assert(pkg.missing_required_fields.includes("dsm_tile_bounds_lat_lng"));
  assertEquals(pkg.transform_package_valid, false);
});

Deno.test("B: DSM transform — confirmed center projects inside DSM bounds, overlap with raster", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: { lat: 28.0, lng: -82.5 },
    static_map_center_lat_lng: { lat: 28.0, lng: -82.5 },
    zoom: 19,
    size: { width: 640, height: 640 },
    scale: 2,
    dsm_tile_bounds_lat_lng: {
      sw: { lat: 27.999, lng: -82.501 },
      ne: { lat: 28.001, lng: -82.499 },
    },
    dsm_size_px: { width: 256, height: 256 },
    dsm_meters_per_pixel: 0.5,
  });
  assert(pkg.geo_to_dsm_transform, "geo→dsm present");
  assert(pkg.dsm_to_raster_transform, "dsm→raster present");
  assert(pkg.confirmed_roof_center_dsm_px, "confirmed dsm px present");
  assertEquals(pkg.dsm_tile_bounds_contain_confirmed_center, true);
  assertEquals(pkg.geo_to_dsm_px_success, true);
  assertEquals(pkg.dsm_pixel_transform_valid, true);
  assertEquals(pkg.transform_package_valid, true);
  assertEquals(pkg.missing_required_fields, []);
});

Deno.test("C: missing transform package → gate fails honestly", () => {
  // Bare-minimum inputs — no static map params, no DSM.
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: { lat: 40, lng: -80 },
  });
  assertEquals(pkg.transform_package_valid, false);
  const v = validateRegistrationTransformPackage(pkg);
  assertEquals(v.valid, false);
  assert(pkg.missing_required_fields.includes("geo_to_raster_transform"));
  assert(pkg.missing_required_fields.includes("geo_to_dsm_transform"));

  // Fed into the gate at candidate_final → coordinate_registration_failed.
  const r = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: { lat: 40, lng: -80 },
    confirmed_roof_center_lat_lng: { lat: 40, lng: -80 },
    confirmed_roof_center_px: pkg.confirmed_roof_center_px,
    geo_to_raster_transform: pkg.geo_to_raster_transform,
    geo_to_dsm_transform: pkg.geo_to_dsm_transform,
    dsm_to_raster_transform: pkg.dsm_to_raster_transform,
    raster_bounds_lat_lng: pkg.raster_bounds_lat_lng,
    dsm_tile_bounds_lat_lng: pkg.dsm_tile_bounds_lat_lng,
    selected_candidate_polygon_px: null,
    geo_to_dsm_px_success: pkg.geo_to_dsm_px_success,
    dsm_pixel_transform_valid: pkg.dsm_pixel_transform_valid,
  });
  assertEquals(r.coordinate_registration_gate_passed, false);
  assert(r.failure);
  assertEquals(r.failure!.hard_fail_reason, "coordinate_registration_failed");
});

Deno.test("D: valid transforms but candidate excludes confirmed center → gate fails", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: { lat: 28.0, lng: -82.5 },
    static_map_center_lat_lng: { lat: 28.0, lng: -82.5 },
    zoom: 19,
    size: { width: 640, height: 640 },
    scale: 2,
    dsm_tile_bounds_lat_lng: {
      sw: { lat: 27.999, lng: -82.501 },
      ne: { lat: 28.001, lng: -82.499 },
    },
    dsm_size_px: { width: 256, height: 256 },
  });
  // Build a candidate polygon nowhere near the confirmed centre pixel (~640,640).
  const farPoly: [number, number][] = [[10, 10], [50, 10], [50, 50], [10, 50]];
  const r = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: { lat: 28.0, lng: -82.5 },
    confirmed_roof_center_lat_lng: { lat: 28.0, lng: -82.5 },
    confirmed_roof_center_px: pkg.confirmed_roof_center_px,
    geo_to_raster_transform: pkg.geo_to_raster_transform,
    geo_to_dsm_transform: pkg.geo_to_dsm_transform,
    dsm_to_raster_transform: pkg.dsm_to_raster_transform,
    raster_bounds_lat_lng: pkg.raster_bounds_lat_lng,
    dsm_tile_bounds_lat_lng: pkg.dsm_tile_bounds_lat_lng,
    selected_candidate_polygon_px: farPoly,
    geo_to_dsm_px_success: pkg.geo_to_dsm_px_success,
    dsm_pixel_transform_valid: pkg.dsm_pixel_transform_valid,
  });
  assertEquals(r.confirmed_center_inside_candidate, false);
  assertEquals(r.coordinate_registration_gate_passed, false);
  assert(r.failure);
});
