import { addSearchableLayer, LOW_CONFIDENCE, type PageOcr } from '@/lib/pdf-ocr/searchableLayer';
import { ocrLangString } from '@/lib/pdf-ocr/languages';

/** Per-page OCR outcome stored with a scanned document. OCR text is never edited or "corrected". */
export interface ScanPageOcr { page: number; mean_confidence: number; words: number; low_confidence_words: number }
export interface ScanOcrSummary {
  status: 'searchable' | 'image_only' | 'failed';
  languages: string;
  pages: ScanPageOcr[];
  words_written: number;
  words_skipped: number;
  verified_searchable: boolean;
  low_quality_pages: number[];
  error?: string;
}

/** Low-quality page: mean confidence under 60 or more than 30% uncertain words. */
export function isLowQualityPage(p: ScanPageOcr) {
  return p.words > 0 && (p.mean_confidence < 60 || p.low_confidence_words / p.words > 0.3);
}

/** Normalise text for search verification only (whitespace / case). Never written back to the document. */
export const normaliseForSearch = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Pick sample words that must be findable after reopening the saved PDF.
 * Only confident, plain words are used so verification is meaningful.
 */
export function pickProbeWords(pages: PageOcr[], max = 5): string[] {
  const out: string[] = [];
  for (const p of pages) for (const w of p.words) {
    if (out.length >= max) return out;
    if (w.confidence >= 85 && /^[A-Za-z0-9]{4,}$/.test(w.text) && !out.includes(w.text)) out.push(w.text);
  }
  return out;
}

async function loadImage(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0); bmp.close();
  return c;
}

/**
 * Runs local OCR on each processed (cropped, perspective-corrected, rotated) page image and adds an
 * invisible text layer BEHIND-THE-SCENES of the existing scan image: the image is never replaced or altered.
 * Each PDF page must be the page image drawn full-bleed, so image pixels map 1:1 to the page box.
 * Afterwards the saved bytes are reopened and probe words searched for to prove searchability.
 */
export async function makeScanSearchable(
  pdfBytes: Uint8Array,
  pageImages: Blob[],
  langs: string[],
  onProgress?: (fraction: number) => void,
): Promise<{ bytes: Uint8Array; summary: ScanOcrSummary }> {
  const languages = ocrLangString(langs);
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(languages);
  const ocr: PageOcr[] = []; const pages: ScanPageOcr[] = [];
  try {
    for (let i = 0; i < pageImages.length; i++) {
      const canvas = await loadImage(pageImages[i]);
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const words = (data.blocks ?? []).flatMap((b: any) => b.paragraphs.flatMap((p: any) => p.lines.flatMap((l: any) => l.words)))
        .map((w: any) => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, confidence: w.confidence }));
      ocr.push({ pageIndex: i, imageWidth: canvas.width, imageHeight: canvas.height, words });
      pages.push({ page: i + 1, mean_confidence: Math.round(data.confidence), words: words.length, low_confidence_words: words.filter(w => w.confidence < LOW_CONFIDENCE).length });
      onProgress?.((i + 1) / pageImages.length);
    }
  } finally { await worker.terminate(); }

  const layer = await addSearchableLayer(pdfBytes, ocr);
  const probes = pickProbeWords(ocr);
  let verified = false;
  if (layer.written > 0) {
    const { loadPDFFromArrayBuffer } = await import('@/lib/pdfRenderer');
    const pdf: any = await loadPDFFromArrayBuffer(layer.bytes.slice().buffer);
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) text += ' ' + (await (await pdf.getPage(i)).getTextContent()).items.map((t: any) => t.str).join(' ');
    const hay = normaliseForSearch(text);
    verified = probes.length === 0 ? hay.length > 0 : probes.every(p => hay.includes(normaliseForSearch(p)));
    if (pdf.numPages !== pageImages.length) verified = false;
  }
  return {
    bytes: layer.bytes,
    summary: {
      status: layer.written > 0 && verified ? 'searchable' : 'image_only',
      languages, pages, words_written: layer.written, words_skipped: layer.skipped,
      verified_searchable: verified, low_quality_pages: pages.filter(isLowQualityPage).map(p => p.page),
    },
  };
}
