import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyPitchPerFacet } from "../verify.ts";

Deno.test("verifyPitchPerFacet returns high agreement when DSM, Solar, and visual match", () => {
  const width = 20;
  const height = 20;
  const grid = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) grid[y * width + x] = 0.5 * x;
  }

  const result = verifyPitchPerFacet({
    dsm: { grid, width, height, meters_per_pixel: 1 },
    facets: [{
      facet_id: "front",
      polygon_px: [[2, 2], [17, 2], [17, 17], [2, 17]],
      centroid_px: [9.5, 9.5],
      azimuth_degrees: 180,
      streetview: { edge_angle_deg: 26.565, confidence: 0.8, metadata: { status: "OK" } },
    }],
    solar_segments: [{ id: "s1", pitchDegrees: 26.565, azimuthDegrees: 180, centerPx: [10, 10] }],
  });

  assertEquals(result.status, "passed");
  assertEquals(result.block_customer_report, false);
  assertEquals(result.facet_results[0].pitch_agreement_state, "high");
  assertEquals(result.facet_results[0].db_patch.pitch_agreement_state, "high");
});

Deno.test("verifyPitchPerFacet hard-fails when pitch streams disagree", () => {
  const width = 20;
  const height = 20;
  const grid = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) grid[y * width + x] = 0.25 * x;
  }

  const result = verifyPitchPerFacet({
    dsm: { grid, width, height, meters_per_pixel: 1 },
    facets: [{
      facet_id: "bad",
      polygon_px: [[2, 2], [17, 2], [17, 17], [2, 17]],
      centroid_px: [9.5, 9.5],
      streetview: { edge_angle_deg: 36.87, confidence: 0.8, metadata: { status: "OK" } },
    }],
    solar_segments: [{ id: "s1", pitchDegrees: 26.565, centerPx: [10, 10] }],
  });

  assertEquals(result.status, "failed");
  assertEquals(result.hard_fail_reason, "pitch_disagreement");
  assertEquals(result.facet_results[0].pitch_agreement_state, "low");
});
