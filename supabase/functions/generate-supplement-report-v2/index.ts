// ============================================================
// generate-supplement-report-v2
// Builds a supplement report from scope_compare_runs +
// scope_compare_results, persists supplement_reports +
// supplement_report_items. Distinct from the legacy
// generate-supplement-report which serves the xact-compare /
// scope_comparisons flow and must continue to work.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { buildSupplementReport } from '../_shared/supplement-report-builder.ts';

interface Body {
  compare_run_id: string;
  options?: {
    include_reviewed_only?: boolean;
    include_excluded?: boolean;
    group_by_section?: boolean;
    group_by_issue_type?: boolean;
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const auth = req.headers.get('Authorization') ?? '';

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { error: 'Unauthorized' });
    const userId = userData.user.id;

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.compare_run_id) return json(400, { error: 'compare_run_id required' });

    const opts = body.options ?? {};

    // Load compare run
    const { data: run, error: runErr } = await admin
      .from('scope_compare_runs')
      .select('*')
      .eq('id', body.compare_run_id)
      .maybeSingle();
    if (runErr) return json(500, { error: runErr.message });
    if (!run) return json(404, { error: 'DOCUMENT_NOT_FOUND', message: 'compare run not found' });

    // Tenant check
    const { data: profile } = await admin
      .from('profiles')
      .select('tenant_id, active_tenant_id')
      .eq('id', userId)
      .maybeSingle();
    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId || tenantId !== run.tenant_id) {
      return json(403, { error: 'forbidden_tenant_mismatch' });
    }

    // Load results
    const { data: results, error: resErr } = await admin
      .from('scope_compare_results')
      .select('*')
      .eq('compare_run_id', run.id);
    if (resErr) return json(500, { error: resErr.message });
    if (!results || results.length === 0) {
      return json(422, { error: 'COMPARE_NO_RESULTS' });
    }

    // Gate: reconciliation review (analysis_json.reconciliation_status)
    const reconStatus = run?.analysis_json?.reconciliation_status;
    if (reconStatus === 'failed' && !opts.include_excluded) {
      return json(422, { error: 'RECONCILIATION_REVIEW_REQUIRED' });
    }

    // Gate: possible matches unreviewed
    if (!opts.include_excluded) {
      const unreviewed = results.filter(
        (r) =>
          r.result_type === 'possible_match' &&
          (r.reviewer_status ?? 'unreviewed') !== 'reviewed',
      );
      if (unreviewed.length > 0) {
        return json(422, {
          error: 'POSSIBLE_MATCHES_REVIEW_REQUIRED',
          unreviewed_count: unreviewed.length,
        });
      }
    }

    // Load docs + headers
    const docIds = [run.carrier_document_id, run.contractor_document_id].filter(
      Boolean,
    ) as string[];
    const { data: docs } = await admin
      .from('insurance_scope_documents')
      .select(
        'id, file_name, carrier_normalized, carrier_name, claim_number_detected, adjuster_name, document_type',
      )
      .in('id', docIds);
    const carrierDocument = docs?.find((d) => d.id === run.carrier_document_id) ?? null;
    const contractorDocument = docs?.find((d) => d.id === run.contractor_document_id) ?? null;

    const { data: headers } = await admin
      .from('insurance_scope_headers')
      .select('*')
      .in('document_id', docIds);
    const carrierHeader = headers?.find((h) => h.document_id === run.carrier_document_id) ?? null;
    const contractorHeader = headers?.find((h) => h.document_id === run.contractor_document_id) ?? null;

    const built = buildSupplementReport({
      compareRun: run,
      compareResults: results,
      carrierDocument,
      contractorDocument,
      carrierHeader,
      contractorHeader,
      options: {
        includeReviewedOnly: !!opts.include_reviewed_only,
        includeExcluded: !!opts.include_excluded,
        groupBySection: opts.group_by_section !== false,
        groupByIssueType: opts.group_by_issue_type !== false,
      },
    });

    const { data: reportRow, error: insErr } = await admin
      .from('supplement_reports')
      .insert({
        tenant_id: tenantId,
        compare_run_id: run.id,
        carrier_document_id: run.carrier_document_id,
        contractor_document_id: run.contractor_document_id,
        report_status: 'draft',
        report_title: 'Supplement Scope Difference Report',
        property_address: built.summary.property_address,
        insured_name: built.summary.insured_name,
        claim_number: built.summary.claim_number,
        carrier_name: built.summary.carrier_name,
        contractor_name: built.summary.contractor_name,
        carrier_total_rcv: built.summary.carrier_total_rcv,
        contractor_total_rcv: built.summary.contractor_total_rcv,
        supplement_difference_rcv: built.summary.supplement_difference_rcv,
        included_items_total: built.summary.included_items_total,
        excluded_items_total: built.summary.excluded_items_total,
        missing_items_total: built.summary.missing_items_total,
        quantity_delta_total: built.summary.quantity_delta_total,
        price_delta_total: built.summary.price_delta_total,
        tax_delta_total: built.summary.tax_delta_total,
        report_json: built.json,
        report_markdown: built.markdown,
        report_html: built.html,
        created_by: userId,
        // legacy NOT NULL fields satisfied via defaults if any
      })
      .select()
      .single();
    if (insErr) return json(500, { error: insErr.message });

    if (built.items.length > 0) {
      const itemRows = built.items.map((it) => ({
        tenant_id: tenantId,
        supplement_report_id: reportRow.id,
        compare_result_id: it.compare_result_id,
        item_order: it.item_order,
        section: it.section,
        issue_type: it.issue_type,
        severity: it.severity,
        included: it.included,
        carrier_description: it.carrier_description,
        contractor_description: it.contractor_description,
        description_for_report: it.description_for_report,
        quantity: it.quantity,
        unit: it.unit,
        carrier_quantity: it.carrier_quantity,
        contractor_quantity: it.contractor_quantity,
        quantity_delta: it.quantity_delta,
        carrier_unit_price: it.carrier_unit_price,
        contractor_unit_price: it.contractor_unit_price,
        unit_price_delta: it.unit_price_delta,
        carrier_total_rcv: it.carrier_total_rcv,
        contractor_total_rcv: it.contractor_total_rcv,
        total_rcv_delta: it.total_rcv_delta,
        tax_delta: it.tax_delta,
        justification_plain: it.justification_plain,
        justification_adjuster: it.justification_adjuster,
        justification_contractor: it.justification_contractor,
        evidence: it.evidence,
        reviewer_note: it.reviewer_note,
      }));
      const { error: itemErr } = await admin.from('supplement_report_items').insert(itemRows);
      if (itemErr) return json(500, { error: itemErr.message });
    }

    return json(200, {
      success: true,
      supplement_report_id: reportRow.id,
      summary: built.summary,
      markdown: built.markdown,
      html: built.html,
      items: built.items,
    });
  } catch (e) {
    return json(500, { error: 'unexpected', message: (e as Error).message });
  }
});
