// ============================================================
// Shared types for the supplement comparison engine (layer 2).
// Single source of truth for normalized items, matches, assembly
// findings, reconciliation results and compare summaries.
// ============================================================

export type ScopeSource = 'carrier' | 'contractor';

export type ScopeAction =
  | 'remove'
  | 'replace'
  | 'rr'
  | 'clean'
  | 'paint'
  | 'unknown';

export type ParserLayout = 'A' | 'B' | 'unknown';

export interface NormalizedScopeItem {
  source: ScopeSource;
  document_id: string;
  line_item_id: string | null;
  line_number: number | null;
  section_name: string | null;
  raw_description: string;
  cleaned_description: string;
  action: ScopeAction;
  canonical_key: string;
  canonical_group: string;
  trade_group: string;
  quantity: number | null;
  unit: string | null;
  remove_price: number | null;
  replace_price: number | null;
  unit_price: number | null;
  tax: number | null;
  total_rcv: number | null;
  total_acv: number | null;
  depreciation_amount: number | null;
  page_number: number | null;
  raw_line: string | null;
  previous_line?: string | null;
  next_line?: string | null;
  parser_layout: ParserLayout;
  confidence: number;
  /**
   * Deterministic per-row fingerprint:
   * sha1(canonical_key | unit | section_name | line_number | round(qty,2) | round(total,2)).
   * Used to prevent accidental merge across elevations.
   */
  fingerprint: string;
}

// ------------------------------------------------------------
// Matches & compare results
// ------------------------------------------------------------

export type CompareResultType =
  | 'exact_match'
  | 'strong_fuzzy_match'
  | 'possible_match_needs_review'
  | 'no_match'
  | 'quantity_delta'
  | 'price_delta'
  | 'price_list_delta_possible'
  | 'missing_from_carrier'
  | 'missing_from_contractor'
  | 'grouped_quantity_delta'
  | 'grouped_total_delta'
  | 'grouped_missing_from_carrier'
  | 'grouped_possible_duplicate'
  | 'assembly_finding';

export type CompareSeverity = 'info' | 'warning' | 'critical';

export interface MatchScoreBreakdown {
  components: Record<string, number>;
  penalties: Record<string, number>;
  final: number;
  classification:
    | 'exact_match'
    | 'strong_fuzzy_match'
    | 'possible_match_needs_review'
    | 'no_match';
  reason_codes: string[];
}

export interface ScopeMatch {
  carrier: NormalizedScopeItem | null;
  contractor: NormalizedScopeItem | null;
  result_type: CompareResultType;
  severity: CompareSeverity;
  score: MatchScoreBreakdown;
  group_id?: string | null;
  parent_result_id?: string | null;
  grouped_children?: ScopeMatch[];
  quantity_delta?: number | null;
  unit_price_delta?: number | null;
  total_rcv_delta?: number | null;
  /** Optional pre-built justification, filled by the builder before persist. */
  justification?: SupplementJustification | null;
}

// ------------------------------------------------------------
// Assemblies
// ------------------------------------------------------------

export interface AssemblyFinding {
  rule_id: string;
  rule_name: string;
  trade_group: string;
  triggered_by: ScopeSource[];
  missing_on_carrier: string[];
  missing_on_contractor: string[];
  severity: CompareSeverity;
  explanation: string;
  related_items: {
    carrier: string[];
    contractor: string[];
  };
}

// ------------------------------------------------------------
// Reconciliation
// ------------------------------------------------------------

export interface ParsedHeaderTotals {
  line_item_total?: number | null;
  tax_amount?: number | null;
  total_rcv?: number | null;
  total_acv?: number | null;
  deductible?: number | null;
  net_claim?: number | null;
}

export type ReconciliationStatus = 'pass' | 'warning' | 'fail';

export interface ReconciliationResult {
  sum_line_total_before_tax: number;
  sum_tax: number;
  sum_total_rcv: number;
  stated_line_item_total: number | null;
  stated_tax: number | null;
  stated_total_rcv: number | null;
  delta_line_item_total: number | null;
  delta_tax: number | null;
  delta_total_rcv: number | null;
  percent_delta_total_rcv: number | null;
  passed: boolean;
  status: ReconciliationStatus;
  warnings: string[];
}

// ------------------------------------------------------------
// Compare summary
// ------------------------------------------------------------

export interface ScopeCompareSummary {
  carrier_document_id: string;
  contractor_document_id: string;
  carrier_total_rcv: number;
  contractor_total_rcv: number;
  rcv_difference: number;
  carrier_price_list: string | null;
  contractor_price_list: string | null;
  price_list_mismatch: boolean;
  price_list_explanation: string | null;
  carrier_estimate_date: string | null;
  contractor_estimate_date: string | null;
  reconciliation: {
    carrier: ReconciliationResult | null;
    contractor: ReconciliationResult | null;
  };
  totals: {
    matches: number;
    quantity_deltas: number;
    price_deltas: number;
    missing_from_carrier: number;
    missing_from_contractor: number;
    grouped_findings: number;
    assembly_findings: number;
    needs_review: number;
  };
  blocking_reasons: string[];
  can_mark_final: boolean;
}

export type ScopeCompareIssue = ScopeMatch | (AssemblyFinding & { kind: 'assembly_finding' });

// ------------------------------------------------------------
// Justification text bundle
// ------------------------------------------------------------

export interface SupplementJustification {
  plain_english: string;
  contractor_facing: string;
  adjuster_facing: string;
  internal_reviewer: string;
}
