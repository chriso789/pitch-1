// ============================================================================
// dsm-derived-bounds-debug-instrumentation.test.ts
// ----------------------------------------------------------------------------
// Diagnostic-only assertions: verifies `derived_bounds_debug` mirrors the
// same booleans the existing branch decisions evaluate. No behavior change
// is asserted — only that the failure point is now visible.
// ============================================================================

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDsmRegistration } from "../dsm-registration.ts";

const FONSICA_BOUNDS = {
  sw: { lat: 27.99, lng: -82.71 },
  ne: { lat: 28.00, lng: -82.70 },
};

// (Test A merged into "Test A (real)" below — the wrong-shape branch causes
// the raster-from-bounds branch to be skipped, and the next branch decides
// whether anything else can fire.)



Deno.test("Test A (real) — wrong-shape raster bounds skip raster branch", () => {
  const r = buildDsmRegistration({
    dsm_loaded: true,
    effectiveDSM: { width: 998, height: 998, resolution: 0.1 },
    allow_derived_bounds: true,
    rasterBoundsLatLng: {
      north: 28.00, south: 27.99, east: -82.70, west: -82.71,
    } as any,
    rasterSizePx: { width: 1280, height: 1280 },
    confirmedCenterLatLng: { lat: 27.995, lng: -82.705 },
    rasterMetersPerPixel: 0.15,
  });
  const dbg = r.derived_bounds_debug!;
  assertEquals(dbg.raster_bounds_input_shape, "north_south_east_west");
  // With a confirmed center + decoded DSM mpp, the second branch wins instead.
  assertEquals(dbg.derived_branch_entered, "derived_from_confirmed_center_and_mpp");
});

Deno.test("Test A2 — wrong-shape bounds AND no fallback evidence → raster_bounds_shape_mismatch", () => {
  const r = buildDsmRegistration({
    dsm_loaded: true,
    effectiveDSM: { width: 998, height: 998 }, // no resolution
    allow_derived_bounds: true,
    rasterBoundsLatLng: {
      north: 28.00, south: 27.99, east: -82.70, west: -82.71,
    } as any,
    rasterSizePx: { width: 1280, height: 1280 },
    // no confirmedCenterLatLng → second/third branches can't fire either
    rasterMetersPerPixel: null,
  });
  const dbg = r.derived_bounds_debug!;
  assertEquals(dbg.derived_branch_entered, "none");
  assertEquals(dbg.derived_branch_skipped_reason, "raster_bounds_shape_mismatch");
});

Deno.test("Test B — effectiveDSM/roofMask lack width/height → internal_dsm_size_missing", () => {
  const r = buildDsmRegistration({
    dsm_loaded: true,
    effectiveDSM: { resolution: 0.1 } as any, // no width/height
    roofMask: null,
    allow_derived_bounds: true,
    rasterBoundsLatLng: FONSICA_BOUNDS,
    rasterSizePx: { width: 1280, height: 1280 },
    confirmedCenterLatLng: { lat: 27.995, lng: -82.705 },
    rasterMetersPerPixel: 0.15,
  });
  const dbg = r.derived_bounds_debug!;
  assertEquals(dbg.dsm_size_px_internal, null);
  assertEquals(dbg.dsm_size_px_internal_source, "missing");
  assertEquals(dbg.derived_branch_entered, "none");
  assertEquals(dbg.derived_branch_skipped_reason, "internal_dsm_size_missing");
});

Deno.test("Test C — known-good Fonsica-shaped input → derived_from_raster_bounds, no skip", () => {
  const r = buildDsmRegistration({
    dsm_loaded: true,
    effectiveDSM: { width: 998, height: 998 }, // no metadata bounds
    allow_derived_bounds: true,
    rasterBoundsLatLng: FONSICA_BOUNDS,
    rasterSizePx: { width: 1280, height: 1280 },
    rasterMetersPerPixel: 0.15,
  });
  const dbg = r.derived_bounds_debug!;
  assertEquals(dbg.raster_bounds_input_shape, "sw_ne");
  assertEquals(dbg.raster_bounds_sw_lat_numeric, true);
  assertEquals(dbg.raster_bounds_ne_lng_numeric, true);
  assertEquals(dbg.dsm_size_px_internal_source, "decoded_dsm_grid");
  assertEquals(dbg.derived_branch_entered, "derived_from_raster_bounds");
  assertEquals(dbg.derived_branch_skipped_reason, null);
  assertEquals(r.dsm_bounds_source, "derived_from_raster_bounds");
});
