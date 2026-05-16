// ============================================================
// Pure pairing + diff logic for xact-compare-documents.
// Extracted so it can be unit-tested without spinning up the
// Deno.serve HTTP handler.
//
// Contract:
//  - Lines are paired by composite key (raw_code+unit → canonical+unit
//    → canonical_item_id+unit → description+unit), unit-equality is
//    always enforced.
//  - Same-identity duplicates on one side (e.g. four elevation gutter
//    rows) are aggregated BEFORE pairing. unit_price on the aggregate
//    is total/qty so it is never an arbitrary single row's value.
//  - carrier_*/company_* values on the diff row come straight from the
//    parsed input — never substituted from a price list.
// ============================================================
import { canonicalScopeKey, normalizeUnit } from './scope-normalizer.ts';

export interface RawLine {
  id: string;
  raw_code?: string | null;
  raw_description?: string | null;
  raw_category?: string | null;
  section_name?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  unit_price?: number | string | null;
  total_rcv?: number | string | null;
  canonical_item_id?: string | null;
}

export interface AggregatedLine extends RawLine {
  _aggregated_from?: string[];
  _aggregated_count?: number;
  _aggregated_descriptions?: string[];
  _aggregated_sections?: (string | null)[];
}

export type ChangeType =
  | 'added'
  | 'removed'
  | 'qty_change'
  | 'price_change'
  | 'name_change'
  | 'unchanged';

export interface DiffRow {
  change_type: ChangeType;
  category: string | null;
  canonical_item_id: string | null;
  match_method: string;
  carrier_line_id: string | null;
  carrier_code: string | null | undefined;
  carrier_description: string | null | undefined;
  carrier_quantity: number | string | null | undefined;
  carrier_unit: string | null | undefined;
  carrier_unit_price: number | string | null | undefined;
  carrier_total_rcv: number | string | null | undefined;
  company_line_id: string | null;
  company_code: string | null | undefined;
  company_description: string | null | undefined;
  company_quantity: number | string | null | undefined;
  company_unit: string | null | undefined;
  company_unit_price: number | string | null | undefined;
  company_total_rcv: number | string | null | undefined;
  delta_quantity: number | null;
  delta_unit_price: number | null;
  delta_rcv: number | null;
  delta_percent: number | null;
  grouped_children?: Array<{
    side: 'carrier' | 'company';
    line_id: string;
    section: string | null;
    description: string | null;
  }>;
}

function norm(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function descKey(line: RawLine): string {
  let s = String(line.raw_description || '').toLowerCase();
  const woFelt = /w\/?\s*out\s*felt|without\s*felt|no\s*felt/.test(s);
  const wFelt = !woFelt && /w\/?\s*felt|with\s*felt/.test(s);
  s = s.replace(/^(r\s*&\s*r|remove\s*&\s*replace|remove|detach\s*&\s*reset|reset|install)\b/i, '');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  const feltTag = woFelt ? ' wofelt' : wFelt ? ' wfelt' : '';
  const removeTag = /^(remove|r\s*r|detach)/.test(String(line.raw_description || '').toLowerCase()) ? ' rm' : '';
  return s + feltTag + removeTag;
}

export function isTaxLine(line: RawLine): boolean {
  const hay = `${line.raw_code || ''} ${line.raw_description || ''} ${line.raw_category || ''} ${line.section_name || ''}`.toLowerCase();
  return /\b(sales\s*tax|material\s*tax|tax\s*amount|\btax\b)\b/.test(hay);
}

export function unitsCompatible(a?: string | null, b?: string | null): boolean {
  const na = normalizeUnit(a ?? null);
  const nb = normalizeUnit(b ?? null);
  if (!na && !nb) return true;
  if (!na || !nb) return true;
  return na === nb;
}

export function pickBest<T extends RawLine>(candidates: T[], target: RawLine): T {
  if (candidates.length === 1) return candidates[0];
  const tq = Number(target.quantity || 0);
  const tp = Number(target.unit_price || 0);
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const qDiff = Math.abs(Number(c.quantity || 0) - tq);
    const pDiff = Math.abs(Number(c.unit_price || 0) - tp);
    const score = qDiff + pDiff * 0.01;
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/**
 * Combine rows that share the same Xactimate identity (code+unit, or
 * canonical+unit, or description+unit). Aggregate qty + total, recompute
 * unit_price = total/qty (weighted average). Keeps a trail of children
 * so the UI can show per-elevation breakdowns.
 */
export function aggregateByIdentity(lines: RawLine[]): AggregatedLine[] {
  const groups = new Map<string, RawLine[]>();
  for (const l of lines) {
    const code = (l.raw_code || '').trim().toLowerCase();
    const unit = normalizeUnit(l.unit ?? null) || '';
    const canon = canonicalScopeKey(l.raw_description || '', l.unit ?? null);
    const identity = code
      ? `code:${code}|${unit}`
      : canon && !canon.startsWith('desc:')
        ? `canon:${canon}|${unit}`
        : `desc:${descKey(l)}|${unit}`;
    const arr = groups.get(identity) || [];
    arr.push(l);
    groups.set(identity, arr);
  }
  const aggregated: AggregatedLine[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) { aggregated.push(group[0]); continue; }
    const totalQty = group.reduce((s, x) => s + Number(x.quantity || 0), 0);
    const totalRcv = group.reduce((s, x) => s + Number(x.total_rcv || 0), 0);
    const unitPrice = totalQty > 0 ? totalRcv / totalQty : (group[0].unit_price ?? null);
    aggregated.push({
      ...group[0],
      id: group[0].id,
      quantity: totalQty || group[0].quantity,
      total_rcv: totalRcv || group[0].total_rcv,
      unit_price: unitPrice,
      _aggregated_from: group.map(g => g.id),
      _aggregated_count: group.length,
      _aggregated_descriptions: group.map(g => g.raw_description || '').filter(Boolean),
      _aggregated_sections: group.map(g => g.section_name ?? g.raw_category ?? null),
    });
  }
  return aggregated;
}

export interface PairResult {
  pairs: Array<{ c: AggregatedLine | null; y: AggregatedLine | null; method: string }>;
  consumedC: Set<string>;
  consumedY: Set<string>;
}

export function pairLines(carrier: AggregatedLine[], company: AggregatedLine[]): PairResult {
  const pairs: PairResult['pairs'] = [];
  const consumedC = new Set<string>();
  const consumedY = new Set<string>();

  const indexBy = (arr: AggregatedLine[], keyFn: (l: AggregatedLine) => string | null, consumed: Set<string>) => {
    const m = new Map<string, AggregatedLine[]>();
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

  const runPass = (keyFn: (l: AggregatedLine) => string | null, method: string) => {
    const cIdx = indexBy(carrier, keyFn, consumedC);
    const yIdx = indexBy(company, keyFn, consumedY);
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

  runPass((l) => {
    const code = (l.raw_code || '').trim().toLowerCase();
    const unit = normalizeUnit(l.unit ?? null) || '';
    return code ? `code:${code}|${unit}` : null;
  }, 'code');

  runPass((l) => {
    const k = canonicalScopeKey(l.raw_description || '', l.unit ?? null);
    if (!k || k.startsWith('desc:')) return null;
    const unit = normalizeUnit(l.unit ?? null) || '';
    return `canon:${k}|${unit}`;
  }, 'canonical_scope');

  runPass((l) => {
    if (!l.canonical_item_id) return null;
    const unit = normalizeUnit(l.unit ?? null) || '';
    return `ci:${l.canonical_item_id}|${unit}`;
  }, 'canonical');

  runPass((l) => {
    const unit = normalizeUnit(l.unit ?? null) || '';
    return `desc:${descKey(l)}|${unit}`;
  }, 'description');

  return { pairs, consumedC, consumedY };
}

export interface DiffOptions {
  price_tolerance_pct?: number;
  qty_tolerance_pct?: number;
}

function childrenFor(side: 'carrier' | 'company', line: AggregatedLine | null): DiffRow['grouped_children'] {
  if (!line || !line._aggregated_from || line._aggregated_from.length <= 1) return undefined;
  return line._aggregated_from.map((id, i) => ({
    side,
    line_id: id,
    section: line._aggregated_sections?.[i] ?? null,
    description: line._aggregated_descriptions?.[i] ?? null,
  }));
}

/**
 * Convert paired (and unpaired) lines into DiffRow records. Carrier
 * and company sides always retain their original parsed unit_price /
 * total_rcv values.
 */
export function buildDiffRows(
  pairResult: PairResult,
  carrier: AggregatedLine[],
  company: AggregatedLine[],
  opts: DiffOptions = {},
): DiffRow[] {
  const { price_tolerance_pct = 1, qty_tolerance_pct = 1 } = opts;
  const rows: DiffRow[] = [];

  const mergeChildren = (
    c?: DiffRow['grouped_children'],
    y?: DiffRow['grouped_children'],
  ): DiffRow['grouped_children'] => {
    const merged = [...(c || []), ...(y || [])];
    return merged.length ? merged : undefined;
  };

  for (const { c, y, method } of pairResult.pairs) {
    if (c && !y) {
      rows.push({
        change_type: 'removed',
        category: c.raw_category || c.section_name || null,
        canonical_item_id: c.canonical_item_id || null,
        match_method: method,
        carrier_line_id: c.id, carrier_code: c.raw_code, carrier_description: c.raw_description,
        carrier_quantity: c.quantity, carrier_unit: c.unit, carrier_unit_price: c.unit_price, carrier_total_rcv: c.total_rcv,
        company_line_id: null, company_code: null, company_description: null,
        company_quantity: null, company_unit: null, company_unit_price: null, company_total_rcv: null,
        delta_quantity: c.quantity ? -Number(c.quantity) : null,
        delta_unit_price: null,
        delta_rcv: c.total_rcv ? -Number(c.total_rcv) : null,
        delta_percent: -100,
        grouped_children: childrenFor('carrier', c),
      });
    } else if (!c && y) {
      rows.push({
        change_type: 'added',
        category: y.raw_category || y.section_name || null,
        canonical_item_id: y.canonical_item_id || null,
        match_method: method,
        carrier_line_id: null, carrier_code: null, carrier_description: null,
        carrier_quantity: null, carrier_unit: null, carrier_unit_price: null, carrier_total_rcv: null,
        company_line_id: y.id, company_code: y.raw_code, company_description: y.raw_description,
        company_quantity: y.quantity, company_unit: y.unit, company_unit_price: y.unit_price, company_total_rcv: y.total_rcv,
        delta_quantity: y.quantity ? Number(y.quantity) : null,
        delta_unit_price: y.unit_price ? Number(y.unit_price) : null,
        delta_rcv: y.total_rcv ? Number(y.total_rcv) : null,
        delta_percent: 100,
        grouped_children: childrenFor('company', y),
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

      const cDesc = String(c.raw_description || '').trim();
      const yDesc = String(y.raw_description || '').trim();
      const nameDiffers = !!cDesc && !!yDesc && cDesc.toLowerCase() !== yDesc.toLowerCase();

      let change_type: ChangeType = 'unchanged';
      if (qtyDeltaPct > qty_tolerance_pct && priceDeltaPct > price_tolerance_pct) change_type = 'price_change';
      else if (qtyDeltaPct > qty_tolerance_pct) change_type = 'qty_change';
      else if (priceDeltaPct > price_tolerance_pct) change_type = 'price_change';
      else if (nameDiffers) change_type = 'name_change';

      if (change_type === 'unchanged') continue;

      rows.push({
        change_type,
        category: y.raw_category || c.raw_category || y.section_name || c.section_name || null,
        canonical_item_id: y.canonical_item_id || c.canonical_item_id || null,
        match_method: method,
        carrier_line_id: c.id, carrier_code: c.raw_code, carrier_description: c.raw_description,
        carrier_quantity: c.quantity, carrier_unit: c.unit, carrier_unit_price: c.unit_price, carrier_total_rcv: c.total_rcv,
        company_line_id: y.id, company_code: y.raw_code, company_description: y.raw_description,
        company_quantity: y.quantity, company_unit: y.unit, company_unit_price: y.unit_price, company_total_rcv: y.total_rcv,
        delta_quantity: yq - cq,
        delta_unit_price: yp - cp,
        delta_rcv: yr - cr,
        delta_percent: cr ? ((yr - cr) / cr) * 100 : null,
        grouped_children: mergeChildren(childrenFor('carrier', c), childrenFor('company', y)),
      });
    }
  }

  // Truly unmatched leftovers
  for (const c of carrier) {
    if (pairResult.consumedC.has(c.id)) continue;
    if (pairResult.pairs.some(p => p.c?.id === c.id)) continue;
    rows.push({
      change_type: 'removed',
      category: c.raw_category || c.section_name || null,
      canonical_item_id: c.canonical_item_id || null,
      match_method: 'unmatched',
      carrier_line_id: c.id, carrier_code: c.raw_code, carrier_description: c.raw_description,
      carrier_quantity: c.quantity, carrier_unit: c.unit, carrier_unit_price: c.unit_price, carrier_total_rcv: c.total_rcv,
      company_line_id: null, company_code: null, company_description: null,
      company_quantity: null, company_unit: null, company_unit_price: null, company_total_rcv: null,
      delta_quantity: c.quantity ? -Number(c.quantity) : null,
      delta_unit_price: null,
      delta_rcv: c.total_rcv ? -Number(c.total_rcv) : null,
      delta_percent: -100,
      grouped_children: childrenFor('carrier', c),
    });
  }
  for (const y of company) {
    if (pairResult.consumedY.has(y.id)) continue;
    if (pairResult.pairs.some(p => p.y?.id === y.id)) continue;
    rows.push({
      change_type: 'added',
      category: y.raw_category || y.section_name || null,
      canonical_item_id: y.canonical_item_id || null,
      match_method: 'unmatched',
      carrier_line_id: null, carrier_code: null, carrier_description: null,
      carrier_quantity: null, carrier_unit: null, carrier_unit_price: null, carrier_total_rcv: null,
      company_line_id: y.id, company_code: y.raw_code, company_description: y.raw_description,
      company_quantity: y.quantity, company_unit: y.unit, company_unit_price: y.unit_price, company_total_rcv: y.total_rcv,
      delta_quantity: y.quantity ? Number(y.quantity) : null,
      delta_unit_price: y.unit_price ? Number(y.unit_price) : null,
      delta_rcv: y.total_rcv ? Number(y.total_rcv) : null,
      delta_percent: 100,
      grouped_children: childrenFor('company', y),
    });
  }

  return rows;
}
