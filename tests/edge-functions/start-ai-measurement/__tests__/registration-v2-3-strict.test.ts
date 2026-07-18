// Regression: Registration Gate v2.3 final-stage strictness.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateRegistrationGate,
  REGISTRATION_GATE_VERSION,
} from "../../_shared/registration-gate.ts";
import {
  detectRegistrationFieldConflicts,
  derivePrecedenceReasonWithConflict,
} from "../../_shared/registration-precedence.ts";

Deno.test("v2.3: candidate_final with null transforms fails honestly", () => {
  const r = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: { lat: 40, lng: -80 },
    confirmed_roof_center_lat_lng: { lat: 40, lng: -80 },
    confirmed_roof_center_px: null,
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    geo_to_dsm_transform: null,
    geo_to_raster_transform: null,
    dsm_to_raster_transform: null,
    raster_bounds_lat_lng: null,
    dsm_tile_bounds_lat_lng: null,
    selected_candidate_polygon_px: null,
  });
  assertEquals(r.coordinate_registration_gate_passed, false);
  assertEquals(r.confirmed_center_inside_candidate, false);
  assert(r.failure);
  // v3 contract: prefer specific missing-field token over generic fallback.
  assertEquals(r.failure!.hard_fail_reason, "dsm_size_missing");
  assertEquals(r.failure!.result_state, "ai_failed_source_acquisition");
  const missing = (r.registration as any).missing_required_fields as string[];
  for (const k of [
    "confirmed_roof_center_px",
    "geo_to_dsm_transform",
    "geo_to_raster_transform",
    "dsm_to_raster_transform",
    "raster_bounds_lat_lng",
    "dsm_tile_bounds_lat_lng",
    "selected_candidate_polygon_px",
  ]) {
    assert(missing.includes(k), `expected ${k} in missing_required_fields`);
  }
  assertEquals((r.registration as any).evaluation_stage, "candidate_final");
  assertEquals((r.registration as any).version, REGISTRATION_GATE_VERSION);
});

Deno.test("v2.3: preflight cannot publish coordinate_registration_gate_passed=true", () => {
  const r = evaluateRegistrationGate({
    evaluation_stage: "source_preflight",
    user_confirmed_roof_target: true,
    confirmed_roof_center_lat_lng: { lat: 40, lng: -80 },
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    dsm_to_raster_transform: { mpp: 0.1 },
  });
  assertEquals(r.coordinate_registration_gate_passed, false);
  assertEquals((r.registration as any).evaluation_stage, "source_preflight");
  assertEquals((r.registration as any).source_preflight_passed, true);
});

Deno.test("v2.3: contradictory legacy block is detected as field conflict, gate failure preferred", () => {
  const geometry = {
    registration: {
      version: REGISTRATION_GATE_VERSION,
      evaluation_stage: "candidate_final",
      coordinate_registration_gate_passed: true,
      confirmed_roof_center_px: null,
      geo_to_dsm_transform: null,
      geo_to_raster_transform: null,
      dsm_to_raster_transform: null,
      missing_required_fields: ["confirmed_roof_center_px"],
    },
  };
  const conflicts = detectRegistrationFieldConflicts(geometry);
  assert(conflicts.length > 0);
  // derivePrecedenceReasonWithConflict prefers honest gate-level reason if
  // present; with no first-class failure on the block it falls back to
  // registration_field_conflict.
  const { reason } = derivePrecedenceReasonWithConflict(geometry);
  assert(reason === "registration_field_conflict" || reason === "coordinate_registration_failed");
});

Deno.test("v2.3: null confirmed_roof_center_px always forces inside_candidate=false", () => {
  const r = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    confirmed_roof_center_lat_lng: { lat: 40, lng: -80 },
    confirmed_roof_center_px: null,
    selected_candidate_polygon_px: [[0, 0], [100, 0], [100, 100], [0, 100]],
  });
  assertEquals(r.confirmed_center_inside_candidate, false);
});
