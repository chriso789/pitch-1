// Registration Gate v2.2 regression tests — strict mode at publish time.
// Pins the four Fonsica failure scenarios from the v2.2 spec:
//   A. candidate selected but confirmed_roof_center_px = null
//   B. block claims pass but top-level transform booleans are false (conflict)
//   C. selected candidate centroid offset > threshold
//   D. block claims pass while geo_to_dsm_transform / geo_to_raster_transform are null

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateRegistrationGate } from "../../_shared/registration-gate.ts";
import {
  detectRegistrationFieldConflicts,
  derivePrecedenceReasonWithConflict,
  deriveRegistrationFailureReason,
} from "../../_shared/registration-precedence.ts";

const CONFIRMED = { lat: 33.75, lng: -84.39 };
const SQUARE: Array<[number, number]> = [[100, 100], [300, 100], [300, 300], [100, 300]];

Deno.test("A. strict mode: candidate selected, confirmed_roof_center_px=null → coordinate_registration_failed", () => {
  const res = evaluateRegistrationGate({
    candidate_selection_started: true,
    user_confirmed_roof_target: true,
    confirmed_roof_center_lat_lng: CONFIRMED,
    confirmed_roof_center_px: null,
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    dsm_to_raster_transform: { kind: "x" },
    geo_to_raster_transform: { kind: "x" },
    geo_to_dsm_transform: { kind: "x" },
    raster_bounds_lat_lng: { sw: { lat: 0, lng: 0 }, ne: { lat: 1, lng: 1 } },
    dsm_tile_bounds_lat_lng: { sw: { lat: 0, lng: 0 }, ne: { lat: 1, lng: 1 } },
    selected_candidate_polygon_px: SQUARE,
  });
  assertEquals(res.coordinate_registration_gate_passed, false);
  assertEquals(res.confirmed_center_inside_candidate, false);
  assertEquals(res.failure?.result_state, "ai_failed_source_acquisition");
  // v3 contract: prefer specific missing-field token over generic fallback.
  assertEquals(res.failure?.hard_fail_reason, "dsm_size_missing");
  assert(
    (res.registration as any).missing_required_fields.includes("confirmed_roof_center_px"),
  );
});

Deno.test("B. conflict detector: block true while top-level false → registration_field_conflict", () => {
  const geometry = {
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: false,
    registration: {
      version: "registration-gate-v2.2",
      geo_to_dsm_px_success: true,
      dsm_pixel_transform_valid: true,
      coordinate_registration_gate_passed: true,
      confirmed_roof_center_px: [200, 200],
      geo_to_dsm_transform: { kind: "x" },
      geo_to_raster_transform: { kind: "x" },
      dsm_to_raster_transform: { kind: "x" },
    },
  };
  const conflicts = detectRegistrationFieldConflicts(geometry);
  assert(conflicts.length >= 2);
  assertEquals(derivePrecedenceReasonWithConflict(geometry).reason, "registration_field_conflict");
});

Deno.test("C. strict mode: candidate centroid offset > threshold → rejected with hard fail", () => {
  // Tiny square at origin, confirmed center far away (Fonsica 878px scenario).
  const tinySquare: Array<[number, number]> = [[0, 0], [50, 0], [50, 50], [0, 50]];
  const res = evaluateRegistrationGate({
    candidate_selection_started: true,
    user_confirmed_roof_target: true,
    confirmed_roof_center_lat_lng: CONFIRMED,
    confirmed_roof_center_px: [900, 900],
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    dsm_to_raster_transform: { kind: "x" },
    geo_to_raster_transform: { kind: "x" },
    geo_to_dsm_transform: { kind: "x" },
    raster_bounds_lat_lng: { sw: { lat: 0, lng: 0 }, ne: { lat: 1, lng: 1 } },
    dsm_tile_bounds_lat_lng: { sw: { lat: 0, lng: 0 }, ne: { lat: 1, lng: 1 } },
    selected_candidate_polygon_px: tinySquare,
  });
  assertEquals((res.registration as any).centroid_offset_exceeds_threshold, true);
  assertEquals(res.confirmed_center_inside_candidate, false);
  assertEquals(res.failure?.result_state, "ai_failed_source_acquisition");
  assert(res.failure?.hard_fail_reason != null);
});

Deno.test("D. conflict detector: block claims pass but geo_to_dsm_transform=null → conflict", () => {
  const geometry = {
    registration: {
      version: "registration-gate-v2.2",
      coordinate_registration_gate_passed: true,
      confirmed_roof_center_px: [200, 200],
      geo_to_dsm_px_success: true,
      dsm_pixel_transform_valid: true,
      geo_to_dsm_transform: null,
      geo_to_raster_transform: null,
      dsm_to_raster_transform: null,
    },
  };
  const conflicts = detectRegistrationFieldConflicts(geometry);
  const fields = conflicts.map((c) => c.field);
  assert(fields.includes("geo_to_dsm_transform"));
  assert(fields.includes("geo_to_raster_transform"));
  assert(fields.includes("dsm_to_raster_transform"));
  assertEquals(derivePrecedenceReasonWithConflict(geometry).reason, "registration_field_conflict");
});

Deno.test("derive: strict failure block infers coordinate_registration_failed", () => {
  const reg = {
    version: "registration-gate-v2.2",
    user_confirmed_roof_target: true,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: false,
    coordinate_registration_gate_passed: false,
    missing_required_fields: ["confirmed_roof_center_px"],
  };
  assertEquals(deriveRegistrationFailureReason(reg), "coordinate_registration_failed");
});
