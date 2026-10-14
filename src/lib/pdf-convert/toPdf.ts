/**
 * Image / Word → PDF conversion (Phase 2D). Runs locally; produces a brand-new PDF.
 * - JPEG/PNG are embedded losslessly as-is; other browser images are re-encoded to PNG by the caller.
 * - Word (.docx) is read as structure (headings, paragraphs, lists, bold/italic, images, table rows)
 *   and re-typeset; it is NOT a pixel-identical copy of Word's layout, and the UI says so.
 * - Standard PDF fonts only cover WinAnsi; characters outside it are reported and block the
 *   conversion instead of being silently swapped or dropped.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';

export const LETTER: [number, number] = [612, 792];
export const MAX_FILES = 50;
export const MAX_BYTES = 40 * 1024 * 1024;

export type ImageInput = { name: string; bytes: Uint8Array; kind: 'jpg' | 'png' };

export function sniffImage(bytes: Uint8Array): 'jpg' | 'png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return null;
}

/** Fit (w,h) inside a box, never upscaling past 100% of the image's 72-dpi size. */
export function fitBox(w: number, h: number, boxW: number, boxH: number) {
  const s = Math.min(boxW / w, boxH / h, 1);
  return { width: w * s, height: h * s };
}

export async function imagesToPdf(images: ImageInput[], opts: { pageSize: 'letter' | 'image'; margin?: number } = { pageSize: 'letter' }) {
  if (!images.length) throw new Error('Pick at least one image');
  if (images.length > MAX_FILES) throw new Error(`Up to ${MAX_FILES} images at a time`);
  const pdf = await PDFDocument.create();
  const margin = opts.margin ?? 36;
  for (const im of images) {
    const img = im.kind === 'jpg' ? await pdf.embedJpg(im.bytes) : await pdf.embedPng(im.bytes);
    if (opts.pageSize === 'image') {
      const p = pdf.addPage([img.width, img.height]);
      p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      continue;
    }
    const landscape = img.width > img.height;
    const [pw, ph] = landscape ? [LETTER[1], LETTER[0]] : LETTER;
    const p = pdf.addPage([pw, ph]);
    const { width, height } = fitBox(img.width, img.height, pw - 2 * margin, ph - 2 * margin);
    p.drawImage(img, { x: (pw - width) / 2, y: (ph - height) / 2, width, height });
  }
  pdf.setProducer('PITCH CRM');
  return pdf.save();
}

// ---------------- Word ----------------
export type Run = { text: string; bold?: boolean; italic?: boolean };
export type Block =
  | { type: 'heading'; level: number; runs: Run[] }
  | { type: 'para'; runs: Run[]; bullet?: string }
  | { type: 'image'; bytes: Uint8Array; kind: 'jpg' | 'png' }
  | { type: 'row'; cells: string[] };

/** Convert mammoth HTML into simple blocks. Uses DOMParser (browser / jsdom). */
export function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out: Block[] = [];
  const runsOf = (el: Element): Run[] => {
    const runs: Run[] = [];
    const walk = (n: Node, b: boolean, i: boolean) => {
      if (n.nodeType === 3) { const t = (n.textContent ?? '').replace(/\s+/g, ' '); if (t) runs.push({ text: t, bold: b, italic: i }); return; }
      if (n.nodeType !== 1) return;
      const tag = (n as Element).tagName.toLowerCase();
      if (tag === 'br') { runs.push({ text: '\n' }); return; }
      n.childNodes.forEach(c => walk(c, b || tag === 'strong' || tag === 'b', i || tag === 'em' || tag === 'i'));
    };
    el.childNodes.forEach(c => walk(c, false, false));
    return runs;
  };
  const imgs = (el: Element) => el.querySelectorAll('img').forEach(img => {
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(img.getAttribute('src') ?? '');
    if (!m) return;
    const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    out.push({ type: 'image', bytes, kind: m[1].toLowerCase() === 'png' ? 'png' : 'jpg' });
  });
  const visit = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) { out.push({ type: 'heading', level: Number(tag[1]), runs: runsOf(el) }); return; }
    if (tag === 'p') { const r = runsOf(el); if (r.some(x => x.text.trim())) out.push({ type: 'para', runs: r }); imgs(el); return; }
    if (tag === 'ul' || tag === 'ol') {
      let n = 1;
      el.querySelectorAll(':scope > li').forEach(li => out.push({ type: 'para', runs: runsOf(li), bullet: tag === 'ol' ? `${n++}.` : '•' }));
      return;
    }
    if (tag === 'table') { el.querySelectorAll('tr').forEach(tr => out.push({ type: 'row', cells: Array.from(tr.querySelectorAll('td,th')).map(c => (c.textContent ?? '').replace(/\s+/g, ' ').trim()) })); return; }
    if (tag === 'img') { imgs(el.parentElement ?? el); return; }
    Array.from(el.children).forEach(visit);
  };
  Array.from(doc.body.children).forEach(visit);
  return out;
}

/** Characters the standard PDF fonts cannot draw (reported, never substituted). */
export function unsupportedChars(blocks: Block[], font: PDFFont): string[] {
  const bad = new Set<string>();
  const check = (t: string) => { for (const ch of t) { if (ch === '\n') continue; try { font.encodeText(ch); } catch { bad.add(ch); } } };
  for (const b of blocks) {
    if (b.type === 'row') b.cells.forEach(check);
    else if (b.type !== 'image') { b.runs.forEach(r => check(r.text)); if (b.type === 'para' && b.bullet) check(b.bullet); }
  }
  return [...bad];
}

type Word = { text: string; font: PDFFont };
export function wrapWords(words: Word[], size: number, maxW: number): Word[][] {
  const lines: Word[][] = []; let line: Word[] = []; let w = 0;
  const space = (f: PDFFont) => f.widthOfTextAtSize(' ', size);
  for (const wd of words) {
    if (wd.text === '\n') { lines.push(line); line = []; w = 0; continue; }
    const ww = wd.font.widthOfTextAtSize(wd.text, size);
    const add = line.length ? space(wd.font) + ww : ww;
    if (line.length && w + add > maxW) { lines.push(line); line = [wd]; w = ww; } else { line.push(wd); w += add; }
  }
  if (line.length) lines.push(line);
  return lines;
}

export async function blocksToPdf(blocks: Block[], title?: string) {
  const pdf = await PDFDocument.create();
  const fonts = {
    r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold),
    i: await pdf.embedFont(StandardFonts.HelveticaOblique), bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const bad = unsupportedChars(blocks, fonts.r);
  if (bad.length) throw new Error(`These characters can't be written with the built-in PDF fonts: ${bad.slice(0, 20).join(' ')}. Nothing was converted.`);
  const [PW, PH] = LETTER; const M = 54; const maxW = PW - 2 * M;
  let page = pdf.addPage(LETTER); let y = PH - M;
  const need = (h: number) => { if (y - h < M) { page = pdf.addPage(LETTER); y = PH - M; } };
  const pick = (r: Run, forceBold = false) => (r.bold || forceBold) ? (r.italic ? fonts.bi : fonts.b) : r.italic ? fonts.i : fonts.r;
  const drawRuns = (runs: Run[], size: number, indent = 0, forceBold = false) => {
    const words: Word[] = [];
    for (const r of runs) for (const part of r.text.split(/(\n)| +/)) if (part) words.push({ text: part, font: pick(r, forceBold) });
    for (const line of wrapWords(words, size, maxW - indent)) {
      need(size * 1.35); y -= size * 1.35;
      let x = M + indent;
      for (const wd of line) { page.drawText(wd.text, { x, y, size, font: wd.font, color: rgb(0, 0, 0) }); x += wd.font.widthOfTextAtSize(wd.text + ' ', size); }
    }
  };
  for (const b of blocks) {
    if (b.type === 'heading') { y -= 8; drawRuns(b.runs, [20, 16, 14, 12, 11, 11][b.level - 1] ?? 11, 0, true); y -= 4; }
    else if (b.type === 'para') {
      if (b.bullet) { need(14); page.drawText(b.bullet, { x: M + 6, y: y - 14, size: 10.5, font: fonts.r }); drawRuns(b.runs, 10.5, 24); }
      else drawRuns(b.runs, 10.5);
      y -= 5;
    } else if (b.type === 'row') {
      const colW = maxW / Math.max(1, b.cells.length);
      const cellLines = b.cells.map(c => wrapWords(c.split(/ +/).filter(Boolean).map(t => ({ text: t, font: fonts.r })), 9.5, colW - 8));
      const h = Math.max(1, ...cellLines.map(l => l.length)) * 12.5 + 6;
      need(h);
      cellLines.forEach((lines, ci) => {
        const x0 = M + ci * colW;
        page.drawRectangle({ x: x0, y: y - h, width: colW, height: h, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
        lines.forEach((ln, li) => page.drawText(ln.map(w => w.text).join(' '), { x: x0 + 4, y: y - 13 - li * 12.5, size: 9.5, font: fonts.r }));
      });
      y -= h;
    } else {
      let img: PDFImage;
      try { img = b.kind === 'png' ? await pdf.embedPng(b.bytes) : await pdf.embedJpg(b.bytes); } catch { continue; }
      const { width, height } = fitBox(img.width, img.height, maxW, PH - 2 * M);
      need(height + 6); y -= height + 6;
      page.drawImage(img, { x: M, y, width, height });
    }
  }
  if (title) pdf.setTitle(title);
  pdf.setProducer('PITCH CRM');
  return pdf.save();
}

export async function docxToPdf(bytes: Uint8Array, title?: string) {
  const mammoth: any = await import('mammoth');
  const res = await (mammoth.default ?? mammoth).convertToHtml({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const blocks = htmlToBlocks(res.value as string);
  if (!blocks.length) throw new Error('No readable content was found in this Word file');
  const pdf = await blocksToPdf(blocks, title);
  const warnings = ((res.messages ?? []) as { message: string }[]).map(m => m.message).slice(0, 10);
  return { bytes: pdf, blocks: blocks.length, warnings };
}
