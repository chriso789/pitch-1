// Regression test — Registration Precedence v1
// Fonsica-class run where the user never confirmed the roof target.
// Expected: target_unconfirmed dominates any downstream perimeter failure.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  REGISTRATION_PRECEDENCE_VERSION,
  deriveRegistrationFailureReason,
  stampPhaseBlockBlockedByRegistration,
  resultStateForRegistrationFailure,
  buildRegistrationPrecedenceStamp,
  forceRegistrationBlockedPhaseBlocks,
  stripRegistrationBlockedGeometryArtifacts,
} from "../../_shared/registration-precedence.ts";
import { evaluateRegistrationGate } from "../../_shared/registration-gate.ts";
import { normalizeResultStateForWrite } from "../../_shared/result-state.ts";

Deno.test("target unconfirmed → target_roof_not_confirmed precedence reason", () => {
  const reg = {
    version: "registration-gate-v2.1",
    user_confirmed_roof_target: false,
    roof_target_admin_override: false,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: false,
    confirmed_center_inside_candidate: false,
    coordinate_registration_gate_passed: false,
  };
  assertEquals(deriveRegistrationFailureReason(reg), "target_roof_not_confirmed");
  assertEquals(resultStateForRegistrationFailure("target_roof_not_confirmed"), "ai_failed_target_unconfirmed");
});

Deno.test("evaluateRegistrationGate routes Fonsica-no-confirm to ai_failed_target_unconfirmed", () => {
  const r = evaluateRegistrationGate({
    user_confirmed_roof_target: false,
    roof_target_admin_override: false,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: false,
  });
  assertEquals(r.failure?.reason, "target_roof_not_confirmed");
  assertEquals(r.failure?.result_state, "ai_failed_target_unconfirmed");
  assertEquals(r.failure?.hard_fail_reason, "target_roof_not_confirmed");
  assertEquals(r.failure?.block_customer_report_reason, "target_roof_not_confirmed");
  assertEquals(
    normalizeResultStateForWrite(r.failure!.hard_fail_reason, {}),
    "ai_failed_target_unconfirmed",
  );
});

Deno.test("stampPhaseBlockBlockedByRegistration overrides executed=true to skipped", () => {
  const phase3_5: Record<string, any> = {
    version: "v1",
    executed: true,
    refinement_iou: 0.91,
    skipped_reason: null,
  };
  const stamped = stampPhaseBlockBlockedByRegistration(phase3_5);
  assertEquals(stamped.executed, false);
  assertEquals(stamped.skipped_reason, "blocked_by_registration_gate");
  assertEquals(stamped.skipped_by, REGISTRATION_PRECEDENCE_VERSION);
  // Original is not mutated
  assertEquals(phase3_5.executed, true);
});

Deno.test("buildRegistrationPrecedenceStamp — target unconfirmed", () => {
  const stamp = buildRegistrationPrecedenceStamp({
    version: "registration-gate-v2.1",
    user_confirmed_roof_target: false,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: false,
  });
  assertEquals(stamp.registration_precedence_version, REGISTRATION_PRECEDENCE_VERSION);
  assertEquals(stamp.registration_precedence_applied, true);
  assertEquals(stamp.registration_precedence_reason, "target_roof_not_confirmed");
  assertEquals(stamp.registration_gate_version, "registration-gate-v2.1");
});

Deno.test("target unconfirmed failure payload blocks all phases and strips perimeter artifacts", () => {
  const geometry: Record<string, any> = {
    result_state: "ai_failed_target_unconfirmed",
    hard_fail_reason: "target_roof_not_confirmed",
    registration_precedence_applied: true,
    phase3_5: { version: "v1", executed: true },
    phase3A_5: { version: "v1", executed: true },
    phase3C: { version: "v1", executed: true },
    phase3D: { version: "v1", executed: true },
    phase3E: { version: "v1", executed: true },
    perimeter_phase0: { executed: true },
    selected_perimeter_after_refinement: [[0, 0], [1, 1]],
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
