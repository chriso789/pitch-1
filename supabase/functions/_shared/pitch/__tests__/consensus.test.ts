import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { degreesToRiseOver12, scorePitchConsensus } from "../consensus.ts";

Deno.test("scorePitchConsensus marks Fonsica-style 6/12 agreement as high", () => {
  const result = scorePitchConsensus({
    facet_id: "fonsica-front",
    evidences: [
      { stream: "dsm", pitch_rise_over_12: 6.0, confidence: 0.95 },
      { stream: "solar", pitch_degrees: 26.565, confidence: 0.78 },
      { stream: "streetview", pitch_rise_over_12: 6.1, confidence: 0.72 },
    ],
  });

  assertEquals(result.pitch_agreement_state, "high");
  assertEquals(result.pitch_confidence, "high");
  assertEquals(result.pitch_source_final, "dsm");
  assertEquals(result.hard_fail_reason, null);
  assertEquals(result.block_customer_report, false);
});

Deno.test("scorePitchConsensus marks two agreeing streams as medium consensus", () => {
  const result = scorePitchConsensus({
    facet_id: "two-of-three",
    evidences: [
      { stream: "dsm", pitch_rise_over_12: 4.0, confidence: 0.95 },
      { stream: "solar", pitch_rise_over_12: 8.0, confidence: 0.70 },
      { stream: "streetview", pitch_rise_over_12: 8.2, confidence: 0.75 },
    ],
  });

  assertEquals(result.pitch_agreement_state, "medium");
  assertEquals(result.pitch_confidence, "medium");
  assertEquals(result.pitch_source_final, "consensus");
  assertEquals(result.agreeing_streams, ["solar", "streetview"]);
  assertEquals(result.block_customer_report, false);
});

Deno.test("scorePitchConsensus hard-fails when all usable streams disagree", () => {
  const result = scorePitchConsensus({
    facet_id: "wrong-topology",
    evidences: [
      { stream: "dsm", pitch_rise_over_12: 3.0, confidence: 0.95 },
      { stream: "solar", pitch_rise_over_12: 6.0, confidence: 0.70 },
      { stream: "streetview", pitch_rise_over_12: 9.0, confidence: 0.75 },
    ],
  });

  assertEquals(result.pitch_agreement_state, "low");
  assertEquals(result.pitch_confidence, "low");
  assertEquals(result.hard_fail_reason, "pitch_disagreement");
  assertEquals(result.block_customer_report, true);
});

Deno.test("scorePitchConsensus blocks publication when fewer than two streams are usable", () => {
  const result = scorePitchConsensus({
    facet_id: "missing-evidence",
    evidences: [{ stream: "dsm", pitch_rise_over_12: 6.0 }],
  });

  assertEquals(result.pitch_agreement_state, "insufficient_evidence");
  assertEquals(result.pitch_source_final, "unavailable");
  assertEquals(result.block_customer_report, true);
});

Deno.test("degreesToRiseOver12 converts 26.565 degrees to approximately 6/12", () => {
  const rise = degreesToRiseOver12(26.565);
  assertEquals(Math.round((rise ?? 0) * 10) / 10, 6.0);
});
