import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computePitchConsensus,
  degToRisePerTwelve,
  PITCH_TOLERANCE_DEG,
  risePerTwelveToDeg,
} from "../consensus.ts";

const SIX_OVER_TWELVE = risePerTwelveToDeg(6); // ≈ 26.565°
const SEVEN_OVER_TWELVE = risePerTwelveToDeg(7);
const NINE_OVER_TWELVE = risePerTwelveToDeg(9);

Deno.test("rise/12 ↔ degrees roundtrip", () => {
  assertEquals(degToRisePerTwelve(SIX_OVER_TWELVE), "6/12");
  assertEquals(degToRisePerTwelve(NINE_OVER_TWELVE), "9/12");
});

Deno.test("3 streams within tolerance → high, consensus", () => {
  const r = computePitchConsensus({
    dsm: SIX_OVER_TWELVE,
    solar: SIX_OVER_TWELVE + 0.5,
    streetview: SIX_OVER_TWELVE - 0.8,
  });
  assertEquals(r.state, "high");
  assertEquals(r.final_source, "consensus");
  assertEquals(r.evidence_count, 3);
  assertEquals(r.agreeing_sources.length, 3);
});

Deno.test("2 streams agree, 1 outlier → medium", () => {
  const r = computePitchConsensus({
    dsm: SIX_OVER_TWELVE,
    solar: SIX_OVER_TWELVE + 0.3,
    streetview: NINE_OVER_TWELVE, // way off
  });
  assertEquals(r.state, "medium");
  // prefer dsm > solar > streetview, so final_source is dsm
  assertEquals(r.final_source, "dsm");
  assertEquals(r.agreeing_sources.sort(), ["dsm", "solar"]);
});

Deno.test("2 streams, both within tolerance → high", () => {
  const r = computePitchConsensus({
    dsm: SIX_OVER_TWELVE,
    solar: SIX_OVER_TWELVE + 1.0,
  });
  assertEquals(r.state, "high");
  assertEquals(r.final_source, "consensus");
  assertEquals(r.evidence_count, 2);
});

Deno.test("2 streams, disagree → low (hard fail)", () => {
  const r = computePitchConsensus({
    dsm: SIX_OVER_TWELVE,
    solar: NINE_OVER_TWELVE,
  });
  assertEquals(r.state, "low");
  assertEquals(r.final_deg, null);
  assertEquals(r.final_source, "none");
});

Deno.test("3 streams, all disagree → low", () => {
  const r = computePitchConsensus({
    dsm: risePerTwelveToDeg(3),
    solar: risePerTwelveToDeg(6),
    streetview: risePerTwelveToDeg(9),
  });
  assertEquals(r.state, "low");
});

Deno.test("only 1 stream → insufficient_evidence", () => {
  const r = computePitchConsensus({ dsm: SIX_OVER_TWELVE });
  assertEquals(r.state, "insufficient_evidence");
  assertEquals(r.evidence_count, 1);
});

Deno.test("0 streams → insufficient_evidence with null final", () => {
  const r = computePitchConsensus({});
  assertEquals(r.state, "insufficient_evidence");
  assertEquals(r.evidence_count, 0);
  assertEquals(r.final_deg, null);
});

Deno.test("Fonsica baseline: dsm=6/12, solar=6/12, streetview missing → high", () => {
  const r = computePitchConsensus({
    dsm: SIX_OVER_TWELVE,
    solar: SIX_OVER_TWELVE + 0.2,
    streetview: null,
  });
  assertEquals(r.state, "high");
  assertEquals(r.final_source, "consensus");
  assertEquals(degToRisePerTwelve(r.final_deg!), "6/12");
});

Deno.test("tolerance constant is documented and < 1/12 step", () => {
  // ±2.5° must be less than the gap between adjacent 1/12 steps near the
  // residential pitch band, otherwise the gate degenerates.
  const stepAt6 = risePerTwelveToDeg(7) - risePerTwelveToDeg(6);
  if (PITCH_TOLERANCE_DEG >= stepAt6) {
    throw new Error(
      `tolerance ${PITCH_TOLERANCE_DEG}° must be < 1/12 step at 6/12 (${stepAt6.toFixed(3)}°)`,
    );
  }
});
