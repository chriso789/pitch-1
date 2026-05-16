// ============================================================
// Scope reconciler — verifies parsed line items reconcile with
// the carrier's stated header totals (line-item total, tax, RCV).
// PASS  <= 2% or $2 delta
// WARN  2% – 5%
// FAIL  > 5%
// ============================================================

import type {
  NormalizedScopeItem,
  ParsedHeaderTotals,
  ReconciliationResult,
} from './scope-types.ts';

const PASS_PCT = 0.02;
const PASS_DOLLARS = 2.0;
const WARN_PCT = 0.05;

function sum(arr: (number | null | undefined)[]): number {
  let total = 0;
  for (const v of arr) if (v != null && Number.isFinite(v)) total += v;
  return +total.toFixed(2);
}

function pctDelta(stated: number | null, calc: number): number | null {
  if (stated === null || stated === undefined) return null;
  const denom = Math.max(Math.abs(stated), 1);
  return +((calc - stated) / denom).toFixed(4);
}

function classify(stated: number | null, calc: number): 'pass' | 'warning' | 'fail' {
  if (stated === null || stated === undefined) return 'pass';
  const absDelta = Math.abs(calc - stated);
  if (absDelta <= PASS_DOLLARS) return 'pass';
  const pct = absDelta / Math.max(Math.abs(stated), 1);
  if (pct <= PASS_PCT) return 'pass';
  if (pct <= WARN_PCT) return 'warning';
  return 'fail';
}

export interface ReconcileParams {
  documentId: string;
  parsedLineItems: Array<
    Pick<NormalizedScopeItem, 'total_rcv' | 'total_acv' | 'tax' | 'unit_price' | 'quantity'>
  >;
  parsedHeaderTotals: ParsedHeaderTotals;
}

/**
 * Reconciles a parsed document's line items against its stated header totals.
 *
 * Returns a ReconciliationResult that is safe to persist into
 * `insurance_scope_documents.raw_json_output.reconciliation`.
 */
export function reconcileParsedDocument(params: ReconcileParams): ReconciliationResult {
  const { parsedLineItems, parsedHeaderTotals } = params;

  // Approximate line-total-before-tax by subtracting tax from total_rcv per row.
  const beforeTaxValues = parsedLineItems.map((li) => {
    const total = li.total_rcv ?? null;
    const tax = li.tax ?? 0;
    if (total === null) return null;
    return +(total - tax).toFixed(2);
  });

  const sumLineTotalBeforeTax = sum(beforeTaxValues);
  const sumTax = sum(parsedLineItems.map((li) => li.tax ?? null));
  const sumTotalRcv = sum(parsedLineItems.map((li) => li.total_rcv ?? null));

  const stated_line_item_total = parsedHeaderTotals.line_item_total ?? null;
  const stated_tax = parsedHeaderTotals.tax_amount ?? null;
  const stated_total_rcv = parsedHeaderTotals.total_rcv ?? null;

  const delta_line_item_total =
    stated_line_item_total !== null ? +(sumLineTotalBeforeTax - stated_line_item_total).toFixed(2) : null;
  const delta_tax = stated_tax !== null ? +(sumTax - stated_tax).toFixed(2) : null;
  const delta_total_rcv =
    stated_total_rcv !== null ? +(sumTotalRcv - stated_total_rcv).toFixed(2) : null;
  const percent_delta_total_rcv = pctDelta(stated_total_rcv, sumTotalRcv);

  const rcvStatus = classify(stated_total_rcv, sumTotalRcv);
  const litStatus = classify(stated_line_item_total, sumLineTotalBeforeTax);
  // Tax is allowed wider band — treat as informational only
  const taxStatus = classify(stated_tax, sumTax);

  // Roll-up: worst of RCV / line-item-total wins.
  const ranks = { pass: 0, warning: 1, fail: 2 } as const;
  const worst = (Object.keys(ranks) as Array<keyof typeof ranks>).reduce((acc, k) => {
    const r = Math.max(ranks[acc], ranks[k]);
    return Object.keys(ranks).find((x) => ranks[x as keyof typeof ranks] === r) as keyof typeof ranks;
  }, 'pass' as keyof typeof ranks);

  // Compute roll-up explicitly from the three:
  const overall: 'pass' | 'warning' | 'fail' =
    [rcvStatus, litStatus, taxStatus].some((s) => s === 'fail')
      ? 'fail'
      : [rcvStatus, litStatus].some((s) => s === 'warning')
      ? 'warning'
      : 'pass';
  // (worst variable kept for future per-band UX; not exported)
  void worst;

  const warnings: string[] = [];
  if (stated_total_rcv === null) warnings.push('stated_total_rcv_missing');
  if (rcvStatus !== 'pass' && stated_total_rcv !== null) {
    warnings.push(
      `total_rcv_${rcvStatus}: parsed ${sumTotalRcv.toFixed(2)} vs stated ${stated_total_rcv.toFixed(
        2,
      )} (${((percent_delta_total_rcv ?? 0) * 100).toFixed(1)}%)`,
    );
  }
  if (litStatus !== 'pass' && stated_line_item_total !== null) {
    warnings.push(
      `line_item_total_${litStatus}: parsed ${sumLineTotalBeforeTax.toFixed(
        2,
      )} vs stated ${stated_line_item_total.toFixed(2)}`,
    );
  }
  if (taxStatus !== 'pass' && stated_tax !== null) {
    warnings.push(
      `tax_${taxStatus}: parsed ${sumTax.toFixed(2)} vs stated ${stated_tax.toFixed(2)}`,
    );
  }
  if (parsedLineItems.length === 0) warnings.push('no_parsed_line_items');

  return {
    sum_line_total_before_tax: sumLineTotalBeforeTax,
    sum_tax: sumTax,
    sum_total_rcv: sumTotalRcv,
    stated_line_item_total,
    stated_tax,
    stated_total_rcv,
    delta_line_item_total,
    delta_tax,
    delta_total_rcv,
    percent_delta_total_rcv,
    passed: overall !== 'fail',
    status: overall,
    warnings,
  };
}
