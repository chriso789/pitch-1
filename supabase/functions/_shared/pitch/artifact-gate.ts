// PR #5 — pitch_results artifact gate.
// Accepts either the legacy self-consistency score block or the new per-facet
// three-stream consensus shape.

import { assertPitchResultsArtifactSelfConsistency } from "../pitch-self-consistency.ts";

export interface PitchArtifactGateResult {
  ok: boolean;
  score: number | null;
  status: string | null;
  reason: string | null;
}

const MIN_SCORE = 0.90;
const PASSING_FACET_STATES = new Set(["high", "medium"]);
const FAILING_FACET_STATES = new Set(["low", "insufficient_evidence"]);

export function assertPitchResultsArtifactGate(metadata: unknown): PitchArtifactGateResult {
  const consensus = assertConsensusShape(metadata);
  if (consensus.reason !== "pitch_consensus_shape_missing") return consensus;
  return assertPitchResultsArtifactSelfConsistency(metadata);
}

function assertConsensusShape(metadata: unknown): PitchArtifactGateResult {
  const m = (metadata ?? {}) as any;
  const block = m.pitch_consensus ?? m.pitch_agreement ?? m.pitch_verification ?? m;
  const facetResults = Array.isArray(block.facet_results) ? block.facet_results :
    Array.isArray(block.facets) ? block.facets :
    Array.isArray(m.facet_results) ? m.facet_results :
    [];

  const hasConsensusShape = facetResults.length > 0 ||
    block.pitch_agreement_state != null ||
    block.pitch_self_consistency_score != null ||
    block.score != null;
  if (!hasConsensusShape) {
    return { ok: false, score: null, status: null, reason: "pitch_consensus_shape_missing" };
  }

  const badFacet = facetResults.find((facet: any) => {
    const state = String(facet.pitch_agreement_state ?? facet.agreement_state ?? "").trim();
    return FAILING_FACET_STATES.has(state) || (state && !PASSING_FACET_STATES.has(state));
  });
  if (badFacet) {
    const state = String(badFacet.pitch_agreement_state ?? badFacet.agreement_state ?? "unknown");
    return {
      ok: false,
      score: deriveScore(block, facetResults),
      status: String(block.status ?? block.pitch_verification_status ?? "failed"),
      reason: state === "low" ? "pitch_disagreement" : `facet_pitch_agreement_${state}`,
    };
  }

  const score = deriveScore(block, facetResults);
  const status = String(block.status ?? block.pitch_verification_status ?? "passed").trim() || "passed";
  if (score == null || !Number.isFinite(score)) {
    return { ok: false, score: null, status, reason: "pitch_self_consistency_score_missing" };
  }
  if (score < MIN_SCORE) {
    return { ok: false, score, status, reason: "pitch_self_consistency_score_below_threshold" };
  }
  if (!["passed", "verified"].includes(status)) {
    return { ok: false, score, status, reason: `pitch_self_consistency_status_${status}` };
  }

  return { ok: true, score, status, reason: null };
}

function deriveScore(block: any, facets: any[]): number | null {
  const explicit = Number(block.pitch_self_consistency_score ?? block.score ?? block.topology_self_consistency_score);
  if (Number.isFinite(explicit)) return explicit;
  if (!facets.length) return null;
  let total = 0;
  for (const facet of facets) {
    const state = String(facet.pitch_agreement_state ?? facet.agreement_state ?? "").trim();
    total += state === "high" ? 1 : state === "medium" ? 0.9 : 0;
  }
  return Math.round((total / facets.length) * 10_000) / 10_000;
}
