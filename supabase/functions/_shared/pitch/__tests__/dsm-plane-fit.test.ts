import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fitFacetDsmPlane, type PxPoint } from "../dsm-plane-fit.ts";

Deno.test("fitFacetDsmPlane recovers 6/12 pitch from DSM samples", () => {
  const width = 24;
  const height = 18;
  const grid = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid[y * width + x] = 0.5 * x + (y % 3) * 0.005;
    }
  }

  const polygon: PxPoint[] = [[2, 2], [21, 2], [21, 15], [2, 15]];
  const result = fitFacetDsmPlane({
    facet_id: "facet-a",
    facet_polygon_px: polygon,
    dsm: { grid, width, height, meters_per_pixel: 1 },
    ransac: { residual_threshold_m: 0.06, min_inlier_ratio: 0.9 },
  });

  assertEquals(result.status, "passed");
  assert(result.pitch_rise_over_12 != null);
  assert(Math.abs(result.pitch_rise_over_12 - 6) < 0.2);
  assert(result.inlier_ratio >= 0.9);
});

Deno.test("fitFacetDsmPlane fails cleanly when the facet has too few DSM points", () => {
  const result = fitFacetDsmPlane({
    facet_id: "tiny",
    facet_polygon_px: [[0, 0], [1, 0], [1, 1], [0, 1]],
    dsm: { grid: [1, 1, 1, 1], width: 2, height: 2, meters_per_pixel: 1 },
    ransac: { min_points: 12 },
  });

  assertEquals(result.status, "failed");
  assertEquals(result.failure_reason, "insufficient_dsm_points");
});
