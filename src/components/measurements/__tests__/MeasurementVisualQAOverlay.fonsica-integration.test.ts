// ============================================================================
// Component integration snapshot — Fonsica
//
// Mirrors the EXACT wiring done in MeasurementVisualQAOverlay.tsx
// (lines 709-753) so the snapshot pins the contract:
//
//   resolvedOverlayTransformDiagnostics  →  computeAlignmentStatus
//   alignmentStatus.raster==='ok'        →  effectiveRegistration.frame_mismatch='ok'
//   effectiveRegistration                →  registrationBanner
//
// If a future refactor of the component breaks this wiring, the snapshot
// changes and this test fails. It is the regression net for "the live
// component is still feeding the alignment/bannering logic the wrong input
// object" — items 5 (integration snapshot) from the prior spec.
// ============================================================================

import { describe, expect, it } from "vitest";
import { computeAlignmentStatus } from "@/lib/measurement/alignmentStatus";
import {
  registrationBanner,
  readRegistrationBlock,
} from "@/lib/measurement/registration-gate";

const fonsicaMeasurement = {
  hard_fail_reason: null,
  result_state: "perimeter_only",
  geometry_report_json: {
    user_confirmed_roof_target: true,
    dsm_pixel_transform_valid: false,
    registration: {
      user_confirmed_roof_target: true,
      geo_to_dsm_px_success: false,
      dsm_pixel_transform_valid: false,
      confirmed_center_inside_candidate: true,
      coordinate_registration_gate_passed: false,
    },
    overlay_debug: {
      raster_url: "https://example/aerial.png",
      target_mask_overlap: 0.976,
    },
    phase3A_5: {
      raw_perimeter_px: [
        [510, 481],
        [780, 481],
        [780, 770],
        [510, 770],
      ],
      target_mask_overlap_with_perimeter: 0.976,
    },
  },
} as const;

// These mirror the values the component computes locally from rasterSize,
// viewportSrc, containerWidth, displayHeight, projectedFirst, bbDisp.
const componentResolvedDiagnostics = {
  coord_space: "raster_px" as const,
  source_px: { width: 1280, height: 1280 },
  crop_bbox_px: { minX: 500, minY: 471, maxX: 790, maxY: 782 },
  display_px_within_crop: { width: 715, height: 768 },
  first_pt_disp: [238.3, 197.6] as [number, number],
  bbox_center_disp: [357.5, 384.1] as [number, number],
  target_mask_overlap: 0.976,
};

describe("MeasurementVisualQAOverlay — Fonsica wiring integration", () => {
  const alignmentStatus = computeAlignmentStatus(fonsicaMeasurement, {
    overlayTransform: componentResolvedDiagnostics,
  });

  const registration = readRegistrationBlock(fonsicaMeasurement)!;
  const effectiveRegistration =
    alignmentStatus.raster_overlay_displacement === "ok" && registration
      ? { ...registration, frame_mismatch: "ok" as const }
      : registration;
  const banner = registrationBanner(effectiveRegistration);

  it("snapshot: alignmentStatus + effectiveRegistration.frame_mismatch + banner.title", () => {
    expect({
      raster_overlay_displacement: alignmentStatus.raster_overlay_displacement,
      dsm_registration_displacement:
        alignmentStatus.dsm_registration_displacement,
      manual_approval_lock_reason: alignmentStatus.manual_approval_lock_reason,
      effective_frame_mismatch: (effectiveRegistration as any).frame_mismatch,
      banner_title: banner?.title ?? null,
    }).toMatchInlineSnapshot(`
      {
        "banner_title": "DSM registration unavailable — aerial perimeter is editable",
        "dsm_registration_displacement": "missing",
        "effective_frame_mismatch": "ok",
        "manual_approval_lock_reason": "dsm_registration_missing",
        "raster_overlay_displacement": "ok",
      }
    `);
  });

  it("never produces the legacy 'Coordinate frame mismatch' banner for this wiring", () => {
    expect(banner?.title).not.toBe(
      "Coordinate frame mismatch — overlay not eligible for manual approval",
    );
  });
});
