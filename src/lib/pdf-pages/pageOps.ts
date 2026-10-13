/**
 * PITCH Page Organizer engine (Phase 2A).
 *
 * The UI edits a lightweight "page plan" (pure data, cheap to undo/redo). `compilePlan`
 * turns the plan into a new PDF with pdf-lib, never touching the source bytes.
 *
 * Preservation strategy: the FIRST source document is used as the output base and its
 * own page objects are re-inserted in the new order, so the document catalog — AcroForm
 * fields, bookmarks/outlines, metadata, page annotations, vector content and
 * measurement annotations — survives. Pages from other PDFs are copied in with their
 * annotations; their form fields/bookmarks are not merged (reported in warnings).
 */
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString, StandardFonts, rgb, degrees, PDFPage } from 'pdf-lib';

export interface SourcePdf { id: string; name: string; bytes: Uint8Array }

export interface PlanPage {
  key: string;            // stable id for React/dnd
  sourceId: string | null; // null => blank page
  sourceIndex: number;     // 0-based page in source
  rotate: number;          // extra rotation added (0/90/180/270)
  crop?: { x: number; y: number; w: number; h: number } | null; // fractions of the page box (0..1, origin bottom-left)
  size?: [number, number]; // for blank pages, or resize target in points
}

export interface Stamp {
  pageNumbers?: { format: string; position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-right'; start: number; size: number };
  header?: { left?: string; center?: string; right?: string; size: number };
  footer?: { left?: string; center?: string; right?: string; size: number };
  textWatermark?: { text: string; size: number; opacity: number; angle: number };
  imageWatermark?: { bytes: Uint8Array; type: 'png' | 'jpg'; opacity: number; scale: number };
  pages?: number[];       // 1-based output pages to stamp; default all
}

export interface Metadata { title?: string; author?: string; subject?: string; keywords?: string[] }
export interface Bookmark { title: string; page: number } // page: 1-based output page

export interface CompileOptions { stamps?: Stamp; metadata?: Metadata; bookmarks?: Bookmark[] | null }

export interface Inspection {
  pageCount: number;
  pages: { width: number; height: number; rotation: number; annotations: number }[];
  hasSignatures: boolean;
  formFieldCount: number;
  bookmarkCount: number;
  encrypted: boolean;
  metadata: Metadata;
}

const load = (b: Uint8Array) => PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false });
let keySeq = 0;
export const newKey = () => `p${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export async function inspectPdf(bytes: Uint8Array): Promise<Inspection> {
  const doc = await load(bytes);
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  let fields = 0, sigs = false;
  if (acro) {
    const f = acro.lookupMaybe(PDFName.of('Fields'), PDFArray);
    fields = f?.size() ?? 0;
    const flags = acro.get(PDFName.of('SigFlags'));
    if (flags && Number(flags.toString()) > 0) sigs = true;
    f?.asArray().forEach((r) => { const d = doc.context.lookup(r); if (d instanceof PDFDict && d.get(PDFName.of('FT'))?.toString() === '/Sig' && d.get(PDFName.of('V'))) sigs = true; });
  }
  return {
    pageCount: doc.getPageCount(),
    pages: doc.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight(), rotation: p.getRotation().angle, annotations: p.node.Annots()?.size() ?? 0 })),
    hasSignatures: sigs,
    formFieldCount: fields,
    bookmarkCount: countOutlines(doc),
    encrypted: doc.isEncrypted,
    metadata: { title: doc.getTitle(), author: doc.getAuthor(), subject: doc.getSubject(), keywords: doc.getKeywords()?.split(/[,;]\s*/).filter(Boolean) },
  };
}

function countOutlines(doc: PDFDocument): number {
  const o = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (!o) return 0;
  let n = 0;
  const walk = (d: PDFDict | undefined) => { let cur = d; let guard = 0; while (cur && guard++ < 10000) { n++; walk(cur.lookupMaybe(PDFName.of('First'), PDFDict)); cur = cur.lookupMaybe(PDFName.of('Next'), PDFDict); } };
  walk(o.lookupMaybe(PDFName.of('First'), PDFDict));
  return n;
}

export function planFromSource(src: SourcePdf, pageCount: number): PlanPage[] {
  return Array.from({ length: pageCount }, (_, i) => ({ key: newKey(), sourceId: src.id, sourceIndex: i, rotate: 0 }));
}

/** Parse "1,3-5" into 1-based page numbers (validated). */
export function parseRange(text: string, max: number): number[] {
  const out: number[] = [];
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`"${part}" is not a page or range (use 1,3-5)`);
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (a < 1 || b < a || b > max) throw new Error(`Pages ${part} are outside 1-${max}`);
    for (let i = a; i <= b; i++) out.push(i);
  }
  return out;
}

/** Operations that change content the user may not expect to lose. */
export function planWarnings(plan: PlanPage[], sources: SourcePdf[], info: Record<string, Inspection>, opts: CompileOptions = {}): string[] {
  const w: string[] = [];
  const base = sources[0];
  const changed = plan.length !== info[base?.id]?.pageCount || plan.some((p, i) => p.sourceId !== base.id || p.sourceIndex !== i || p.rotate || p.crop || p.size) || opts.stamps || opts.metadata;
  if (changed && sources.some((s) => info[s.id]?.hasSignatures)) w.push('This document has digital signatures. Saving any change will invalidate them.');
  for (const s of sources.slice(1)) {
    if (!plan.some((p) => p.sourceId === s.id)) continue;
    if (info[s.id]?.formFieldCount) w.push(`Form fields from "${s.name}" will be merged and stay fillable; any field whose name already exists gets a "_2" style suffix.`);
    if (info[s.id]?.bookmarkCount) w.push(`Bookmarks from "${s.name}" are added under a "${s.name}" heading (top-level bookmarks only; nested levels are not copied).`);
  }
  const used = new Set(plan.filter((p) => p.sourceId === base?.id).map((p) => p.sourceIndex));
  const removed = (info[base?.id]?.pageCount ?? 0) - used.size;
  if (removed > 0) w.push(`${removed} original page(s) will not be in the new version (the original file is kept).`);
  if (plan.some((p) => p.crop)) w.push('Cropping hides content outside the crop box; it is not deleted and can be restored from the original.');
  if (plan.some((p) => p.size && p.sourceId)) w.push('Resized pages are scaled; drawing scales calibrated on those sheets must be re-verified.');
  return w;
}

export async function compilePlan(plan: PlanPage[], sources: SourcePdf[], opts: CompileOptions = {}): Promise<Uint8Array> {
  if (!plan.length) throw new Error('The document must keep at least one page');
  if (!sources.length) throw new Error('No source PDF');
  const base = sources[0];
  const doc = await load(base.bytes);
  const originals = doc.getPages();
  const otherDocs = new Map<string, PDFDocument>();
  for (const s of sources.slice(1)) otherDocs.set(s.id, await load(s.bytes));

  // Pre-copy duplicates while indices are still valid.
  const seen = new Set<number>(); const dupIdx: number[] = [];
  for (const p of plan) if (p.sourceId === base.id) { if (seen.has(p.sourceIndex)) dupIdx.push(p.sourceIndex); else seen.add(p.sourceIndex); }
  const dupCopies = dupIdx.length ? await doc.copyPages(doc, dupIdx) : [];
  const foreignPos = new Map<string, PDFPage>();
  // Remove all pages from the tree (objects stay alive), then insert in plan order.
  for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
  const usedBase = new Set<number>();
  for (const p of plan) {
    let page: PDFPage;
    if (!p.sourceId) {
      page = doc.addPage(p.size ?? [612, 792]);
    } else if (p.sourceId === base.id) {
      const orig = originals[p.sourceIndex];
      if (!orig) throw new Error(`Page ${p.sourceIndex + 1} does not exist in ${base.name}`);
      if (usedBase.has(p.sourceIndex)) {
        page = doc.addPage(dupCopies.shift()!); // deep copy for duplicates
      } else {
        // Reinsert the original page object -> keeps refs from bookmarks/forms valid.
        doc.addPage(orig); page = orig; usedBase.add(p.sourceIndex);
      }
    } else {
      const src = otherDocs.get(p.sourceId);
      if (!src) throw new Error('Unknown source document');
      const [copy] = await doc.copyPages(src, [p.sourceIndex]);
      page = doc.addPage(copy);
      mergeWidgets(doc, page);
      const k = `${p.sourceId}:${p.sourceIndex}`;
      if (!foreignPos.has(k)) foreignPos.set(k, page);
    }
    if (p.rotate) page.setRotation(degrees((page.getRotation().angle + p.rotate) % 360));
    if (p.crop) {
      const mb = page.getMediaBox();
      const c = p.crop;
      page.setCropBox(mb.x + c.x * mb.width, mb.y + c.y * mb.height, c.w * mb.width, c.h * mb.height);
    }
    if (p.size && p.sourceId) {
      const sx = p.size[0] / page.getWidth(), sy = p.size[1] / page.getHeight();
      const s = Math.min(sx, sy);
      page.scale(s, s); // scales content + annotations
      page.setSize(p.size[0], p.size[1]);
    }
  }
  // Drop the base AcroForm field refs for removed pages' widgets is not attempted; dangling
  // bookmark destinations for removed pages are removed below.
  pruneOutlines(doc, new Set(doc.getPages().map((p) => p.ref.toString())));

  if (!opts.bookmarks) {
    for (const s of sources.slice(1)) {
      const items = readBookmarks(otherDocs.get(s.id)!).map((b) => ({ title: b.title, page: b.page ? foreignPos.get(`${s.id}:${b.page - 1}`) : undefined })).filter((b) => b.page);
      if (items.length) appendOutlineGroup(doc, s.name.replace(/\.pdf$/i, ''), items as { title: string; page: PDFPage }[]);
    }
  }
  if (opts.stamps) await applyStamps(doc, opts.stamps);
  if (opts.metadata) {
    const m = opts.metadata;
    if (m.title !== undefined) doc.setTitle(m.title);
    if (m.author !== undefined) doc.setAuthor(m.author);
    if (m.subject !== undefined) doc.setSubject(m.subject);
    if (m.keywords) doc.setKeywords(m.keywords);
  }
  doc.setProducer('PITCH PDF Studio');
  doc.setModificationDate(new Date());
  if (opts.bookmarks) setBookmarks(doc, opts.bookmarks);
  return doc.save({ useObjectStreams: true });
}

/** Register widgets copied from another PDF in this document's AcroForm so they stay fillable. */
function mergeWidgets(doc: PDFDocument, page: PDFPage) {
  const annots = page.node.Annots(); if (!annots) return;
  let acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const roots: PDFRef[] = [];
  for (const r of annots.asArray()) {
    if (!(r instanceof PDFRef)) continue;
    const d = doc.context.lookup(r); if (!(d instanceof PDFDict) || d.get(PDFName.of('Subtype'))?.toString() !== '/Widget') continue;
    let ref = r; let cur: PDFDict = d; let guard = 0;
    while (guard++ < 50) { const pr = cur.get(PDFName.of('Parent')); if (!(pr instanceof PDFRef)) break; const pd = doc.context.lookup(pr); if (!(pd instanceof PDFDict)) break; ref = pr; cur = pd; }
    if (!roots.some((x) => x.toString() === ref.toString())) roots.push(ref);
  }
  if (!roots.length) return;
  if (!acro) { acro = doc.context.obj({ Fields: [] }) as PDFDict; doc.catalog.set(PDFName.of('AcroForm'), doc.context.register(acro)); }
  let fields = acro.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields) { fields = doc.context.obj([]) as PDFArray; acro.set(PDFName.of('Fields'), fields); }
  const nameOf = (r: unknown) => { const d = r instanceof PDFRef ? doc.context.lookup(r) : r; const t = d instanceof PDFDict ? d.lookup(PDFName.of('T')) : undefined; return t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : ''; };
  const existing = new Set(fields.asArray().map(nameOf));
  const present = new Set(fields.asArray().map((x) => x.toString()));
  for (const ref of roots) {
    if (present.has(ref.toString())) continue;
    const d = doc.context.lookup(ref) as PDFDict; let name = nameOf(d);
    if (name && existing.has(name)) { let n = 2; while (existing.has(`${name}_${n}`)) n++; name = `${name}_${n}`; d.set(PDFName.of('T'), PDFHexString.fromText(name)); }
    existing.add(name); fields.push(ref); present.add(ref.toString());
  }
}

function appendOutlineGroup(doc: PDFDocument, title: string, items: { title: string; page: PDFPage }[]) {
  const ctx = doc.context;
  let rootRef = doc.catalog.get(PDFName.of('Outlines'));
  let root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (!root || !(rootRef instanceof PDFRef)) { root = ctx.obj({ Type: 'Outlines', Count: 0 }) as PDFDict; rootRef = ctx.register(root); doc.catalog.set(PDFName.of('Outlines'), rootRef); }
  const groupRef = ctx.nextRef(); const kids = items.map(() => ctx.nextRef());
  items.forEach((it, i) => {
    const d = ctx.obj({ Title: PDFHexString.fromText(it.title), Parent: groupRef, Dest: [it.page.ref, 'Fit'] }) as PDFDict;
    if (i > 0) d.set(PDFName.of('Prev'), kids[i - 1]); if (i < kids.length - 1) d.set(PDFName.of('Next'), kids[i + 1]);
    ctx.assign(kids[i], d);
  });
  const group = ctx.obj({ Title: PDFHexString.fromText(title), Parent: rootRef, First: kids[0], Last: kids[kids.length - 1], Count: -kids.length, Dest: [items[0].page.ref, 'Fit'] }) as PDFDict;
  const lastRef = root.get(PDFName.of('Last'));
  if (lastRef instanceof PDFRef) { (ctx.lookup(lastRef) as PDFDict).set(PDFName.of('Next'), groupRef); group.set(PDFName.of('Prev'), lastRef); } else root.set(PDFName.of('First'), groupRef);
  root.set(PDFName.of('Last'), groupRef);
  const c = root.get(PDFName.of('Count')); root.set(PDFName.of('Count'), ctx.obj(Math.abs(Number(c?.toString() ?? 0)) + 1));
  ctx.assign(groupRef, group);
}

function pruneOutlines(doc: PDFDocument, livePages: Set<string>) {
  const o = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (!o) return;
  let cur = o.lookupMaybe(PDFName.of('First'), PDFDict); let guard = 0;
  while (cur && guard++ < 10000) {
    const dest = cur.lookupMaybe(PDFName.of('Dest'), PDFArray);
    const target = dest?.get(0);
    if (target instanceof PDFRef && !livePages.has(target.toString())) cur.delete(PDFName.of('Dest')); // keep title, no dead link
    cur = cur.lookupMaybe(PDFName.of('Next'), PDFDict);
  }
}

/** Replaces the outline with a flat list. */
export function setBookmarks(doc: PDFDocument, marks: Bookmark[]) {
  const pages = doc.getPages();
  const valid = marks.filter((m) => m.title.trim() && m.page >= 1 && m.page <= pages.length);
  if (!valid.length) { doc.catalog.delete(PDFName.of('Outlines')); return; }
  const ctx = doc.context;
  const rootRef = ctx.nextRef();
  const refs = valid.map(() => ctx.nextRef());
  valid.forEach((m, i) => {
    const d = ctx.obj({ Title: PDFHexString.fromText(m.title), Parent: rootRef, Dest: [pages[m.page - 1].ref, 'Fit'] }) as PDFDict;
    if (i > 0) d.set(PDFName.of('Prev'), refs[i - 1]);
    if (i < refs.length - 1) d.set(PDFName.of('Next'), refs[i + 1]);
    ctx.assign(refs[i], d);
  });
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
}

export function readBookmarks(doc: PDFDocument): Bookmark[] {
  const o = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  const pageRefs = doc.getPages().map((p) => p.ref.toString());
  const out: Bookmark[] = [];
  let cur = o?.lookupMaybe(PDFName.of('First'), PDFDict); let guard = 0;
  while (cur && guard++ < 10000) {
    const t = cur.lookup(PDFName.of('Title'));
    const title = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : '';
    const dest = cur.lookupMaybe(PDFName.of('Dest'), PDFArray)?.get(0);
    out.push({ title, page: dest ? pageRefs.indexOf(dest.toString()) + 1 : 0 });
    cur = cur.lookupMaybe(PDFName.of('Next'), PDFDict);
  }
  return out;
}

const fill = (t: string, n: number, total: number) => t.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total));

async function applyStamps(doc: PDFDocument, s: Stamp) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const img = s.imageWatermark ? (s.imageWatermark.type === 'png' ? await doc.embedPng(s.imageWatermark.bytes) : await doc.embedJpg(s.imageWatermark.bytes)) : null;
  const pages = doc.getPages();
  const total = pages.length;
  const only = s.pages ? new Set(s.pages) : null;
  pages.forEach((page, i) => {
    const n = i + 1;
    if (only && !only.has(n)) return;
    // Draw in the visible (crop) box, compensating for /Rotate so text reads upright.
    const box = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const vw = rot % 180 ? box.height : box.width, vh = rot % 180 ? box.width : box.height;
    const place = (x: number, y: number) => {
      // map visible-space (x,y) to user space
      if (rot === 90) return { x: box.x + box.width - y, y: box.y + x };
      if (rot === 180) return { x: box.x + box.width - x, y: box.y + box.height - y };
      if (rot === 270) return { x: box.x + y, y: box.y + box.height - x };
      return { x: box.x + x, y: box.y + y };
    };
    const text = (t: string, x: number, y: number, size: number, align: 'l' | 'c' | 'r', extra: { opacity?: number; angle?: number } = {}) => {
      if (!t) return;
      const w = font.widthOfTextAtSize(t, size);
      const ax = align === 'c' ? x - w / 2 : align === 'r' ? x - w : x;
      const pt = place(ax, y);
      page.drawText(t, { x: pt.x, y: pt.y, size, font, color: rgb(0.15, 0.15, 0.15), opacity: extra.opacity, rotate: degrees(rot + (extra.angle ?? 0)) });
    };
    const m = 24;
    for (const [band, y] of [[s.header, vh - m - (s.header?.size ?? 9)], [s.footer, m]] as const) {
      if (!band) continue;
      text(fill(band.left ?? '', n, total), m, y, band.size, 'l');
      text(fill(band.center ?? '', n, total), vw / 2, y, band.size, 'c');
      text(fill(band.right ?? '', n, total), vw - m, y, band.size, 'r');
    }
    if (s.pageNumbers) {
      const pn = s.pageNumbers; const label = fill(pn.format, n + pn.start - 1, total + pn.start - 1);
      const y = pn.position === 'top-right' ? vh - m - pn.size : m + (s.footer ? s.footer.size + 6 : 0);
      const [x, a] = pn.position === 'bottom-left' ? [m, 'l'] : pn.position === 'bottom-center' ? [vw / 2, 'c'] : [vw - m, 'r'];
      text(label, x as number, y, pn.size, a as 'l' | 'c' | 'r');
    }
    if (s.textWatermark?.text) {
      const t = s.textWatermark; const w = font.widthOfTextAtSize(t.text, t.size);
      const rad = (t.angle * Math.PI) / 180;
      const x = vw / 2 - (Math.cos(rad) * w) / 2 + (Math.sin(rad) * t.size) / 3, y = vh / 2 - (Math.sin(rad) * w) / 2 - (Math.cos(rad) * t.size) / 3;
      const pt = place(x, y);
      page.drawText(t.text, { x: pt.x, y: pt.y, size: t.size, font, color: rgb(0.6, 0.1, 0.1), opacity: t.opacity, rotate: degrees(rot + t.angle) });
    }
    if (img && s.imageWatermark) {
      const k = Math.min(vw / img.width, vh / img.height) * s.imageWatermark.scale;
      const w = img.width * k, h = img.height * k;
      const pt = place(rot === 90 ? (vw - w) / 2 + w : rot === 180 ? (vw + w) / 2 : rot === 270 ? (vw - w) / 2 : (vw - w) / 2,
        rot === 90 ? (vh - h) / 2 : rot === 180 ? (vh + h) / 2 : rot === 270 ? (vh + h) / 2 : (vh - h) / 2);
      page.drawImage(img, { x: pt.x, y: pt.y, width: w, height: h, opacity: s.imageWatermark.opacity, rotate: degrees(rot) });
    }
  });
}

/** Split into chunks of N pages or at explicit 1-based start pages. Each output is a separate file. */
export async function splitPlan(plan: PlanPage[], sources: SourcePdf[], every: number): Promise<Uint8Array[]> {
  if (every < 1) throw new Error('Split size must be at least 1 page');
  const outs: Uint8Array[] = [];
  for (let i = 0; i < plan.length; i += every) outs.push(await compilePlan(plan.slice(i, i + every), sources));
  return outs;
}

/** Map of output page -> source page, saved with each version so measurement scales can be re-linked. */
export const pageMap = (plan: PlanPage[]) => plan.map((p, i) => ({ out: i, sourceId: p.sourceId, sourceIndex: p.sourceIndex, rotate: p.rotate, cropped: !!p.crop, resized: !!p.size }));
