// ============================================================================
// PHASE 3C — DEFER CONNECTIVITY-ISOLATED STRUCTURAL EDGES
// ----------------------------------------------------------------------------
// Replace the previous "delete dangling edges before refinement" behavior
// with a deferral model: connectivity-isolated edges that are STILL
// structurally meaningful (DSM-supported, solar-aligned, inside perimeter,
// pre-classified as ridge/valley/hip) are moved into a deferred candidate
// list and only deleted AFTER refinement proves they are noise.
//
// Wire-in points in autonomous-graph-solver.ts:
//   • Replace the body of the dangling-edge removal step with a call to
//     `categorizeForDeferral()` for each candidate.
//   • After refinement / face split tries: call
//     `finalizeDeferredEdges(deferred, refinementOutcome)`.
// ============================================================================

export type PxPt = [number, number];

export interface DeferralCandidate {
  edge_id: string;
  original_type: 'ridge' | 'valley' | 'hip' | 'eave' | 'rake' | 'unknown';
  p1: PxPt;
  p2: PxPt;
  length_px: number;
  length_lf: number;
  inside_perimeter: boolean;
  dsm_support_score: number;
  solar_alignment_score: number;
  pre_classification_confidence: number;
  reason_deferred: string;
}

export interface DeferredEdgeDecision {
  edge_id: string;
  original_type: DeferralCandidate['original_type'];
  length_px: number;
  length_lf: number;
  inside_perimeter: boolean;
  dsm_support_score: number;
  solar_alignment_score: number;
  reason_deferred: string;
  used_for_split: boolean;
  final_status: 'reinserted' | 'rejected' | 'pending';
}

export interface DeferralDiagnostics {
  phase3C_deferred_edges_version: 'v1';
  connectivity_edges_deferred: number;
  connectivity_edges_deleted_pre_refinement: number;
  connectivity_edges_deleted_post_refinement: number;
  deferred_structural_candidates_count: number;
  deferred_edges_used_for_refinement: number;
  deferred_edges_rejected_after_refinement: number;
  deferred_edge_table: DeferredEdgeDecision[];
}

export function emptyDeferralDiagnostics(): DeferralDiagnostics {
  return {
    phase3C_deferred_edges_version: 'v1',
    connectivity_edges_deferred: 0,
    connectivity_edges_deleted_pre_refinement: 0,
    connectivity_edges_deleted_post_refinement: 0,
    deferred_structural_candidates_count: 0,
    deferred_edges_used_for_refinement: 0,
    deferred_edges_rejected_after_refinement: 0,
    deferred_edge_table: [],
  };
}

/**
 * Decide whether a connectivity-isolated edge should be deferred (kept for
 * later refinement) or deleted now. Returns null when the edge should be
 * deleted pre-refinement; returns a candidate object when it should be
 * deferred.
 */
export function categorizeForDeferral(
  c: DeferralCandidate,
  diag: DeferralDiagnostics,
): DeferralCandidate | null {
  const isStructural =
    c.original_type === 'ridge' ||
    c.original_type === 'valley' ||
    c.original_type === 'hip';
  const evidenceScore =
    0.5 * c.dsm_support_score +
    0.3 * c.solar_alignment_score +
    0.2 * c.pre_classification_confidence;

  if (isStructural && c.inside_perimeter && evidenceScore >= 0.4) {
    diag.connectivity_edges_deferred++;
    diag.deferred_structural_candidates_count++;
    diag.deferred_edge_table.push({
      edge_id: c.edge_id,
      original_type: c.original_type,
      length_px: c.length_px,
      length_lf: c.length_lf,
      inside_perimeter: c.inside_perimeter,
      dsm_support_score: c.dsm_support_score,
      solar_alignment_score: c.solar_alignment_score,
      reason_deferred: c.reason_deferred,
      used_for_split: false,
      final_status: 'pending',
    });
    return c;
  }

  diag.connectivity_edges_deleted_pre_refinement++;
  return null;
}

/**
 * After refinement attempts, mark each deferred edge as reinserted or rejected.
 * `usedForSplitIds` lists deferred edges that successfully split an oversized
 * face during refinement.
 */
export function finalizeDeferredEdges(
  diag: DeferralDiagnostics,
  usedForSplitIds: Set<string>,
): void {
  for (const row of diag.deferred_edge_table) {
    if (row.final_status !== 'pending') continue;
    if (usedForSplitIds.has(row.edge_id)) {
      row.used_for_split = true;
      row.final_status = 'reinserted';
      diag.deferred_edges_used_for_refinement++;
    } else {
      row.final_status = 'rejected';
      diag.deferred_edges_rejected_after_refinement++;
      diag.connectivity_edges_deleted_post_refinement++;
    }
  }
}
