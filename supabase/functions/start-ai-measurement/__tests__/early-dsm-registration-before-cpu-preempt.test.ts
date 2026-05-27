// Regression: dsm-registration-derived-bounds-v1 early callsite
// `early_dsm_registration_before_topology`
//
// Verifies the pure helper:
//   • runs the derived-bounds path when all gate inputs are present
//     (Fonsica-shaped: 998×998 DSM, 1280×1280 raster, frame_mismatch=ok,
//     target_mask_overlap_with_perimeter=0.976)
//   • emits the canonical v1 diagnostic surface
//   • skips silently (no failure tokens) when gating inputs are missing
//   • merge helper preserves derived fields into a downstream debug bag
//     (so CPU-preempt terminal failures keep the derived DSM transform)

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  EARLY_DSM_REGISTRATION_CALLSITE,
  mergeEarlyDsmRegistrationIntoDebug,
  runEarlyDerivedDsmRegistration,
} from "../../_shared/early-dsm-registration.ts";

// ── Fonsica-shaped raster bounds ──
// 1280×1280 static-map raster covering a small lat/lng window centered on the
// confirmed roof. Roundtrip uses the same bounds as the raster transform.
const RASTER_BOUNDS = {
  sw: { lat: 33.000, lng: -117.300 },
  ne: { lat: 33.0050, lng: -117.2940 },
};
const RASTER_SIZE = { width: 1280, height: 1280 };
const DSM_SIZE = { width: 998, height: 998 };
const CONFIRMED_LL = { lat: 33.00250, lng: -117.29700 };

const GEO_TO_RASTER = {
  size_px: RASTER_SIZE,
  bounds: RASTER_BOUNDS,
  meters_per_pixel: 0.42,
};

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    dsm_loaded: true,
    dsm_size_px: DSM_SIZE,
    dsm_meters_per_pixel: 0.54,
    raster_bounds_lat_lng: RASTER_BOUNDS,
    raster_size_px: RASTER_SIZE,
    raster_meters_per_pixel: 0.42,
    geo_to_raster_transform: GEO_TO_RASTER as any,
    frame_mismatch: "ok",
    target_mask_overlap_with_perimeter: 0.976,
    selected_perimeter_present: true,
    confirmed_roof_center_lat_lng: CONFIRMED_LL,
    static_map_center_lat_lng: CONFIRMED_LL,
    zoom: 19,
    logical_image_size: { width: 640, height: 640 },
    scale: 2,
    effectiveDSM: {
      width: 998,
      height: 998,
      bounds: null,
      resolution: 0.54,
    },
    roofMask: { width: 998, height: 998 },
    mask_loaded: true,
    dsmCoordinateMatchDebug: {
      dsm_bbox: { width: 998, height: 998 },
      frame_mismatch: "ok",
    },
    ...overrides,
  } as any;
}

Deno.test("positive — Fonsica-shaped inputs produce derived-bounds-validated registration", () => {
  const result = runEarlyDerivedDsmRegistration(makeInput());

  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.callsite, EARLY_DSM_REGISTRATION_CALLSITE);

  const f = result.fields;
  assertEquals(f.dsm_bounds_derived, true);
  assertEquals(f.dsm_tile_bounds_source, "derived_from_raster_bounds");
  assertEquals(f.dsm_bounds_source, "derived_from_raster_bounds");
  assertExists(f.geo_to_dsm_transform);
  assertExists(f.dsm_to_raster_transform);
  assertEquals(f.geo_to_dsm_px_success, true);
  assertEquals(f.dsm_pixel_transform_valid, true);
  assertEquals(f.dsm_tile_bounds_contain_confirmed_center, true);
  assertEquals(f.derived_bounds_enabled, true);
  assertEquals(
    f.derived_bounds_policy,
    "dsm-registration-derived-bounds-v1",
  );
  assertEquals(f.derived_bounds_validation_passed, true);
  assertEquals(f.derived_bounds_validation_failures.length, 0);
  if (!(f.dsm_raster_roundtrip_error_px < 8)) {
    throw new Error(
      `roundtrip error expected <8, got ${f.dsm_raster_roundtrip_error_px}`,
    );
  }
  assertEquals(f.dsm_validation_status.reason, "derived_bounds_validated");
  assertEquals(
    f.dsm_registration_callsite,
    "early_dsm_registration_before_topology",
  );
});

Deno.test("negative — frame_mismatch !== 'ok' skips with explicit reason", () => {
  const result = runEarlyDerivedDsmRegistration(
    makeInput({ frame_mismatch: "raster_outside_dsm" }),
  );
  assertEquals(result.success, false);
  if (result.success) return;
  assertEquals(result.skipped_reason, "frame_mismatch_not_ok");
  assertEquals(result.fields.dsm_bounds_derived, false);
  assertEquals(result.fields.derived_bounds_enabled, false);
  assertEquals(
    result.fields.dsm_registration_callsite_attempted,
    "early_dsm_registration_before_topology",
  );
});

Deno.test("negative — target_mask_overlap < 0.90 skips with explicit reason", () => {
  const result = runEarlyDerivedDsmRegistration(
    makeInput({ target_mask_overlap_with_perimeter: 0.42 }),
  );
  assertEquals(result.success, false);
  if (result.success) return;
  assertEquals(result.skipped_reason, "target_mask_overlap_below_gate");
});

Deno.test("merge helper preserves derived fields into terminal debug bag", () => {
  const result = runEarlyDerivedDsmRegistration(makeInput());
  if (!result.success) throw new Error("expected derived success");

  // Simulate a downstream terminal-payload debug bag that would otherwise
  // null the DSM transform fields (the original Fonsica failure mode).
  const downstreamBag = {
    dsm_bounds_derived: false,
    dsm_tile_bounds_source:
      "dsm_tile_bounds_missing_from_google_solar_metadata",
    geo_to_dsm_transform: null,
    dsm_to_raster_transform: null,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: false,
    dsm_validation_status: {
      available: false,
      reason: "dsm_tile_bounds_missing_from_google_solar_metadata",
    },
    hard_fail_reason: "ai_measurement_cpu_timeout",
    result_state: "ai_failed_runtime",
  } as Record<string, unknown>;

  const merged = mergeEarlyDsmRegistrationIntoDebug(downstreamBag, result);

  assertEquals((merged as any).dsm_bounds_derived, true);
  assertEquals(
    (merged as any).dsm_tile_bounds_source,
    "derived_from_raster_bounds",
  );
  assertExists((merged as any).geo_to_dsm_transform);
  assertExists((merged as any).dsm_to_raster_transform);
  assertEquals((merged as any).geo_to_dsm_px_success, true);
  assertEquals((merged as any).dsm_pixel_transform_valid, true);
  assertEquals(
    ((merged as any).dsm_validation_status as any).reason,
    "derived_bounds_validated",
  );
  assertEquals(
    (merged as any).dsm_registration_callsite,
    "early_dsm_registration_before_topology",
  );
  // Original failure tokens preserved (terminal state still failure bucket).
  assertEquals(
    (merged as any).hard_fail_reason,
    "ai_measurement_cpu_timeout",
  );
  assertEquals((merged as any).result_state, "ai_failed_runtime");
});

Deno.test("merge helper records skipped_reason when early run did not succeed", () => {
  const skipped = runEarlyDerivedDsmRegistration(
    makeInput({ frame_mismatch: "raster_outside_dsm" }),
  );
  const merged = mergeEarlyDsmRegistrationIntoDebug({}, skipped);
  assertEquals(
    (merged as any).dsm_registration_callsite_attempted,
    "early_dsm_registration_before_topology",
  );
  assertEquals(
    (merged as any).dsm_registration_callsite_skipped_reason,
    "frame_mismatch_not_ok",
  );
});
