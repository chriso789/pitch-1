// Deno tests for the Target Roof Registration Gate v2 shared helpers.
// Run via: supabase--test_edge_functions (no specific function needed —
// _shared tests are picked up by the standard runner).

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateRegistrationGate,
  evaluateTargetConfirmation,
  evaluateCandidate,
  evaluateCandidateAgainstTarget,
  canApproveManualPerimeter,
  polygonContainsPoint,
} from "../registration-gate.ts";
import { normalizeResultStateForWrite } from "../result-state.ts";

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
  assertEquals(res.failure?.hard_fail_reason, "dsm_size_missing");
});

Deno.test("evaluateRegistrationGate — fails when candidate doesn't contain confirmed center", () => {
  const res = evaluateRegistrationGate({
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: CONFIRMED,
    confirmed_roof_center_lat_lng: CONFIRMED,
    confirmed_roof_center_px: [50, 50], // outside SQUARE
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    geo_to_raster_transform: { a: 1 },
    geo_to_dsm_transform: { a: 1 },
    dsm_to_raster_transform: { a: 1 },
    raster_bounds_lat_lng: { sw: { lat: 33.7, lng: -84.4 }, ne: { lat: 33.8, lng: -84.3 } },
    dsm_tile_bounds_lat_lng: { sw: { lat: 33.7, lng: -84.4 }, ne: { lat: 33.8, lng: -84.3 } },
    dsm_size_px: { width: 998, height: 998 },
    selected_candidate_polygon_px: SQUARE,
  });
  assertEquals(res.confirmed_center_inside_candidate, false);
  assertEquals(
    res.failure?.hard_fail_reason,
    "candidate_centroid_offset_exceeds_target",
  );
});

Deno.test("evaluateRegistrationGate — passes when all gates satisfied", () => {
  const res = evaluateRegistrationGate({
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: CONFIRMED,
    confirmed_roof_center_lat_lng: CONFIRMED,
    confirmed_roof_center_px: [200, 200], // inside SQUARE
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    geo_to_raster_transform: { a: 1 },
    geo_to_dsm_transform: { a: 1 },
    dsm_to_raster_transform: { a: 1 },
    raster_bounds_lat_lng: { sw: { lat: 33.7, lng: -84.4 }, ne: { lat: 33.8, lng: -84.3 } },
    dsm_tile_bounds_lat_lng: { sw: { lat: 33.7, lng: -84.4 }, ne: { lat: 33.8, lng: -84.3 } },
    dsm_size_px: { width: 998, height: 998 },
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

Deno.test("evaluateCandidateAgainstTarget — rejects Fonsica-style fused/tree candidate by target diagonal", () => {
  const fusedCandidate: Array<[number, number]> = [
    [50, 50],
    [1220, 50],
    [1220, 1220],
    [50, 1220],
  ];
  const confirmedRoofCenter: [number, number] = [640, 640];
  const targetRoofComponentDiagonalPx = 260;
  const r = evaluateCandidateAgainstTarget(
    fusedCandidate,
    confirmedRoofCenter,
    targetRoofComponentDiagonalPx,
  );
  assertEquals(r.rejected, true);
  assertEquals(r.rejection_reason, "centroid_offset_exceeds_target");
  assert(r.candidate_centroid_offset_threshold_px < 160);
});

Deno.test("evaluateCandidateAgainstTarget — rejects front-yard component that does not contain roof anchor", () => {
  const treeOrFrontYardComponent: Array<[number, number]> = [
    [410, 720],
    [520, 720],
    [520, 840],
    [410, 840],
  ];
  const confirmedRoofCenter: [number, number] = [640, 640];
  const r = evaluateCandidateAgainstTarget(
    treeOrFrontYardComponent,
    confirmedRoofCenter,
    170,
  );
  assertEquals(r.rejected, true);
  assertEquals(r.rejection_reason, "candidate_does_not_contain_confirmed_roof_center");
});

Deno.test("canApproveManualPerimeter — requires all 5 flags", () => {
  assertEquals(canApproveManualPerimeter(null), false);
  for (const missingFlag of [
    "user_confirmed_roof_target",
    "geo_to_dsm_px_success",
    "dsm_pixel_transform_valid",
    "confirmed_center_inside_candidate",
    "coordinate_registration_gate_passed",
  ] as const) {
    const reg = {
      user_confirmed_roof_target: true,
      geo_to_dsm_px_success: true,
      dsm_pixel_transform_valid: true,
      confirmed_center_inside_candidate: true,
      coordinate_registration_gate_passed: true,
    };
    reg[missingFlag] = false;
    assertEquals(canApproveManualPerimeter(reg), false, `missing ${missingFlag} must disable approval`);
  }
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

Deno.test("registration failures normalize away from perimeter state", () => {
  assertEquals(normalizeResultStateForWrite("target_roof_not_confirmed", {}), "ai_failed_target_unconfirmed");
  assertEquals(normalizeResultStateForWrite("coordinate_registration_failed", {}), "ai_failed_source_acquisition");
  assertEquals(normalizeResultStateForWrite("candidate_does_not_contain_confirmed_roof_center", {}), "ai_failed_source_acquisition");
});

// ─── Regression: registration failures must outrank perimeter failures ───
// The `derivePhase3ResultState` helper in start-ai-measurement reads the
// registration block directly. These tests pin the contract the helper
// relies on: a failing gate ALWAYS resolves to a registration result_state,
// never to ai_failed_perimeter, even when a perimeter_shape_not_accurate
// reason is also present on the debug bag.

Deno.test("regression: user_confirmed=false yields target_unconfirmed (not perimeter)", () => {
  const r = evaluateRegistrationGate({
    user_confirmed_roof_target: false,
    confirmed_roof_center_lat_lng: CONFIRMED,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: false,
  });
  assert(r.failure);
  assertEquals(r.failure!.result_state, "ai_failed_target_unconfirmed");
  assertEquals(r.failure!.hard_fail_reason, "target_roof_not_confirmed");
  assertEquals(canApproveManualPerimeter(r), false);
});

Deno.test("regression: confirmed but bad transform yields source_acquisition", () => {
  const r = evaluateRegistrationGate({
    user_confirmed_roof_target: true,
    confirmed_roof_center_lat_lng: CONFIRMED,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: false,
  });
  assert(r.failure);
  assertEquals(r.failure!.result_state, "ai_failed_source_acquisition");
  assertEquals(r.failure!.hard_fail_reason, "dsm_size_missing");
  assertEquals(canApproveManualPerimeter(r), false);
});
