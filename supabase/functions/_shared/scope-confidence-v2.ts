// ============================================================
// Confidence scoring v2 for scope match candidates.
// Weighted components + penalties; returns a MatchScoreBreakdown
// with classification and reason codes.
// ============================================================

import type { MatchScoreBreakdown, NormalizedScopeItem } from './scope-types.ts';
import { tokenSimilarity } from './scope-normalizer.ts';

const WEIGHTS = {
  canonical_key_exact: 0.35,
  unit_match: 0.10,
  section_match: 0.10,
  trade_match: 0.10,
  quantity_close: 0.10,
  total_close: 0.05,
  token_similarity: 0.15, // multiplied by similarity
  action_compatible: 0.05,
};

const PENALTIES = {
  different_trade: -0.30,
  different_unit: -0.20,
  section_mismatch_when_same_exists: -0.15,
  total_diff_over_200pct_weak_desc: -0.20,
  different_material: -0.25,
};

const MATERIAL_TYPES = ['shingle', 'tile', 'metal', 'tpo', 'epdm', 'modified bitumen', 'slate', 'wood shake'];

function detectMaterial(desc: string): string | null {
  const d = desc.toLowerCase();
  for (const m of MATERIAL_TYPES) if (d.includes(m)) return m;
  return null;
}

function actionsCompatible(a: NormalizedScopeItem['action'], b: NormalizedScopeItem['action']): boolean {
  if (a === b) return true;
  if (a === 'unknown' || b === 'unknown') return true;
  // rr is compatible with remove or replace
  if ((a === 'rr' && (b === 'remove' || b === 'replace')) || (b === 'rr' && (a === 'remove' || a === 'replace'))) {
    return true;
  }
  return false;
}

export function scoreMatch(
  carrier: NormalizedScopeItem,
  contractor: NormalizedScopeItem,
  context?: { contractorSectionsSeenOnCarrier?: boolean },
): MatchScoreBreakdown {
  const components: Record<string, number> = {};
  const penalties: Record<string, number> = {};
  const reasonCodes: string[] = [];

  // Canonical key exact
  if (carrier.canonical_key && carrier.canonical_key === contractor.canonical_key) {
    components.canonical_key_exact = WEIGHTS.canonical_key_exact;
    reasonCodes.push('canonical_key_exact');
  }
  // Unit match
  if (carrier.unit && contractor.unit && carrier.unit === contractor.unit) {
    components.unit_match = WEIGHTS.unit_match;
    reasonCodes.push('unit_match');
  } else if (carrier.unit && contractor.unit) {
    penalties.different_unit = PENALTIES.different_unit;
    reasonCodes.push('different_unit');
  }
  // Section / elevation
  if (
    carrier.section_name &&
    contractor.section_name &&
    carrier.section_name.toUpperCase() === contractor.section_name.toUpperCase()
  ) {
    components.section_match = WEIGHTS.section_match;
    reasonCodes.push('section_match');
  } else if (context?.contractorSectionsSeenOnCarrier) {
    penalties.section_mismatch_when_same_exists = PENALTIES.section_mismatch_when_same_exists;
    reasonCodes.push('section_mismatch_when_same_exists');
  }
  // Trade group
  if (carrier.trade_group === contractor.trade_group) {
    components.trade_match = WEIGHTS.trade_match;
  } else {
    penalties.different_trade = PENALTIES.different_trade;
    reasonCodes.push('different_trade');
  }
  // Quantity close (within 10%)
  if (carrier.quantity != null && contractor.quantity != null) {
    const denom = Math.max(Math.abs(carrier.quantity), Math.abs(contractor.quantity), 1);
    if (Math.abs(carrier.quantity - contractor.quantity) / denom <= 0.1) {
      components.quantity_close = WEIGHTS.quantity_close;
      reasonCodes.push('quantity_close');
    }
  }
  // Total close (within 10%)
  if (carrier.total_rcv != null && contractor.total_rcv != null) {
    const denom = Math.max(Math.abs(carrier.total_rcv), Math.abs(contractor.total_rcv), 1);
    if (Math.abs(carrier.total_rcv - contractor.total_rcv) / denom <= 0.1) {
      components.total_close = WEIGHTS.total_close;
      reasonCodes.push('total_close');
    }
  }
  // Token similarity (weighted)
  const sim = tokenSimilarity(carrier.cleaned_description, contractor.cleaned_description);
  components.token_similarity = +(WEIGHTS.token_similarity * sim).toFixed(4);
  if (sim >= 0.5) reasonCodes.push('token_similarity_high');

  // Action compatibility
  if (actionsCompatible(carrier.action, contractor.action)) {
    components.action_compatible = WEIGHTS.action_compatible;
  }

  // Material penalty (shingle vs tile vs metal)
  const matA = detectMaterial(carrier.raw_description);
  const matB = detectMaterial(contractor.raw_description);
  if (matA && matB && matA !== matB) {
    penalties.different_material = PENALTIES.different_material;
    reasonCodes.push('different_material');
  }

  // Total diff > 200% with weak description match
  if (
    carrier.total_rcv != null &&
    contractor.total_rcv != null &&
    sim < 0.3
  ) {
    const denom = Math.max(Math.abs(carrier.total_rcv), Math.abs(contractor.total_rcv), 1);
    if (Math.abs(carrier.total_rcv - contractor.total_rcv) / denom > 2.0) {
      penalties.total_diff_over_200pct_weak_desc = PENALTIES.total_diff_over_200pct_weak_desc;
      reasonCodes.push('total_diff_over_200pct_weak_desc');
    }
  }

  const compSum = Object.values(components).reduce((s, v) => s + v, 0);
  const penSum = Object.values(penalties).reduce((s, v) => s + v, 0);
  const final = Math.max(0, Math.min(1, +(compSum + penSum).toFixed(4)));

  const classification: MatchScoreBreakdown['classification'] =
    final >= 0.9 ? 'exact_match'
      : final >= 0.8 ? 'strong_fuzzy_match'
      : final >= 0.7 ? 'possible_match_needs_review'
      : 'no_match';

  return {
    components,
    penalties,
    final,
    classification,
    reason_codes: reasonCodes,
  };
}
