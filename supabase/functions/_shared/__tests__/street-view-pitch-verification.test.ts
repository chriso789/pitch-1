import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkStreetViewPitchAgainstReference,
  estimatePitchFromStreetViewEdgeAngle,
} from "../street-view-pitch-verification.ts";

Deno.test("estimatePitchFromStreetViewEdgeAngle converts edge angle to rise over 12", () => {
  // atan(0.5) = 26.565°, so corrected image angle should estimate ~6/12.
  const pitch = estimatePitchFromStreetViewEdgeAngle({ edge_angle_deg: 26.565, horizon_angle_deg: 0, camera_pitch_deg: 0 });
  assertEquals(Math.round((pitch ?? 0) * 10) / 10, 6.0);
});

Deno.test("checkStreetViewPitchAgainstReference passes when visual edge agrees", () => {
  const result = checkStreetViewPitchAgainstReference({
    facet_id: "front",
    edge_angle_deg: 26.565,
    horizon_angle_deg: 0,
    camera_pitch_deg: 0,
    confidence: 0.8,
    metadata: { status: "OK" },
  }, 6.1);

  assertEquals(result.status, "passed");
  assertEquals(result.reason, null);
});

Deno.test("checkStreetViewPitchAgainstReference marks unavailable metadata as unavailable", () => {
  const result = checkStreetViewPitchAgainstReference({
    facet_id: "front",
    edge_angle_deg: 26.565,
    confidence: 0.8,
    metadata: { status: "ZERO_RESULTS" },
  }, 6.0);

  assertEquals(result.status, "unavailable");
  assertEquals(result.available, false);
});
