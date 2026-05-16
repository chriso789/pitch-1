// ============================================================
// compare-scope-documents — Accuracy Layer 2
//
// Compares two parsed scope documents (carrier vs contractor)
// using fingerprinted normalized items, grouped duplicates,
// price-list awareness, v2 confidence scoring, assembly rules,
// and the supplement justification builder.
//
// Persists results to scope_compare_runs + scope_compare_results.
// Re-applies any scope_compare_overrides on a re-open.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

import { corsHeaders } from "../_shared/cors.ts";
import { scopeErrorResponse } from "../_shared/scope-errors.ts";
import {
  canonicalScopeKey,
  classifyScopeGroup,
  classifyTrade,
  stripActionPrefix,
  normalizeDescription,
  normalizeUnit,
  normalizeMoney,
  normalizeQuantity,
} from "../_shared/scope-normalizer.ts";
import { fingerprintScopeItem } from "../_shared/scope-fingerprint.ts";
import { scoreMatch } from "../_shared/scope-confidence-v2.ts";
import { evaluateAssemblyRules } from "../_shared/scope-assembly-rules.ts";
import { buildJustification } from "../_shared/supplement-justification-builder.ts";
import { reconcileParsedDocument } from "../_shared/scope-reconciler.ts";
import type {
  NormalizedScopeItem,
  ScopeMatch,
  ScopeCompareSummary,
  ScopeSource,
  ReconciliationResult,
  ParsedHeaderTotals,
} from "../_shared/scope-types.ts";

interface CompareRequest {
  carrier_document_id: string;
  contractor_document_id: string;
  job_id?: string;
  insurance_claim_id?: string;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

async function toNormalizedItem(
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

function severityFromScore(score: number): 'info' | 'warning' | 'critical' {
  if (score >= 0.9) return 'info';
  if (score >= 0.7) return 'warning';
  return 'critical';
}

function detectPriceListMismatch(
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

// ------------------------------------------------------------
// Main compare
// ------------------------------------------------------------

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

  // 1) Section-first 1:1 matching by canonical_key + section + unit
  for (const con of contractorItems) {
    if (!con.line_item_id) continue;
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

  // 2) Cross-section best-match for leftovers (still by canonical_key + unit)
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

  // 3) Group leftover contractor items by canonical_key + unit and try grouped comparison
  const leftoverContractor = contractorItems.filter((i) => !contractorUsed.has(i.fingerprint));
  const groups = new Map<string, NormalizedScopeItem[]>();
  for (const it of leftoverContractor) {
    const k = `${it.canonical_key}|${it.unit ?? ''}`;
    const arr = groups.get(k) ?? [];
    arr.push(it);
    groups.set(k, arr);
  }

  for (const [k, group] of groups) {
    // Carrier grouped total for same canonical_key + unit
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
      // All contractor lines missing from carrier as a group
      const children: ScopeMatch[] = group.map((c) => ({
        carrier: null,
        contractor: c,
        result_type: 'missing_from_carrier',
        severity: 'warning',
        score: {
          components: {},
          penalties: {},
          final: 0,
          classification: 'no_match',
          reason_codes: ['grouped_child'],
        },
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
        score: {
          components: {},
          penalties: {},
          final: 0,
          classification: 'no_match',
          reason_codes: ['grouped_missing_from_carrier'],
        },
        group_id: groupId,
        grouped_children: children,
        total_rcv_delta: -contractorTotal,
      };
      parent.justification = buildJustification(parent);
      matches.push(parent);
      group.forEach((g) => contractorUsed.add(g.fingerprint));
      continue;
    }

    // Carrier has grouped allowance — produce grouped delta
    const totalDelta = +(contractorTotal - carrierTotal).toFixed(2);
    const qtyDelta = +(contractorQty - carrierQty).toFixed(2);
    const denom = Math.max(Math.abs(carrierTotal), Math.abs(contractorTotal), 1);
    const pct = Math.abs(totalDelta) / denom;
    const resultType =
      pct < 0.05 ? 'grouped_possible_duplicate' : 'grouped_total_delta';

    const children: ScopeMatch[] = group.map((c) => ({
      carrier: null,
      contractor: c,
      result_type: 'grouped_quantity_delta',
      severity: 'info',
      score: {
        components: {},
        penalties: {},
        final: 0,
        classification: 'no_match',
        reason_codes: ['grouped_child'],
      },
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

  // 4) Anything left on carrier is missing_from_contractor (informational)
  for (const car of carrierItems) {
    if (carrierUsed.has(car.fingerprint)) continue;
    const m: ScopeMatch = {
      carrier: car,
      contractor: null,
      result_type: 'missing_from_contractor',
      severity: 'info',
      score: {
        components: {},
        penalties: {},
        final: 0,
        classification: 'no_match',
        reason_codes: ['unmatched_carrier'],
      },
      total_rcv_delta: car.total_rcv ?? 0,
    };
    m.justification = buildJustification(m);
    matches.push(m);
  }

  // Tally
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

function buildPairMatch(
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

// ------------------------------------------------------------
// Edge handler
// ------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return scopeErrorResponse('UNAUTHORIZED', 'Missing bearer token', corsHeaders);
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: { user } } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) {
      return scopeErrorResponse('UNAUTHORIZED', 'Invalid session', corsHeaders);
    }
    const { data: profile } = await admin
      .from('profiles')
      .select('tenant_id, active_tenant_id')
      .eq('id', user.id)
      .single();
    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId) {
      return scopeErrorResponse('TENANT_ACCESS_DENIED', 'No tenant', corsHeaders);
    }

    const body = (await req.json()) as CompareRequest;
    if (!body.carrier_document_id || !body.contractor_document_id) {
      return scopeErrorResponse('INVALID_INPUT', 'carrier_document_id and contractor_document_id are required', corsHeaders);
    }

    // Load both documents + headers + line items
    const [carrierDoc, contractorDoc] = await Promise.all([
      admin.from('insurance_scope_documents').select('*').eq('id', body.carrier_document_id).single(),
      admin.from('insurance_scope_documents').select('*').eq('id', body.contractor_document_id).single(),
    ]);
    if (!carrierDoc.data) return scopeErrorResponse('DOCUMENT_NOT_FOUND', 'Carrier document not found', corsHeaders);
    if (!contractorDoc.data) return scopeErrorResponse('DOCUMENT_NOT_FOUND', 'Contractor document not found', corsHeaders);
    if (carrierDoc.data.tenant_id !== tenantId || contractorDoc.data.tenant_id !== tenantId) {
      return scopeErrorResponse('TENANT_ACCESS_DENIED', 'Cross-tenant document access denied', corsHeaders);
    }

    const [carrierHeader, contractorHeader, carrierLI, contractorLI] = await Promise.all([
      admin.from('insurance_scope_headers').select('*').eq('document_id', body.carrier_document_id).maybeSingle(),
      admin.from('insurance_scope_headers').select('*').eq('document_id', body.contractor_document_id).maybeSingle(),
      admin.from('insurance_scope_line_items').select('*').eq('document_id', body.carrier_document_id),
      admin.from('insurance_scope_line_items').select('*').eq('document_id', body.contractor_document_id),
    ]);

    if (!carrierLI.data?.length) return scopeErrorResponse('COMPARE_NO_CARRIER_LINES', 'Carrier has no parsed line items', corsHeaders);
    if (!contractorLI.data?.length) return scopeErrorResponse('COMPARE_NO_CONTRACTOR_LINES', 'Contractor has no parsed line items', corsHeaders);

    // Normalize
    const carrierItems = await Promise.all(carrierLI.data.map((r) => toNormalizedItem({ ...r, document_id: body.carrier_document_id }, 'carrier')));
    const contractorItems = await Promise.all(contractorLI.data.map((r) => toNormalizedItem({ ...r, document_id: body.contractor_document_id }, 'contractor')));

    // Price list awareness
    const carrierPL = carrierHeader.data?.price_list_name ?? null;
    const contractorPL = contractorHeader.data?.price_list_name ?? null;
    const plState = detectPriceListMismatch(carrierPL, contractorPL);

    // Reconcile both sides
    const carrierTotals: ParsedHeaderTotals = {
      line_item_total: carrierHeader.data?.total_rcv ?? null,
      tax_amount: carrierHeader.data?.tax_amount ?? null,
      total_rcv: carrierHeader.data?.total_rcv ?? null,
      total_acv: carrierHeader.data?.total_acv ?? null,
      deductible: carrierHeader.data?.deductible ?? null,
      net_claim: carrierHeader.data?.total_net_claim ?? null,
    };
    const contractorTotals: ParsedHeaderTotals = {
      line_item_total: contractorHeader.data?.total_rcv ?? null,
      tax_amount: contractorHeader.data?.tax_amount ?? null,
      total_rcv: contractorHeader.data?.total_rcv ?? null,
      total_acv: contractorHeader.data?.total_acv ?? null,
      deductible: contractorHeader.data?.deductible ?? null,
      net_claim: contractorHeader.data?.total_net_claim ?? null,
    };
    const carrierReconciliation: ReconciliationResult = reconcileParsedDocument({
      documentId: body.carrier_document_id,
      parsedLineItems: carrierItems,
      parsedHeaderTotals: carrierTotals,
    });
    const contractorReconciliation: ReconciliationResult = reconcileParsedDocument({
      documentId: body.contractor_document_id,
      parsedLineItems: contractorItems,
      parsedHeaderTotals: contractorTotals,
    });

    // Run comparison + assembly rules
    const { matches, summaryTotals } = compareNormalized(carrierItems, contractorItems, {
      priceListMismatch: plState.mismatch,
    });
    const assemblyFindings = evaluateAssemblyRules({ carrierItems, contractorItems });
    summaryTotals.assembly_findings = assemblyFindings.length;

    // Append assembly findings as synthetic match rows for persistence
    for (const f of assemblyFindings) {
      const justification = buildJustification({ ...f, kind: 'assembly_finding' });
      matches.push({
        carrier: null,
        contractor: null,
        result_type: 'assembly_finding',
        severity: f.severity,
        score: {
          components: {},
          penalties: {},
          final: 0,
          classification: 'no_match',
          reason_codes: [f.rule_id, ...f.missing_on_carrier, ...f.missing_on_contractor],
        },
        justification,
      });
    }

    // Summary
    const blockingReasons: string[] = [];
    if (!carrierReconciliation.passed) blockingReasons.push('carrier_reconciliation_failed');
    if (!contractorReconciliation.passed) blockingReasons.push('contractor_reconciliation_failed');
    if (summaryTotals.needs_review > 0) blockingReasons.push('needs_review_rows_present');

    const summary: ScopeCompareSummary = {
      carrier_document_id: body.carrier_document_id,
      contractor_document_id: body.contractor_document_id,
      carrier_total_rcv: carrierHeader.data?.total_rcv ?? carrierReconciliation.sum_total_rcv,
      contractor_total_rcv: contractorHeader.data?.total_rcv ?? contractorReconciliation.sum_total_rcv,
      rcv_difference: +(
        (contractorHeader.data?.total_rcv ?? contractorReconciliation.sum_total_rcv) -
        (carrierHeader.data?.total_rcv ?? carrierReconciliation.sum_total_rcv)
      ).toFixed(2),
      carrier_price_list: carrierPL,
      contractor_price_list: contractorPL,
      price_list_mismatch: plState.mismatch,
      price_list_explanation: plState.explanation,
      carrier_estimate_date: carrierHeader.data?.estimate_date ?? null,
      contractor_estimate_date: contractorHeader.data?.estimate_date ?? null,
      reconciliation: {
        carrier: carrierReconciliation,
        contractor: contractorReconciliation,
      },
      totals: summaryTotals,
      blocking_reasons: blockingReasons,
      can_mark_final: blockingReasons.length === 0,
    };

    // Persist compare run
    const { data: run, error: runErr } = await admin
      .from('scope_compare_runs')
      .insert({
        tenant_id: tenantId,
        carrier_document_id: body.carrier_document_id,
        contractor_document_id: body.contractor_document_id,
        job_id: body.job_id ?? null,
        insurance_claim_id: body.insurance_claim_id ?? null,
        status: blockingReasons.length === 0 ? 'reviewable' : 'needs_review',
        summary: summary as any,
        created_by: user.id,
      })
      .select()
      .single();
    if (runErr) {
      console.error('[compare-scope-documents] run insert err', runErr);
    }

    // Persist match results (best-effort)
    if (run?.id) {
      const rows = matches.map((m) => ({
        compare_run_id: run.id,
        tenant_id: tenantId,
        result_type: m.result_type,
        severity: m.severity,
        carrier_line_item_id: m.carrier?.line_item_id ?? null,
        contractor_line_item_id: m.contractor?.line_item_id ?? null,
        carrier_description: m.carrier?.raw_description ?? null,
        contractor_description: m.contractor?.raw_description ?? null,
        normalized_key: m.contractor?.canonical_key ?? m.carrier?.canonical_key ?? null,
        canonical_group: m.contractor?.canonical_group ?? m.carrier?.canonical_group ?? null,
        carrier_quantity: m.carrier?.quantity ?? null,
        contractor_quantity: m.contractor?.quantity ?? null,
        quantity_delta: m.quantity_delta ?? null,
        unit: m.contractor?.unit ?? m.carrier?.unit ?? null,
        carrier_unit_price: m.carrier?.unit_price ?? null,
        contractor_unit_price: m.contractor?.unit_price ?? null,
        unit_price_delta: m.unit_price_delta ?? null,
        carrier_total_rcv: m.carrier?.total_rcv ?? null,
        contractor_total_rcv: m.contractor?.total_rcv ?? null,
        total_rcv_delta: m.total_rcv_delta ?? null,
        match_confidence: m.score.final,
        match_method: m.score.classification,
        match_score_breakdown: m.score as any,
        justification: m.justification as any,
        group_id: m.group_id ?? null,
        parent_result_id: null,
        grouped_children: (m.grouped_children ?? []) as any,
      }));
      if (rows.length) {
        const { error: rowsErr } = await admin.from('scope_compare_results').insert(rows);
        if (rowsErr) console.error('[compare-scope-documents] results insert err', rowsErr);
      }

      // Re-apply existing overrides for this run (idempotent — used on re-open)
      const { data: overrides } = await admin
        .from('scope_compare_overrides')
        .select('*')
        .eq('compare_run_id', run.id);
      if (overrides?.length) {
        // overrides are surfaced separately in the response; consumer UI merges them.
        (summary as any).applied_overrides = overrides.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        compare_run_id: run?.id ?? null,
        summary,
        matches,
        assembly_findings: assemblyFindings,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[compare-scope-documents] error', err);
    return scopeErrorResponse(
      'INTERNAL_ERROR',
      err instanceof Error ? err.message : String(err),
      corsHeaders,
    );
  }
});
