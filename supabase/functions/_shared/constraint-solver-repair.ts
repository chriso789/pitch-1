// ============================================================================
// PHASE 3E — CONSTRAINT SOLVER REPAIR PASS
// ----------------------------------------------------------------------------
// When every constraint-solver candidate is rejected because ridge_lf = 0
// (or valley_lf = 0 when expected), this module force-inserts the highest-
// confidence seed-backbone ridge/valley chains and re-scores. Replaces the
// current "fail immediately when 8/8 candidates rejected" behavior.
//
// Wire-in point in constraint-roof-solver.ts:
//   • After all candidates score and before returning the best:
//       if (allRejectedFor('ridge_lf=0') && seed.seed_ridge_lf > 0) {
//         const repaired = attemptRepairPass({ candidates, seed, scoreFn });
//         return repaired.selected ?? hardFail('topology_undersegmented_after_backbone_repair');
//       }
// ============================================================================

import type { SeedBackboneEdge, SeedBackboneResult } from './backbone-seed.ts';

export interface RepairCandidate {
  id: string;
  topology_type: string;
  faces: number;
  ridge_lf: number;
  valley_lf: number;
  hip_lf: number;
  area_ratio: number; // refined / target
  has_cross_roof_diagonal: boolean;
  rejected_reason: string | null;
  /** Mutable score the repair pass updates after reseeding. */
  score: number;
}

export interface RepairPassInput {
  candidates: RepairCandidate[];
  seed: SeedBackboneResult;
  /** Re-score callback after the seed is force-inserted. */
  rescore: (cand: RepairCandidate, ridgeChains: SeedBackboneEdge[], valleyChains: SeedBackboneEdge[]) => RepairCandidate;
}

export interface RepairPassResult {
  selected: RepairCandidate | null;
  diagnostics: RepairDiagnostics;
}

export interface RepairDiagnostics {
  phase3E_constraint_repair_version: 'v1';
  candidate_repair_attempted: boolean;
  repaired_ridge_chains_inserted: number;
  repaired_valley_chains_inserted: number;
  repaired_candidate_scores: { id: string; score: number; ridge_lf: number; valley_lf: number; faces: number }[];
  repair_iterations: number;
  final_selected_candidate: string | null;
  final_rejection_reason: string | null;
}

export function shouldAttemptRepair(candidates: RepairCandidate[], seed: SeedBackboneResult): boolean {
  if (!candidates.length) return false;
  const allRidgeZero = candidates.every(c => c.ridge_lf <= 0);
  const seedHasRidge = seed.seed_ridge_lf > 0;
  const allValleyZero = candidates.every(c => c.valley_lf <= 0);
  const seedHasValley = seed.seed_valley_lf > 0;
  return (allRidgeZero && seedHasRidge) || (allValleyZero && seedHasValley);
}

export function attemptRepairPass(input: RepairPassInput): RepairPassResult {
  const diag: RepairDiagnostics = {
    phase3E_constraint_repair_version: 'v1',
    candidate_repair_attempted: false,
    repaired_ridge_chains_inserted: 0,
    repaired_valley_chains_inserted: 0,
    repaired_candidate_scores: [],
    repair_iterations: 0,
    final_selected_candidate: null,
    final_rejection_reason: null,
  };

  if (!shouldAttemptRepair(input.candidates, input.seed)) {
    return { selected: null, diagnostics: diag };
  }

  diag.candidate_repair_attempted = true;

  // Pick highest-evidence seed chains.
  const ridgeChains = input.seed.seed_backbone_edges
    .filter(e => e.type === 'ridge')
    .sort((a, b) => b.evidence_score - a.evidence_score);
  const valleyChains = input.seed.seed_backbone_edges
    .filter(e => e.type === 'valley')
    .sort((a, b) => b.evidence_score - a.evidence_score);
  diag.repaired_ridge_chains_inserted = ridgeChains.length;
  diag.repaired_valley_chains_inserted = valleyChains.length;

  // Re-score every candidate with seed forced in.
  const rescored = input.candidates.map(c => {
    const result = input.rescore(c, ridgeChains, valleyChains);
    diag.repair_iterations++;
    diag.repaired_candidate_scores.push({
      id: result.id,
      score: result.score,
      ridge_lf: result.ridge_lf,
      valley_lf: result.valley_lf,
      faces: result.faces,
    });
    return result;
  });

  // Acceptance: faces↑, ridge_lf>0 (or valley_lf>0 when expected),
  // area conservation 0.95–1.05, no cross-roof diagonal dominance.
  const acceptable = rescored.filter(c =>
    c.faces > 2 &&
    (c.ridge_lf > 0 || (input.seed.seed_valley_lf > 0 && c.valley_lf > 0)) &&
    c.area_ratio >= 0.95 && c.area_ratio <= 1.05 &&
    !c.has_cross_roof_diagonal
  );

  if (acceptable.length === 0) {
    diag.final_rejection_reason = 'topology_undersegmented_after_backbone_repair';
    return { selected: null, diagnostics: diag };
  }

  acceptable.sort((a, b) => b.score - a.score);
  const winner = acceptable[0];
  diag.final_selected_candidate = winner.id;
  return { selected: winner, diagnostics: diag };
}
