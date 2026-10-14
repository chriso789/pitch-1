import { PDFDocument, StandardFonts, TextRenderingMode, pushGraphicsState, popGraphicsState, setTextRenderingMode, beginText, endText, setFontAndSize, showText, setTextMatrix, PDFOperator, PDFNumber } from 'pdf-lib';

/** One OCR word with its box in rendered-image pixels (origin top-left). */
export interface OcrWordPx { text: string; x0: number; y0: number; x1: number; y1: number; confidence: number }
export interface PageOcr { pageIndex: number; imageWidth: number; imageHeight: number; words: OcrWordPx[] }

export const LOW_CONFIDENCE = 70;
const WIN_ANSI = /^[\x20-\x7E\u00A0-\u00FF]+$/;

/** Words that can be written to an invisible WinAnsi text layer. Others are reported, never substituted. */
export function partitionWords(words: OcrWordPx[]) {
  const ok: OcrWordPx[] = [], skipped: OcrWordPx[] = [];
  for (const w of words) (w.text.trim() && WIN_ANSI.test(w.text) ? ok : skipped).push(w);
  return { ok, skipped };
}

/** Pixel box → PDF user space using the page's visible (crop) box. Rotated pages are not supported. */
export function pxToUser(w: OcrWordPx, imgW: number, imgH: number, box: { x: number; y: number; width: number; height: number }) {
  const sx = box.width / imgW, sy = box.height / imgH;
  return { x: box.x + w.x0 * sx, y: box.y + box.height - w.y1 * sy, width: (w.x1 - w.x0) * sx, height: (w.y1 - w.y0) * sy };
}

export interface LayerResult { bytes: Uint8Array; written: number; skipped: number; skippedRotatedPages: number[] }

/**
 * Adds an invisible (render mode 3) text layer so scanned pages become searchable/selectable.
 * Visible content is never altered; OCR text is not trusted as dimensions or quantities.
 */
export async function addSearchableLayer(src: Uint8Array, pages: PageOcr[]): Promise<LayerResult> {
  const doc = await PDFDocument.load(src, { ignoreEncryption: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let written = 0, skipped = 0; const skippedRotatedPages: number[] = [];
  for (const p of pages) {
    const page = doc.getPage(p.pageIndex);
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    if (rot !== 0) { skippedRotatedPages.push(p.pageIndex + 1); skipped += p.words.length; continue; }
    const key = page.node.newFontDictionary('PITCHOcr', font.ref);
    const box = page.getCropBox();
    const { ok, skipped: bad } = partitionWords(p.words); skipped += bad.length;
    const ops: PDFOperator[] = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const w of ok) {
      const u = pxToUser(w, p.imageWidth, p.imageHeight, box);
      const size = Math.max(1, u.height);
      const natural = font.widthOfTextAtSize(w.text, size);
      ops.push(setFontAndSize(key, size));
      // Horizontal scaling (Tz) makes the selection box match the word width on the scan.
      ops.push(PDFOperator.of('Tz' as any, [PDFNumber.of(natural > 0 ? (u.width / natural) * 100 : 100)]));
      ops.push(setTextMatrix(1, 0, 0, 1, u.x, u.y));
      ops.push(showText(font.encodeText(w.text)));
      written++;
    }
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);
  }
  return { bytes: await doc.save({ useObjectStreams: false }), written, skipped, skippedRotatedPages };
}
