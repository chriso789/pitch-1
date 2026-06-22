import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { lookupSolarPitchForFacet } from "../solar-pitch-lookup.ts";
import { buildStreetViewPitchEvidence, projectStreetViewEdgeAngleToPitch } from "../streetview-edge-angle.ts";

Deno.test("lookupSolarPitchForFacet selects nearest Solar segment and converts pitch", () => {
  const result = lookupSolarPitchForFacet({
    facet_id: "front",
    centroid_px: [100, 100],
    azimuth_degrees: 180,
  }, [
    { id: "far", pitchDegrees: 10, azimuthDegrees: 90, centerPx: [300, 300] },
    { id: "near", pitchDegrees: 26.565, azimuthDegrees: 182, centerPx: [104, 98] },
  ]);

  assertEquals(result.status, "matched");
  assertEquals(result.solar_segment_id, "near");
  assertEquals(Math.round((result.pitch_rise_over_12 ?? 0) * 10) / 10, 6.0);
});

Deno.test("lookupSolarPitchForFacet reports unavailable when no pitch-bearing segment exists", () => {
  const result = lookupSolarPitchForFacet({ facet_id: "front", centroid_px: [100, 100] }, [
    { id: "bad", centerPx: [100, 100] },
  ]);

  assertEquals(result.status, "unavailable");
  assertEquals(result.pitch_rise_over_12, null);
});

Deno.test("projectStreetViewEdgeAngleToPitch converts corrected visual edge angle to 6/12", () => {
  const projected = projectStreetViewEdgeAngleToPitch({
    edge_angle_deg: 28.565,
    horizon_angle_deg: 2,
    camera_pitch_deg: 0,
  });

  assertEquals(Math.round((projected.pitch_rise_over_12 ?? 0) * 10) / 10, 6.0);
});

Deno.test("buildStreetViewPitchEvidence reports unavailable when pano metadata is unavailable", () => {
  const evidence = buildStreetViewPitchEvidence({
    facet_id: "front",
    edge_angle_deg: 26.565,
    metadata: { status: "ZERO_RESULTS" },
  });

  assertEquals(evidence.status, "unavailable");
  assertEquals(evidence.pitch_rise_over_12, null);
});
