// ============================================================
// Pure pairing + diff logic for xact-compare-documents.
//
// Contract:
//  - Lines are paired by normalized work identity, not by display order.
//  - Units must match before two rows can line up.
//  - Remove/tear-off shingle work never collapses into replacement/R&R
//    shingle work just because Xactimate codes are similar.
//  - Same-identity duplicates aggregate with weighted unit price = total/qty.
//  - carrier_*/company_* values always come from parsed source lines.
// ============================================================
import { canonicalScopeKey, classifyScopeGroup, normalizeUnit } from './scope-normalizer.ts';

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
  page_number?: number | string | null;
  raw_line?: string | null;
}

export interface AggregatedLine extends RawLine {
  _aggregated_from?: string[];
  _aggregated_count?: number;
  _aggregated_descriptions?: string[];
  _aggregated_sections?: (string | null)[];
  _aggregated_codes?: (string | null)[];
  _aggregated_quantities?: (number | null)[];
  _aggregated_units?: (string | null)[];
  _aggregated_unit_prices?: (number | null)[];
  _aggregated_totals?: (number | null)[];
  _aggregated_pages?: (number | null)[];
  _aggregated_raw_lines?: (string | null)[];
}

export type ChangeType =
  | 'added'
  | 'removed'
  | 'qty_change'
  | 'price_change'
  | 'name_change'
  | 'unchanged';

export interface MatchScoreBreakdown {
  final: number;
  classification: 'exact' | 'strong' | 'review' | 'unmatched';
  normalized_key: string | null;
  reason_codes: string[];
  components: Record<string, number>;
  penalties: Record<string, number>;
}

export interface DiffRow {
  change_type: ChangeType;
  category: string | null;
  canonical_item_id: string | null;
  match_method: string;
  normalized_key?: string | null;
  canonical_group?: string | null;
  match_confidence?: number | null;
  match_score_breakdown?: MatchScoreBreakdown | null;
  justification?: string | null;
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
    code: string | null;
    section: string | null;
    description: string | null;
    quantity: number | null;
    unit: string | null;
    unit_price: number | null;
    total_rcv: number | null;
    page_number: number | null;
    raw_line: string | null;
  }>;
}

function norm(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v: number | string | null | undefined): string {
  const n = num(v) ?? 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function qty(v: number | string | null | undefined): string {
  const n = num(v);
  if (n === null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function normalizeCode(code: string | null | undefined): string | null {
  const cleaned = norm(code).replace(/\s+/g, ' ').toUpperCase();
  if (!cleaned) return null;
  return cleaned;
}

export function descKey(line: RawLine): string {
  const desc = String(line.raw_description || '');
  let s = desc.toLowerCase();
  const woFelt = /w\/?\s*out\s*felt|without\s*felt|no\s*felt/.test(s);
  const wFelt = !woFelt && /w\/?\s*felt|with\s*felt/.test(s);
  s = s.replace(/^(r\s*&\s*r|remove\s*&\s*replace|remove|tear\s*off|detach\s*&\s*reset|reset|install|replace)\b/i, '');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  const feltTag = woFelt ? ' wofelt' : wFelt ? ' wfelt' : '';
  return `${s}${feltTag}`.trim();
}

export function workAction(line: RawLine): 'remove' | 'replace' | 'rr' | 'other' {
  const d = String(line.raw_description || '').trim().toLowerCase();
  if (/^(r\s*&\s*r|r\s+and\s+r|r\s*\/\s*r|remove\s*&\s*replace|detach\s*&\s*reset)/i.test(d)) return 'rr';
  if (/^(remove|tear\s*off|demo|detach)\b/i.test(d) || /\btear\s*off\b/i.test(d)) return 'remove';
  if (/^(replace|install)\b/i.test(d)) return 'replace';
  if (/\b(laminated|composition|comp\.?\s*shingle|shingle\s*rfg)\b/i.test(d)) return 'replace';
  return 'other';
}

function isShingleLike(line: RawLine): boolean {
  const hay = `${line.raw_code || ''} ${line.raw_description || ''}`.toLowerCase();
  return /\b(asb|shingle|laminated|composition|comp\.?\s*shingle|tear\s*off)\b/.test(hay);
}

function semanticAction(line: RawLine): string {
  if (!isShingleLike(line)) return 'scope';
  return workAction(line);
}

export function semanticKey(line: RawLine): string {
  const canonical = canonicalScopeKey(line.raw_description || '', line.unit ?? null);
  const unit = normalizeUnit(line.unit ?? null) || '';
  return `${canonical}|${semanticAction(line)}|${unit}`;
}

function codeKey(line: RawLine): string | null {
  const code = normalizeCode(line.raw_code);
  if (!code) return null;
  const unit = normalizeUnit(line.unit ?? null) || '';
  return `code:${code}|${semanticAction(line)}|${unit}`;
}

function canonicalKey(line: RawLine): string | null {
  const k = canonicalScopeKey(line.raw_description || '', line.unit ?? null);
  if (!k || k.startsWith('desc:')) return null;
  const unit = normalizeUnit(line.unit ?? null) || '';
  return `canon:${k}|${semanticAction(line)}|${unit}`;
}

function canonicalIdKey(line: RawLine): string | null {
  if (!line.canonical_item_id) return null;
  const unit = normalizeUnit(line.unit ?? null) || '';
  return `ci:${line.canonical_item_id}|${semanticAction(line)}|${unit}`;
}

function descriptionKey(line: RawLine): string | null {
  const unit = normalizeUnit(line.unit ?? null) || '';
  const d = descKey(line);
  return d ? `desc:${d}|${semanticAction(line)}|${unit}` : null;
}

function normalizedKeyFor(line: RawLine | null): string | null {
  if (!line) return null;
  return canonicalKey(line) ?? codeKey(line) ?? descriptionKey(line) ?? null;
}

function groupFor(line: RawLine | null): string | null {
  if (!line) return null;
  return classifyScopeGroup(line.raw_description || '');
}

export function isTaxLine(line: RawLine): boolean {
  const hay = `${line.raw_code || ''} ${line.raw_description || ''} ${line.raw_category || ''} ${line.section_name || ''}`.toLowerCase();
  return /\b(sales\s*tax|material\s*tax|tax\s*amount|\btax\b)\b/.test(hay);
}

export function unitsCompatible(a?: string | null, b?: string | null): boolean {
  const na = normalizeUnit(a ?? null);
  const nb = normalizeUnit(b ?? null);
  if (!na && !nb) return true;
  if (!na || !nb) return false;
  return na === nb;
}

function semanticsCompatible(a: RawLine, b: RawLine): boolean {
  if (!unitsCompatible(a.unit, b.unit)) return false;
  if (isShingleLike(a) || isShingleLike(b)) return semanticAction(a) === semanticAction(b);
  return true;
}

export function pickBest<T extends RawLine>(candidates: T[], target: RawLine): T {
  if (candidates.length === 1) return candidates[0];
  const tq = num(target.quantity) ?? 0;
  const tt = num(target.total_rcv) ?? 0;
  const tp = num(target.unit_price) ?? 0;
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const qDiff = Math.abs((num(c.quantity) ?? 0) - tq);
    const tDiff = Math.abs((num(c.total_rcv) ?? 0) - tt) / Math.max(Math.abs(tt), 1);
    const pDiff = Math.abs((num(c.unit_price) ?? 0) - tp) / Math.max(Math.abs(tp), 1);
    const sectionPenalty = norm(c.section_name) === norm(target.section_name) ? 0 : 0.25;
    const score = qDiff + tDiff + pDiff + sectionPenalty;
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/**
 * Combine rows that share the same normalized work identity. The identity
 * includes action for shingle work, so remove/tear-off and replacement rows
 * never collapse just because a carrier reused the same Xactimate selector.
 */
export function aggregateByIdentity(lines: RawLine[]): AggregatedLine[] {
  const groups = new Map<string, RawLine[]>();
  for (const l of lines) {
    const identity = codeKey(l) ?? canonicalKey(l) ?? descriptionKey(l) ?? semanticKey(l);
    const arr = groups.get(identity) || [];
    arr.push(l);
    groups.set(identity, arr);
  }
  const aggregated: AggregatedLine[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) { aggregated.push(group[0]); continue; }
    const totalQty = group.reduce((s, x) => s + (num(x.quantity) ?? 0), 0);
    const totalRcv = group.reduce((s, x) => s + (num(x.total_rcv) ?? 0), 0);
    const unitPrice = totalQty > 0 ? +(totalRcv / totalQty).toFixed(4) : (group[0].unit_price ?? null);
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
      _aggregated_codes: group.map(g => g.raw_code ?? null),
      _aggregated_quantities: group.map(g => num(g.quantity)),
      _aggregated_units: group.map(g => normalizeUnit(g.unit ?? null)),
      _aggregated_unit_prices: group.map(g => num(g.unit_price)),
      _aggregated_totals: group.map(g => num(g.total_rcv)),
      _aggregated_pages: group.map(g => num(g.page_number)),
      _aggregated_raw_lines: group.map(g => g.raw_line ?? null),
    });
  }
  return aggregated;
}

export interface PairResult {
  pairs: Array<{ c: AggregatedLine | null; y: AggregatedLine | null; method: string; key: string | null }>;
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
        const validYs = ys.filter(y => semanticsCompatible(target, y));
        if (validYs.length === 0) break;
        const best = pickBest(validYs, target);
        pairs.push({ c: target, y: best, method, key: k });
        consumedC.add(target.id);
        consumedY.add(best.id);
        cs = cs.filter(c => c.id !== target.id);
        ys = ys.filter(y => y.id !== best.id);
      }
    }
  };

  runPass(codeKey, 'code_semantic');
  runPass(canonicalKey, 'canonical_scope');
  runPass(canonicalIdKey, 'canonical_item');
  runPass(descriptionKey, 'description_semantic');

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
    code: line._aggregated_codes?.[i] ?? null,
    section: line._aggregated_sections?.[i] ?? null,
    description: line._aggregated_descriptions?.[i] ?? null,
    quantity: line._aggregated_quantities?.[i] ?? null,
    unit: line._aggregated_units?.[i] ?? null,
    unit_price: line._aggregated_unit_prices?.[i] ?? null,
    total_rcv: line._aggregated_totals?.[i] ?? null,
    page_number: line._aggregated_pages?.[i] ?? null,
    raw_line: line._aggregated_raw_lines?.[i] ?? null,
  }));
}

function confidence(method: string, c: AggregatedLine | null, y: AggregatedLine | null, changeType: ChangeType): MatchScoreBreakdown {
  if (!c || !y) {
    return {
      final: 0,
      classification: 'unmatched',
      normalized_key: normalizedKeyFor(y ?? c),
      reason_codes: [changeType === 'added' ? 'company_only' : 'carrier_only'],
      components: {},
      penalties: {},
    };
  }
  const components: Record<string, number> = {};
  const penalties: Record<string, number> = {};
  const reasons: string[] = [];
  if (unitsCompatible(c.unit, y.unit)) { components.unit = 0.2; reasons.push('unit_match'); } else penalties.unit = -0.5;
  if (semanticAction(c) === semanticAction(y)) { components.semantic_action = 0.2; reasons.push('semantic_action_match'); } else penalties.semantic_action = -0.5;
  if (canonicalScopeKey(c.raw_description || '', c.unit ?? null) === canonicalScopeKey(y.raw_description || '', y.unit ?? null)) {
    components.canonical = 0.3;
    reasons.push('canonical_key_match');
  }
  if (normalizeCode(c.raw_code) && normalizeCode(c.raw_code) === normalizeCode(y.raw_code)) {
    components.code = 0.2;
    reasons.push('xactimate_code_match');
  } else if (method === 'canonical_scope') {
    components.cross_code_canonical = 0.1;
    reasons.push('paired_by_canonical_not_code');
  }
  if (norm(c.section_name) && norm(c.section_name) === norm(y.section_name)) {
    components.section = 0.1;
    reasons.push('section_match');
  }
  if ((c._aggregated_count ?? 1) > 1 || (y._aggregated_count ?? 1) > 1) {
    reasons.push('grouped_duplicate_evidence');
  }
  const final = Math.max(0, Math.min(1, Object.values(components).reduce((s, v) => s + v, 0) + Object.values(penalties).reduce((s, v) => s + v, 0)));
  return {
    final: +final.toFixed(4),
    classification: final >= 0.9 ? 'exact' : final >= 0.75 ? 'strong' : final >= 0.6 ? 'review' : 'unmatched',
    normalized_key: normalizedKeyFor(y) ?? normalizedKeyFor(c),
    reason_codes: reasons,
    components,
    penalties,
  };
}

function makeJustification(row: Pick<DiffRow, 'change_type' | 'carrier_description' | 'company_description' | 'carrier_quantity' | 'company_quantity' | 'carrier_unit' | 'company_unit' | 'carrier_unit_price' | 'company_unit_price' | 'carrier_total_rcv' | 'company_total_rcv' | 'delta_rcv' | 'normalized_key' | 'match_confidence'>): string {
  const carrierDesc = row.carrier_description || 'no carrier line';
  const companyDesc = row.company_description || 'no company line';
  const confidencePct = Math.round((row.match_confidence ?? 0) * 100);
  if (row.change_type === 'added') {
    return `Company-only scope item: ${companyDesc}. Parsed company evidence shows ${qty(row.company_quantity)} ${row.company_unit || ''} × ${money(row.company_unit_price)} = ${money(row.company_total_rcv)}. Delta RCV ${money(row.delta_rcv)}. Normalized key ${row.normalized_key || 'unmatched'}; confidence ${confidencePct}%.`;
  }
  if (row.change_type === 'removed') {
    return `Carrier-only scope item: ${carrierDesc}. Parsed carrier evidence shows ${qty(row.carrier_quantity)} ${row.carrier_unit || ''} × ${money(row.carrier_unit_price)} = ${money(row.carrier_total_rcv)}. Delta RCV ${money(row.delta_rcv)}. Normalized key ${row.normalized_key || 'unmatched'}; confidence ${confidencePct}%.`;
  }
  return `Aligned line evidence: carrier "${carrierDesc}" (${qty(row.carrier_quantity)} ${row.carrier_unit || ''} × ${money(row.carrier_unit_price)} = ${money(row.carrier_total_rcv)}) vs company "${companyDesc}" (${qty(row.company_quantity)} ${row.company_unit || ''} × ${money(row.company_unit_price)} = ${money(row.company_total_rcv)}). Dollar difference ${money(row.delta_rcv)}. Normalized key ${row.normalized_key || 'unknown'}; confidence ${confidencePct}%.`;
}

function decorate(row: DiffRow, c: AggregatedLine | null, y: AggregatedLine | null, method: string): DiffRow {
  const score = confidence(method, c, y, row.change_type);
  const decorated: DiffRow = {
    ...row,
    normalized_key: score.normalized_key,
    canonical_group: groupFor(y ?? c),
    match_confidence: score.final,
    match_score_breakdown: score,
  };
  decorated.justification = makeJustification(decorated);
  return decorated;
}

/**
 * Convert paired (and unpaired) lines into DiffRow records. Carrier and
 * company sides always retain their parsed unit_price / total_rcv values.
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
    if (c && y) {
      const cq = num(c.quantity) ?? 0;
      const yq = num(y.quantity) ?? 0;
      const cp = num(c.unit_price) ?? 0;
      const yp = num(y.unit_price) ?? 0;
      const cr = num(c.total_rcv) ?? 0;
      const yr = num(y.total_rcv) ?? 0;
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

      rows.push(decorate({
        change_type,
        category: y.raw_category || c.raw_category || y.section_name || c.section_name || null,
        canonical_item_id: y.canonical_item_id || c.canonical_item_id || null,
        match_method: method,
        carrier_line_id: c.id, carrier_code: c.raw_code, carrier_description: c.raw_description,
        carrier_quantity: c.quantity, carrier_unit: normalizeUnit(c.unit ?? null), carrier_unit_price: c.unit_price, carrier_total_rcv: c.total_rcv,
        company_line_id: y.id, company_code: y.raw_code, company_description: y.raw_description,
        company_quantity: y.quantity, company_unit: normalizeUnit(y.unit ?? null), company_unit_price: y.unit_price, company_total_rcv: y.total_rcv,
        delta_quantity: +(yq - cq).toFixed(4),
        delta_unit_price: +(yp - cp).toFixed(4),
        delta_rcv: +(yr - cr).toFixed(2),
        delta_percent: cr ? +(((yr - cr) / cr) * 100).toFixed(4) : null,
        grouped_children: mergeChildren(childrenFor('carrier', c), childrenFor('company', y)),
      }, c, y, method));
    }
  }

  for (const c of carrier) {
    if (pairResult.consumedC.has(c.id)) continue;
    rows.push(decorate({
      change_type: 'removed',
      category: c.raw_category || c.section_name || null,
      canonical_item_id: c.canonical_item_id || null,
      match_method: 'unmatched',
      carrier_line_id: c.id, carrier_code: c.raw_code, carrier_description: c.raw_description,
      carrier_quantity: c.quantity, carrier_unit: normalizeUnit(c.unit ?? null), carrier_unit_price: c.unit_price, carrier_total_rcv: c.total_rcv,
      company_line_id: null, company_code: null, company_description: null,
      company_quantity: null, company_unit: null, company_unit_price: null, company_total_rcv: null,
      delta_quantity: c.quantity ? -(num(c.quantity) ?? 0) : null,
      delta_unit_price: null,
      delta_rcv: c.total_rcv ? -(num(c.total_rcv) ?? 0) : null,
      delta_percent: -100,
      grouped_children: childrenFor('carrier', c),
    }, c, null, 'unmatched'));
  }
  for (const y of company) {
    if (pairResult.consumedY.has(y.id)) continue;
    rows.push(decorate({
      change_type: 'added',
      category: y.raw_category || y.section_name || null,
      canonical_item_id: y.canonical_item_id || null,
      match_method: 'unmatched',
      carrier_line_id: null, carrier_code: null, carrier_description: null,
      carrier_quantity: null, carrier_unit: null, carrier_unit_price: null, carrier_total_rcv: null,
      company_line_id: y.id, company_code: y.raw_code, company_description: y.raw_description,
      company_quantity: y.quantity, company_unit: normalizeUnit(y.unit ?? null), company_unit_price: y.unit_price, company_total_rcv: y.total_rcv,
      delta_quantity: y.quantity ? (num(y.quantity) ?? 0) : null,
      delta_unit_price: y.unit_price ? (num(y.unit_price) ?? 0) : null,
      delta_rcv: y.total_rcv ? (num(y.total_rcv) ?? 0) : null,
      delta_percent: 100,
      grouped_children: childrenFor('company', y),
    }, null, y, 'unmatched'));
  }

  return rows;
}
