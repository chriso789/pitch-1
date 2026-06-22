import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertPitchResultsArtifactGate } from "../artifact-gate.ts";

Deno.test("assertPitchResultsArtifactGate accepts high and medium facet consensus", () => {
  const result = assertPitchResultsArtifactGate({
    pitch_consensus: {
      status: "passed",
      facet_results: [
        { facet_id: "a", pitch_agreement_state: "high" },
        { facet_id: "b", pitch_agreement_state: "medium" },
      ],
    },
  });

  assertEquals(result.ok, true);
  assertEquals(result.score, 0.95);
});

Deno.test("assertPitchResultsArtifactGate rejects low facet consensus", () => {
  const result = assertPitchResultsArtifactGate({
    pitch_consensus: {
      status: "passed",
      facet_results: [
        { facet_id: "a", pitch_agreement_state: "high" },
        { facet_id: "b", pitch_agreement_state: "low" },
      ],
    },
  });

  assertEquals(result.ok, false);
  assertEquals(result.reason, "pitch_disagreement");
});
