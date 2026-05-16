// ============================================================
// Xactimate Comparison Engine
// Diff a carrier scope vs a company-built scope, line by line
// ============================================================
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseService, supabaseAuth } from '../_shared/supabase.ts';
import {
  aggregateByIdentity,
  isTaxLine,
  pairLines,
  buildDiffRows,
  type DiffRow,
} from '../_shared/xact-compare-core.ts';

interface CompareRequest {
  carrier_document_id: string;
  company_document_id: string;
  project_id?: string | null;
  job_id?: string | null;
  price_tolerance_pct?: number; // default 1%
  qty_tolerance_pct?: number;   // default 1%
}

function norm(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = (await req.json()) as CompareRequest;
    const {
      carrier_document_id,
      company_document_id,
      project_id = null,
      job_id = null,
      price_tolerance_pct = 1,
      qty_tolerance_pct = 1,
    } = body;

    if (!carrier_document_id || !company_document_id) {
      return new Response(JSON.stringify({ error: 'carrier_document_id and company_document_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const auth = supabaseAuth(req);
    const { data: userData } = await auth.auth.getUser();
    const userId = userData?.user?.id;

    const svc = supabaseService();

    // Load both docs (and verify same tenant)
    const { data: docs, error: docsErr } = await svc
      .from('insurance_scope_documents')
      .select('id, tenant_id, document_type, file_name')
      .in('id', [carrier_document_id, company_document_id]);
    if (docsErr) throw docsErr;
    if (!docs || docs.length !== 2) throw new Error('Documents not found');
    const tenantId = docs[0].tenant_id;
    if (docs.some(d => d.tenant_id !== tenantId)) throw new Error('Tenant mismatch');

    // Load line items
    const loadLines = async (docId: string) => {
      const { data, error } = await svc
        .from('insurance_scope_line_items')
        .select('id, raw_code, raw_description, raw_category, quantity, unit, unit_price, total_rcv, canonical_item_id, section_name')
        .eq('document_id', docId);
      if (error) throw error;
      return data || [];
    };
    const [carrierLinesRaw, companyLinesRaw] = await Promise.all([
      loadLines(carrier_document_id),
      loadLines(company_document_id),
    ]);
    // Exclude tax rows from the comparison entirely, then aggregate
    // same-identity duplicates so elevation-specific rows pair as one.
    const carrierLines = aggregateByIdentity(carrierLinesRaw.filter(l => !isTaxLine(l)));
    const companyLines = aggregateByIdentity(companyLinesRaw.filter(l => !isTaxLine(l)));

    // Multi-pass matching with unit-equality enforced at every step
    // and aggregation of elevation-duplicates. See _shared/xact-compare-core.ts.
    const pairResult = pairLines(carrierLines, companyLines);
    const rows: DiffRow[] = buildDiffRows(pairResult, carrierLines, companyLines, {
      price_tolerance_pct,
      qty_tolerance_pct,
    });

    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const carrier_total_rcv = sum(carrierLines.map(l => Number(l.total_rcv || 0)));
    const company_total_rcv = sum(companyLines.map(l => Number(l.total_rcv || 0)));
    const net_supplement_amount = company_total_rcv - carrier_total_rcv;
    const counts = {
      added: rows.filter(r => r.change_type === 'added').length,
      removed: rows.filter(r => r.change_type === 'removed').length,
      qty_change: rows.filter(r => r.change_type === 'qty_change').length,
      price_change: rows.filter(r => r.change_type === 'price_change').length,
      name_change: rows.filter(r => r.change_type === 'name_change').length,
    };

    // Persist
    const { data: comparison, error: compErr } = await svc
      .from('scope_comparisons')
      .insert({
        tenant_id: tenantId,
        project_id, job_id,
        carrier_document_id, company_document_id,
        status: 'draft',
        carrier_total_rcv, company_total_rcv, net_supplement_amount,
        added_count: counts.added,
        removed_count: counts.removed,
        qty_change_count: counts.qty_change,
        price_change_count: counts.price_change,
        totals_json: { counts, carrier_line_count: carrierLines.length, company_line_count: companyLines.length },
        created_by: userId || null,
      })
      .select()
      .single();
    if (compErr) throw compErr;

    if (rows.length) {
      const insertRows = rows.map(r => ({ ...r, comparison_id: comparison.id, tenant_id: tenantId }));
      // Chunk inserts
      const CHUNK = 500;
      for (let i = 0; i < insertRows.length; i += CHUNK) {
        const { error: insErr } = await svc
          .from('scope_comparison_lines')
          .insert(insertRows.slice(i, i + CHUNK));
        if (insErr) throw insErr;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      comparison_id: comparison.id,
      counts,
      carrier_total_rcv,
      company_total_rcv,
      net_supplement_amount,
      diff_rows: rows.length,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('xact-compare-documents error', e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
