// ============================================================
// Pure scope comparison core — no Supabase / Deno IO.
// Extracted from compare-scope-documents/index.ts so it can be
// imported by both the edge function and unit tests without
// dragging the npm:supabase-js dependency into Deno test runs.
// ============================================================

import {
  canonicalScopeKey,
  classifyScopeGroup,
  classifyTrade,
  stripActionPrefix,
  normalizeDescription,
  normalizeUnit,
  normalizeMoney,
  normalizeQuantity,
} from './scope-normalizer.ts';
import { fingerprintScopeItem } from './scope-fingerprint.ts';
import { scoreMatch } from './scope-confidence-v2.ts';
import { buildJustification } from './supplement-justification-builder.ts';
import type {
  NormalizedScopeItem,
  ScopeMatch,
  ScopeCompareSummary,
  ScopeSource,
} from './scope-types.ts';

export async function toNormalizedItem(
  row: any,
  source: ScopeSource,
): Promise<NormalizedScopeItem> {
  const desc = String(row.raw_description ?? '');
  const { action, cleaned } = stripActionPrefix(desc);
  const canonical = canonicalScopeKey(desc, row.unit ?? null);
  const group = classifyScopeGroup(desc);
  const trade = classifyTrade(desc);
  const unit = normalizeUnit(row.unit ?? null);
  const quantity = normalizeQuantity(row.quantity ?? null);
  const total = normalizeMoney(row.total_rcv ?? null);
  const fp =
    row.fingerprint ??
    (await fingerprintScopeItem({
      canonical_key: canonical,
      unit,
      section_name: row.section_name ?? row.raw_category ?? null,
      line_number: row.line_order ?? null,
      quantity,
      total_rcv: total,
    }));

  return {
    source,
    document_id: row.document_id,
    line_item_id: row.id ?? null,
    line_number: row.line_order ?? null,
    section_name: row.section_name ?? row.raw_category ?? null,
    raw_description: desc,
    cleaned_description: cleaned || normalizeDescription(desc),
    action,
    canonical_key: canonical,
    canonical_group: group,
    trade_group: trade,
    quantity,
    unit,
    remove_price: normalizeMoney(row.remove_price ?? null),
    replace_price: normalizeMoney(row.replace_price ?? null),
    unit_price: normalizeMoney(row.effective_unit_price ?? row.unit_price ?? null),
    tax: null,
    total_rcv: total,
    total_acv: normalizeMoney(row.total_acv ?? null),
    depreciation_amount: normalizeMoney(row.depreciation_amount ?? null),
    page_number: row.page_number ?? null,
    raw_line: row.raw_line ?? null,
    previous_line: row.previous_line ?? null,
    next_line: row.next_line ?? null,
    parser_layout: (row.parser_layout ?? row.layout_type ?? 'unknown') as any,
    confidence: 1,
    fingerprint: fp,
  };
}

export function severityFromScore(score: number): 'info' | 'warning' | 'critical' {
  if (score >= 0.9) return 'info';
  if (score >= 0.7) return 'warning';
  return 'critical';
}

export function detectPriceListMismatch(
  carrierPL: string | null,
  contractorPL: string | null,
): { mismatch: boolean; explanation: string | null } {
  if (!carrierPL || !contractorPL) return { mismatch: false, explanation: null };
  if (carrierPL.trim().toUpperCase() === contractorPL.trim().toUpperCase()) {
    return { mismatch: false, explanation: null };
  }
  return {
    mismatch: true,
    explanation: `Price list mismatch detected. Carrier scope uses ${carrierPL} while contractor scope uses ${contractorPL}. Unit price differences may be partially caused by price-list date differences.`,
  };
}

export function buildPairMatch(
  car: NormalizedScopeItem,
  con: NormalizedScopeItem,
  score: ReturnType<typeof scoreMatch>,
  opts: { priceListMismatch: boolean },
): ScopeMatch {
  const qDelta =
    car.quantity != null && con.quantity != null
      ? +((con.quantity ?? 0) - (car.quantity ?? 0)).toFixed(2)
      : null;
  const pDelta =
    car.unit_price != null && con.unit_price != null
      ? +((con.unit_price ?? 0) - (car.unit_price ?? 0)).toFixed(2)
      : null;
  const tDelta =
    car.total_rcv != null && con.total_rcv != null
      ? +((con.total_rcv ?? 0) - (car.total_rcv ?? 0)).toFixed(2)
      : null;

  let result_type: ScopeMatch['result_type'];
  let severity: ScopeMatch['severity'];
  if (qDelta != null && Math.abs(qDelta) > 0.5) {
    result_type = 'quantity_delta';
    severity = severityFromScore(score.final);
  } else if (pDelta != null && Math.abs(pDelta) > 0.5) {
    result_type = opts.priceListMismatch ? 'price_list_delta_possible' : 'price_delta';
    severity = opts.priceListMismatch ? 'warning' : severityFromScore(score.final);
  } else {
    result_type = score.classification === 'exact_match' ? 'exact_match' : 'strong_fuzzy_match';
    severity = 'info';
  }

  const m: ScopeMatch = {
    carrier: car,
    contractor: con,
    result_type,
    severity,
    score,
    quantity_delta: qDelta,
    unit_price_delta: pDelta,
    total_rcv_delta: tDelta,
  };
  m.justification = buildJustification(m);
  return m;
}

export function compareNormalized(
  carrierItems: NormalizedScopeItem[],
  contractorItems: NormalizedScopeItem[],
  opts: { priceListMismatch: boolean },
): { matches: ScopeMatch[]; summaryTotals: ScopeCompareSummary['totals'] } {
  const carrierUsed = new Set<string>();
  const contractorUsed = new Set<string>();
  const matches: ScopeMatch[] = [];

  const carrierSections = new Set(
    carrierItems.map((i) => (i.section_name || '').toUpperCase()).filter(Boolean),
  );

  // 1) Section-first 1:1 matching
  for (const con of contractorItems) {
    const candidates = carrierItems.filter(
      (c) =>
        !carrierUsed.has(c.fingerprint) &&
        c.canonical_key === con.canonical_key &&
        (c.section_name || '').toUpperCase() === (con.section_name || '').toUpperCase() &&
        (c.unit ?? null) === (con.unit ?? null),
    );
    if (candidates.length === 0) continue;
    let best: { car: NormalizedScopeItem; score: ReturnType<typeof scoreMatch> } | null = null;
    for (const car of candidates) {
      const s = scoreMatch(car, con, {
        contractorSectionsSeenOnCarrier: carrierSections.has((con.section_name || '').toUpperCase()),
      });
      if (!best || s.final > best.score.final) best = { car, score: s };
    }
    if (best && best.score.final >= 0.7) {
      carrierUsed.add(best.car.fingerprint);
      contractorUsed.add(con.fingerprint);
      matches.push(buildPairMatch(best.car, con, best.score, opts));
    }
  }

  // 2) Cross-section best-match for leftovers
  for (const con of contractorItems) {
    if (contractorUsed.has(con.fingerprint)) continue;
    const candidates = carrierItems.filter(
      (c) =>
        !carrierUsed.has(c.fingerprint) &&
        c.canonical_key === con.canonical_key &&
        (c.unit ?? null) === (con.unit ?? null),
    );
    let best: { car: NormalizedScopeItem; score: ReturnType<typeof scoreMatch> } | null = null;
    for (const car of candidates) {
      const s = scoreMatch(car, con, {
        contractorSectionsSeenOnCarrier: carrierSections.has((con.section_name || '').toUpperCase()),
      });
      if (!best || s.final > best.score.final) best = { car, score: s };
    }
    if (best && best.score.final >= 0.7) {
      carrierUsed.add(best.car.fingerprint);
      contractorUsed.add(con.fingerprint);
      matches.push(buildPairMatch(best.car, con, best.score, opts));
    }
  }

  // 3) Group leftover contractor items
  const leftoverContractor = contractorItems.filter((i) => !contractorUsed.has(i.fingerprint));
  const groups = new Map<string, NormalizedScopeItem[]>();
  for (const it of leftoverContractor) {
    const k = `${it.canonical_key}|${it.unit ?? ''}`;
    const arr = groups.get(k) ?? [];
    arr.push(it);
    groups.set(k, arr);
  }

  for (const [k, group] of groups) {
    const carrierGroup = carrierItems.filter(
      (c) =>
        !carrierUsed.has(c.fingerprint) &&
        c.canonical_key === group[0].canonical_key &&
        (c.unit ?? null) === (group[0].unit ?? null),
    );
    const contractorTotal = group.reduce((s, i) => s + (i.total_rcv ?? 0), 0);
    const contractorQty = group.reduce((s, i) => s + (i.quantity ?? 0), 0);
    const carrierTotal = carrierGroup.reduce((s, i) => s + (i.total_rcv ?? 0), 0);
    const carrierQty = carrierGroup.reduce((s, i) => s + (i.quantity ?? 0), 0);

    const groupId = `grp_${k}_${matches.length}`;

    if (carrierGroup.length === 0) {
      const children: ScopeMatch[] = group.map((c) => ({
        carrier: null,
        contractor: c,
        result_type: 'missing_from_carrier',
        severity: 'warning',
        score: { components: {}, penalties: {}, final: 0, classification: 'no_match', reason_codes: ['grouped_child'] },
        group_id: groupId,
        total_rcv_delta: -(c.total_rcv ?? 0),
      }));
      const parent: ScopeMatch = {
        carrier: null,
        contractor: {
          ...group[0],
          quantity: contractorQty,
          total_rcv: contractorTotal,
          section_name: null,
          raw_description: `[grouped ${group.length}× ${group[0].canonical_key}]`,
        },
        result_type: 'grouped_missing_from_carrier',
        severity: contractorTotal > 1000 ? 'critical' : 'warning',
        score: { components: {}, penalties: {}, final: 0, classification: 'no_match', reason_codes: ['grouped_missing_from_carrier'] },
        group_id: groupId,
        grouped_children: children,
        total_rcv_delta: -contractorTotal,
      };
      parent.justification = buildJustification(parent);
      matches.push(parent);
      group.forEach((g) => contractorUsed.add(g.fingerprint));
      continue;
    }

    const totalDelta = +(contractorTotal - carrierTotal).toFixed(2);
    const qtyDelta = +(contractorQty - carrierQty).toFixed(2);
    const denom = Math.max(Math.abs(carrierTotal), Math.abs(contractorTotal), 1);
    const pct = Math.abs(totalDelta) / denom;
    const resultType: ScopeMatch['result_type'] = pct < 0.05 ? 'grouped_possible_duplicate' : 'grouped_total_delta';

    const children: ScopeMatch[] = group.map((c) => ({
      carrier: null,
      contractor: c,
      result_type: 'grouped_quantity_delta',
      severity: 'info',
      score: { components: {}, penalties: {}, final: 0, classification: 'no_match', reason_codes: ['grouped_child'] },
      group_id: groupId,
    }));

    const parent: ScopeMatch = {
      carrier: { ...carrierGroup[0], quantity: carrierQty, total_rcv: carrierTotal },
      contractor: { ...group[0], quantity: contractorQty, total_rcv: contractorTotal },
      result_type: resultType,
      severity: severityFromScore(1 - Math.min(1, pct)),
      score: {
        components: {},
        penalties: {},
        final: 1 - Math.min(1, pct),
        classification: resultType === 'grouped_possible_duplicate' ? 'strong_fuzzy_match' : 'possible_match_needs_review',
        reason_codes: ['grouped_compare'],
      },
      group_id: groupId,
      grouped_children: children,
      quantity_delta: qtyDelta,
      total_rcv_delta: totalDelta,
    };
    parent.justification = buildJustification(parent);
    matches.push(parent);
    group.forEach((g) => contractorUsed.add(g.fingerprint));
    carrierGroup.forEach((c) => carrierUsed.add(c.fingerprint));
  }

  // 4) Carrier-only leftovers
  for (const car of carrierItems) {
    if (carrierUsed.has(car.fingerprint)) continue;
    const m: ScopeMatch = {
      carrier: car,
      contractor: null,
      result_type: 'missing_from_contractor',
      severity: 'info',
      score: { components: {}, penalties: {}, final: 0, classification: 'no_match', reason_codes: ['unmatched_carrier'] },
      total_rcv_delta: car.total_rcv ?? 0,
    };
    m.justification = buildJustification(m);
    matches.push(m);
  }

  const totals = {
    matches: matches.filter((m) => m.result_type === 'exact_match' || m.result_type === 'strong_fuzzy_match').length,
    quantity_deltas: matches.filter((m) => m.result_type === 'quantity_delta').length,
    price_deltas: matches.filter((m) => m.result_type === 'price_delta' || m.result_type === 'price_list_delta_possible').length,
    missing_from_carrier: matches.filter((m) => m.result_type === 'missing_from_carrier' || m.result_type === 'grouped_missing_from_carrier').length,
    missing_from_contractor: matches.filter((m) => m.result_type === 'missing_from_contractor').length,
    grouped_findings: matches.filter((m) => (m.result_type as string).startsWith('grouped_')).length,
    assembly_findings: 0,
    needs_review: matches.filter((m) => m.score.classification === 'possible_match_needs_review').length,
  };

  return { matches, summaryTotals: totals };
}
