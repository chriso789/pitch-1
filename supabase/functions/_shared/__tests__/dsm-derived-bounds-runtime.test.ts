// PR A — Outline Unlock: tests for `tryDeriveDsmRegistrationFromRaster`.
//
// Run with: deno test supabase/functions/_shared/__tests__/dsm-derived-bounds-runtime.test.ts

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isDerivedBoundsAllowed, tryDeriveDsmRegistrationFromRaster } from "../dsm-derived-bounds-runtime.ts";
import fonsica from "../__fixtures__/fonsica-dsm-missing.json" with { type: "json" };

const fonsicaInput = () => ({
  dsm_size_px: fonsica.dsm_size_px,
  raster_bounds_lat_lng: fonsica.raster_bounds_lat_lng,
  raster_size_px: fonsica.raster_size_px,
  geo_to_raster_transform: fonsica.geo_to_raster_transform as any,
  selected_candidate_polygon_px: fonsica.selected_candidate_polygon_px as Array<[number, number]>,
  candidate_coordinate_space: fonsica.candidate_coordinate_space,
  target_mask_overlap_with_perimeter: fonsica.target_mask_overlap_with_perimeter,
  confirmed_roof_center_px: fonsica.confirmed_roof_center_px as [number, number],
});

Deno.test("derives DSM registration from Fonsica raster fixture", () => {
  const res = tryDeriveDsmRegistrationFromRaster(fonsicaInput());
  assertEquals(res.status, "derived_from_registered_raster");
  if (res.status !== "derived_from_registered_raster") return;
  assertEquals(res.dsm_bounds_source, "derived_from_registered_raster");
  assertEquals(res.dsm_bounds_derived, true);
  assertEquals(res.dsm_registration_source, "derived_registered_raster_fallback");
  assertEquals(res.geo_to_dsm_transform_source, "derived_from_raster_bounds");
  assertEquals(res.dsm_to_raster_transform_source, "derived_from_raster_bounds");
  assert(res.dsm_bounds_confidence >= 0.70 && res.dsm_bounds_confidence <= 0.85,
    `confidence ${res.dsm_bounds_confidence} not in [0.70, 0.85]`);
  assertEquals(res.dsm_size_px.width, 998);
  assertEquals(res.dsm_size_px.height, 998);
});

Deno.test("derives bounds even when target mask overlap is low but raster registration is valid", () => {
  const inp = { ...fonsicaInput(), target_mask_overlap_with_perimeter: 0.6 };
  const res = tryDeriveDsmRegistrationFromRaster(inp);
  assertEquals(res.status, "derived_from_registered_raster");
  if (res.status !== "derived_from_registered_raster") return;
  assertEquals(res.dsm_bounds_source, "derived_from_registered_raster");
  assert(res.dsm_bounds_confidence >= 0.55 && res.dsm_bounds_confidence < 0.75);
});

Deno.test("allows derived bounds with valid raster registration even when target overlap is low", () => {
  assertEquals(isDerivedBoundsAllowed({
    dsm_loaded: true,
    mask_loaded: true,
    raster_bounds_lat_lng: fonsica.raster_bounds_lat_lng as any,
    raster_size_px: fonsica.raster_size_px as any,
    raster_meters_per_pixel: 0.118,
    geo_to_raster_transform: fonsica.geo_to_raster_transform as any,
    frame_mismatch_ok: true,
    frame_mismatch_source: "registered_raster",
    frame_mismatch_raw: null,
    raster_registration_evidence: { source_raster_px: fonsica.raster_size_px },
    target_mask_overlap: 0.42,
    confirmed_roof_center_lat_lng: null,
    confirmed_roof_center_px: fonsica.confirmed_roof_center_px as any,
    dsm_size_px: fonsica.dsm_size_px as any,
  }), true);
});

Deno.test("refuses to derive when DSM size missing", () => {
  const inp = { ...fonsicaInput(), dsm_size_px: null };
  const res = tryDeriveDsmRegistrationFromRaster(inp);
  assertEquals(res.status, "unavailable_but_aerial_perimeter_editable");
});

Deno.test("refuses to derive when confirmed center is outside candidate", () => {
  const inp = { ...fonsicaInput(), confirmed_roof_center_px: [10, 10] as [number, number] };
  const res = tryDeriveDsmRegistrationFromRaster(inp);
  assertEquals(res.status, "unavailable_but_aerial_perimeter_editable");
  if (res.status === "unavailable_but_aerial_perimeter_editable") {
    assertEquals(res.reason, "confirmed_center_outside_candidate_raster");
  }
});

Deno.test("refuses to derive when candidate not in raster_px frame", () => {
  const inp = { ...fonsicaInput(), candidate_coordinate_space: "dsm_px" };
  const res = tryDeriveDsmRegistrationFromRaster(inp);
  assertEquals(res.status, "unavailable_but_aerial_perimeter_editable");
  if (res.status === "unavailable_but_aerial_perimeter_editable") {
    assertEquals(res.reason, "candidate_not_in_raster_px");
  }
});
