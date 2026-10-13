import { PDFDocument, PDFDict, PDFName, PDFArray, PDFNumber, PDFRawStream, PDFStream, PDFPage, StandardFonts, decodePDFRawStream, StandardFontEmbedder } from 'pdf-lib';

/**
 * Genuine existing-text editing for page content streams.
 * We tokenize the page's own content stream, find the actual text-show operators (Tj, TJ, ', ")
 * with the font selected by Tf, and splice ONLY those operators. Every other byte of the stream is
 * kept. Two modes:
 *  - in place: the operand is re-encoded in the original font's own codes (glyphs must be proven present);
 *  - restyle/move: the original operator is replaced by an advance-preserving empty TJ (so nothing else on
 *    the line moves) and the new text is written as a real text object with the chosen font, size, colour and
 *    position. The old text is removed from the content, not covered. No overlay/annotation is used.
 * Every output is reopened and verified; anything unverifiable throws and nothing is saved.
 */

export interface FontDiagnosis {
  key: string; baseFont: string; subtype: string; encoding: string;
  embedded: boolean; subset: boolean; standard14: boolean; hasToUnicode: boolean; twoByte: boolean;
  usedCodes: Set<number>; toUni: Map<number, string>; fromUni: Map<string, number>;
  widths: Map<number, number> | null; defaultWidth?: number;
  editable: boolean; reason?: string; note?: string;
}
export interface TextState { size: number; Tc: number; Tw: number; Tz: number; Ts: number; Tr: number; fill: string }
export interface TextSegment {
  id: number; op: string; fontKey: string | null; text: string; codes: number[];
  strStart: number; strEnd: number; // byte range of the operand to splice
  opStart: number; opEnd: number;   // byte range of operands + operator
  kerned: boolean; kernSum: number;
  state: TextState;
  dependentNext: boolean; // the next show operator continues from this one's end position
}
export interface PageText { segments: TextSegment[]; fonts: Record<string, FontDiagnosis>; content: Uint8Array; blocked?: string }

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set('()<>[]{}/%'.split('').map(c => c.charCodeAt(0)));
type Tok = { t: 'num' | 'name' | 'str' | 'arr[' | 'arr]' | 'dict[' | 'dict]' | 'op'; s: number; e: number; v: string; b?: number[] };

function tokenize(src: Uint8Array): Tok[] {
  const out: Tok[] = []; let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i];
    if (WS.has(c)) { i++; continue; }
    if (c === 37) { while (i < n && src[i] !== 10 && src[i] !== 13) i++; continue; }
    const s = i;
    if (c === 40) { // literal string
      const b: number[] = []; let depth = 1; i++;
      while (i < n && depth) {
        const ch = src[i++];
        if (ch === 92) {
          const x = src[i++];
          const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
          if (x in map) b.push(map[x]);
          else if (x >= 48 && x <= 55) { let o = x - 48; for (let k = 0; k < 2 && src[i] >= 48 && src[i] <= 55; k++) o = o * 8 + src[i++] - 48; b.push(o & 255); }
          else if (x === 13) { if (src[i] === 10) i++; } else if (x !== 10) b.push(x);
          continue;
        }
        if (ch === 40) depth++; else if (ch === 41 && --depth === 0) break;
        b.push(ch);
      }
      out.push({ t: 'str', s, e: i, v: '', b }); continue;
    }
    if (c === 60 && src[i + 1] === 60) { out.push({ t: 'dict[', s, e: i + 2, v: '<<' }); i += 2; continue; }
    if (c === 62 && src[i + 1] === 62) { out.push({ t: 'dict]', s, e: i + 2, v: '>>' }); i += 2; continue; }
    if (c === 60) { i++; let hex = ''; while (i < n && src[i] !== 62) { if (!WS.has(src[i])) hex += String.fromCharCode(src[i]); i++; } i++; if (hex.length % 2) hex += '0'; const b: number[] = []; for (let k = 0; k < hex.length; k += 2) b.push(parseInt(hex.slice(k, k + 2), 16)); out.push({ t: 'str', s, e: i, v: '', b }); continue; }
    if (c === 91) { out.push({ t: 'arr[', s, e: ++i, v: '[' }); continue; }
    if (c === 93) { out.push({ t: 'arr]', s, e: ++i, v: ']' }); continue; }
    if (c === 47) { i++; while (i < n && !WS.has(src[i]) && !DELIM.has(src[i])) i++; out.push({ t: 'name', s, e: i, v: new TextDecoder('latin1').decode(src.subarray(s + 1, i)) }); continue; }
    while (i < n && !WS.has(src[i]) && !DELIM.has(src[i])) i++;
    if (i === s) { i++; continue; }
    const v = new TextDecoder('latin1').decode(src.subarray(s, i));
    out.push({ t: /^[+-]?(\d+\.?\d*|\.\d+)$/.test(v) ? 'num' : 'op', s, e: i, v });
    if (v === 'ID') { // skip inline image data up to whitespace EI whitespace
      while (i < n - 2 && !(WS.has(src[i]) && src[i + 1] === 69 && src[i + 2] === 73 && (i + 3 >= n || WS.has(src[i + 3])))) i++;
      i += 3;
    }
  }
  return out;
}

function inherited(page: PDFPage, key: string): PDFDict | undefined {
  let node: any = page.node;
  while (node) {
    let v: unknown; try { v = node.context.lookup(node.get(PDFName.of(key))); } catch { v = undefined; }
    if (v instanceof PDFDict) return v;
    try { node = node.context.lookup(node.get(PDFName.of('Parent'))); } catch { return undefined; }
    if (!(node instanceof PDFDict)) return undefined;
  }
}

function annotCount(p: PDFPage) { try { const a = p.doc.context.lookup(p.node.get(PDFName.of('Annots'))); return a instanceof PDFArray ? a.size() : 0; } catch { return -1; } }
function fieldCount(d: PDFDocument) { try { return d.getForm().getFields().length; } catch { return -1; } }

export function pageContentBytes(page: PDFPage): Uint8Array {
  const ctx = page.doc.context;
  const raw = ctx.lookup(page.node.get(PDFName.of('Contents')));
  const streams = raw instanceof PDFArray ? raw.asArray().map(r => { try { return ctx.lookup(r); } catch { return undefined; } }) : [raw];
  const parts = streams.map((s, i) => {
    if (s === undefined && raw !== undefined) throw new Error(`content stream ${i + 1} of this page could not be found in the file`);
    try { return s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s instanceof PDFStream ? (s as any).getContents() as Uint8Array : new Uint8Array(); }
    catch (e) { throw new Error(`content stream ${i + 1} could not be decompressed (${(e as Error).message})`); }
  });
  const total = parts.reduce((a, p) => a + p.length + 1, 0), out = new Uint8Array(total); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; out[o++] = 10; }
  return out;
}

function parseToUnicode(src: string) {
  const map = new Map<number, string>();
  const hexToStr = (h: string) => { let s = ''; for (let k = 0; k + 4 <= h.length; k += 4) s += String.fromCharCode(parseInt(h.slice(k, k + 4), 16)); if (h.length === 2) s = String.fromCharCode(parseInt(h, 16)); return s; };
  for (const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  for (const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[4]) { const base = hexToStr(m[4]); for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo))); }
      else if (m[5]) [...m[5].matchAll(/<([0-9a-fA-F]+)>/g)].forEach((x, k) => map.set(lo + k, hexToStr(x[1])));
    }
  }
  return map;
}

// WinAnsi 128–159 (the rest of 32–255 is Latin-1 identical)
const WIN_ANSI_HI: Record<number, string> = { 128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡', 136: 'ˆ', 137: '‰', 138: 'Š', 139: '‹', 140: 'Œ', 142: 'Ž', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 152: '˜', 153: '™', 154: 'š', 155: '›', 156: 'œ', 158: 'ž', 159: 'Ÿ' };
function winAnsiMap() { const m = new Map<number, string>(); for (let c = 32; c < 256; c++) { if (c < 127 || c >= 160) m.set(c, String.fromCharCode(c)); else if (WIN_ANSI_HI[c]) m.set(c, WIN_ANSI_HI[c]); } return m; }
/** Characters a standard (WinAnsi) font can draw. */
export function winAnsiMissing(text: string): string[] { const ok = new Set(winAnsiMap().values()); return [...new Set(Array.from(text).filter(ch => !ok.has(ch)))]; }

const STD_BY_BASE: Record<string, StandardFonts> = Object.fromEntries(Object.values(StandardFonts).map(v => [v, v as StandardFonts]));

function diagnoseFont(key: string, font: PDFDict): FontDiagnosis {
  const name = (k: string, d: PDFDict = font) => d.lookupMaybe(PDFName.of(k), PDFName)?.decodeText();
  const subtype = name('Subtype') ?? 'Unknown';
  const baseFont = name('BaseFont') ?? key;
  const encObj = font.lookup(PDFName.of('Encoding'));
  const encoding = encObj instanceof PDFName ? encObj.decodeText() : encObj instanceof PDFDict ? 'custom (Differences)' : 'built-in';
  const twoByte = subtype === 'Type0';
  const desc = twoByte ? (font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.lookup(0) as PDFDict | undefined) : font;
  const fd = desc?.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  const embedded = !!fd && ['FontFile', 'FontFile2', 'FontFile3'].some(k => fd.has(PDFName.of(k)));
  const subset = /^[A-Z]{6}\+/.test(baseFont);
  const tu = font.lookup(PDFName.of('ToUnicode'));
  let toUni = new Map<number, string>();
  if (tu instanceof PDFRawStream) toUni = parseToUnicode(new TextDecoder('latin1').decode(decodePDFRawStream(tu).decode()));
  const plain = baseFont.replace(/^[A-Z]{6}\+/, '');
  const standard14 = /^(Times|Helvetica|Courier|Symbol|ZapfDingbats)/.test(plain) && !embedded;
  const stdEncoding = ['WinAnsiEncoding', 'built-in', 'StandardEncoding'].includes(encoding);
  if (!toUni.size && !twoByte && stdEncoding) toUni = winAnsiMap();
  const fromUni = new Map<string, number>(); toUni.forEach((u, c) => { if (!fromUni.has(u)) fromUni.set(u, c); });

  // Glyph advance widths (glyph space, 1/1000 em) — needed so nothing else on a line moves.
  let widths: Map<number, number> | null = null; let defaultWidth: number | undefined;
  try {
    if (twoByte && desc) {
      defaultWidth = desc.lookupMaybe(PDFName.of('DW'), PDFNumber)?.asNumber() ?? 1000; widths = new Map();
      const W = desc.lookupMaybe(PDFName.of('W'), PDFArray);
      if (W) for (let i = 0; i < W.size();) {
        const first = (W.lookup(i) as PDFNumber).asNumber(); const nx = W.lookup(i + 1);
        if (nx instanceof PDFArray) { nx.asArray().forEach((_, k) => widths!.set(first + k, (nx.lookup(k) as PDFNumber).asNumber())); i += 2; }
        else { const last = (nx as PDFNumber).asNumber(), w = (W.lookup(i + 2) as PDFNumber).asNumber(); for (let c = first; c <= last; c++) widths.set(c, w); i += 3; }
      }
    } else {
      const fc = font.lookupMaybe(PDFName.of('FirstChar'), PDFNumber)?.asNumber(); const Ws = font.lookupMaybe(PDFName.of('Widths'), PDFArray);
      if (fc !== undefined && Ws) { widths = new Map(); Ws.asArray().forEach((_, k) => widths!.set(fc + k, (Ws.lookup(k) as PDFNumber).asNumber())); defaultWidth = fd?.lookupMaybe(PDFName.of('MissingWidth'), PDFNumber)?.asNumber() ?? 0; }
      else if (standard14 && STD_BY_BASE[plain]) {
        const emb = StandardFontEmbedder.for(STD_BY_BASE[plain] as unknown as Parameters<typeof StandardFontEmbedder.for>[0]); widths = new Map();
        toUni.forEach((u, c) => { try { widths!.set(c, emb.widthOfTextAtSize(u, 1000)); } catch { /* unencodable */ } });
      }
    }
  } catch { widths = null; }

  let reason: string | undefined; let note: string | undefined;
  if (subtype === 'Type3') reason = 'Type 3 font (glyphs are drawn procedures) — cannot safely re-encode.';
  else if (twoByte && !['Identity-H', 'Identity-V'].includes(encoding)) reason = `CID font with "${encoding}" encoding — only Identity-H/V is supported.`;
  else if (!toUni.size) reason = encoding.startsWith('custom') ? 'Custom glyph encoding without a ToUnicode map — characters cannot be mapped reliably.' : 'No character map available for this font.';
  else if (!embedded && !standard14) {
    if (twoByte || !stdEncoding) reason = 'Font program is not embedded and its encoding is not a standard one, so characters cannot be verified.';
    else note = 'This font is not embedded in the PDF; viewers supply it, exactly as they already do for the original text.';
  }
  return { key, baseFont, subtype, encoding, embedded, subset, standard14, hasToUnicode: tu instanceof PDFRawStream, twoByte, usedCodes: new Set(), toUni, fromUni, widths, defaultWidth, editable: !reason, reason, note };
}

function damagedFont(key: string, e: unknown): FontDiagnosis {
  return { key, baseFont: key, subtype: 'Unknown', encoding: 'unknown', embedded: false, subset: false, standard14: false, hasToUnicode: false, twoByte: false, usedCodes: new Set(), toUni: new Map(), fromUni: new Map(), widths: null, editable: false, reason: `This font's internal data is damaged or incomplete (${(e as Error).message}), so its glyphs cannot be verified.` };
}

function getPage(doc: PDFDocument, pageIndex: number): PDFPage {
  let pages: PDFPage[];
  try { pages = doc.getPages(); }
  catch (e) { throw new Error(`the PDF's page list could not be read (${(e as Error).message}). The file may be protected or damaged.`); }
  const page = pages[pageIndex]; if (!page) throw new Error('Page does not exist');
  return page;
}

const SHOW = new Set(['Tj', 'TJ', "'", '"']);
const POSITION = new Set(['Td', 'TD', 'Tm', 'T*', 'BT', 'ET', "'", '"']);

export function readPageText(doc: PDFDocument, pageIndex: number): PageText {
  if (doc.isEncrypted) return { segments: [], fonts: {}, content: new Uint8Array(), blocked: 'This PDF is encrypted. Open it through the editor so it can be unlocked first (only possible when it opens without a password).' };
  const page = getPage(doc, pageIndex);
  let fontDict: PDFDict | undefined;
  try { const r = inherited(page, 'Resources'); const f = r ? doc.context.lookup(r.get(PDFName.of('Font'))) : undefined; fontDict = f instanceof PDFDict ? f : undefined; } catch { fontDict = undefined; }
  const fonts: Record<string, FontDiagnosis> = {};
  fontDict?.entries().forEach(([k, v]) => {
    const key = k.decodeText();
    try { const f = doc.context.lookup(v); fonts[key] = f instanceof PDFDict ? diagnoseFont(key, f) : damagedFont(key, new Error('font object missing')); }
    catch (e) { fonts[key] = damagedFont(key, e); }
  });
  const content = pageContentBytes(page);
  const src = new TextDecoder('latin1').decode(content);
  const toks = tokenize(content);
  const segments: TextSegment[] = []; let ops: Tok[] = [];
  type GS = TextState & { font: string | null; cs: string };
  let gs: GS = { font: null, size: 0, Tc: 0, Tw: 0, Tz: 100, Ts: 0, Tr: 0, fill: '0 g', cs: '' }; const stack: GS[] = [];
  let prev: TextSegment | null = null;
  const num = (k: number) => { const o = ops.filter(x => x.t === 'num'); return o.length > k ? parseFloat(o[k].v) : 0; };
  const opsText = (t: Tok) => ops.length ? src.slice(ops[0].s, t.e) : t.v;
  const decode = (b: number[], f: FontDiagnosis | undefined) => {
    const codes: number[] = []; if (f?.twoByte) for (let k = 0; k + 1 < b.length; k += 2) codes.push((b[k] << 8) | b[k + 1]); else codes.push(...b);
    return { codes, text: codes.map(c => f?.toUni.get(c) ?? '\uFFFD').join('') };
  };
  for (const t of toks) {
    if (t.t !== 'op') { ops.push(t); continue; }
    switch (t.v) {
      case 'q': stack.push({ ...gs }); break;
      case 'Q': gs = stack.pop() ?? gs; break;
      case 'Tf': gs.font = ops.find(o => o.t === 'name')?.v ?? gs.font; gs.size = num(0); break;
      case 'Tc': gs.Tc = num(0); break;
      case 'Tw': gs.Tw = num(0); break;
      case 'Tz': gs.Tz = num(0); break;
      case 'Ts': gs.Ts = num(0); break;
      case 'Tr': gs.Tr = num(0); break;
      case 'g': case 'rg': case 'k': gs.cs = ''; gs.fill = opsText(t); break;
      case 'cs': gs.cs = opsText(t); gs.fill = gs.cs; break;
      case 'sc': case 'scn': gs.fill = (gs.cs ? gs.cs + ' ' : '') + opsText(t); break;
    }
    if (t.v === '"') { gs.Tw = num(0); gs.Tc = num(1); }
    if (POSITION.has(t.v)) prev = null;
    if (SHOW.has(t.v)) {
      const f = gs.font ? fonts[gs.font] : undefined;
      const state: TextState = { size: gs.size, Tc: gs.Tc, Tw: gs.Tw, Tz: gs.Tz, Ts: gs.Ts, Tr: gs.Tr, fill: gs.fill };
      let seg: TextSegment | null = null;
      if (t.v === 'TJ') {
        const a = ops.findIndex(o => o.t === 'arr['), z = ops.map(o => o.t).lastIndexOf('arr]');
        if (a >= 0 && z > a) {
          const inner = ops.slice(a, z); const d = decode(inner.filter(o => o.t === 'str').flatMap(p => p.b!), f);
          const kerns = inner.filter(o => o.t === 'num').map(o => parseFloat(o.v));
          seg = { id: segments.length, op: 'TJ', fontKey: gs.font, ...d, strStart: ops[a].s, strEnd: ops[z].e, opStart: ops[a].s, opEnd: t.e, kerned: kerns.length > 0, kernSum: kerns.reduce((x, y) => x + y, 0), state, dependentNext: false };
        }
      } else {
        const s = [...ops].reverse().find(o => o.t === 'str');
        if (s) seg = { id: segments.length, op: t.v, fontKey: gs.font, ...decode(s.b!, f), strStart: s.s, strEnd: s.e, opStart: ops[0]?.s ?? s.s, opEnd: t.e, kerned: false, kernSum: 0, state, dependentNext: false };
      }
      if (seg) { if (prev && (t.v === 'Tj' || t.v === 'TJ')) prev.dependentNext = true; segments.push(seg); prev = seg; }
    }
    ops = [];
  }
  for (const s of segments) if (s.fontKey && fonts[s.fontKey]) s.codes.forEach(c => fonts[s.fontKey!].usedCodes.add(c));
  return { segments, fonts, content };
}

function codesFor(f: FontDiagnosis, text: string): { ok: true; codes: number[] } | { ok: false; reason: string } {
  if (!f.editable) return { ok: false, reason: f.reason! };
  if (!text.length) return { ok: false, reason: 'Replacement text is empty.' };
  if (/[\r\n]/.test(text)) return { ok: false, reason: 'A text area is a single line. Remove the line break.' };
  const codes: number[] = []; const missing = new Set<string>();
  for (const ch of Array.from(text)) {
    const c = f.fromUni.get(ch);
    if (c === undefined) { missing.add(ch); continue; }
    if (f.embedded && !f.usedCodes.has(c)) { missing.add(ch); continue; } // embedded fonts may be subsets: glyph must already be used with this font
    codes.push(c);
  }
  if (missing.size) return { ok: false, reason: `The font ${f.baseFont.replace(/^[A-Z]{6}\+/, '')}${f.subset ? ' (a subset)' : ''} does not contain these characters: ${[...missing].map(c => JSON.stringify(c)).join(' ')}. Nothing was changed.` };
  return { ok: true, codes };
}

/** Why a replacement is (not) possible with the segment's original font. */
export function checkReplacement(pt: PageText, seg: TextSegment, text: string): { ok: true; codes: number[] } | { ok: false; reason: string } {
  const f = seg.fontKey ? pt.fonts[seg.fontKey] : undefined;
  if (!f) return { ok: false, reason: `Font resource /${seg.fontKey ?? '?'} is missing from the page resources.` };
  return codesFor(f, text);
}

/** Horizontal advance of codes in TJ units (1/1000 text-space unit per font size); undefined if widths unknown. */
function advanceUnits(f: FontDiagnosis, codes: number[], st: TextState, kernSum = 0): number | undefined {
  if (!f.widths || !st.size) return undefined;
  let w = 0;
  for (const c of codes) { const g = f.widths.get(c) ?? f.defaultWidth; if (g === undefined) return undefined; w += g; }
  const spaces = f.twoByte ? 0 : codes.filter(c => c === 32).length;
  return w + (1000 * (codes.length * st.Tc + spaces * st.Tw)) / st.size - kernSum;
}

const fmt = (x: number) => String(Math.round(x * 10000) / 10000);
const hexOf = (codes: number[], twoByte: boolean) => '<' + codes.map(c => c.toString(16).padStart(twoByte ? 4 : 2, '0')).join('') + '>';

async function finish(doc: PDFDocument, pageIndex: number, next: Uint8Array, before: PageText, check: (after: PageText) => void, counts: { fields: number; annots: number }) {
  const page = getPage(doc, pageIndex);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(next)));
  const out = await doc.save();
  const re = await PDFDocument.load(out, { updateMetadata: false });
  const after = readPageText(re, pageIndex);
  check(after);
  if (fieldCount(re) !== counts.fields || annotCount(getPage(re, pageIndex)) !== counts.annots) throw new Error('Verification failed: forms or annotations changed');
  void before; return out;
}

/** Replace one segment's text in place, with its original font; returns verified new PDF bytes. */
export async function replaceSegmentText(bytes: Uint8Array, pageIndex: number, segmentId: number, text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  const pt = readPageText(doc, pageIndex);
  if (pt.blocked) throw new Error(pt.blocked);
  const seg = pt.segments[segmentId]; if (!seg) throw new Error('Text object not found');
  const chk = checkReplacement(pt, seg, text); if ('reason' in chk) throw new Error(chk.reason);
  const f = pt.fonts[seg.fontKey!];
  let operand = hexOf(chk.codes, f.twoByte);
  if (seg.dependentNext) { // keep following text on the line where it was
    const oldA = advanceUnits(f, seg.codes, seg.state, seg.kernSum), newA = advanceUnits(f, chk.codes, seg.state);
    if (oldA === undefined || newA === undefined) throw new Error('The text that follows on this line continues from this text, and this font has no width table, so changing it would shift the rest of the line. Nothing was changed.');
    const k = newA - oldA;
    if (Math.abs(k) > 0.001) operand = `[${operand} ${fmt(k)}]`;
  }
  if (seg.op === 'TJ' && !operand.startsWith('[')) operand = `[${operand}]`;
  if ((seg.op === 'Tj' || seg.op === "'" || seg.op === '"') && operand.startsWith('[')) {
    if (seg.op !== 'Tj') throw new Error('This text uses a line-advance operator that cannot carry spacing adjustments. Nothing was changed.');
  }
  const replaceRange = operand.startsWith('[') && seg.op === 'Tj' ? [seg.strStart, seg.opEnd, `${operand} TJ`] as const : [seg.strStart, seg.strEnd, operand] as const;
  const enc = new TextEncoder().encode(replaceRange[2]);
  const next = new Uint8Array(pt.content.length - (replaceRange[1] - replaceRange[0]) + enc.length);
  next.set(pt.content.subarray(0, replaceRange[0])); next.set(enc, replaceRange[0]); next.set(pt.content.subarray(replaceRange[1]), replaceRange[0] + enc.length);
  const counts = { fields: fieldCount(doc), annots: annotCount(getPage(doc, pageIndex)) };
  return finish(doc, pageIndex, next, pt, after => {
    if (after.segments.length !== pt.segments.length) throw new Error('Verification failed: text object count changed');
    if (after.segments[segmentId].text !== text) throw new Error('Verification failed: replacement not found in the content stream');
    if (pt.segments.some((s, i) => i !== segmentId && after.segments[i].text !== s.text)) throw new Error('Verification failed: other text changed');
  }, counts);
}

export type FontChoice = { kind: 'page'; key: string } | { kind: 'standard'; name: StandardFonts };
export interface RestyleOptions {
  text: string; font: FontChoice; size: number;
  /** Original text rendering matrix in PDF user space (pdf.js TextItem.transform). */
  matrix: number[];
  dx: number; dy: number; // move, PDF points
  color?: [number, number, number] | null; // 0–1 RGB; null/undefined keeps the original colour
}

export const STANDARD_CHOICES: { name: StandardFonts; label: string }[] = [
  { name: StandardFonts.Helvetica, label: 'Helvetica' }, { name: StandardFonts.HelveticaBold, label: 'Helvetica Bold' },
  { name: StandardFonts.HelveticaOblique, label: 'Helvetica Italic' }, { name: StandardFonts.HelveticaBoldOblique, label: 'Helvetica Bold Italic' },
  { name: StandardFonts.TimesRoman, label: 'Times' }, { name: StandardFonts.TimesRomanBold, label: 'Times Bold' },
  { name: StandardFonts.TimesRomanItalic, label: 'Times Italic' }, { name: StandardFonts.TimesRomanBoldItalic, label: 'Times Bold Italic' },
  { name: StandardFonts.Courier, label: 'Courier' }, { name: StandardFonts.CourierBold, label: 'Courier Bold' },
  { name: StandardFonts.CourierOblique, label: 'Courier Italic' }, { name: StandardFonts.CourierBoldOblique, label: 'Courier Bold Italic' },
];

/** Check a restyle request without writing anything. */
export function checkRestyle(pt: PageText, seg: TextSegment, o: Pick<RestyleOptions, 'text' | 'font' | 'size'>): { ok: true } | { ok: false; reason: string } {
  if (!o.text.length) return { ok: false, reason: 'Replacement text is empty.' };
  if (/[\r\n]/.test(o.text)) return { ok: false, reason: 'A text area is a single line. Remove the line break.' };
  if (!(o.size > 0 && o.size < 500)) return { ok: false, reason: 'Font size must be between 0 and 500 pt.' };
  if (seg.op === '"') return { ok: false, reason: 'This text uses a combined spacing operator that cannot be moved safely. You can still change its words in place.' };
  const of = seg.fontKey ? pt.fonts[seg.fontKey] : undefined;
  if (seg.dependentNext && (!of || advanceUnits(of, seg.codes, seg.state, seg.kernSum) === undefined)) return { ok: false, reason: 'The next text on this line continues from this one and its font has no width table, so moving it would shift the rest of the line.' };
  if (o.font.kind === 'page') { const f = pt.fonts[o.font.key]; if (!f) return { ok: false, reason: 'That font is not available on this page.' }; const c = codesFor(f, o.text); return c.ok ? { ok: true } : c; }
  const miss = winAnsiMissing(o.text);
  return miss.length ? { ok: false, reason: `This standard font cannot draw: ${miss.map(c => JSON.stringify(c)).join(' ')}.` } : { ok: true };
}

/** Remove the original text operator (advance preserved) and write the text as a new real text object with the chosen style/position. */
export async function rewriteSegment(bytes: Uint8Array, pageIndex: number, segmentId: number, o: RestyleOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  const pt = readPageText(doc, pageIndex);
  if (pt.blocked) throw new Error(pt.blocked);
  const seg = pt.segments[segmentId]; if (!seg) throw new Error('Text object not found');
  const chk = checkRestyle(pt, seg, o); if ('reason' in chk) throw new Error(chk.reason);
  const page = getPage(doc, pageIndex);
  const counts = { fields: fieldCount(doc), annots: annotCount(page) };

  // 1) the old text: replace the show operator with an empty TJ that keeps the same advance
  let removal = '[] TJ';
  if (seg.dependentNext) { const a = advanceUnits(pt.fonts[seg.fontKey!], seg.codes, seg.state, seg.kernSum)!; removal = `[${fmt(-a)}] TJ`; }
  if (seg.op === "'") removal = 'T* ' + removal;
  const start = seg.op === "'" ? seg.strStart : seg.strStart;

  // 2) the new text object
  let fontName: string, operand: string, twoByte = false;
  if (o.font.kind === 'page') {
    const f = pt.fonts[o.font.key]; const c = codesFor(f, o.text) as { ok: true; codes: number[] };
    fontName = `/${o.font.key}`; twoByte = f.twoByte; operand = hexOf(c.codes, f.twoByte);
  } else {
    const font = await doc.embedFont(o.font.name);
    fontName = page.node.newFontDictionary(font.name, font.ref).toString();
    operand = font.encodeText(o.text).toString();
  }
  void twoByte;
  const [a, b, c, d, e, f] = o.matrix; const sh = Math.hypot(a, b) || 1, sv = Math.hypot(c, d) || 1;
  const tm = [a / sh, b / sh, c / sv, d / sv, e + o.dx, f + o.dy].map(fmt).join(' ');
  const fill = o.color ? `${o.color.map(fmt).join(' ')} rg` : seg.state.fill;
  const st = seg.state;
  const obj = `\nQ\nq BT ${fill} ${fontName} ${fmt(o.size)} Tf ${fmt(st.Tc)} Tc ${fmt(st.Tw)} Tw ${fmt(100 * sh / sv)} Tz ${st.Tr === 3 ? 3 : 0} Tr ${tm} Tm ${operand} Tj ET Q\n`;

  const head = new TextEncoder().encode('q\n'), mid = new TextEncoder().encode(removal), tail = new TextEncoder().encode(obj);
  const pre = pt.content.subarray(0, start), post = pt.content.subarray(seg.opEnd);
  const next = new Uint8Array(head.length + pre.length + mid.length + post.length + tail.length); let p = 0;
  for (const part of [head, pre, mid, post, tail]) { next.set(part, p); p += part.length; }

  return finish(doc, pageIndex, next, pt, after => {
    if (after.segments.length !== pt.segments.length + 1) throw new Error('Verification failed: text object count changed unexpectedly');
    if (after.segments[segmentId].text !== '') throw new Error('Verification failed: the original text is still present');
    const added = after.segments[after.segments.length - 1];
    const latin = Array.from(o.text).every(ch => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127);
    if ((o.font.kind === 'page' || latin) && added.text !== o.text) throw new Error('Verification failed: the new text was not written correctly');
    if (pt.segments.some((s, i) => i !== segmentId && after.segments[i].text !== s.text)) throw new Error('Verification failed: other text changed');
  }, counts);
}

/** Fonts usable for this page: every editable font already on the page plus the standard PDF fonts. */
export function pageFontChoices(pt: PageText): { key: string; label: string }[] {
  return Object.values(pt.fonts).filter(f => f.editable).map(f => ({ key: f.key, label: `${f.baseFont.replace(/^[A-Z]{6}\+/, '')} (/${f.key})` }));
}
