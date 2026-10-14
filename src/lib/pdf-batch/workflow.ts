/**
 * PDF batch workflow (Phase 2F). Independent implementation — no PdfCraftTool (AGPL) code.
 * A workflow is an ordered list of typed steps applied with pdf-lib to one PDF at a time.
 * Every step is validated before anything runs; outputs are reopened and checked.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

export type BatchStep =
  | { type: 'rotate'; pages: string; angle: 90 | 180 | 270 }
  | { type: 'keep_pages'; pages: string }
  | { type: 'page_numbers'; format: string }
  | { type: 'watermark'; text: string; opacity: number }
  | { type: 'set_title'; title: string }
  | { type: 'strip_metadata' }
  | { type: 'ocr' };

export const STEP_LABELS: Record<BatchStep['type'], string> = {
  rotate: 'Rotate pages',
  keep_pages: 'Keep only these pages',
  page_numbers: 'Add page numbers',
  watermark: 'Add watermark',
  set_title: 'Set document title',
  strip_metadata: 'Remove hidden details',
  ocr: 'Make scanned pages searchable',
};

/** Browser-only steps are injected so the core stays testable without a canvas. */
export interface WorkflowHooks { ocr?: (bytes: Uint8Array) => Promise<{ bytes: Uint8Array; note: string }> }

export const MAX_DOCS = 25;
export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_STEPS = 10;
const WIN_ANSI = /^[\x20-\x7E\u00A0-\u00FF]*$/;

/** "all", "1-3,5" → zero-based indexes; throws on out-of-range or malformed input. */
export function resolvePages(spec: string, count: number): number[] {
  const s = spec.trim().toLowerCase();
  if (!s || s === 'all') return Array.from({ length: count }, (_, i) => i);
  const out = new Set<number>();
  for (const part of s.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`"${part.trim()}" is not a page or range`);
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b < a || b > count) throw new Error(`Pages ${part.trim()} are outside 1–${count}`);
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}

export function validateSteps(steps: BatchStep[]): string | null {
  if (!steps.length) return 'Add at least one step';
  if (steps.length > MAX_STEPS) return `At most ${MAX_STEPS} steps`;
  if (steps.filter(s => s.type === 'ocr').length > 1) return 'Text recognition can only be one step';
  for (const [i, st] of steps.entries()) {
    const n = `Step ${i + 1}`;
    if (st.type === 'watermark') {
      if (!st.text.trim() || st.text.length > 60) return `${n}: watermark text must be 1–60 characters`;
      if (!WIN_ANSI.test(st.text)) return `${n}: watermark has characters the built-in font can't show`;
      if (!(st.opacity > 0 && st.opacity <= 1)) return `${n}: opacity must be between 0 and 1`;
    }
    if (st.type === 'page_numbers' && (!st.format.includes('{n}') || !WIN_ANSI.test(st.format) || st.format.length > 40)) return `${n}: number format must contain {n} (e.g. "Page {n} of {total}")`;
    if (st.type === 'set_title' && (!st.title.trim() || st.title.length > 200)) return `${n}: title must be 1–200 characters`;
    if ((st.type === 'rotate' || st.type === 'keep_pages') && !/^\s*(all|[\d\s,-]+)\s*$/i.test(st.pages)) return `${n}: pages must be "all" or like 1-3,5`;
  }
  return null;
}

export interface BatchResult { bytes: Uint8Array; pagesIn: number; pagesOut: number; log: string[] }

export async function runWorkflow(src: Uint8Array, steps: BatchStep[], hooks: WorkflowHooks = {}): Promise<BatchResult> {
  const err = validateSteps(steps);
  if (err) throw new Error(err);
  if (src.byteLength > MAX_BYTES) throw new Error('File is larger than 50 MB');
  let doc = await PDFDocument.load(src, { updateMetadata: false });
  if (doc.isEncrypted) throw new Error('Password-protected PDFs are skipped');
  const pagesIn = doc.getPageCount();
  const log: string[] = [];
  for (const st of steps) {
    const count = doc.getPageCount();
    if (st.type === 'ocr') {
      if (!hooks.ocr) throw new Error('Text recognition is not available here');
      const r = await hooks.ocr(await doc.save());
      doc = await PDFDocument.load(r.bytes, { updateMetadata: false });
      log.push(r.note);
    } else if (st.type === 'rotate') {
      const idx = resolvePages(st.pages, count);
      for (const i of idx) { const p = doc.getPage(i); p.setRotation(degrees((p.getRotation().angle + st.angle) % 360)); }
      log.push(`Rotated ${idx.length} page(s) by ${st.angle}°`);
    } else if (st.type === 'keep_pages') {
      const keep = new Set(resolvePages(st.pages, count));
      if (!keep.size) throw new Error('No pages left to keep');
      for (let i = count - 1; i >= 0; i--) if (!keep.has(i)) doc.removePage(i);
      log.push(`Kept ${keep.size} of ${count} page(s)`);
    } else if (st.type === 'page_numbers') {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      doc.getPages().forEach((p, i) => {
        const t = st.format.replace(/\{n\}/g, String(i + 1)).replace(/\{total\}/g, String(count));
        const { x, y, width } = p.getCropBox();
        const w = font.widthOfTextAtSize(t, 9);
        p.drawText(t, { x: x + width / 2 - w / 2, y: y + 14, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
      });
      log.push(`Numbered ${count} page(s)`);
    } else if (st.type === 'watermark') {
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      for (const p of doc.getPages()) {
        const { x, y, width, height } = p.getCropBox();
        const size = Math.min(width, height) / Math.max(6, st.text.length * 0.6);
        const w = font.widthOfTextAtSize(st.text, size);
        p.drawText(st.text, { x: x + width / 2 - (w / 2) * Math.SQRT1_2, y: y + height / 2 - (w / 2) * Math.SQRT1_2, size, font, color: rgb(0.6, 0.6, 0.6), opacity: st.opacity, rotate: degrees(45) });
      }
      log.push(`Watermarked ${count} page(s)`);
    } else if (st.type === 'set_title') {
      doc.setTitle(st.title.trim());
      log.push('Set title');
    } else if (st.type === 'strip_metadata') {
      doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setCreator(''); doc.setProducer('');
      doc.catalog.delete(doc.context.obj('Metadata') as any);
      log.push('Removed hidden details');
    }
  }
  const bytes = await doc.save();
  const check = await PDFDocument.load(bytes);
  if (check.getPageCount() !== doc.getPageCount()) throw new Error('Output check failed: page count changed on reopen');
  return { bytes, pagesIn, pagesOut: check.getPageCount(), log };
}
