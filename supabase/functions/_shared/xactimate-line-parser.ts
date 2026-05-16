// ============================================================
// Xactimate Line Parser
// Deterministic line-by-line extractor for Xactimate-style PDFs
// Supports Layout A (UNIT PRICE) and Layout B (REMOVE + REPLACE)
// ============================================================

import { normalizeMoney, normalizeQuantity, normalizeUnit } from './scope-normalizer.ts';

export type LayoutType = 'A' | 'B' | 'unknown';

export interface ParsedLineItem {
  line_number: number | null;
  section_name: string | null;
  raw_description: string;
  quantity: number | null;
  unit: string | null;
  remove_price: number | null;
  replace_price: number | null;
  unit_price: number | null;
  effective_unit_price: number | null;
  tax: number | null;
  total_rcv: number | null;
  depreciation_amount: number | null;
  total_acv: number | null;
  page_number: number | null;
  layout_type: LayoutType;
  raw_line: string;
}

export interface ParsedTotals {
  line_item_total: number | null;
  material_sales_tax: number | null;
  total_rcv: number | null;
  total_acv: number | null;
  net_claim: number | null;
  deductible: number | null;
  recoverable_depreciation: number | null;
  non_recoverable_depreciation: number | null;
}

export interface ParsedHeader {
  carrier_name: string | null;
  claim_number: string | null;
  property_address: string | null;
  price_list: string | null;
  estimate_date: string | null;
}

export interface ParseDebugRow {
  raw_line: string;
  page_number: number | null;
  parser_layout: LayoutType;
  parsed_json: Record<string, unknown>;
  accepted: boolean;
  rejection_reason: string | null;
}

export interface ParseResult {
  header: ParsedHeader;
  lineItems: ParsedLineItem[];
  debugRows: ParseDebugRow[];
  totals: ParsedTotals;
  warnings: string[];
  layout_detected: LayoutType;
  reconciliation: { sum_of_lines: number; doc_rcv: number | null; within_tolerance: boolean; ratio: number | null };
}

const NUMERIC = String.raw`\(?-?\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?|\(?-?\$?\d+(?:\.\d+)?\)?`;
const UNIT_TOKEN = String.raw`(?:SQ|SF|LF|EA|HR|BDL|RL|CY|DA|LS)\b`;

// Layout A row (typical Xactimate single unit price):
// {desc...} {qty} {UNIT} {unit_price} {tax} {rcv} {deprec} {acv}
// numbers at end: 5 numbers (unit_price, tax, rcv, deprec, acv)  qty+unit prefix
const LAYOUT_A_TAIL_RE = new RegExp(
  String.raw`\s+(${NUMERIC})\s+(${UNIT_TOKEN})\s+(${NUMERIC})\s+(${NUMERIC})\s+(${NUMERIC})\s+(${NUMERIC})\s+(${NUMERIC})\s*$`,
  'i',
);
// Variant with 4 tail numbers: unit_price tax rcv acv (no deprec column shown)
const LAYOUT_A_TAIL_RE_4 = new RegExp(
  String.raw`\s+(${NUMERIC})\s+(${UNIT_TOKEN})\s+(${NUMERIC})\s+(${NUMERIC})\s+(${NUMERIC})\s+(${NUMERIC})\s*$`,
  'i',
);

// Layout B row (REMOVE + REPLACE + TAX + TOTAL):
// {desc...} {qty} {UNIT} {remove} {replace} {tax} {total}
const LAYOUT_B_TAIL_RE = new RegExp(
  String.raw`\s+(${NUMERIC})\s+(${UNIT_TOKEN})\s+(${NUMERIC})\s+(${NUMERIC})\s+(${NUMERIC})\s+(${NUMERIC})\s*$`,
  'i',
);

const LINE_NUMBER_RE = /^\s*(\d{1,3})\.\s+(.*)$/;
const PAGE_MARKER_RE = /^\s*Page\s+(\d+)\b/i;

const SECTION_HEADERS = [
  /^\s*ROOF\s*$/i, /^\s*DWELLING ROOF/i,
  /^\s*FRONT ELEVATION/i, /^\s*LEFT ELEVATION/i, /^\s*REAR ELEVATION/i, /^\s*RIGHT ELEVATION/i,
  /^\s*TARP\b/i, /^\s*EXTERIOR\b/i,
  /^\s*FRONT\s*$/i, /^\s*BACK\s*$/i, /^\s*LEFT\s*$/i, /^\s*RIGHT\s*$/i,
  /^\s*GENERAL\s*$/i, /^\s*GUTTERS?\s*$/i,
];

const REJECT_PATTERNS = [
  /^\s*Page\s+\d+/i,
  /^\s*Date:/i,
  /^\s*Estimate:/i,
  /^\s*Client:/i,
  /^\s*Carrier:/i,
  /^\s*Adjuster:/i,
  /^\s*Claim\s*Number/i,
  /^\s*Insured:/i,
  /^\s*Property:/i,
  /^\s*Price List/i,
  /^\s*DESCRIPTION\b/i,
  /^\s*QUANTITY\b/i,
  /^\s*Totals?:/i,
  /^\s*Subtotal/i,
  /^\s*Line Item Total/i,
  /^\s*Material Sales Tax/i,
  /^\s*Replacement Cost Value/i,
  /^\s*Actual Cash Value/i,
  /^\s*Net Claim/i,
  /^\s*Deductible/i,
  /^\s*Recap/i,
  /^\s*CONTINUED\b/i,
];

function parseNum(s: string | undefined | null): number | null {
  return normalizeMoney(s ?? null);
}

function isSectionHeader(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return null;
  for (const re of SECTION_HEADERS) {
    if (re.test(trimmed)) return trimmed.toUpperCase();
  }
  return null;
}

function isRejectable(line: string): string | null {
  for (const re of REJECT_PATTERNS) if (re.test(line)) return `header_or_total:${re.source}`;
  if (!/[a-zA-Z]/.test(line)) return 'no_letters';
  return null;
}

function detectLayout(text: string): LayoutType {
  // Look for header lines indicating layout
  if (/DESCRIPTION\s+QTY\s+REMOVE\s+REPLACE/i.test(text)) return 'B';
  if (/DESCRIPTION\s+QUANTITY\s+UNIT\s*PRICE/i.test(text)) return 'A';
  // Heuristic on first few numeric rows
  const sampleLines = text.split(/\r?\n/).slice(0, 400);
  let aHits = 0, bHits = 0;
  for (const ln of sampleLines) {
    if (LAYOUT_A_TAIL_RE.test(ln) || LAYOUT_A_TAIL_RE_4.test(ln)) aHits++;
    else if (LAYOUT_B_TAIL_RE.test(ln)) bHits++;
  }
  if (aHits === 0 && bHits === 0) return 'unknown';
  return aHits >= bHits ? 'A' : 'B';
}

function tryParseLayoutA(line: string): Partial<ParsedLineItem> | null {
  let m = line.match(LAYOUT_A_TAIL_RE);
  if (m) {
    const [_, qty, unit, unit_price, tax, rcv, deprec, acv] = m;
    const desc = line.slice(0, line.length - m[0].length).trim();
    return {
      raw_description: desc,
      quantity: normalizeQuantity(qty),
      unit: normalizeUnit(unit),
      unit_price: parseNum(unit_price),
      tax: parseNum(tax),
      total_rcv: parseNum(rcv),
      depreciation_amount: parseNum(deprec),
      total_acv: parseNum(acv),
      remove_price: null,
      replace_price: null,
      effective_unit_price: parseNum(unit_price),
      layout_type: 'A',
    };
  }
  m = line.match(LAYOUT_A_TAIL_RE_4);
  if (m) {
    const [_, qty, unit, unit_price, tax, rcv, acv] = m;
    const desc = line.slice(0, line.length - m[0].length).trim();
    return {
      raw_description: desc,
      quantity: normalizeQuantity(qty),
      unit: normalizeUnit(unit),
      unit_price: parseNum(unit_price),
      tax: parseNum(tax),
      total_rcv: parseNum(rcv),
      depreciation_amount: null,
      total_acv: parseNum(acv),
      remove_price: null,
      replace_price: null,
      effective_unit_price: parseNum(unit_price),
      layout_type: 'A',
    };
  }
  return null;
}

function tryParseLayoutB(line: string, action: 'remove' | 'replace' | 'rr' | 'other'): Partial<ParsedLineItem> | null {
  const m = line.match(LAYOUT_B_TAIL_RE);
  if (!m) return null;
  const [_, qty, unit, removeOrReplace, replaceOrTax, taxOrTotal, total] = m;
  // The 4 tail numbers are: remove, replace, tax, total
  const remove = parseNum(removeOrReplace);
  const replace = parseNum(replaceOrTax);
  const tax = parseNum(taxOrTotal);
  const totalVal = parseNum(total);
  const desc = line.slice(0, line.length - m[0].length).trim();

  let effective: number | null = null;
  if (action === 'rr') effective = (remove ?? 0) + (replace ?? 0);
  else if (action === 'remove') effective = remove;
  else if (action === 'replace') effective = replace;
  else effective = (remove ?? 0) + (replace ?? 0);

  return {
    raw_description: desc,
    quantity: normalizeQuantity(qty),
    unit: normalizeUnit(unit),
    remove_price: remove,
    replace_price: replace,
    unit_price: effective,
    effective_unit_price: effective,
    tax,
    total_rcv: totalVal,
    total_acv: totalVal,
    depreciation_amount: null,
    layout_type: 'B',
  };
}

function detectAction(desc: string): 'remove' | 'replace' | 'rr' | 'other' {
  const d = desc.trim();
  if (/^r\s*&\s*r\b/i.test(d) || /^r\s+and\s+r\b/i.test(d) || /^r\s*\/\s*r\b/i.test(d)) return 'rr';
  if (/^remove\b/i.test(d)) return 'remove';
  if (/^replace\b/i.test(d)) return 'replace';
  return 'other';
}

function parseTotals(rawText: string): ParsedTotals {
  const grab = (re: RegExp): number | null => {
    const m = rawText.match(re);
    return m ? normalizeMoney(m[1]) : null;
  };
  return {
    line_item_total: grab(/Line Item Total[^\d\-\(]*([\-\(]?\$?[\d,]+\.\d{2})/i),
    material_sales_tax: grab(/Material Sales Tax[^\d\-\(]*([\-\(]?\$?[\d,]+\.\d{2})/i),
    total_rcv: grab(/Replacement Cost Value[^\d\-\(]*([\-\(]?\$?[\d,]+\.\d{2})/i)
      ?? grab(/Total\s+RCV[^\d\-\(]*([\-\(]?\$?[\d,]+\.\d{2})/i),
    total_acv: grab(/Actual Cash Value[^\d\-\(]*([\-\(]?\$?[\d,]+\.\d{2})/i),
    net_claim: grab(/Net Claim(?:\s+if\s+Depreciation\s+is\s+Recovered)?[^\d\-\(]*([\-\(]?\$?[\d,]+\.\d{2})/i),
    deductible: grab(/Deductible[^\d\-\(]*([\-\(]?\$?[\d,]+\.\d{2})/i),
    recoverable_depreciation: grab(/Recoverable Depreciation[^\d\-\(]*([\-\(]?\$?[\d,]+\.\d{2})/i),
    non_recoverable_depreciation: grab(/Non-?recoverable Depreciation[^\d\-\(]*([\-\(]?\$?[\d,]+\.\d{2})/i),
  };
}

function parseHeader(rawText: string): ParsedHeader {
  const grab = (re: RegExp): string | null => {
    const m = rawText.match(re);
    return m ? m[1].trim() : null;
  };
  return {
    carrier_name: grab(/Carrier:\s*([^\n]+)/i) ?? grab(/Insurance Company:\s*([^\n]+)/i),
    claim_number: grab(/Claim\s*(?:Number|#)?:\s*([^\n]+)/i),
    property_address: grab(/Property:\s*([^\n]+)/i) ?? grab(/Insured Property:\s*([^\n]+)/i),
    price_list: grab(/Price List:\s*([^\n]+)/i),
    estimate_date: grab(/Date of Estimate:\s*([^\n]+)/i) ?? grab(/Estimate Date:\s*([^\n]+)/i),
  };
}

export function parseXactimateLines(rawText: string, _documentId: string): ParseResult {
  const layoutDetected = detectLayout(rawText);
  const lines = rawText.split(/\r?\n/);

  const items: ParsedLineItem[] = [];
  const debug: ParseDebugRow[] = [];
  const warnings: string[] = [];
  let currentSection: string | null = null;
  let currentPage: number | null = null;
  let pendingLineNum: number | null = null;
  let pendingBuffer: string[] = [];

  const flushPending = () => {
    if (pendingBuffer.length === 0) return;
    const merged = pendingBuffer.join(' ').replace(/\s+/g, ' ').trim();
    pendingBuffer = [];
    const lineNum = pendingLineNum;
    pendingLineNum = null;

    if (!merged) return;
    const reject = isRejectable(merged);
    if (reject) {
      debug.push({ raw_line: merged, page_number: currentPage, parser_layout: layoutDetected, parsed_json: {}, accepted: false, rejection_reason: reject });
      return;
    }

    // Try both layouts; trust the one the line actually matches.
    const action = detectAction(merged);
    let parsed: Partial<ParsedLineItem> | null = null;
    if (layoutDetected === 'A') parsed = tryParseLayoutA(merged) ?? tryParseLayoutB(merged, action);
    else if (layoutDetected === 'B') parsed = tryParseLayoutB(merged, action) ?? tryParseLayoutA(merged);
    else parsed = tryParseLayoutA(merged) ?? tryParseLayoutB(merged, action);

    if (!parsed) {
      debug.push({ raw_line: merged, page_number: currentPage, parser_layout: layoutDetected, parsed_json: {}, accepted: false, rejection_reason: 'no_layout_match' });
      return;
    }

    const item: ParsedLineItem = {
      line_number: lineNum,
      section_name: currentSection,
      raw_description: parsed.raw_description || merged,
      quantity: parsed.quantity ?? null,
      unit: parsed.unit ?? null,
      remove_price: parsed.remove_price ?? null,
      replace_price: parsed.replace_price ?? null,
      unit_price: parsed.unit_price ?? null,
      effective_unit_price: parsed.effective_unit_price ?? null,
      tax: parsed.tax ?? null,
      total_rcv: parsed.total_rcv ?? null,
      depreciation_amount: parsed.depreciation_amount ?? null,
      total_acv: parsed.total_acv ?? null,
      page_number: currentPage,
      layout_type: parsed.layout_type ?? layoutDetected,
      raw_line: merged,
    };
    items.push(item);
    debug.push({ raw_line: merged, page_number: currentPage, parser_layout: item.layout_type, parsed_json: { ...item }, accepted: true, rejection_reason: null });
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, ' ').trimEnd();
    if (!line.trim()) {
      // blank line could end wrap
      continue;
    }
    const pm = line.match(PAGE_MARKER_RE);
    if (pm) { currentPage = parseInt(pm[1], 10); continue; }
    const sec = isSectionHeader(line);
    if (sec) { flushPending(); currentSection = sec; continue; }

    const lm = line.match(LINE_NUMBER_RE);
    if (lm) {
      flushPending();
      pendingLineNum = parseInt(lm[1], 10);
      pendingBuffer = [lm[2]];
      continue;
    }
    // continuation
    if (pendingBuffer.length > 0) {
      pendingBuffer.push(line.trim());
    } else {
      // unattached line; check for non-numbered line items that still match a tail regex
      if (LAYOUT_A_TAIL_RE.test(line) || LAYOUT_A_TAIL_RE_4.test(line) || LAYOUT_B_TAIL_RE.test(line)) {
        pendingLineNum = null;
        pendingBuffer = [line];
        flushPending();
      } else {
        // ignore
      }
    }
  }
  flushPending();

  const totals = parseTotals(rawText);
  const header = parseHeader(rawText);

  const sumOfLines = items.reduce((s, i) => s + (i.total_rcv ?? 0), 0);
  const docRcv = totals.total_rcv ?? totals.line_item_total ?? null;
  let withinTolerance = false;
  let ratio: number | null = null;
  if (docRcv && docRcv > 0) {
    ratio = sumOfLines / docRcv;
    withinTolerance = Math.abs(1 - ratio) <= 0.05;
    if (!withinTolerance) warnings.push(`Line-item sum ${sumOfLines.toFixed(2)} differs from doc RCV ${docRcv.toFixed(2)} by ${((1 - ratio) * 100).toFixed(1)}%`);
  }
  if (items.length === 0) warnings.push('no_line_items_extracted');
  if (layoutDetected === 'unknown') warnings.push('layout_undetected');

  return {
    header,
    lineItems: items,
    debugRows: debug,
    totals,
    warnings,
    layout_detected: layoutDetected,
    reconciliation: { sum_of_lines: +sumOfLines.toFixed(2), doc_rcv: docRcv, within_tolerance: withinTolerance, ratio },
  };
}
