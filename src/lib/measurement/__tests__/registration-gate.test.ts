// PR A — Outline Unlock: manual approval no longer requires DSM registration.
//
// Run with: bunx vitest run src/lib/measurement/__tests__/registration-gate.test.ts

import { describe, expect, it } from "vitest";
import { canApproveManualPerimeter, registrationBanner } from "../registration-gate";

describe("canApproveManualPerimeter — PR A: DSM-optional manual approval", () => {
  it("approves when target confirmed + frame_mismatch=ok, even with DSM sub-flags false", () => {
    const reg = {
      user_confirmed_roof_target: true,
      geo_to_dsm_px_success: false,
      dsm_pixel_transform_valid: false,
      confirmed_center_inside_candidate: null,
      coordinate_registration_gate_passed: false,
      frame_mismatch: "ok",
    };
    expect(canApproveManualPerimeter(reg as any)).toBe(true);
  });

  it("approves when raster_candidate_check_passed=true and target confirmed", () => {
    const reg = {
      user_confirmed_roof_target: true,
      geo_to_dsm_px_success: null,
      dsm_pixel_transform_valid: null,
      confirmed_center_inside_candidate: null,
      coordinate_registration_gate_passed: null,
      raster_candidate_check_passed: true,
    };
    expect(canApproveManualPerimeter(reg as any)).toBe(true);
  });

  it("blocks when operator never confirmed the target roof", () => {
    const reg = {
      user_confirmed_roof_target: false,
      frame_mismatch: "ok",
      raster_candidate_check_passed: true,
    };
    expect(canApproveManualPerimeter(reg as any)).toBe(false);
  });

  it("blocks on explicit frame mismatch even when target was confirmed", () => {
    const reg = {
      user_confirmed_roof_target: true,
      confirmed_center_inside_candidate: false,
      frame_mismatch: "mismatch",
    };
    expect(canApproveManualPerimeter(reg as any)).toBe(false);
  });
});

describe("registrationBanner — PR A: DSM-unavailable copy", () => {
  it("shows info banner when frame is OK but DSM sub-flags failed", () => {
    const reg = {
      user_confirmed_roof_target: true,
      geo_to_dsm_px_success: false,
      dsm_pixel_transform_valid: false,
      frame_mismatch: "ok",
    };
    const b = registrationBanner(reg as any);
    expect(b).not.toBeNull();
    expect(b!.variant).toBe("info");
    expect(b!.title).toMatch(/DSM registration unavailable/i);
    expect(b!.description).toMatch(/self-consistency/i);
  });

  it("does not mention 'vendor gates' anywhere", () => {
    const reg = {
      user_confirmed_roof_target: true,
      geo_to_dsm_px_success: false,
      dsm_pixel_transform_valid: false,
      frame_mismatch: "ok",
    };
    const b = registrationBanner(reg as any);
    expect(b?.description ?? "").not.toMatch(/vendor\s+gate/i);
  });
});
