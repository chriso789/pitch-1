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
  force_exact_documents?: boolean;
}

function norm(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function resolveCanonicalDocument(svc: any, doc: any) {
  if (!doc?.file_hash) return doc;
  const { data, error } = await svc
    .from('insurance_scope_documents')
    .select('id, tenant_id, document_type, file_name, file_hash, parse_status, parser_version, created_at')
    .eq('tenant_id', doc.tenant_id)
    .eq('document_type', doc.document_type)
    .eq('file_hash', doc.file_hash)
    .order('created_at', { ascending: false })
    .limit(25);
  if (error || !data?.length) return doc;
  return data.find((d: any) => d.parse_status === 'complete' && d.parser_version === '2.1.0')
    ?? data.find((d: any) => d.parse_status === 'complete')
    ?? data[0]
    ?? doc;
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
      force_exact_documents = false,
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
      .select('id, tenant_id, document_type, file_name, file_hash, parse_status, parser_version, created_at')
      .in('id', [carrier_document_id, company_document_id]);
    if (docsErr) throw docsErr;
    if (!docs || docs.length !== 2) throw new Error('Documents not found');
    const carrierDocOriginal = docs.find(d => d.id === carrier_document_id);
    const companyDocOriginal = docs.find(d => d.id === company_document_id);
    if (!carrierDocOriginal || !companyDocOriginal) throw new Error('Documents not found');
    const tenantId = carrierDocOriginal.tenant_id;
    if (companyDocOriginal.tenant_id !== tenantId) throw new Error('Tenant mismatch');
    const carrierDoc = force_exact_documents ? carrierDocOriginal : await resolveCanonicalDocument(svc, carrierDocOriginal);
    const companyDoc = force_exact_documents ? companyDocOriginal : await resolveCanonicalDocument(svc, companyDocOriginal);

    // Load line items
    const loadLines = async (docId: string) => {
      const { data, error } = await svc
        .from('insurance_scope_line_items')
        .select('id, raw_code, raw_description, raw_category, quantity, unit, unit_price, total_rcv, canonical_item_id, section_name, page_number, raw_line')
        .eq('document_id', docId);
      if (error) throw error;
      return data || [];
    };
    const [carrierLinesRaw, companyLinesRaw] = await Promise.all([
      loadLines(carrierDoc.id),
      loadLines(companyDoc.id),
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
        carrier_document_id: carrierDoc.id, company_document_id: companyDoc.id,
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
      const insertRows = rows.map(({ grouped_children, match_score_breakdown, ...r }) => ({
        ...r,
        comparison_id: comparison.id,
        tenant_id: tenantId,
        match_score_breakdown: match_score_breakdown ?? null,
        ...(grouped_children && grouped_children.length ? { grouped_children } : {}),
      }));
      const CHUNK = 500;
      for (let i = 0; i < insertRows.length; i += CHUNK) {
        const slice = insertRows.slice(i, i + CHUNK);
        let { error: insErr } = await svc.from('scope_comparison_lines').insert(slice);
        if (insErr && /(grouped_children|match_score_breakdown|match_confidence|normalized_key|canonical_group)/i.test(insErr.message)) {
          // Fall back for older local schemas; deployed DB has these columns.
          const stripped = slice.map(({ grouped_children, match_score_breakdown, match_confidence, normalized_key, canonical_group, ...rest }: any) => rest);
          ({ error: insErr } = await svc.from('scope_comparison_lines').insert(stripped));
        }
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
