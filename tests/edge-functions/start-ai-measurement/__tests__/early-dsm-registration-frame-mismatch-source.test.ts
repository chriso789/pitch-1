/// <reference lib="deno.ns" />
// ============================================================================
// Regression: the early-derived-DSM gate must read frame_mismatch from the
// authoritative geometry payload sources (resolveFrameMismatch), not just from
// dsmCoordinateMatchDebug. On Fonsica the latter is null even when
// overlay_transform.frame_mismatch === "ok", so the gate previously skipped
// with frame_mismatch_not_ok and blocked DSM-derived bounds.
//
// This file exercises the resolver + runEarlyDerivedDsmRegistration wiring as
// a unit, mirroring the integration callsite in start-ai-measurement/index.ts.
// ============================================================================

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveFrameMismatch } from "../../_shared/resolveFrameMismatch.ts";
import {
  runEarlyDerivedDsmRegistration,
  type EarlyDsmRegistrationInput,
} from "../../_shared/early-dsm-registration.ts";

// Minimal Fonsica-shaped geometry view.
function makeFonsicaGeometryView(overrides: Record<string, unknown> = {}) {
  return {
    overlay_transform: {
      frame_mismatch: "ok",
      coord_space: "raster_px",
      renderer_coord_space: "raster_px",
      source_raster_px: { width: 1280, height: 1280 },
    },
    confirmed_roof_center_px: { x: 640, y: 640 },
    raster_bounds_contain_confirmed_center: true,
    selected_candidate_polygon_px_present: true,
    target_mask_overlap_with_perimeter: 0.976,
    ...overrides,
  };
}

// Build EarlyDsmRegistrationInput sharing the same resolved frame_mismatch the
// integration callsite passes.
function makeEarlyInput(frame: string | null): EarlyDsmRegistrationInput {
  return {
    dsm_loaded: true,
    dsm_size_px: { width: 998, height: 998 },
    dsm_meters_per_pixel: 0.15,
    raster_bounds_lat_lng: {
      sw: { lat: 27.99, lng: -82.73 },
      ne: { lat: 28.01, lng: -82.71 },
    },
    raster_size_px: { width: 1280, height: 1280 },
    raster_meters_per_pixel: 0.15,
    geo_to_raster_transform: {
      lng_to_x: { m: 64000, b: 5279360 },
      lat_to_y: { m: -64000, b: 1791360 },
    } as any,
    frame_mismatch: frame,
    target_mask_overlap_with_perimeter: 0.976,
    selected_perimeter_present: true,
    confirmed_roof_center_lat_lng: { lat: 28.0, lng: -82.72 },
    static_map_center_lat_lng: { lat: 28.0, lng: -82.72 },
    zoom: 19,
    logical_image_size: { width: 640, height: 640 },
    scale: 2,
    dsmCoordinateMatchDebug: null,
    effectiveDSM: null,
    roofMask: null,
    mask_loaded: false,
  };
}

Deno.test("explicit Fonsica positive: overlay_transform.frame_mismatch=ok flows to early gate", () => {
  const view = makeFonsicaGeometryView();
  const resolved = resolveFrameMismatch(view, null);
  assertEquals(resolved.frame_mismatch_ok, true);
  assertEquals(
    resolved.frame_mismatch_source,
    "overlay_transform.frame_mismatch",
  );

  // Pass the resolved value into the gate exactly like the integration callsite.
  const result = runEarlyDerivedDsmRegistration(
    makeEarlyInput(resolved.frame_mismatch_ok ? "ok" : resolved.frame_mismatch_raw),
  );

  // The gate must NOT short-circuit on frame_mismatch_not_ok. Other downstream
  // skips (e.g. missing DSM grid evidence) are acceptable here because this
  // test is about the frame-mismatch source contract, not full registration.
  if (result.success === false) {
    assertNotEquals(result.skipped_reason, "frame_mismatch_not_ok");
  }
});

Deno.test("inferred Fonsica positive: no explicit string, raster evidence yields ok", () => {
  const view = {
    coordinate_space_candidate: "raster_px",
    coordinate_space_renderer: "raster_px",
    source_raster_px: { width: 1280, height: 1280 },
    confirmed_roof_center_px: { x: 640, y: 640 },
    raster_bounds_contain_confirmed_center: true,
    selected_candidate_polygon_px_present: true,
    target_mask_overlap_with_perimeter: 0.976,
  };
  const resolved = resolveFrameMismatch(view, null);
  assertEquals(resolved.frame_mismatch_ok, true);
  assertEquals(
    resolved.frame_mismatch_source,
    "inferred_from_raster_registration_evidence",
  );

  const result = runEarlyDerivedDsmRegistration(makeEarlyInput("ok"));
  if (result.success === false) {
    assertNotEquals(result.skipped_reason, "frame_mismatch_not_ok");
  }
});

Deno.test("negative: explicit raster_outside_dsm with weak evidence skips gate", () => {
  const view = {
    overlay_transform: { frame_mismatch: "raster_outside_dsm" },
  };
  const resolved = resolveFrameMismatch(view, null);
  assertEquals(resolved.frame_mismatch_ok, false);
  assertEquals(resolved.frame_mismatch_raw, "raster_outside_dsm");

  const result = runEarlyDerivedDsmRegistration(
    makeEarlyInput(resolved.frame_mismatch_ok ? "ok" : resolved.frame_mismatch_raw),
  );
  assertEquals(result.success, false);
  if (result.success === false) {
    assertEquals(result.skipped_reason, "frame_mismatch_not_ok");
  }
});

Deno.test("legacy dsmCoordinateMatchDebug source is honored when geometry is empty", () => {
  const resolved = resolveFrameMismatch({}, {
    frame_mismatch: "ok",
  });
  assertEquals(resolved.frame_mismatch_ok, true);
  assertEquals(resolved.frame_mismatch_source, "dsmCoordinateMatchDebug");
});

Deno.test("legacy match_status fallback path", () => {
  const resolved = resolveFrameMismatch({}, { match_status: "ok" });
  assertEquals(resolved.frame_mismatch_ok, true);
  assertEquals(resolved.frame_mismatch_source, "dsmCoordinateMatchDebug");
});

Deno.test("legacy is_valid:true treated as ok", () => {
  const resolved = resolveFrameMismatch({}, { is_valid: true });
  assertEquals(resolved.frame_mismatch_ok, true);
});
