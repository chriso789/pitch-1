// Deno tests for the Target Roof Registration Gate v2 shared helpers.
// Run via: supabase--test_edge_functions (no specific function needed —
// _shared tests are picked up by the standard runner).

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateRegistrationGate,
  evaluateTargetConfirmation,
  evaluateCandidate,
  canApproveManualPerimeter,
  polygonContainsPoint,
} from "../registration-gate.ts";

const CONFIRMED = { lat: 33.7501, lng: -84.3920 };
const SQUARE: Array<[number, number]> = [
  [100, 100], [300, 100], [300, 300], [100, 300],
];

Deno.test("polygonContainsPoint — basic in/out", () => {
  assertEquals(polygonContainsPoint(SQUARE, [200, 200]), true);
  assertEquals(polygonContainsPoint(SQUARE, [50, 50]), false);
  assertEquals(polygonContainsPoint(SQUARE, null), false);
  assertEquals(polygonContainsPoint(null, [200, 200]), false);
});

Deno.test("evaluateTargetConfirmation — missing flag rejects", () => {
  const r = evaluateTargetConfirmation({
    user_confirmed_roof_target: false,
    confirmed_roof_center_lat_lng: CONFIRMED,
  });
  assertEquals(r.ok, false);
});

Deno.test("evaluateTargetConfirmation — missing lat/lng rejects", () => {
  const r = evaluateTargetConfirmation({
    user_confirmed_roof_target: true,
    confirmed_roof_center_lat_lng: null,
  });
  assertEquals(r.ok, false);
});

Deno.test("evaluateTargetConfirmation — admin override bypasses lat/lng", () => {
  const r = evaluateTargetConfirmation({
    user_confirmed_roof_target: false,
    roof_target_admin_override: true,
    confirmed_roof_center_lat_lng: null,
  });
  assertEquals(r.ok, true);
});

Deno.test("evaluateRegistrationGate — fails on missing target confirmation", () => {
  const res = evaluateRegistrationGate({
    user_confirmed_roof_target: false,
  });
  assertEquals(res.user_confirmed_roof_target, false);
  assertEquals(res.coordinate_registration_gate_passed, false);
  assertEquals(res.failure?.result_state, "ai_failed_target_unconfirmed");
  assertEquals(res.failure?.hard_fail_reason, "target_roof_not_confirmed");
});

Deno.test("evaluateRegistrationGate — fails on invalid frame", () => {
  const res = evaluateRegistrationGate({
    user_confirmed_roof_target: true,
    confirmed_roof_center_lat_lng: CONFIRMED,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: false,
  });
  assertEquals(res.failure?.result_state, "ai_failed_source_acquisition");
  assertEquals(res.failure?.hard_fail_reason, "coordinate_registration_failed");
});

Deno.test("evaluateRegistrationGate — fails when candidate doesn't contain confirmed center", () => {
  const res = evaluateRegistrationGate({
    user_confirmed_roof_target: true,
    confirmed_roof_center_lat_lng: CONFIRMED,
    confirmed_roof_center_px: [50, 50], // outside SQUARE
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    dsm_to_raster_transform: { a: 1 },
    selected_candidate_polygon_px: SQUARE,
  });
  assertEquals(res.confirmed_center_inside_candidate, false);
  assertEquals(
    res.failure?.hard_fail_reason,
    "candidate_does_not_contain_confirmed_roof_center",
  );
});

Deno.test("evaluateRegistrationGate — passes when all gates satisfied", () => {
  const res = evaluateRegistrationGate({
    user_confirmed_roof_target: true,
    confirmed_roof_center_lat_lng: CONFIRMED,
    confirmed_roof_center_px: [200, 200], // inside SQUARE
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    dsm_to_raster_transform: { a: 1 },
    selected_candidate_polygon_px: SQUARE,
  });
  assertEquals(res.failure, null);
  assertEquals(res.coordinate_registration_gate_passed, true);
  assertEquals(res.confirmed_center_inside_candidate, true);
  assertEquals((res.registration as any).version.startsWith("registration-gate-v"), true);
});

Deno.test("evaluateCandidate — rejects when point outside", () => {
  const r = evaluateCandidate(SQUARE, [50, 50]);
  assertEquals(r.rejected, true);
  assertEquals(r.rejection_reason, "candidate_does_not_contain_confirmed_roof_center");
});

Deno.test("evaluateCandidate — accepts and computes centroid offset", () => {
  const r = evaluateCandidate(SQUARE, [210, 210]);
  assertEquals(r.rejected, false);
  assert(r.candidate_centroid_offset_from_confirmed_center_px != null);
  assert(r.candidate_centroid_offset_from_confirmed_center_px! < 30);
});

Deno.test("canApproveManualPerimeter — requires all 5 flags", () => {
  assertEquals(canApproveManualPerimeter(null), false);
  assertEquals(
    canApproveManualPerimeter({
      user_confirmed_roof_target: true,
      geo_to_dsm_px_success: true,
      dsm_pixel_transform_valid: true,
      confirmed_center_inside_candidate: true,
      coordinate_registration_gate_passed: false, // <- gate not passed
    }),
    false,
  );
  assertEquals(
    canApproveManualPerimeter({
      user_confirmed_roof_target: true,
      geo_to_dsm_px_success: true,
      dsm_pixel_transform_valid: true,
      confirmed_center_inside_candidate: true,
      coordinate_registration_gate_passed: true,
    }),
    true,
  );
});
