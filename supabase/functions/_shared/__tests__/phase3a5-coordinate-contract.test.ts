import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { refineTrueOuterRoofPerimeter } from "../perimeter-refinement.ts";
import {
  evaluatePhase3A5FrameContract,
  selectPhase3A5TargetMaskComponent,
} from "../phase3a5-coordinate-contract.ts";

function rectMask(
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) mask[y * width + x] = 1;
  }
  return mask;
}

Deno.test("A: unknown Phase 3A.5 coordinate contract blocks scoring before perimeter_shape_not_accurate", () => {
  const result = refineTrueOuterRoofPerimeter({
    raw_perimeter_px: [[10, 10], [30, 10], [30, 30], [10, 30]],
    raw_perimeter_source: "test",
    target_mask_grid: rectMask(50, 50, 10, 10, 30, 30),
    width: 50,
    height: 50,
    meters_per_pixel: 0.1,
    perimeter_coordinate_space: "aerial_px",
    target_mask_coordinate_space: "dsm_px",
    scorer_coordinate_space: "unknown",
  });
  assertEquals(result.passed, false);
  assertEquals(result.hard_fail_reason, "coordinate_space_contract_unknown");
  assertEquals(result.diagnostics.perimeter_vs_mask_iou, null);
  assertEquals(result.diagnostics.raw_iou_vs_target, null);
  assert(
    !String(result.hard_fail_reason).includes("perimeter_shape_not_accurate"),
  );
});

Deno.test("A2: mismatched Phase 3A.5 frames without transform fail specifically", () => {
  const contract = evaluatePhase3A5FrameContract({
    perimeter_coordinate_space: "aerial_px",
    target_mask_coordinate_space: "dsm_px",
    scorer_coordinate_space: "aerial_px",
  });
  assertEquals(contract.ok, false);
  assertEquals(contract.hard_fail_reason, "coordinate_space_mismatch");
});

Deno.test("B: same-frame aerial scoring keeps overlap and IoU metrics consistent", () => {
  const result = refineTrueOuterRoofPerimeter({
    raw_perimeter_px: [[10, 10], [31, 10], [31, 31], [10, 31]],
    raw_perimeter_source: "test",
    target_mask_grid: rectMask(50, 50, 10, 10, 30, 30),
    width: 50,
    height: 50,
    meters_per_pixel: 0.1,
    perimeter_coordinate_space: "aerial_px",
    target_mask_coordinate_space: "aerial_px",
    scorer_coordinate_space: "aerial_px",
    transform_used: "none_same_aerial_frame",
    thresholds: { min_confidence: 0 },
  });
  assertEquals(result.diagnostics.coordinate_space_contract?.ok, true);
  assertEquals(result.diagnostics.scorer_coordinate_space, "aerial_px");
  assert(result.diagnostics.perimeter_vs_mask_iou !== null);
  assert(result.diagnostics.raw_iou_vs_target !== null);
  assert(
    Math.abs(
      result.diagnostics.perimeter_vs_mask_iou! -
        result.diagnostics.raw_iou_vs_target!,
    ) < 0.02,
  );
  assertEquals(
    result.diagnostics.shape_validation.target_overlap_with_perimeter,
    1,
  );
});

Deno.test("C: component selection rejects larger misaligned component before fake inside ratio can dominate", () => {
  const selection = selectPhase3A5TargetMaskComponent({
    perimeter: [[100, 100], [140, 100], [140, 140], [100, 140]],
    sqft_per_px2: 1,
    reference_area_sqft: [1600],
    components: [
      {
        id: 1,
        pixels: 5000,
        cx: 500,
        cy: 500,
        minX: 460,
        maxX: 560,
        minY: 460,
        maxY: 560,
        insidePerimeterPixels: 5000,
      },
      {
        id: 2,
        pixels: 1500,
        cx: 121,
        cy: 121,
        minX: 101,
        maxX: 139,
        minY: 101,
        maxY: 139,
        insidePerimeterPixels: 1450,
      },
    ],
  });
  assertEquals(selection.selected_component_id, 2);
  const rejected = selection.rows.find((row) => row.id === 1);
  assertEquals(
    rejected?.rejection_reason,
    "component_centroid_offset_exceeds_half_footprint_diagonal",
  );
});

Deno.test("D: component selection rejects front-yard tree blob when it misses confirmed roof anchor", () => {
  const selection = selectPhase3A5TargetMaskComponent({
    perimeter: [[320, 320], [420, 320], [420, 420], [320, 420]],
    sqft_per_px2: 1,
    reference_area_sqft: [10000],
    anchor_points: [[370, 370]],
    require_anchor_support: true,
    anchor_radius_px: 32,
    components: [
      {
        id: 1,
        pixels: 2600,
        cx: 335,
        cy: 505,
        minX: 300,
        maxX: 370,
        minY: 470,
        maxY: 540,
        insidePerimeterPixels: 250,
      },
      {
        id: 2,
        pixels: 9500,
        cx: 370,
        cy: 370,
        minX: 318,
        maxX: 423,
        minY: 318,
        maxY: 423,
        insidePerimeterPixels: 9000,
      },
    ],
  });

  assertEquals(selection.selected_component_id, 2);
  const rejected = selection.rows.find((row) => row.id === 1);
  assertEquals(rejected?.rejection_reason, "component_missing_confirmed_roof_anchor");
  assertEquals(rejected?.anchor_supported, false);
});
