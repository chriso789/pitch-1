/** Batch OCR hook: recognizes only pages with no real text, then adds the invisible searchable layer. */
import { loadPDFFromArrayBuffer } from '@/lib/pdfRenderer';
import { addSearchableLayer, type PageOcr } from './searchableLayer';
import { ocrLangString } from './languages';

export async function ocrSearchable(bytes: Uint8Array, langs?: string[]): Promise<{ bytes: Uint8Array; note: string }> {
  const pdf: any = await loadPDFFromArrayBuffer(bytes.slice().buffer);
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(ocrLangString(langs));
  const pages: PageOcr[] = [];
  try {
    for (let i = 0; i < pdf.numPages; i++) {
      const p = await pdf.getPage(i + 1);
      if ((await p.getTextContent()).items.length) continue;
      const vp = p.getViewport({ scale: 2 });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await p.render({ canvasContext: ctx, viewport: vp }).promise;
      const { data } = await worker.recognize(c, {}, { blocks: true });
      const words = (data.blocks ?? []).flatMap((b: any) => b.paragraphs.flatMap((pp: any) => pp.lines.flatMap((l: any) => l.words)))
        .map((w: any) => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, confidence: w.confidence }));
      pages.push({ pageIndex: i, imageWidth: c.width, imageHeight: c.height, words });
    }
  } finally { await worker.terminate(); }
  if (!pages.length) return { bytes, note: 'Text recognition: every page already had real text' };
  const r = await addSearchableLayer(bytes, pages);
  const extra = r.skippedRotatedPages.length ? `; rotated page(s) ${r.skippedRotatedPages.join(', ')} left without text` : '';
  return { bytes: r.bytes, note: `Searchable text added to ${pages.length} page(s)${extra}` };
}
