/**
 * PITCH Markup engine (Phase 2B).
 *
 * Markups are stored in PDF user space (unrotated page coordinates, same space the
 * measurement engine uses) and written as REAL PDF annotations with appearance streams,
 * so Acrobat, pdf.js and other viewers display them. Each annotation also carries a
 * `/PITCHMarkup` JSON entry so PITCH can re-open and keep editing it losslessly.
 * `flatten` burns the same appearance streams into the page content stream instead.
 *
 * Existing page text is never rewritten: "cover" is an opaque overlay, labelled as such.
 */
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFHexString, PDFString, PDFNumber, StandardFonts, PDFFont, PDFPage, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

export type Pt = [number, number];
export type RGB = [number, number, number];
export type MarkupType = 'text' | 'highlight' | 'underline' | 'strikeout' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'polyline' | 'polygon' | 'cloud' | 'callout' | 'note' | 'stamp' | 'image' | 'cover';
export const BOX_TYPES: MarkupType[] = ['text', 'rect', 'ellipse', 'note', 'stamp', 'image', 'cover', 'callout'];
export const POINT_TYPES: MarkupType[] = ['line', 'arrow', 'polyline', 'polygon', 'cloud'];
export const TEXT_MARKUP: MarkupType[] = ['highlight', 'underline', 'strikeout'];

export interface Reply { id: string; author: string; text: string; createdAt: string }
export interface Markup {
  id: string;
  page: number;               // 0-based
  type: MarkupType;
  // box types: centre, local width/height, rotation (deg CCW in user space)
  center?: Pt; w?: number; h?: number; rotation?: number;
  points?: Pt[];              // point types; callout: [anchor]
  quads?: Pt[][];             // text markup: each quad = 4 pts [TL, TR, BL, BR] in reading orientation
  color: RGB; fill?: RGB | null; width: number; opacity: number;
  text?: string; fontSize?: number; align?: 0 | 1 | 2; fontColor?: RGB;
  label?: string;             // stamp text
  image?: { data: string; type: 'png' | 'jpg' }; // base64
  author: string; createdAt: string; modifiedAt?: string;
  replies?: Reply[];
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
const rgbOp = (c: RGB, stroke: boolean) => `${n(c[0])} ${n(c[1])} ${n(c[2])} ${stroke ? 'RG' : 'rg'}`;
const rot = (p: Pt, c: Pt, deg: number): Pt => { const a = (deg * Math.PI) / 180, dx = p[0] - c[0], dy = p[1] - c[1]; return [c[0] + dx * Math.cos(a) - dy * Math.sin(a), c[1] + dx * Math.sin(a) + dy * Math.cos(a)]; };
export function boxCorners(m: Markup): Pt[] {
  const c = m.center!, hw = (m.w ?? 0) / 2, hh = (m.h ?? 0) / 2, r = m.rotation ?? 0;
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as Pt[]).map(([x, y]) => rot([c[0] + x, c[1] + y], c, r));
}
export function markupPoints(m: Markup): Pt[] {
  if (m.quads) return m.quads.flat();
  const pts = [...(m.points ?? [])];
  if (m.center) pts.push(...boxCorners(m));
  return pts;
}
export function bbox(m: Markup, pad = 0): [number, number, number, number] {
  const pts = markupPoints(m); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const extra = pad + (m.width ?? 1) * 2 + (m.type === 'arrow' || m.type === 'callout' ? (m.width ?? 1) * 6 + 6 : 0) + (m.type === 'cloud' ? 12 : 0);
  return [Math.min(...xs) - extra, Math.min(...ys) - extra, Math.max(...xs) + extra, Math.max(...ys) + extra];
}

function arrowHead(from: Pt, to: Pt, size: number): string {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const p1: Pt = [to[0] - size * Math.cos(a - 0.45), to[1] - size * Math.sin(a - 0.45)];
  const p2: Pt = [to[0] - size * Math.cos(a + 0.45), to[1] - size * Math.sin(a + 0.45)];
  return `${n(p1[0])} ${n(p1[1])} m ${n(to[0])} ${n(to[1])} l ${n(p2[0])} ${n(p2[1])} l S`;
}
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5523;
  return `${n(cx + rx)} ${n(cy)} m ${n(cx + rx)} ${n(cy + ry * k)} ${n(cx + rx * k)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c ${n(cx - rx * k)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + ry * k)} ${n(cx - rx)} ${n(cy)} c ${n(cx - rx)} ${n(cy - ry * k)} ${n(cx - rx * k)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c ${n(cx + rx * k)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - ry * k)} ${n(cx + rx)} ${n(cy)} c`;
}
/** Revision cloud: outward scallops along each polygon edge. */
export function cloudPath(pts: Pt[], radius: number): string {
  if (pts.length < 3) return '';
  // orientation: ensure scallops bulge outward
  const area = pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const sgn = area > 0 ? -1 : 1;
  let d = `${n(pts[0][0])} ${n(pts[0][1])} m`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const k = Math.max(1, Math.round(len / (radius * 2)));
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, nx = -uy * sgn, ny = ux * sgn;
    for (let j = 0; j < k; j++) {
      const s: Pt = [a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k];
      const e: Pt = [a[0] + ((b[0] - a[0]) * (j + 1)) / k, a[1] + ((b[1] - a[1]) * (j + 1)) / k];
      const h = (len / k) * 0.6;
      d += ` ${n(s[0] + nx * h)} ${n(s[1] + ny * h)} ${n(e[0] + nx * h)} ${n(e[1] + ny * h)} ${n(e[0])} ${n(e[1])} c`;
    }
  }
  return d;
}

function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
const safe = (font: PDFFont, s: string) => { const set = new Set(font.getCharacterSet()); return [...s].map((ch) => (set.has(ch.codePointAt(0)!) ? ch : '?')).join(''); };

/** Builds the appearance content (in absolute user-space coordinates). */
function appearance(m: Markup, font: PDFFont, imgName: string | null): { ops: string; multiply?: boolean } {
  const lw = Math.max(0.1, m.width);
  const fillOp = m.fill ? rgbOp(m.fill, false) : '';
  const st = `${rgbOp(m.color, true)} ${lw} w 1 J 1 j`;
  // local frame for box types
  const local = () => { const c = m.center!, r = ((m.rotation ?? 0) * Math.PI) / 180; return `${n(Math.cos(r))} ${n(Math.sin(r))} ${n(-Math.sin(r))} ${n(Math.cos(r))} ${n(c[0])} ${n(c[1])} cm`; };
  const hw = (m.w ?? 0) / 2, hh = (m.h ?? 0) / 2;
  const textBlock = (x0: number, y0: number, w: number, h: number) => {
    const fs = m.fontSize ?? 12; const lines = wrap(font, safe(font, m.text ?? ''), fs, Math.max(10, w - 8));
    let ops = `BT /Helv ${n(fs)} Tf ${rgbOp(m.fontColor ?? m.color, false)}`;
    lines.forEach((ln, i) => {
      const tw = font.widthOfTextAtSize(ln, fs); const x = m.align === 1 ? x0 + (w - tw) / 2 : m.align === 2 ? x0 + w - 4 - tw : x0 + 4;
      const y = y0 + h - 4 - fs * (i + 1) * 1.15 + fs * 0.2;
      ops += ` 1 0 0 1 ${n(x)} ${n(y)} Tm ${font.encodeText(ln).toString()} Tj`;
    });
    return ops + ' ET';
  };
  switch (m.type) {
    case 'highlight': return { multiply: true, ops: `${rgbOp(m.color, false)} ` + m.quads!.map((q) => `${n(q[2][0])} ${n(q[2][1])} m ${n(q[3][0])} ${n(q[3][1])} l ${n(q[1][0])} ${n(q[1][1])} l ${n(q[0][0])} ${n(q[0][1])} l h f`).join(' ') };
    case 'underline': case 'strikeout': return { ops: `${rgbOp(m.color, true)} ` + m.quads!.map((q) => {
      const t = m.type === 'underline' ? 0.08 : 0.5; const ht = Math.hypot(q[0][0] - q[2][0], q[0][1] - q[2][1]);
      const a: Pt = [q[2][0] + (q[0][0] - q[2][0]) * t, q[2][1] + (q[0][1] - q[2][1]) * t], b: Pt = [q[3][0] + (q[1][0] - q[3][0]) * t, q[3][1] + (q[1][1] - q[3][1]) * t];
      return `${n(Math.max(0.5, ht / 14))} w ${n(a[0])} ${n(a[1])} m ${n(b[0])} ${n(b[1])} l S`; }).join(' ') };
    case 'line': case 'arrow': { const [a, b] = m.points!; return { ops: `${st} ${n(a[0])} ${n(a[1])} m ${n(b[0])} ${n(b[1])} l S` + (m.type === 'arrow' ? ' ' + arrowHead(a, b, lw * 4 + 6) : '') }; }
    case 'polyline': return { ops: `${st} ` + m.points!.map((p, i) => `${n(p[0])} ${n(p[1])} ${i ? 'l' : 'm'}`).join(' ') + ' S' };
    case 'polygon': return { ops: `${st} ${fillOp} ` + m.points!.map((p, i) => `${n(p[0])} ${n(p[1])} ${i ? 'l' : 'm'}`).join(' ') + (m.fill ? ' h B' : ' h S') };
    case 'cloud': return { ops: `${st} ${fillOp} ${cloudPath(m.points!, Math.max(6, lw * 4))}` + (m.fill ? ' h B' : ' h S') };
    case 'rect': return { ops: `q ${local()} ${st} ${fillOp} ${n(-hw)} ${n(-hh)} ${n(2 * hw)} ${n(2 * hh)} re ${m.fill ? 'B' : 'S'} Q` };
    case 'ellipse': return { ops: `q ${local()} ${st} ${fillOp} ${ellipsePath(0, 0, hw, hh)} ${m.fill ? 'B' : 'S'} Q` };
    case 'cover': return { ops: `q ${local()} ${rgbOp(m.fill ?? [1, 1, 1], false)} ${n(-hw)} ${n(-hh)} ${n(2 * hw)} ${n(2 * hh)} re f ${m.text ? textBlock(-hw, -hh, 2 * hw, 2 * hh) : ''} Q` };
    case 'text': return { ops: `q ${local()} ${m.fill ? `${fillOp} ${n(-hw)} ${n(-hh)} ${n(2 * hw)} ${n(2 * hh)} re f` : ''} ${m.width > 0 && m.fill !== undefined ? `${st} ${n(-hw)} ${n(-hh)} ${n(2 * hw)} ${n(2 * hh)} re S` : ''} ${textBlock(-hw, -hh, 2 * hw, 2 * hh)} Q` };
    case 'callout': {
      const a = m.points![0]; const corners = boxCorners(m);
      const mid = corners.map((c, i) => [(c[0] + corners[(i + 1) % 4][0]) / 2, (c[1] + corners[(i + 1) % 4][1]) / 2] as Pt);
      const near = mid.reduce((b, p) => (Math.hypot(p[0] - a[0], p[1] - a[1]) < Math.hypot(b[0] - a[0], b[1] - a[1]) ? p : b));
      return { ops: `${st} ${n(near[0])} ${n(near[1])} m ${n(a[0])} ${n(a[1])} l S ${arrowHead(near, a, lw * 4 + 6)} q ${local()} ${rgbOp(m.fill ?? [1, 1, 1], false)} ${st} ${n(-hw)} ${n(-hh)} ${n(2 * hw)} ${n(2 * hh)} re B ${textBlock(-hw, -hh, 2 * hw, 2 * hh)} Q` };
    }
    case 'note': return { ops: `q ${local()} ${rgbOp(m.color, false)} 0 0 0 RG 0.6 w ${n(-hw)} ${n(-hh)} ${n(2 * hw)} ${n(2 * hh)} re B 0 0 0 RG ${[0.35, 0, -0.35].map((f) => `${n(-hw * 0.6)} ${n(hh * f)} m ${n(hw * 0.6)} ${n(hh * f)} l S`).join(' ')} Q` };
    case 'stamp': {
      const label = safe(font, (m.label ?? 'APPROVED').toUpperCase()); const fs = Math.min(hh * 1.1, (2 * hw * 0.85) / Math.max(1, font.widthOfTextAtSize(label, 1)));
      const tw = font.widthOfTextAtSize(label, fs);
      return { ops: `q ${local()} ${rgbOp(m.color, true)} ${n(Math.max(1.5, lw))} w ${n(-hw + 2)} ${n(-hh + 2)} ${n(2 * hw - 4)} ${n(2 * hh - 4)} re S BT /Helv ${n(fs)} Tf ${rgbOp(m.color, false)} 1 0 0 1 ${n(-tw / 2)} ${n(-fs * 0.35)} Tm ${font.encodeText(label).toString()} Tj ET Q` };
    }
    case 'image': return { ops: imgName ? `q ${local()} ${n(2 * hw)} 0 0 ${n(2 * hh)} ${n(-hw)} ${n(-hh)} cm /${imgName} Do Q` : '' };
  }
}

const SUBTYPE: Record<MarkupType, string> = { text: 'FreeText', callout: 'FreeText', cover: 'Square', highlight: 'Highlight', underline: 'Underline', strikeout: 'StrikeOut', line: 'Line', arrow: 'Line', rect: 'Square', ellipse: 'Circle', polyline: 'PolyLine', polygon: 'Polygon', cloud: 'Polygon', note: 'Text', stamp: 'Stamp', image: 'Stamp' };
const pdfDate = (iso: string) => { const d = new Date(iso); const p = (x: number) => String(x).padStart(2, '0'); return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`; };
const KEY = PDFName.of('PITCHMarkup');

function isPitch(doc: PDFDocument, r: unknown): boolean {
  const d = r instanceof PDFRef ? doc.context.lookup(r) : r;
  return d instanceof PDFDict && (d.has(KEY) || d.has(PDFName.of('PITCHReply')));
}

export interface WriteOptions { flatten?: boolean }

/** Write markups into a copy of the PDF. Previous PITCH markups are replaced; other annotations are untouched. */
export async function writeMarkups(bytes: Uint8Array, markups: Markup[], opts: WriteOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  for (const p of pages) {
    const a = p.node.Annots(); if (!a) continue;
    const keep = a.asArray().filter((r) => !isPitch(doc, r));
    p.node.set(PDFName.of('Annots'), doc.context.obj(keep));
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ctx = doc.context;
  const gsMul = ctx.register(ctx.obj({ Type: 'ExtGState', BM: 'Multiply' }));
  let xi = 0;
  for (const m of markups) {
    const page = pages[m.page]; if (!page) throw new Error(`Markup ${m.id} is on page ${m.page + 1}, which does not exist`);
    const rect = bbox(m);
    let imgName: string | null = null; const xobjs: Record<string, PDFRef> = {};
    if (m.type === 'image' && m.image) {
      const raw = Uint8Array.from(atob(m.image.data), (c) => c.charCodeAt(0));
      const img = m.image.type === 'png' ? await doc.embedPng(raw) : await doc.embedJpg(raw);
      imgName = 'Im0'; xobjs[imgName] = img.ref;
    }
    const ap = appearance(m, font, imgName);
    const gs: Record<string, PDFRef | PDFDict> = {};
    const alpha = ctx.obj({ Type: 'ExtGState', CA: m.opacity, ca: m.opacity, ...(ap.multiply ? { BM: 'Multiply' } : {}) });
    gs.GSa = ctx.register(alpha as PDFDict);
    const content = `/GSa gs ${ap.ops}`;
    const resources = ctx.obj({ Font: { Helv: font.ref }, ExtGState: gs, ...(Object.keys(xobjs).length ? { XObject: xobjs } : {}) });
    const form = ctx.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: resources });
    const formRef = ctx.register(form);
    void gsMul;
    if (opts.flatten) {
      const name = `PITCHFx${xi++}`;
      let res = page.node.Resources(); if (!res) { res = ctx.obj({}) as PDFDict; page.node.set(PDFName.of('Resources'), res); }
      let xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict); if (!xo) { xo = ctx.obj({}) as PDFDict; res.set(PDFName.of('XObject'), xo); }
      xo.set(PDFName.of(name), formRef);
      const s = ctx.register(ctx.stream(`q /${name} Do Q`));
      // wrap existing content so its graphics state cannot leak into the markup
      const pre = ctx.register(ctx.stream('q')); const post = ctx.register(ctx.stream('Q'));
      const cur = page.node.get(PDFName.of('Contents'));
      const arr = cur instanceof PDFArray ? cur.asArray() : cur ? [cur] : [];
      page.node.set(PDFName.of('Contents'), ctx.obj([pre, ...arr, post, s]));
      continue;
    }
    const plain = (m.text ?? m.label ?? '').slice(0, 5000);
    const json = JSON.stringify({ ...m, v: 1 });
    const d: Record<string, unknown> = {
      Type: 'Annot', Subtype: SUBTYPE[m.type], Rect: rect, C: m.color, CA: m.opacity, F: 4,
      T: PDFHexString.fromText(m.author), Contents: PDFHexString.fromText(m.type === 'cover' ? `[Overlay] ${plain}` : plain), NM: PDFString.of(m.id),
      M: PDFString.of(pdfDate(m.modifiedAt ?? m.createdAt)), CreationDate: PDFString.of(pdfDate(m.createdAt)), P: page.ref,
      BS: { W: m.width, S: 'S' }, AP: { N: formRef }, PITCHMarkup: PDFHexString.fromText(json),
    };
    if (m.fill && ['rect', 'ellipse', 'polygon', 'cloud'].includes(m.type)) d.IC = m.fill;
    if (m.quads) d.QuadPoints = m.quads.flatMap((q) => q.flat());
    if (m.type === 'line' || m.type === 'arrow') { d.L = m.points!.flat(); d.LE = [PDFName.of('None'), PDFName.of(m.type === 'arrow' ? 'OpenArrow' : 'None')]; }
    if (m.type === 'polyline' || m.type === 'polygon' || m.type === 'cloud') d.Vertices = m.points!.flat();
    if (m.type === 'cloud') d.BE = { S: 'C', I: 1 };
    if (m.type === 'text' || m.type === 'callout') {
      const c = m.fontColor ?? m.color; d.DA = PDFString.of(`/Helv ${m.fontSize ?? 12} Tf ${c.join(' ')} rg`); d.Q = m.align ?? 0;
      if (m.type === 'callout') { d.IT = PDFName.of('FreeTextCallout'); const cs = boxCorners(m); d.CL = [...m.points![0], ...cs[0]]; d.LE = PDFName.of('OpenArrow'); }
    }
    if (m.type === 'note') { d.Name = PDFName.of('Comment'); d.Open = false; }
    if (m.type === 'stamp' || m.type === 'image') d.Name = PDFName.of(m.type === 'image' ? 'PITCHImage' : 'PITCH');
    const ref = ctx.register(ctx.obj(d as any));
    page.node.addAnnot(ref);
    for (const r of m.replies ?? []) {
      const rr = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: rect, F: 4 | 2, IRT: ref, RT: PDFName.of('R'), T: PDFHexString.fromText(r.author), Contents: PDFHexString.fromText(r.text),
        NM: PDFString.of(r.id), M: PDFString.of(pdfDate(r.createdAt)), P: page.ref, Name: PDFName.of('Comment'), PITCHReply: PDFString.of(m.id) } as any));
      page.node.addAnnot(rr);
    }
  }
  return doc.save({ useObjectStreams: true });
}

export interface ReadResult { markups: Markup[]; otherAnnotations: { page: number; subtype: string }[] }

/** Re-open PITCH markups from a PDF and list any non-PITCH annotations (kept read-only). */
export async function readMarkups(bytes: Uint8Array): Promise<ReadResult> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const markups: Markup[] = []; const other: ReadResult['otherAnnotations'] = [];
  doc.getPages().forEach((p, pi) => {
    for (const r of p.node.Annots()?.asArray() ?? []) {
      const d = doc.context.lookup(r); if (!(d instanceof PDFDict)) continue;
      const raw = d.lookup(KEY);
      if (raw instanceof PDFHexString || raw instanceof PDFString) {
        try { const m = JSON.parse(raw.decodeText()) as Markup & { v?: number }; delete m.v; markups.push({ ...m, page: pi }); } catch { /* ignore broken */ }
      } else if (!d.has(PDFName.of('PITCHReply'))) other.push({ page: pi, subtype: d.get(PDFName.of('Subtype'))?.toString().slice(1) ?? '?' });
    }
  });
  return { markups, otherAnnotations: other };
}

/** Low-level inspection for tests / verification: the raw annotation dictionaries PITCH wrote. */
export async function inspectAnnotations(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPages().map((p) => (p.node.Annots()?.asArray() ?? []).map((r) => {
    const d = doc.context.lookup(r) as PDFDict;
    const ap = d.lookupMaybe(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N'));
    const apStream = ap instanceof PDFRef ? doc.context.lookup(ap) : undefined;
    let apText = '';
    if (apStream instanceof PDFRawStream) { try { apText = new TextDecoder().decode(decodePDFRawStream(apStream).decode()); } catch { apText = ''; } }
    const num = (k: string) => (d.lookup(PDFName.of(k)) as PDFArray | undefined)?.asArray().map((x) => (x as PDFNumber).asNumber());
    return { subtype: d.get(PDFName.of('Subtype'))?.toString(), nm: (d.lookup(PDFName.of('NM')) as PDFString | undefined)?.decodeText(), rect: num('Rect'), quad: num('QuadPoints'), irt: !!d.get(PDFName.of('IRT')), it: d.get(PDFName.of('IT'))?.toString(), be: !!d.get(PDFName.of('BE')), hasAP: !!ap, apText };
  }));
}

export function pageContentText(doc: PDFDocument, page: PDFPage): string {
  const c = page.node.get(PDFName.of('Contents'));
  const arr = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
  return arr.map((r) => { const s = doc.context.lookup(r as PDFRef); return s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : ''; }).join('\n');
}
