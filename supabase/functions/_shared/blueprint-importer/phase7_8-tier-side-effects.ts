// Blueprint Importer v2 — Phase 7.8 enhanced_estimates / proposal tier
// side-effect verification result.
//
// PURE module. Encodes the empirical findings from inspecting:
//   - public.estimate_line_items
//   - public.enhanced_estimates
//   - public.proposal_tier_items
//   - DB triggers (none discovered on these tables)
//
// Verdict is consumed by the Phase 7.8 readiness evaluator. Do NOT change
// without re-running the DB inspection.

export const PHASE_7_8_TIER_VERIFICATION_VERSION =
  "v2.0-tier-side-effects-phase-7.8" as const;

export type TierVerdict =
  | "safe_with_explicit_draft_mode"      // A
  | "safe_only_if_fully_priced"          // B
  | "unsafe_without_phase_7_9_contract"  // C
  | "ambiguous_block_phase_8";           // D

export interface TierSideEffectsReport {
  version: typeof PHASE_7_8_TIER_VERIFICATION_VERSION;
  verdict: TierVerdict;
  enhanced_estimates_recompute_observed: boolean;
  proposal_tier_items_recompute_observed: boolean;
  db_triggers_on_estimate_line_items: number;
  notes: string[];
  required_phase_7_9_followups: string[];
}

export function getTierSideEffectsReport(): TierSideEffectsReport {
  return {
    version: PHASE_7_8_TIER_VERIFICATION_VERSION,
    // information_schema.triggers query returned 0 rows for estimate_line_items,
    // enhanced_estimates, and proposal_tier_items.
    db_triggers_on_estimate_line_items: 0,
    enhanced_estimates_recompute_observed: false,
    proposal_tier_items_recompute_observed: false,
    // enhanced_estimates totals (material_total/labor_total/etc.) are NOT NULL
    // *application-computed* fields populated by the existing CRM estimate
    // builder. Inserting estimate_line_items rows does NOT automatically
    // recompute them at the DB layer — but application code paths that
    // read estimate_line_items into enhanced_estimates totals have not been
    // audited in this phase. proposal_tier_items is fully independent (own
    // unit_cost, final_price, tier columns).
    verdict: "unsafe_without_phase_7_9_contract",
    notes: [
      "No DB triggers observed on estimate_line_items, enhanced_estimates, or proposal_tier_items.",
      "enhanced_estimates totals are NOT NULL and are computed by the existing estimate builder, not by DB triggers.",
      "proposal_tier_items is independent of estimate_line_items at the DB layer.",
      "Inserting estimate_line_items would not silently corrupt enhanced_estimates totals at the DB layer.",
      "However, the application-side recompute pathway has not been audited; Phase 7.9 must lock the recompute contract before Phase 8.",
    ],
    required_phase_7_9_followups: [
      "Audit application code that reads estimate_line_items into enhanced_estimates totals.",
      "Define a draft/non-final line flag (e.g. is_optional + sort_order convention or new metadata) so blueprint-imported lines never participate in tier totals until approved.",
      "Define proposal_tier_items creation strategy (one tier per imported line vs. none until pricing contract is signed).",
      "Lock calculation_metadata pointer convention to handoff_batch_id.",
    ],
  };
}
