import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRawStream, PDFStream, PDFPage, decodePDFRawStream } from 'pdf-lib';

/**
 * Genuine existing-text editing for page content streams.
 * We tokenize the page's own content stream, find the actual text-show operators (Tj, TJ, ', ")
 * with the font selected by Tf, and splice ONLY the string operand. Every other byte of the
 * stream is kept. Replacement text is encoded in the original font's own codes and is only
 * allowed when every glyph is proven present (already used with that font in this document,
 * or the font is a full, non-subset font). No font is ever substituted; no overlay is drawn.
 */

export interface FontDiagnosis {
  key: string; baseFont: string; subtype: string; encoding: string;
  embedded: boolean; subset: boolean; hasToUnicode: boolean; twoByte: boolean;
  usedCodes: Set<number>; toUni: Map<number, string>; fromUni: Map<string, number>;
  editable: boolean; reason?: string;
}
export interface TextSegment {
  id: number; op: string; fontKey: string | null; text: string; codes: number[];
  strStart: number; strEnd: number; // byte range of the operand to splice
  kerned: boolean;
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
        let ch = src[i++];
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
    const v = node.lookup(PDFName.of(key));
    if (v instanceof PDFDict) return v;
    node = node.lookup(PDFName.of('Parent'));
    if (!(node instanceof PDFDict)) return undefined;
  }
}

export function pageContentBytes(page: PDFPage): Uint8Array {
  const c = page.node.Contents();
  const streams = c instanceof PDFArray ? c.asArray().map(r => page.doc.context.lookup(r)) : [c];
  const parts = streams.map(s => s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s instanceof PDFStream ? (s as any).getContents() as Uint8Array : new Uint8Array());
  const total = parts.reduce((a, p) => a + p.length + 1, 0), out = new Uint8Array(total); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; out[o++] = 10; }
  return out;
}

function parseToUnicode(src: string, twoByte: boolean) {
  const map = new Map<number, string>();
  const hexToStr = (h: string) => { let s = ''; for (let k = 0; k + 4 <= h.length; k += 4) s += String.fromCharCode(parseInt(h.slice(k, k + 4), 16)); return s; };
  for (const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  for (const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[4]) { const base = hexToStr(m[4]); for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo))); }
      else if (m[5]) [...m[5].matchAll(/<([0-9a-fA-F]+)>/g)].forEach((x, k) => map.set(lo + k, hexToStr(x[1])));
    }
  }
  void twoByte; return map;
}

function diagnoseFont(doc: PDFDocument, key: string, font: PDFDict): FontDiagnosis {
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
  if (tu instanceof PDFRawStream) toUni = parseToUnicode(new TextDecoder('latin1').decode(decodePDFRawStream(tu).decode()), twoByte);
  const standard14 = /^(Times|Helvetica|Courier|Symbol|ZapfDingbats)/.test(baseFont.replace(/^[A-Z]{6}\+/, '')) && !embedded;
  if (!toUni.size && !twoByte && (encoding === 'WinAnsiEncoding' || encoding === 'built-in' || encoding === 'StandardEncoding'))
    for (let c = 32; c < 256; c++) if (c < 127 || c >= 160) toUni.set(c, String.fromCharCode(c));
  const fromUni = new Map<string, number>(); toUni.forEach((u, c) => { if (!fromUni.has(u)) fromUni.set(u, c); });
  let reason: string | undefined;
  if (subtype === 'Type3') reason = 'Type 3 font (glyphs are drawn procedures) — cannot safely re-encode.';
  else if (twoByte && !['Identity-H', 'Identity-V'].includes(encoding)) reason = `CID font with "${encoding}" encoding — only Identity-H/V is supported.`;
  else if (!toUni.size) reason = encoding.startsWith('custom') ? 'Custom glyph encoding without a ToUnicode map — characters cannot be mapped reliably.' : 'No character map available for this font.';
  else if (!embedded && !standard14) reason = 'Font program is not embedded and is not a standard PDF font.';
  void doc;
  return { key, baseFont, subtype, encoding, embedded, subset, hasToUnicode: tu instanceof PDFRawStream, twoByte, usedCodes: new Set(), toUni, fromUni, editable: !reason, reason };
}

export function readPageText(doc: PDFDocument, pageIndex: number): PageText {
  const page = doc.getPages()[pageIndex];
  if (!page) throw new Error('Page does not exist');
  if (doc.isEncrypted) return { segments: [], fonts: {}, content: new Uint8Array(), blocked: 'This PDF is encrypted (often owner-password protected). Its content streams cannot be decoded or rewritten without removing protection, so editing is blocked.' };
  const fontDict = inherited(page, 'Resources')?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const fonts: Record<string, FontDiagnosis> = {};
  fontDict?.entries().forEach(([k, v]) => { const f = doc.context.lookup(v); if (f instanceof PDFDict) fonts[k.decodeText()] = diagnoseFont(doc, k.decodeText(), f); });
  const content = pageContentBytes(page);
  const toks = tokenize(content);
  const segments: TextSegment[] = []; let ops: Tok[] = []; let font: string | null = null;
  const decode = (b: number[], f: FontDiagnosis | undefined) => {
    const codes: number[] = []; if (f?.twoByte) for (let k = 0; k + 1 < b.length; k += 2) codes.push((b[k] << 8) | b[k + 1]); else codes.push(...b);
    return { codes, text: codes.map(c => f?.toUni.get(c) ?? '\uFFFD').join('') };
  };
  for (const t of toks) {
    if (t.t !== 'op') { ops.push(t); continue; }
    if (t.v === 'Tf') font = ops.find(o => o.t === 'name')?.v ?? font;
    else if (['Tj', "'", '"', 'TJ'].includes(t.v)) {
      const f = font ? fonts[font] : undefined;
      if (t.v === 'TJ') {
        const a = ops.findIndex(o => o.t === 'arr['), z = ops.map(o => o.t).lastIndexOf('arr]');
        if (a >= 0 && z > a) {
          const parts = ops.slice(a, z).filter(o => o.t === 'str'); const d = decode(parts.flatMap(p => p.b!), f);
          segments.push({ id: segments.length, op: 'TJ', fontKey: font, ...d, strStart: ops[a].s, strEnd: ops[z].e, kerned: ops.slice(a, z).some(o => o.t === 'num') });
        }
      } else {
        const s = [...ops].reverse().find(o => o.t === 'str');
        if (s) segments.push({ id: segments.length, op: t.v, fontKey: font, ...decode(s.b!, f), strStart: s.s, strEnd: s.e, kerned: false });
      }
    }
    ops = [];
  }
  for (const s of segments) if (s.fontKey && fonts[s.fontKey]) s.codes.forEach(c => fonts[s.fontKey!].usedCodes.add(c));
  return { segments, fonts, content };
}

/** Why a replacement is (not) possible with the segment's original font. */
export function checkReplacement(pt: PageText, seg: TextSegment, text: string): { ok: true; codes: number[] } | { ok: false; reason: string } {
  const f = seg.fontKey ? pt.fonts[seg.fontKey] : undefined;
  if (!f) return { ok: false, reason: `Font resource /${seg.fontKey ?? '?'} is missing from the page resources.` };
  if (!f.editable) return { ok: false, reason: f.reason! };
  if (!text.length) return { ok: false, reason: 'Replacement text is empty.' };
  const codes: number[] = []; const missing = new Set<string>();
  for (const ch of Array.from(text)) {
    const c = f.fromUni.get(ch);
    if (c === undefined) { missing.add(ch); continue; }
    if ((f.subset || f.twoByte) && !f.usedCodes.has(c)) { missing.add(ch); continue; } // glyph not proven present in subset
    codes.push(c);
  }
  if (missing.size) return { ok: false, reason: `The original font${f.subset ? ' (a subset)' : ''} does not contain these characters: ${[...missing].map(c => JSON.stringify(c)).join(' ')}. Nothing was changed.` };
  return { ok: true, codes };
}

/** Replace one segment's text in the actual content stream; returns verified new PDF bytes. */
export async function replaceSegmentText(bytes: Uint8Array, pageIndex: number, segmentId: number, text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  const pt = readPageText(doc, pageIndex);
  if (pt.blocked) throw new Error(pt.blocked);
  const seg = pt.segments[segmentId]; if (!seg) throw new Error('Text object not found');
  const chk = checkReplacement(pt, seg, text); if (!chk.ok) throw new Error(chk.reason);
  const f = pt.fonts[seg.fontKey!];
  const hex = '<' + chk.codes.map(c => c.toString(16).padStart(f.twoByte ? 4 : 2, '0')).join('') + '>';
  const operand = seg.op === 'TJ' ? `[${hex}]` : hex;
  const enc = new TextEncoder().encode(operand);
  const next = new Uint8Array(pt.content.length - (seg.strEnd - seg.strStart) + enc.length);
  next.set(pt.content.subarray(0, seg.strStart)); next.set(enc, seg.strStart); next.set(pt.content.subarray(seg.strEnd), seg.strStart + enc.length);
  const page = doc.getPages()[pageIndex];
  const fieldCount = doc.getForm().getFields().length, annots = page.node.Annots()?.size() ?? 0;
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(next)));
  const out = await doc.save();
  // Reopen and verify the operator itself changed, nothing else moved.
  const re = await PDFDocument.load(out, { updateMetadata: false });
  const after = readPageText(re, pageIndex);
  if (after.segments.length !== pt.segments.length) throw new Error('Verification failed: text object count changed');
  if (after.segments[segmentId].text !== text) throw new Error('Verification failed: replacement not found in the content stream');
  if (pt.segments.some((s, i) => i !== segmentId && after.segments[i].text !== s.text)) throw new Error('Verification failed: other text changed');
  if (re.getForm().getFields().length !== fieldCount || (re.getPages()[pageIndex].node.Annots()?.size() ?? 0) !== annots) throw new Error('Verification failed: forms or annotations changed');
  return out;
}
