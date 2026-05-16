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

    // Multi-pass matching with unit-equality enforced at every step:
    //   Pass 0: exact raw_code + unit  (most stable Xactimate identity)
    //   Pass 1: canonical scope key + unit
    //   Pass 2: canonical_item_id + unit
    //   Pass 3: normalized description + unit
    // When multiple candidates collide, pickBest() chooses the closest match
    // by quantity (and tie-breaks on unit price), so we never pair lines by
    // arbitrary array order.
    const pairs: Array<{ c: any | null; y: any | null; method: string }> = [];
    const consumedC = new Set<string>();
    const consumedY = new Set<string>();

    const indexBy = (arr: any[], keyFn: (l: any) => string | null, consumed: Set<string>) => {
      const m = new Map<string, any[]>();
      for (const l of arr) {
        if (consumed.has(l.id)) continue;
        const k = keyFn(l);
        if (!k) continue;
        const a = m.get(k) || [];
        a.push(l);
        m.set(k, a);
      }
      return m;
    };

    const runPass = (
      keyFn: (l: any) => string | null,
      method: string,
    ) => {
      const cIdx = indexBy(carrierLines, keyFn, consumedC);
      const yIdx = indexBy(companyLines, keyFn, consumedY);
      const keys = new Set([...cIdx.keys(), ...yIdx.keys()]);
      for (const k of keys) {
        let cs = (cIdx.get(k) || []).filter(c => !consumedC.has(c.id));
        let ys = (yIdx.get(k) || []).filter(y => !consumedY.has(y.id));
        while (cs.length && ys.length) {
          const target = cs[0];
          const validYs = ys.filter(y => unitsCompatible(y.unit, target.unit));
          if (validYs.length === 0) break;
          const best = pickBest(validYs, target);
          pairs.push({ c: target, y: best, method });
          consumedC.add(target.id);
          consumedY.add(best.id);
          cs = cs.filter(c => c.id !== target.id);
          ys = ys.filter(y => y.id !== best.id);
        }
      }
    };

    // Pass 0: raw_code + unit (e.g. RFG ASBPH + SQ)
    runPass(
      (l) => {
        const code = (l.raw_code || '').trim().toLowerCase();
        const unit = normalizeUnit(l.unit) || '';
        return code ? `code:${code}|${unit}` : null;
      },
      'code',
    );

    // Pass 1: canonical scope key + unit
    runPass(
      (l) => {
        const k = canonicalScopeKey(l.raw_description || '', l.unit);
        if (!k || k.startsWith('desc:')) return null;
        const unit = normalizeUnit(l.unit) || '';
        return `canon:${k}|${unit}`;
      },
      'canonical_scope',
    );

    // Pass 2: canonical_item_id + unit
    runPass(
      (l) => {
        if (!l.canonical_item_id) return null;
        const unit = normalizeUnit(l.unit) || '';
        return `ci:${l.canonical_item_id}|${unit}`;
      },
      'canonical',
    );

    // Pass 3: normalized description + unit
    runPass(
      (l) => {
        const unit = normalizeUnit(l.unit) || '';
        return `desc:${descKey(l)}|${unit}`;
      },
      'description',
    );

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
