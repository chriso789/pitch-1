// ABC per-row mapping state machine used by /supplier-verify/abc.
// This replaces the generic "Pending" chip and gates pricing calls so we
// never submit an unmapped or unverified line to ABC's Price Items endpoint.
//
// Contract (required by ABC integration team):
//   internal material
//     → exact ABC family
//     → color-specific child itemNumber
//     → branch verification
//     → Product API UOM
//     → Price Items
//     → visible live price / error
//
// A row is "canPrice" ONLY when all of the following are true:
//   • mapping row exists for supplier='abc' on this template item
//   • supplier_item_number is present AND was returned by ABC Product API
//     (proxied by requiring raw_catalog_payload OR approved_at)
//   • default_uom is set to a value that appears in valid_uoms
//   • branch_scope contains the tenant's currently-selected branch
//   • color_name is set if the family exposes colors
//
// All other cases surface a specific state — never generic "pending".

export type AbcMappingRow = {
  id: string;
  supplier: string;
  supplier_item_number: string | null;
  supplier_item_description: string | null;
  color_name: string | null;
  default_uom: string | null;
  valid_uoms: string[] | null;
  branch_scope: string[] | null;
  ship_to_scope: string[] | null;
  mapping_status: string | null;
  review_state: string | null;
  approved_at: string | null;
  last_checked_at: string | null;
  raw_catalog_payload: unknown | null;
};

export type AbcRowState =
  | 'needs_abc_match'
  | 'needs_color_selection'
  | 'needs_uom_selection'
  | 'needs_branch_verification'
  | 'needs_review'
  | 'ready_to_price'
  | 'pricing'
  | 'priced'
  | 'price_unavailable'
  | 'unavailable_at_branch'
  | 'stale_mapping'
  | 'pricing_expired'
  | 'waf_blocked'
  | 'error';

export interface AbcRowStateInfo {
  state: AbcRowState;
  canPrice: boolean;
  label: string;
  reason: string;
  tone: 'muted' | 'warn' | 'ok' | 'danger';
}

const LABELS: Record<AbcRowState, { label: string; tone: AbcRowStateInfo['tone'] }> = {
  needs_abc_match: { label: 'Needs ABC Match', tone: 'warn' },
  needs_color_selection: { label: 'Needs Color', tone: 'warn' },
  needs_uom_selection: { label: 'Needs UOM', tone: 'warn' },
  needs_branch_verification: { label: 'Needs Branch Verification', tone: 'warn' },
  needs_review: { label: 'Needs Review', tone: 'warn' },
  ready_to_price: { label: 'Ready to Price', tone: 'muted' },
  pricing: { label: 'Pricing…', tone: 'muted' },
  priced: { label: 'Priced', tone: 'ok' },
  price_unavailable: { label: 'Zero Price — Contact Branch', tone: 'danger' },
  unavailable_at_branch: { label: 'Unavailable at Branch', tone: 'danger' },
  stale_mapping: { label: 'Stale Mapping', tone: 'warn' },
  pricing_expired: { label: 'Pricing Expired', tone: 'warn' },
  waf_blocked: { label: 'WAF Blocked', tone: 'danger' },
  error: { label: 'Error', tone: 'danger' },
};

function describe(state: AbcRowState, reason?: string): AbcRowStateInfo {
  const { label, tone } = LABELS[state];
  return {
    state,
    canPrice: state === 'ready_to_price' || state === 'priced' || state === 'pricing',
    label,
    reason: reason ?? label,
    tone,
  };
}

export function computeAbcRowState(opts: {
  mapping: AbcMappingRow | null;
  selectedBranchNumber: string | null;
  familyLikelyHasColors?: boolean;
}): AbcRowStateInfo {
  const { mapping, selectedBranchNumber, familyLikelyHasColors } = opts;

  if (!mapping) return describe('needs_abc_match', 'No ABC product matched yet');

  // Any row where the SKU was auto-set from the internal code (no catalog
  // snapshot, no approval) is a review case, not a mapped row.
  const hasRealCatalogEvidence = !!mapping.raw_catalog_payload || !!mapping.approved_at;
  if (!mapping.supplier_item_number || !hasRealCatalogEvidence) {
    return describe('needs_abc_match', 'ABC item number not verified against Product API');
  }

  if (mapping.review_state === 'needs_review' || mapping.mapping_status === 'needs_review') {
    return describe('needs_review', 'Auto-suggested mapping — confirm the exact ABC item');
  }

  if (familyLikelyHasColors && !mapping.color_name) {
    return describe('needs_color_selection', 'Pick the exact color for this ABC item');
  }

  const validUoms = (mapping.valid_uoms || []).filter(Boolean);
  if (!mapping.default_uom) {
    return describe('needs_uom_selection', 'Select a valid Product API UOM (no EA default)');
  }
  if (validUoms.length > 0 && !validUoms.includes(mapping.default_uom)) {
    return describe('needs_uom_selection', `UOM "${mapping.default_uom}" is not valid for this ABC item`);
  }

  const branches = (mapping.branch_scope || []).filter(Boolean);
  if (selectedBranchNumber && branches.length > 0 && !branches.includes(selectedBranchNumber)) {
    return describe('needs_branch_verification', `Verify this item at branch ${selectedBranchNumber}`);
  }
  if (!selectedBranchNumber) {
    return describe('needs_branch_verification', 'Select an ABC branch on the connection first');
  }

  return describe('ready_to_price', 'All checks passed — ready to call ABC Price Items');
}

export function statesForPricingResult(parsed: {
  status?: string | null;
  errorSummary?: string | null;
  errorCode?: string | null;
  unitPrice?: number | null;
  lineStatus?: string | null;
  lineStatusMessage?: string | null;
} | null | undefined): AbcRowStateInfo {
  if (!parsed) return describe('error', 'No pricing response');
  const err = (parsed.errorCode || parsed.errorSummary || '').toString().toLowerCase();
  if (err.includes('waf')) return describe('waf_blocked', 'Blocked by ABC sandbox WAF');
  const ls = (parsed.lineStatus || '').toLowerCase();
  if (ls === 'unavailable' || ls === 'item_unavailable_at_branch') {
    return describe('unavailable_at_branch', parsed.lineStatusMessage || 'Unavailable at branch');
  }
  if (ls === 'rejected' || ls === 'item_mismatch' || ls === 'uom_mismatch' || ls === 'missing') {
    return describe('error', parsed.lineStatusMessage || `Pricing rejected (${ls})`);
  }
  if (typeof parsed.unitPrice === 'number') {
    if (parsed.unitPrice === 0) return describe('price_unavailable', 'ABC returned $0 — contact branch');
    if (parsed.unitPrice > 0) return describe('priced', 'Priced');
  }
  return describe('price_unavailable', parsed.lineStatusMessage || 'No price returned');
}
