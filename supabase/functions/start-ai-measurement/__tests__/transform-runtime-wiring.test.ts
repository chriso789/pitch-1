// Transform Runtime Wiring v1 — regression tests proving that the persisted
// registration block carries real Web-Mercator math (not nulls) when the
// builder is called, and that the gate consumes those values directly.
//
// These tests target the pure pieces (buildRegistrationTransformPackage +
// evaluateRegistrationGate) wired exactly the way start-ai-measurement wires
// them at the candidate_final site. If either contract drifts, the persisted
// Fonsica row will go back to all-null transforms and these tests fail.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRegistrationTransformPackage,
  SOURCE_REGISTRATION_TRANSFORM_VERSION,
} from "../../_shared/source-registration-transform.ts";
import { evaluateRegistrationGate } from "../../_shared/registration-gate.ts";

const FONSICA = { lat: 27.9506, lng: -82.4572 };

Deno.test("happy path: confirmed center projects to raster centre and gate fields are non-null", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: FONSICA,
    static_map_center_lat_lng: FONSICA,
    zoom: 20,
    size: { width: 640, height: 640 },
    scale: 2,
    dsm_tile_bounds_lat_lng: {
      sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
      ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
    },
    dsm_size_px: { width: 256, height: 256 },
    dsm_meters_per_pixel: 0.5,
  });
  assertEquals(pkg.version, SOURCE_REGISTRATION_TRANSFORM_VERSION);
  assert(pkg.confirmed_roof_center_px, "confirmed_roof_center_px must be populated");
  assert(pkg.geo_to_raster_transform, "geo_to_raster_transform must be populated");
  assert(pkg.raster_bounds_lat_lng, "raster_bounds_lat_lng must be populated");
  assert(pkg.geo_to_dsm_transform, "geo_to_dsm_transform must be populated");
  assert(pkg.dsm_to_raster_transform, "dsm_to_raster_transform must be populated");
  assert(pkg.confirmed_roof_center_dsm_px, "confirmed_roof_center_dsm_px must be populated");
  // Centre of 640x640@scale2 raster is (640,640).
  const [x, y] = pkg.confirmed_roof_center_px!;
  assert(Math.abs(x - 640) < 1, `expected x≈640 got ${x}`);
  assert(Math.abs(y - 640) < 1, `expected y≈640 got ${y}`);
  assertEquals(pkg.raster_bounds_contain_confirmed_center, true);
  assertEquals(pkg.geo_to_dsm_px_success, true);
  assertEquals(pkg.dsm_pixel_transform_valid, true);
  assertEquals(pkg.transform_package_valid, true);
  assertEquals(pkg.missing_required_fields.length, 0);
});

Deno.test("missing static-map size leaves transforms null and gate fails coordinate_registration_failed", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: FONSICA,
    static_map_center_lat_lng: FONSICA,
    zoom: 20,
    // size missing
    scale: 2,
  } as any);
  assertEquals(pkg.transform_package_valid, false);
  assertEquals(pkg.confirmed_roof_center_px, null);
  assertEquals(pkg.geo_to_raster_transform, null);
  assertEquals(pkg.raster_bounds_lat_lng, null);
  assert(pkg.missing_required_fields.includes("raster_bounds_lat_lng"));
  assert(pkg.missing_required_fields.includes("confirmed_roof_center_px"));

  const result = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: pkg.confirmed_roof_center_px ?? null,
    geo_to_raster_transform: pkg.geo_to_raster_transform ?? null,
    geo_to_dsm_transform: pkg.geo_to_dsm_transform ?? null,
    dsm_to_raster_transform: pkg.dsm_to_raster_transform ?? null,
    raster_bounds_lat_lng: pkg.raster_bounds_lat_lng ?? null,
    dsm_tile_bounds_lat_lng: pkg.dsm_tile_bounds_lat_lng ?? null,
    geo_to_dsm_px_success: pkg.geo_to_dsm_px_success === true,
    dsm_pixel_transform_valid: pkg.dsm_pixel_transform_valid === true,
    selected_candidate_polygon_px: null,
  });
  assert(result.failure, "gate must fail when transform package is invalid");
  assertEquals(result.coordinate_registration_gate_passed, false);
  assertEquals(result.failure?.result_state, "ai_failed_source_acquisition");
  assertEquals(result.failure?.hard_fail_reason, "coordinate_registration_failed");
});

Deno.test("gate passes only when candidate polygon contains confirmed centre", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: FONSICA,
    static_map_center_lat_lng: FONSICA,
    zoom: 20,
    size: { width: 640, height: 640 },
    scale: 2,
    dsm_tile_bounds_lat_lng: {
      sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
      ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
    },
    dsm_size_px: { width: 256, height: 256 },
    dsm_meters_per_pixel: 0.5,
  });
  const [cx, cy] = pkg.confirmed_roof_center_px!;
  // Candidate polygon containing the centre.
  const containing: [number, number][] = [
    [cx - 100, cy - 100], [cx + 100, cy - 100], [cx + 100, cy + 100], [cx - 100, cy + 100],
  ];
  const result = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: pkg.confirmed_roof_center_px,
    geo_to_raster_transform: pkg.geo_to_raster_transform,
    geo_to_dsm_transform: pkg.geo_to_dsm_transform,
    dsm_to_raster_transform: pkg.dsm_to_raster_transform,
    raster_bounds_lat_lng: pkg.raster_bounds_lat_lng,
    dsm_tile_bounds_lat_lng: pkg.dsm_tile_bounds_lat_lng,
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    selected_candidate_polygon_px: containing,
    footprint_bbox_diagonal_px: 283,
  });
  assertEquals(result.confirmed_center_inside_candidate, true);
  assertEquals(result.coordinate_registration_gate_passed, true);
  assertEquals(result.failure, null);
});

Deno.test("missing selected candidate at final stage hard-fails", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: FONSICA,
    static_map_center_lat_lng: FONSICA,
    zoom: 20,
    size: { width: 640, height: 640 },
    scale: 2,
    dsm_tile_bounds_lat_lng: {
      sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
      ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
    },
    dsm_size_px: { width: 256, height: 256 },
    dsm_meters_per_pixel: 0.5,
  });
  const result = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: pkg.confirmed_roof_center_px,
    geo_to_raster_transform: pkg.geo_to_raster_transform,
    geo_to_dsm_transform: pkg.geo_to_dsm_transform,
    dsm_to_raster_transform: pkg.dsm_to_raster_transform,
    raster_bounds_lat_lng: pkg.raster_bounds_lat_lng,
    dsm_tile_bounds_lat_lng: pkg.dsm_tile_bounds_lat_lng,
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    selected_candidate_polygon_px: null,
  });
  assertEquals(result.coordinate_registration_gate_passed, false);
  assert(result.failure, "final stage must fail without selected candidate");
  const missing = (result.registration as any).missing_required_fields as string[];
  assert(missing.includes("selected_candidate_polygon_px"));
});

Deno.test("must-run preflight: target unconfirmed still builds static transform proof", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: FONSICA,
    static_map_center_lat_lng: FONSICA,
    zoom: 19,
    size: { width: 640, height: 640 },
    scale: 2,
  });
  const result = evaluateRegistrationGate({
    evaluation_stage: "target_preflight",
    user_confirmed_roof_target: false,
    roof_target_admin_override: false,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: pkg.confirmed_roof_center_px,
    geo_to_raster_transform: pkg.geo_to_raster_transform,
    raster_bounds_lat_lng: pkg.raster_bounds_lat_lng,
    raster_size_px: pkg.raster_size_px,
    static_map_center_lat_lng: pkg.static_map_center_lat_lng,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: false,
    dsm_to_raster_transform: null,
  });
  assert(result.failure, "target-unconfirmed preflight may fail, but not with null static transform evidence");
  assert(pkg.confirmed_roof_center_px, "confirmed_roof_center_px must be populated before target failure write");
  assert(pkg.raster_bounds_lat_lng, "raster_bounds_lat_lng must be populated before target failure write");
  assert(pkg.geo_to_raster_transform, "geo_to_raster_transform must be populated before target failure write");
  assertEquals(result.failure?.result_state, "ai_failed_target_unconfirmed");
});

Deno.test("must-run preflight: source acquisition failure before DSM only misses DSM fields", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: FONSICA,
    static_map_center_lat_lng: FONSICA,
    zoom: 19,
    size: { width: 640, height: 640 },
    scale: 2,
  });
  assert(pkg.confirmed_roof_center_px, "static confirmed center px must be populated");
  assert(pkg.geo_to_raster_transform, "static geo→raster transform must be populated");
  assert(pkg.raster_bounds_lat_lng, "static raster bounds must be populated");
  assertEquals(pkg.dsm_tile_bounds_lat_lng, null);
  assertEquals(pkg.geo_to_dsm_transform, null);
  assertEquals(pkg.dsm_to_raster_transform, null);
  const missing = pkg.missing_required_fields;
  assert(!missing.includes("confirmed_roof_center_px"));
  assert(!missing.includes("geo_to_raster_transform"));
  assert(!missing.includes("raster_bounds_lat_lng"));
  assert(missing.includes("dsm_tile_bounds_lat_lng"));
  assert(missing.includes("geo_to_dsm_transform"));
});

Deno.test("must-run preflight: write chokepoint has fallback proof for missing transform builder", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(source.includes("function ensureRegistrationProofBeforeWrite"));
  assert(source.includes("transform_builder_not_called_before_write"));
  assert(source.includes("transform_builder_called: false"));
  assert(source.includes("let safePayload = ensureRegistrationProofBeforeWrite(prepareRoofMeasurementPayload(payload));"));
});
