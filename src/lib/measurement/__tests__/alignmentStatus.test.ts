import { describe, it, expect } from "vitest";
import { computeAlignmentStatus } from "../alignmentStatus";

// Fixture mirrors the spec exactly — raster overlay valid, DSM missing.
const fonsicaLike = {
  geometry_report_json: {
    overlay_transform: {
      coord_space: "raster_px",
      source_raster_px: { width: 1280, height: 1280 },
      crop_bbox_px: { minX: 500, minY: 471, maxX: 790, maxY: 782 },
      perimeter_bbox_center_src: [644.9, 626.4],
    },
    confirmed_roof_center_px: [640, 640],
    target_mask_overlap_with_perimeter: 0.976,
    perimeter_vs_mask_iou: 0.845,
    perimeter_centroid_offset_px: 878,
    selected_perimeter_px: [
      [600, 500],
      [780, 500],
      [780, 760],
      [600, 760],
    ],
    geo_to_dsm_transform: null,
    dsm_to_raster_transform: null,
    confirmed_roof_center_dsm_px: null,
    dsm_pixel_transform_valid: false,
    user_confirmed_roof_target: true,
  },
};

describe("computeAlignmentStatus — raster OK / DSM missing", () => {
  const s = computeAlignmentStatus(fonsicaLike);

  it("classifies raster overlay as OK", () => {
    expect(s.raster_overlay_displacement).toBe("ok");
  });

  it("classifies DSM registration as missing", () => {
    expect(s.dsm_registration_displacement).toBe("missing");
  });

  it("locks manual approval on DSM registration, not frame mismatch", () => {
    expect(s.manual_approval_lock_reason).toBe("dsm_registration_missing");
  });

  it("emits the DSM-incomplete banner copy", () => {
    expect(s.banner?.title).toBe(
      "DSM registration incomplete — manual approval locked",
    );
  });

  it("never claims coordinate frame mismatch", () => {
    const blob = JSON.stringify(s).toLowerCase();
    expect(blob).not.toContain("coordinate frame mismatch");
  });

  it("returns the explicit displacement metrics", () => {
    expect(s.metrics.perimeter_bbox_center_src).toEqual([644.9, 626.4]);
    expect(s.metrics.confirmed_center_src).toEqual([640, 640]);
    expect(s.metrics.raster_center_offset_px).toBeGreaterThan(13);
    expect(s.metrics.raster_center_offset_px).toBeLessThan(16);
    expect(s.metrics.target_mask_overlap).toBeCloseTo(0.976);
    expect(s.metrics.perimeter_vs_mask_iou).toBeCloseTo(0.845);
    expect(s.metrics.legacy_centroid_offset_px).toBe(878);
  });
});

describe("computeAlignmentStatus — explicit frame mismatch", () => {
  it("preserves frame_mismatch lock when overlay is actually wrong", () => {
    const s = computeAlignmentStatus({
      geometry_report_json: {
        overlay_transform: { frame_mismatch: "mismatch" },
        dsm_pixel_transform_valid: true,
      },
    });
    expect(s.raster_overlay_displacement).toBe("mismatch");
    expect(s.manual_approval_lock_reason).toBe("frame_mismatch");
    expect(s.banner?.title.toLowerCase()).toContain("coordinate frame mismatch");
  });
});

describe("computeAlignmentStatus — validated DSM", () => {
  it("returns no lock reason when DSM is validated and raster is OK", () => {
    const s = computeAlignmentStatus({
      geometry_report_json: {
        overlay_transform: { frame_mismatch: "ok" },
        dsm_pixel_transform_valid: true,
        user_confirmed_roof_target: true,
      },
    });
    expect(s.raster_overlay_displacement).toBe("ok");
    expect(s.dsm_registration_displacement).toBe("validated");
    expect(s.manual_approval_lock_reason).toBeNull();
    expect(s.banner).toBeNull();
  });
});

describe("computeAlignmentStatus — crop valid, coord_space missing", () => {
  it("returns aerial overlay = ok when crop bbox is valid and perimeter bbox center projects inside it", () => {
    // Live Fonsica-like payload: overlay_transform exposes a valid crop and
    // perimeter_bbox_center_src, but coord_space is not the literal
    // "raster_px" string and selected_perimeter_px isn't surfaced under that
    // exact key. The Overlay Transform diagnostics already prove the crop is
    // valid; the alignment helper must agree instead of reporting "unknown".
    const s = computeAlignmentStatus({
      geometry_report_json: {
        overlay_transform: {
          crop_bbox_px: { minX: 500, minY: 471, maxX: 790, maxY: 782 },
          perimeter_bbox_center_src: [644.9, 626.4],
          source_raster_px: { width: 1280, height: 1280 },
        },
      },
    });
    expect(s.raster_overlay_displacement).toBe("ok");
  });
});

