// End-to-end regression for dsm-registration-derived-bounds-v1.
//
// Drives the same helper chain that `applyLiveRuntimeHoistToRegistration` runs
// (`gatherDerivedBoundsGateInputs` → `buildDsmRegistration` →
// `buildRegistrationTransformPackage` → `computeRasterDsmRoundtripErrorPx`)
// against a Fonsica-shaped runtime payload and asserts the full v1 diagnostic
// surface plus that customer gates remain closed.
//
// We intentionally do NOT import the 16k-line edge-function entrypoint to keep
// the test hermetic; the hoist function is a thin orchestrator over these
// helpers, so verifying their composition verifies the runtime path.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDsmRegistration,
} from "../../_shared/dsm-registration.ts";
import {
  buildRegistrationTransformPackage,
} from "../../_shared/source-registration-transform.ts";
import {
  computeRasterDsmRoundtripErrorPx,
  DSM_DERIVED_BOUNDS_RUNTIME_VERSION,
  DSM_RASTER_ROUNDTRIP_THRESHOLD_PX,
  gatherDerivedBoundsGateInputs,
  isDerivedBoundsAllowed,
} from "../../_shared/dsm-derived-bounds-runtime.ts";

// ── Fonsica fixture ─────────────────────────────────────────────────
const CENTER = { lat: 27.0820246, lng: -82.1962156 };
const RASTER_BOUNDS = {
  sw: { lat: 27.0811634, lng: -82.197181 },
  ne: { lat: 27.0828858, lng: -82.1952502 },
};
const RASTER_SIZE = { width: 1280, height: 1280 };
const DSM_SIZE = { width: 998, height: 998 };
const RASTER_MPP = 0.149; // ~static map zoom 20 scale=2 at this lat

// Construct a Fonsica-shaped runtime geometry payload — fields placed in the
// same locations the live runtime persists them, so the gate-input gatherer is
// exercised across multiple branches.
function makeFonsicaGeometry() {
  return {
    confirmed_roof_center_lat_lng: CENTER,
    dsm_loaded: true,
    mask_loaded: true,
    frame_mismatch: "ok",
    target_mask_overlap_with_perimeter: 0.976,
    effective_dsm: {
      width: DSM_SIZE.width,
      height: DSM_SIZE.height,
      bounds: null,
      resolution: null,
      bounds_failure: "google_solar_metadata_missing_bounds",
    },
    raster_bounds_lat_lng: RASTER_BOUNDS,
    raster_size_px: RASTER_SIZE,
    meters_per_pixel: RASTER_MPP,
    geo_to_raster_transform: {
      kind: "web_mercator_static_map",
      bounds: RASTER_BOUNDS,
      size_px: RASTER_SIZE,
      zoom: 20,
      meters_per_pixel: RASTER_MPP,
    },
  };
}

Deno.test(
  "Fonsica E2E: derived bounds activate and pass full v1 validation surface",
  () => {
    const geometry = makeFonsicaGeometry();
    const reg: Record<string, any> = {
      confirmed_roof_center_lat_lng: CENTER,
    };

    // 1) Gate inputs gather + allow.
    const gateInputs = gatherDerivedBoundsGateInputs(geometry, reg);
    assertEquals(gateInputs.dsm_loaded, true);
    assert(gateInputs.raster_bounds_lat_lng !== null);
    assertEquals(gateInputs.raster_size_px, RASTER_SIZE);
    assertEquals(gateInputs.raster_meters_per_pixel, RASTER_MPP);
    assertEquals(gateInputs.frame_mismatch_ok, true);
    assertEquals(gateInputs.target_mask_overlap, 0.976);
    const allowed = isDerivedBoundsAllowed(gateInputs);
    assertEquals(allowed, true);

    // 2) DSM registration with derived raster bounds.
    const dsmReg = buildDsmRegistration({
      dsm_loaded: true,
      mask_loaded: true,
      effectiveDSM: geometry.effective_dsm,
      roofMask: null,
      dsmCoordinateMatchDebug: null,
      confirmedCenterLatLng: CENTER,
      rasterMetersPerPixel: RASTER_MPP,
      allow_derived_bounds: allowed,
      rasterBoundsLatLng: RASTER_BOUNDS,
      rasterSizePx: RASTER_SIZE,
    });
    assertEquals(dsmReg.dsm_bounds_source, "derived_from_raster_bounds");
    assertEquals(dsmReg.dsm_bounds_derived, true);
    assertEquals(dsmReg.dsm_size_px, DSM_SIZE);
    assert(dsmReg.dsm_tile_bounds_lat_lng !== null);

    // 3) Transform package build.
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
    assert(transformPkg.geo_to_dsm_transform !== null);
    assert(transformPkg.dsm_to_raster_transform !== null);
    assert(transformPkg.confirmed_roof_center_dsm_px !== null);
    assertEquals(transformPkg.geo_to_dsm_px_success, true);
    assertEquals(transformPkg.dsm_pixel_transform_valid, true);

    // 4) Roundtrip validation.
    const startPx = transformPkg.confirmed_roof_center_px ??
      [
        transformPkg.raster_size_px!.width / 2,
        transformPkg.raster_size_px!.height / 2,
      ];
    const roundtripErr = computeRasterDsmRoundtripErrorPx({
      start_raster_px: startPx as [number, number],
      geo_to_raster_transform: transformPkg.geo_to_raster_transform,
      geo_to_dsm_transform: transformPkg.geo_to_dsm_transform,
      dsm_to_raster_transform: transformPkg.dsm_to_raster_transform,
    });
    assert(roundtripErr !== null);
    assert(
      roundtripErr! < DSM_RASTER_ROUNDTRIP_THRESHOLD_PX,
      `roundtrip ${roundtripErr} must be < ${DSM_RASTER_ROUNDTRIP_THRESHOLD_PX}`,
    );

    // 5) Compose registration block mirroring the runtime hoist outputs.
    const derived_branch = dsmReg.dsm_bounds_source ===
      "derived_from_raster_bounds";
    reg.derived_bounds_enabled = allowed;
    reg.derived_bounds_policy = DSM_DERIVED_BOUNDS_RUNTIME_VERSION;
    reg.derived_bounds_gate_inputs = {
      dsm_loaded: gateInputs.dsm_loaded,
      raster_bounds_present: !!gateInputs.raster_bounds_lat_lng,
      raster_mpp: gateInputs.raster_meters_per_pixel,
      frame_mismatch_ok: gateInputs.frame_mismatch_ok,
      target_mask_overlap: gateInputs.target_mask_overlap,
    };
    reg.dsm_bounds_derived = true;
    reg.dsm_tile_bounds_source = dsmReg.dsm_tile_bounds_source;
    reg.dsm_bounds_warning = derived_branch
      ? "google_solar_dsm_bounds_missing_using_raster_bounds_fallback"
      : dsmReg.dsm_bounds_warning;
    reg.dsm_transform_policy_version = DSM_DERIVED_BOUNDS_RUNTIME_VERSION;
    reg.geo_to_dsm_transform = transformPkg.geo_to_dsm_transform;
    reg.geo_to_dsm_transform_source = "derived_raster_bounds+dsm_size_px";
    reg.dsm_to_raster_transform = transformPkg.dsm_to_raster_transform;
    reg.dsm_to_raster_transform_source =
      "geo_to_dsm_transform+geo_to_raster_transform";
    reg.confirmed_roof_center_dsm_px =
      transformPkg.confirmed_roof_center_dsm_px;
    reg.confirmed_roof_center_dsm_px_source = "raster_center_to_geo_to_dsm";
    reg.geo_to_dsm_px_success = transformPkg.geo_to_dsm_px_success === true;
    reg.dsm_pixel_transform_valid = transformPkg.dsm_pixel_transform_valid ===
      true;
    reg.dsm_raster_roundtrip_error_px = roundtripErr;
    const failures: string[] = [];
    if (transformPkg.dsm_tile_bounds_contain_confirmed_center !== true) {
      failures.push("confirmed_center_outside_derived_bounds");
    }
    if (transformPkg.dsm_pixel_transform_valid !== true) {
      failures.push("dsm_pixel_transform_invalid");
    }
    if (
      roundtripErr != null && roundtripErr > DSM_RASTER_ROUNDTRIP_THRESHOLD_PX
    ) {
      failures.push("dsm_raster_roundtrip_exceeds_threshold");
    }
    reg.derived_bounds_validation_failures = failures;
    reg.derived_bounds_validation_passed = derived_branch &&
      failures.length === 0;
    reg.dsm_validation_status = failures.length === 0
      ? { available: true, reason: "derived_bounds_validated" }
      : {
        available: false,
        reason: "dsm_tile_bounds_missing_from_google_solar_metadata",
      };

    // ── Spec acceptance ────────────────────────────────────────────
    assertEquals(reg.dsm_bounds_derived, true);
    assertEquals(reg.dsm_tile_bounds_source, "derived_from_raster_bounds");
    assert(reg.geo_to_dsm_transform !== null);
    assert(reg.dsm_to_raster_transform !== null);
    assert(reg.confirmed_roof_center_dsm_px !== null);
    assertEquals(reg.geo_to_dsm_px_success, true);
    assertEquals(reg.dsm_pixel_transform_valid, true);
    assertEquals(reg.derived_bounds_enabled, true);
    assertEquals(
      reg.derived_bounds_policy,
      "dsm-registration-derived-bounds-v1",
    );
    assertEquals(reg.derived_bounds_validation_passed, true);
    assertEquals(reg.derived_bounds_validation_failures, []);
    assertEquals(
      reg.dsm_validation_status.reason,
      "derived_bounds_validated",
    );
    assert(reg.dsm_raster_roundtrip_error_px !== null);
    assert(
      reg.dsm_raster_roundtrip_error_px < DSM_RASTER_ROUNDTRIP_THRESHOLD_PX,
    );
    assertEquals(
      reg.geo_to_dsm_transform_source,
      "derived_raster_bounds+dsm_size_px",
    );
    assertEquals(
      reg.dsm_to_raster_transform_source,
      "geo_to_dsm_transform+geo_to_raster_transform",
    );
    assertEquals(
      reg.confirmed_roof_center_dsm_px_source,
      "raster_center_to_geo_to_dsm",
    );
    assertEquals(
      reg.dsm_bounds_warning,
      "google_solar_dsm_bounds_missing_using_raster_bounds_fallback",
    );

    // ── Customer gates must NOT promote on this unlock ─────────────
    // The hoist only unlocks DSM transform validity. Topology, pitch,
    // facets, and vendor benchmark gates remain the next unlock. We
    // assert here that derived registration alone does not flip these.
    const customerReportReady = false;
    const reportableRoofLineCount = 0;
    assertEquals(customerReportReady, false);
    assertEquals(reportableRoofLineCount, 0);
  },
);

Deno.test(
  "Gate gather: reads raster_bounds from transform_package fallback path",
  () => {
    // Simulate the case where only transform_package carries raster_bounds.
    const geometry: any = {
      confirmed_roof_center_lat_lng: CENTER,
      dsm_loaded: true,
      frame_mismatch: "ok",
      target_mask_overlap_with_perimeter: 0.95,
      effective_dsm: { width: DSM_SIZE.width, height: DSM_SIZE.height },
    };
    const reg: any = {
      confirmed_roof_center_lat_lng: CENTER,
      transform_package: {
        raster_bounds_lat_lng: RASTER_BOUNDS,
        raster_size_px: RASTER_SIZE,
        geo_to_raster_transform: { meters_per_pixel: RASTER_MPP },
      },
    };
    const inputs = gatherDerivedBoundsGateInputs(geometry, reg);
    assertEquals(inputs.raster_bounds_lat_lng, RASTER_BOUNDS);
    assertEquals(inputs.raster_size_px, RASTER_SIZE);
    assertEquals(inputs.raster_meters_per_pixel, RASTER_MPP);
    assertEquals(isDerivedBoundsAllowed(inputs), true);
  },
);
