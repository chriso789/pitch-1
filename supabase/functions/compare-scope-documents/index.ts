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
import { evaluateAssemblyRules } from "../_shared/scope-assembly-rules.ts";
import { reconcileParsedDocument } from "../_shared/scope-reconciler.ts";
import {
  toNormalizedItem,
  detectPriceListMismatch,
  compareNormalized,
} from "../_shared/scope-compare-core.ts";
import { buildJustification } from "../_shared/supplement-justification-builder.ts";
import type {
  ScopeCompareSummary,
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
