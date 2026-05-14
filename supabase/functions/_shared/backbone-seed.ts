// ============================================================================
// PHASE 3D — SEED BACKBONE LOCKED INTO PLANAR GRAPH
// ----------------------------------------------------------------------------
// Builds a "seed backbone" of ridge / valley / hip chains from the strongest
// available structural evidence (raw DSM edges + pre-classification + Solar
// segment azimuth groups + perimeter reflex corners) and exposes helpers so
// the autonomous-graph-solver can:
//
//   1. Insert these edges into the planar graph BEFORE face extraction.
//   2. Mark them `locked = true` so canonical-edge pruning skips them.
//   3. Demote (not delete) any locked edge that fails a downstream check
//      → mark `provisional / requires_review`.
//
// If `seed_backbone_edges_inserted > 0` but final ridge_lf = 0 and
// valley_lf = 0, callers MUST set `hard_fail_reason = 'backbone_not_applied'`
// and `result_state = 'ai_failed_topology'`.
//
// Wire-in points in autonomous-graph-solver.ts:
//   • After raw-edge classification: call buildSeedBackbone(...)
//   • Before face extraction: call insertSeedBackboneIntoGraph(graph, seed)
//   • In canonical-edge pruning: skip edges where edge.locked === true
//   • After face extraction: call detectBackboneNotApplied(seed, finalEdges)
// ============================================================================

export type PxPt = [number, number];

export type BackboneEdgeType = 'ridge' | 'valley' | 'hip';

export interface RawEdgeEvidence {
  id: string;
  type: BackboneEdgeType;
  p1: PxPt;
  p2: PxPt;
  /** DSM Sobel-magnitude support (0..1). */
  dsm_support: number;
  /** Solar azimuth-group alignment score (0..1). */
  solar_alignment: number;
  /** Whether the edge is fully inside the true outer perimeter. */
  inside_perimeter: boolean;
  /** Pre-classification confidence (0..1). */
  pre_classification_confidence: number;
}

export interface SeedBackboneInput {
  raw_edges: RawEdgeEvidence[];
  perimeter_px: PxPt[];
  /** Reflex (concave) corners of the perimeter, useful for valley anchors. */
  reflex_corners_px?: PxPt[];
  meters_per_pixel: number;
  /** Min combined evidence score (dsm × solar × pre-class) to accept. */
  min_seed_score?: number;
  /** Min length in pixels for a chain to be considered structural. */
  min_chain_length_px?: number;
}

export interface SeedBackboneEdge {
  id: string;
  type: BackboneEdgeType;
  p1: PxPt;
  p2: PxPt;
  length_px: number;
  length_lf: number;
  evidence_score: number;
  locked: true;
  /** Set to true if a downstream check failed but the edge was kept. */
  provisional: boolean;
  /** Reason the edge was demoted to provisional, if applicable. */
  prune_reason: string | null;
}

export interface SeedBackboneResult {
  /** All seed edges produced from raw evidence. */
  seed_backbone_edges: SeedBackboneEdge[];
  /** Counts grouped by type, in linear feet. */
  seed_ridge_lf: number;
  seed_valley_lf: number;
  seed_hip_lf: number;
  /** Diagnostics persisted into geometry_report_json. */
  diagnostics: SeedBackboneDiagnostics;
}

export interface SeedBackboneDiagnostics {
  phase3D_backbone_seed_version: 'v1';
  seed_backbone_edges_count: number;
  seed_backbone_edges_inserted: number;
  seed_backbone_edges_survived: number;
  seed_backbone_edges_pruned: number;
  backbone_prune_reasons: Record<string, number>;
  locked_backbone_edges_count: number;
  seed_ridge_lf: number;
  seed_valley_lf: number;
  seed_hip_lf: number;
  /**
   * Set by `detectBackboneNotApplied()` AFTER face extraction. When true,
   * caller must set hard_fail_reason='backbone_not_applied'.
   */
  backbone_not_applied: boolean;
}

const FT_PER_M = 3.28084;

export function buildSeedBackbone(input: SeedBackboneInput): SeedBackboneResult {
  const minScore = input.min_seed_score ?? 0.45;
  const minLen = input.min_chain_length_px ?? 12;
  const seed: SeedBackboneEdge[] = [];

  for (const e of input.raw_edges) {
    if (!e.inside_perimeter) continue;
    const score =
      0.45 * e.dsm_support +
      0.35 * e.solar_alignment +
      0.20 * e.pre_classification_confidence;
    if (score < minScore) continue;
    const lenPx = Math.hypot(e.p2[0] - e.p1[0], e.p2[1] - e.p1[1]);
    if (lenPx < minLen) continue;
    const lenLf = lenPx * input.meters_per_pixel * FT_PER_M;
    seed.push({
      id: `seed_${e.id}`,
      type: e.type,
      p1: e.p1,
      p2: e.p2,
      length_px: round(lenPx, 2),
      length_lf: round(lenLf, 2),
      evidence_score: round(score, 3),
      locked: true,
      provisional: false,
      prune_reason: null,
    });
  }

  const ridge_lf = sumByType(seed, 'ridge');
  const valley_lf = sumByType(seed, 'valley');
  const hip_lf = sumByType(seed, 'hip');

  return {
    seed_backbone_edges: seed,
    seed_ridge_lf: ridge_lf,
    seed_valley_lf: valley_lf,
    seed_hip_lf: hip_lf,
    diagnostics: {
      phase3D_backbone_seed_version: 'v1',
      seed_backbone_edges_count: seed.length,
      seed_backbone_edges_inserted: 0,
      seed_backbone_edges_survived: 0,
      seed_backbone_edges_pruned: 0,
      backbone_prune_reasons: {},
      locked_backbone_edges_count: seed.length,
      seed_ridge_lf: ridge_lf,
      seed_valley_lf: valley_lf,
      seed_hip_lf: hip_lf,
      backbone_not_applied: false,
    },
  };
}

/**
 * Mark seed-backbone edges as inserted into the planar graph. The solver
 * MUST call this when it actually merges them into its working edge set.
 */
export function markBackboneInserted(
  diag: SeedBackboneDiagnostics,
  insertedCount: number,
): void {
  diag.seed_backbone_edges_inserted = insertedCount;
  diag.seed_backbone_edges_survived = insertedCount;
}

/**
 * Demote a locked edge (do NOT delete it). The solver must call this in its
 * canonical-edge pruning step instead of removing the edge outright.
 */
export function demoteLockedEdge(
  edge: SeedBackboneEdge,
  diag: SeedBackboneDiagnostics,
  reason: string,
): void {
  if (edge.provisional) return;
  edge.provisional = true;
  edge.prune_reason = reason;
  diag.seed_backbone_edges_pruned++;
  diag.seed_backbone_edges_survived = Math.max(
    0,
    diag.seed_backbone_edges_inserted - diag.seed_backbone_edges_pruned,
  );
  diag.backbone_prune_reasons[reason] = (diag.backbone_prune_reasons[reason] ?? 0) + 1;
}

/**
 * Final check after face extraction. Returns true (and mutates diagnostics)
 * when the seed backbone existed but no ridge/valley survived in the final
 * planar graph. Caller MUST then set hard_fail_reason = 'backbone_not_applied'.
 */
export function detectBackboneNotApplied(
  seed: SeedBackboneResult,
  final: { ridge_lf: number; valley_lf: number },
): boolean {
  const hadStructural = seed.seed_ridge_lf > 0 || seed.seed_valley_lf > 0;
  const lostAll = final.ridge_lf <= 0 && final.valley_lf <= 0;
  const failed = hadStructural && lostAll;
  seed.diagnostics.backbone_not_applied = failed;
  return failed;
}

function sumByType(seed: SeedBackboneEdge[], type: BackboneEdgeType): number {
  let s = 0;
  for (const e of seed) if (e.type === type) s += e.length_lf;
  return round(s, 2);
}

function round(x: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(x * f) / f;
}
