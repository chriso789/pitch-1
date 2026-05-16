// ============================================================
// Xactimate Comparison Engine
// Diff a carrier scope vs a company-built scope, line by line
// ============================================================
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseService, supabaseAuth } from '../_shared/supabase.ts';

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

// Normalize a description so the same line item matches across docs even when
// the parser assigns slightly different Xactimate codes or punctuation.
// Preserves meaningful distinctions like "w/ felt" vs "w/out felt".
function descKey(line: any): string {
  let s = String(line.raw_description || '').toLowerCase();
  // Preserve felt distinction before stripping punctuation
  const woFelt = /w\/?\s*out\s*felt|without\s*felt|no\s*felt/.test(s);
  const wFelt = !woFelt && /w\/?\s*felt|with\s*felt/.test(s);
  // Strip leading verbs like "remove", "r&r", "detach & reset"
  s = s.replace(/^(r\s*&\s*r|remove\s*&\s*replace|remove|detach\s*&\s*reset|reset|install)\b/i, '');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  const feltTag = woFelt ? ' wofelt' : wFelt ? ' wfelt' : '';
  const removeTag = /^(remove|r\s*r|detach)/.test(String(line.raw_description || '').toLowerCase()) ? ' rm' : '';
  return s + feltTag + removeTag;
}

function codeKey(line: any): string | null {
  if (line.canonical_item_id) return `c:${line.canonical_item_id}`;
  if (line.raw_code) return `k:${norm(line.raw_code)}`;
  return null;
}

// Skip tax line items - tax handled separately at totals level, not compared
function isTaxLine(line: any): boolean {
  const hay = `${line.raw_code || ''} ${line.raw_description || ''} ${line.raw_category || ''} ${line.section_name || ''}`.toLowerCase();
  return /\b(sales\s*tax|material\s*tax|tax\s*amount|\btax\b)\b/.test(hay);
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
    // Exclude tax rows from the comparison entirely
    const carrierLines = carrierLinesRaw.filter(l => !isTaxLine(l));
    const companyLines = companyLinesRaw.filter(l => !isTaxLine(l));

    // Index by match key
    const carrierByKey = new Map<string, any[]>();
    for (const l of carrierLines) {
      const k = matchKey(l);
      const arr = carrierByKey.get(k) || [];
      arr.push(l);
      carrierByKey.set(k, arr);
    }
    const companyByKey = new Map<string, any[]>();
    for (const l of companyLines) {
      const k = matchKey(l);
      const arr = companyByKey.get(k) || [];
      arr.push(l);
      companyByKey.set(k, arr);
    }

    type DiffRow = {
      change_type: 'added' | 'removed' | 'qty_change' | 'price_change' | 'unchanged';
      category: string | null;
      canonical_item_id: string | null;
      match_method: string;
      carrier_line_id: string | null;
      carrier_code: string | null;
      carrier_description: string | null;
      carrier_quantity: number | null;
      carrier_unit: string | null;
      carrier_unit_price: number | null;
      carrier_total_rcv: number | null;
      company_line_id: string | null;
      company_code: string | null;
      company_description: string | null;
      company_quantity: number | null;
      company_unit: string | null;
      company_unit_price: number | null;
      company_total_rcv: number | null;
      delta_quantity: number | null;
      delta_unit_price: number | null;
      delta_rcv: number | null;
      delta_percent: number | null;
    };

    const rows: DiffRow[] = [];
    const allKeys = new Set<string>([...carrierByKey.keys(), ...companyByKey.keys()]);

    for (const k of allKeys) {
      const cArr = carrierByKey.get(k) || [];
      const yArr = companyByKey.get(k) || [];
      const c = cArr[0];
      const y = yArr[0];
      const matchMethod = k.startsWith('c:') ? 'canonical' : k.startsWith('k:') ? 'code' : 'description';

      if (c && !y) {
        rows.push({
          change_type: 'removed', category: c.raw_category || c.section_name || null,
          canonical_item_id: c.canonical_item_id || null, match_method: matchMethod,
          carrier_line_id: c.id, carrier_code: c.raw_code, carrier_description: c.raw_description,
          carrier_quantity: c.quantity, carrier_unit: c.unit, carrier_unit_price: c.unit_price, carrier_total_rcv: c.total_rcv,
          company_line_id: null, company_code: null, company_description: null,
          company_quantity: null, company_unit: null, company_unit_price: null, company_total_rcv: null,
          delta_quantity: c.quantity ? -Number(c.quantity) : null,
          delta_unit_price: null,
          delta_rcv: c.total_rcv ? -Number(c.total_rcv) : null,
          delta_percent: -100,
        });
      } else if (!c && y) {
        rows.push({
          change_type: 'added', category: y.raw_category || y.section_name || null,
          canonical_item_id: y.canonical_item_id || null, match_method: matchMethod,
          carrier_line_id: null, carrier_code: null, carrier_description: null,
          carrier_quantity: null, carrier_unit: null, carrier_unit_price: null, carrier_total_rcv: null,
          company_line_id: y.id, company_code: y.raw_code, company_description: y.raw_description,
          company_quantity: y.quantity, company_unit: y.unit, company_unit_price: y.unit_price, company_total_rcv: y.total_rcv,
          delta_quantity: y.quantity ? Number(y.quantity) : null,
          delta_unit_price: y.unit_price ? Number(y.unit_price) : null,
          delta_rcv: y.total_rcv ? Number(y.total_rcv) : null,
          delta_percent: 100,
        });
      } else if (c && y) {
        const cq = Number(c.quantity || 0);
        const yq = Number(y.quantity || 0);
        const cp = Number(c.unit_price || 0);
        const yp = Number(y.unit_price || 0);
        const cr = Number(c.total_rcv || 0);
        const yr = Number(y.total_rcv || 0);
        const qtyDeltaPct = cq ? Math.abs((yq - cq) / cq) * 100 : (yq ? 100 : 0);
        const priceDeltaPct = cp ? Math.abs((yp - cp) / cp) * 100 : (yp ? 100 : 0);

        let change_type: DiffRow['change_type'] = 'unchanged';
        if (qtyDeltaPct > qty_tolerance_pct && priceDeltaPct > price_tolerance_pct) change_type = 'price_change';
        else if (qtyDeltaPct > qty_tolerance_pct) change_type = 'qty_change';
        else if (priceDeltaPct > price_tolerance_pct) change_type = 'price_change';

        if (change_type === 'unchanged') continue;

        rows.push({
          change_type,
          category: y.raw_category || c.raw_category || y.section_name || c.section_name || null,
          canonical_item_id: y.canonical_item_id || c.canonical_item_id || null,
          match_method: matchMethod,
          carrier_line_id: c.id, carrier_code: c.raw_code, carrier_description: c.raw_description,
          carrier_quantity: c.quantity, carrier_unit: c.unit, carrier_unit_price: c.unit_price, carrier_total_rcv: c.total_rcv,
          company_line_id: y.id, company_code: y.raw_code, company_description: y.raw_description,
          company_quantity: y.quantity, company_unit: y.unit, company_unit_price: y.unit_price, company_total_rcv: y.total_rcv,
          delta_quantity: yq - cq,
          delta_unit_price: yp - cp,
          delta_rcv: yr - cr,
          delta_percent: cr ? ((yr - cr) / cr) * 100 : null,
        });
      }
    }

    // Aggregate totals
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const carrier_total_rcv = sum(carrierLines.map(l => Number(l.total_rcv || 0)));
    const company_total_rcv = sum(companyLines.map(l => Number(l.total_rcv || 0)));
    const net_supplement_amount = company_total_rcv - carrier_total_rcv;
    const counts = {
      added: rows.filter(r => r.change_type === 'added').length,
      removed: rows.filter(r => r.change_type === 'removed').length,
      qty_change: rows.filter(r => r.change_type === 'qty_change').length,
      price_change: rows.filter(r => r.change_type === 'price_change').length,
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
