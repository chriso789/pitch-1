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

    // Two-pass matching: (1) by code/canonical, (2) leftovers by normalized description
    const carrierRemaining = [...carrierLines];
    const companyRemaining = [...companyLines];
    const pairs: Array<{ c: any | null; y: any | null; method: string }> = [];

    const indexBy = (arr: any[], keyFn: (l: any) => string | null) => {
      const m = new Map<string, any[]>();
      for (const l of arr) {
        const k = keyFn(l);
        if (!k) continue;
        const a = m.get(k) || [];
        a.push(l);
        m.set(k, a);
      }
      return m;
    };

    // Pass 1: code / canonical
    const cByCode = indexBy(carrierRemaining, codeKey);
    const yByCode = indexBy(companyRemaining, codeKey);
    const codeKeys = new Set([...cByCode.keys(), ...yByCode.keys()]);
    const consumedC = new Set<string>();
    const consumedY = new Set<string>();
    for (const k of codeKeys) {
      const cs = cByCode.get(k) || [];
      const ys = yByCode.get(k) || [];
      const n = Math.min(cs.length, ys.length);
      for (let i = 0; i < n; i++) {
        pairs.push({ c: cs[i], y: ys[i], method: k.startsWith('c:') ? 'canonical' : 'code' });
        consumedC.add(cs[i].id);
        consumedY.add(ys[i].id);
      }
    }

    // Pass 2: leftovers matched by normalized description
    const leftoverC = carrierRemaining.filter(l => !consumedC.has(l.id));
    const leftoverY = companyRemaining.filter(l => !consumedY.has(l.id));
    const cByDesc = indexBy(leftoverC, (l) => `d:${descKey(l)}`);
    const yByDesc = indexBy(leftoverY, (l) => `d:${descKey(l)}`);
    const descKeys = new Set([...cByDesc.keys(), ...yByDesc.keys()]);
    for (const k of descKeys) {
      const cs = cByDesc.get(k) || [];
      const ys = yByDesc.get(k) || [];
      const n = Math.min(cs.length, ys.length);
      for (let i = 0; i < n; i++) {
        pairs.push({ c: cs[i], y: ys[i], method: 'description' });
        consumedC.add(cs[i].id);
        consumedY.add(ys[i].id);
      }
      for (let i = n; i < cs.length; i++) pairs.push({ c: cs[i], y: null, method: 'description' });
      for (let i = n; i < ys.length; i++) pairs.push({ c: null, y: ys[i], method: 'description' });
    }

    const rows: DiffRow[] = [];

    for (const { c, y, method: matchMethod } of pairs) {
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

        // Detect exact line item name differences (raw description mismatch on otherwise-matched pair)
        const cDesc = String(c.raw_description || '').trim();
        const yDesc = String(y.raw_description || '').trim();
        const nameDiffers = !!cDesc && !!yDesc && cDesc.toLowerCase() !== yDesc.toLowerCase();

        let change_type: DiffRow['change_type'] = 'unchanged';
        if (qtyDeltaPct > qty_tolerance_pct && priceDeltaPct > price_tolerance_pct) change_type = 'price_change';
        else if (qtyDeltaPct > qty_tolerance_pct) change_type = 'qty_change';
        else if (priceDeltaPct > price_tolerance_pct) change_type = 'price_change';
        else if (nameDiffers) change_type = 'name_change';

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

    // Add unmatched carrier-only leftovers (no companion at all in either pass)
    for (const c of carrierLines) {
      if (consumedC.has(c.id)) continue;
      if (pairs.some(p => p.c?.id === c.id)) continue;
      rows.push({
        change_type: 'removed', category: c.raw_category || c.section_name || null,
        canonical_item_id: c.canonical_item_id || null, match_method: 'unmatched',
        carrier_line_id: c.id, carrier_code: c.raw_code, carrier_description: c.raw_description,
        carrier_quantity: c.quantity, carrier_unit: c.unit, carrier_unit_price: c.unit_price, carrier_total_rcv: c.total_rcv,
        company_line_id: null, company_code: null, company_description: null,
        company_quantity: null, company_unit: null, company_unit_price: null, company_total_rcv: null,
        delta_quantity: c.quantity ? -Number(c.quantity) : null,
        delta_unit_price: null,
        delta_rcv: c.total_rcv ? -Number(c.total_rcv) : null,
        delta_percent: -100,
      });
    }
    for (const y of companyLines) {
      if (consumedY.has(y.id)) continue;
      if (pairs.some(p => p.y?.id === y.id)) continue;
      rows.push({
        change_type: 'added', category: y.raw_category || y.section_name || null,
        canonical_item_id: y.canonical_item_id || null, match_method: 'unmatched',
        carrier_line_id: null, carrier_code: null, carrier_description: null,
        carrier_quantity: null, carrier_unit: null, carrier_unit_price: null, carrier_total_rcv: null,
        company_line_id: y.id, company_code: y.raw_code, company_description: y.raw_description,
        company_quantity: y.quantity, company_unit: y.unit, company_unit_price: y.unit_price, company_total_rcv: y.total_rcv,
        delta_quantity: y.quantity ? Number(y.quantity) : null,
        delta_unit_price: y.unit_price ? Number(y.unit_price) : null,
        delta_rcv: y.total_rcv ? Number(y.total_rcv) : null,
        delta_percent: 100,
      });
    }

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
