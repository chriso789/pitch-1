// Regression test — Registration Precedence v1
// Target confirmed but coordinate frame is broken (geo→DSM transform invalid).
// Expected: coordinate_registration_failed → ai_failed_source_acquisition.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveRegistrationFailureReason,
  resultStateForRegistrationFailure,
  buildRegistrationPrecedenceStamp,
  forceRegistrationBlockedPhaseBlocks,
  stripRegistrationBlockedGeometryArtifacts,
} from "../../_shared/registration-precedence.ts";
import { evaluateRegistrationGate } from "../../_shared/registration-gate.ts";

Deno.test("broken frame → coordinate_registration_failed precedence reason", () => {
  const reg = {
    version: "registration-gate-v2.1",
    user_confirmed_roof_target: true,
    roof_target_admin_override: false,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: true,
    confirmed_center_inside_candidate: true,
    coordinate_registration_gate_passed: false,
  };
  assertEquals(deriveRegistrationFailureReason(reg), "coordinate_registration_failed");
  assertEquals(resultStateForRegistrationFailure("coordinate_registration_failed"), "ai_failed_source_acquisition");
});

Deno.test("evaluateRegistrationGate — target confirmed, frame invalid → ai_failed_source_acquisition", () => {
  const r = evaluateRegistrationGate({
    user_confirmed_roof_target: true,
    confirmed_roof_center_lat_lng: { lat: 27.85, lng: -82.7 },
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: true,
    dsm_to_raster_transform: { a: 1 },
  });
  assertEquals(r.failure?.reason, "dsm_size_missing");
  assertEquals(r.failure?.result_state, "ai_failed_source_acquisition");
  // v3 contract: gate prefers specific missing-field tokens (firstSpecificMissingReason)
  // over the generic coordinate_registration_failed fallback. Fixture lacks DSM size.
  assertEquals(r.failure?.hard_fail_reason, "dsm_size_missing");
});

Deno.test("buildRegistrationPrecedenceStamp — broken frame applied=true", () => {
  const stamp = buildRegistrationPrecedenceStamp({
    version: "registration-gate-v2.1",
    user_confirmed_roof_target: true,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: true,
  });
  assertEquals(stamp.registration_precedence_applied, true);
  assertEquals(stamp.registration_precedence_reason, "coordinate_registration_failed");
});

Deno.test("buildRegistrationPrecedenceStamp — gate passed → applied=false, reason=null", () => {
  const stamp = buildRegistrationPrecedenceStamp({
    version: "registration-gate-v2.1",
    user_confirmed_roof_target: true,
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    confirmed_center_inside_candidate: true,
    coordinate_registration_gate_passed: true,
  });
  assertEquals(stamp.registration_precedence_applied, false);
  assertEquals(stamp.registration_precedence_reason, null);
});

Deno.test("broken frame failure blocks all phases and removes editable perimeter artifacts", () => {
  const geometry: Record<string, any> = {
    result_state: "ai_failed_source_acquisition",
    hard_fail_reason: "coordinate_registration_failed",
    registration_precedence_applied: true,
    phase3_5: { version: "v1", executed: true },
    phase3A_5: { version: "v1", executed: true },
    phase3C: { version: "v1", executed: true },
    phase3D: { version: "v1", executed: true },
    phase3E: { version: "v1", executed: true },
    perimeter_phase0: { executed: true },
    selected_perimeter_after_refinement: [[100, 100], [200, 100]],
  };
  forceRegistrationBlockedPhaseBlocks(geometry);
  stripRegistrationBlockedGeometryArtifacts(geometry);
  for (const key of ["phase3_5", "phase3A_5", "phase3C", "phase3D", "phase3E"]) {
    assertEquals(geometry[key].executed, false);
    assertEquals(geometry[key].skipped_reason, "blocked_by_registration_gate");
  }
  assertEquals("perimeter_phase0" in geometry, false);
  assertEquals("selected_perimeter_after_refinement" in geometry, false);
});
