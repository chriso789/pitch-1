// PR A-2b — DSM candidate check skipped (raster_px) must not block manual approval.
//
// Run with: bunx vitest run src/lib/measurement/__tests__/registration-gate-pr-a2b.test.ts

import { describe, expect, it } from "vitest";
import {
  canApproveManualPerimeter,
  registrationBanner,
} from "../registration-gate";

describe("PR A-2b — manual approval gate (Fonsica raster-valid / DSM-missing)", () => {
  const reg = {
    user_confirmed_roof_target: true,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: false,
    // DSM candidate check was skipped because the candidate is in raster_px.
    confirmed_center_inside_candidate: null,
    coordinate_registration_gate_passed: false,
    raster_candidate_check_passed: true,
    dsm_candidate_check_skipped: true,
    candidate_coordinate_space: "raster_px",
    frame_mismatch: null,
    dsm_registration_status: "unavailable_but_aerial_perimeter_editable",
  } as any;

  it("enables manual approval when DSM check is skipped and raster gate passed", () => {
    expect(canApproveManualPerimeter(reg)).toBe(true);
  });

  it("still enables approval when confirmed_center_inside_candidate is stale-false but DSM was skipped", () => {
    const stale = { ...reg, confirmed_center_inside_candidate: false };
    expect(canApproveManualPerimeter(stale)).toBe(true);
  });

  it("banner does NOT list confirmed_center_inside_candidate as failed when DSM check is skipped", () => {
    const stale = { ...reg, confirmed_center_inside_candidate: false };
    const b = registrationBanner(stale);
    expect(b).not.toBeNull();
    expect(b!.failedFlags).not.toContain("confirmed_center_inside_candidate");
    expect(b!.title).toMatch(/DSM registration unavailable/i);
    expect(b!.description).toMatch(/self-consistency/i);
    expect(b!.description).not.toMatch(/vendor\s+gate/i);
    expect(b!.description).not.toMatch(/benchmark\s+gate/i);
  });

  it("still blocks when operator never confirmed the target roof", () => {
    expect(
      canApproveManualPerimeter({ ...reg, user_confirmed_roof_target: false }),
    ).toBe(false);
  });
});
