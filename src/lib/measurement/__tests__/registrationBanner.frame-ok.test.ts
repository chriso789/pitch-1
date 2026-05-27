import { describe, it, expect } from "vitest";
import {
  registrationBanner,
  readRegistrationBlock,
} from "../registration-gate";

describe("registrationBanner — frame_mismatch source resolution", () => {
  it("returns DSM-incomplete warning when overlay_transform.frame_mismatch === 'ok' and DSM flags are false", () => {
    const measurement = {
      geometry_report_json: {
        overlay_transform: { frame_mismatch: "ok" },
        registration: {
          user_confirmed_roof_target: true,
          geo_to_dsm_px_success: false,
          dsm_pixel_transform_valid: false,
          confirmed_center_inside_candidate: true,
          coordinate_registration_gate_passed: false,
        },
      },
    };
    const reg = readRegistrationBlock(measurement);
    const banner = registrationBanner(reg);
    expect(banner).not.toBeNull();
    expect(banner!.variant).toBe("warning");
    expect(banner!.title).toBe(
      "DSM registration incomplete — manual approval locked",
    );
    expect(banner!.title.toLowerCase()).not.toContain("coordinate frame mismatch");
  });

  it("returns destructive coordinate-mismatch copy when frame_mismatch is raster_outside_dsm AND center not inside candidate", () => {
    const measurement = {
      geometry_report_json: {
        overlay_transform: { frame_mismatch: "raster_outside_dsm" },
        registration: {
          user_confirmed_roof_target: true,
          geo_to_dsm_px_success: false,
          dsm_pixel_transform_valid: false,
          confirmed_center_inside_candidate: false,
          coordinate_registration_gate_passed: false,
        },
      },
    };
    const reg = readRegistrationBlock(measurement);
    const banner = registrationBanner(reg);
    expect(banner).not.toBeNull();
    expect(banner!.variant).toBe("destructive");
    expect(banner!.title.toLowerCase()).toContain("coordinate frame mismatch");
  });

  it("infers ok from raster registration evidence and produces DSM-incomplete copy, never coord-mismatch", () => {
    const measurement = {
      geometry_report_json: {
        coordinate_space_candidate: "raster_px",
        coordinate_space_renderer: "raster_px",
        source_raster_px: { width: 1280, height: 1280 },
        confirmed_roof_center_px: { x: 640, y: 640 },
        raster_bounds_contain_confirmed_center: true,
        selected_candidate_polygon_px_present: true,
        target_mask_overlap_with_perimeter: 0.976,
        registration: {
          user_confirmed_roof_target: true,
          geo_to_dsm_px_success: false,
          dsm_pixel_transform_valid: false,
          confirmed_center_inside_candidate: true,
          coordinate_registration_gate_passed: false,
        },
      },
    };
    const reg = readRegistrationBlock(measurement);
    const banner = registrationBanner(reg);
    expect(banner).not.toBeNull();
    expect(banner!.title).toBe(
      "DSM registration incomplete — manual approval locked",
    );
  });
});
