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

/** Pixel box → PDF user space for an unrotated page (crop box). */
export function pxToUser(w: OcrWordPx, imgW: number, imgH: number, box: { x: number; y: number; width: number; height: number }) {
  const sx = box.width / imgW, sy = box.height / imgH;
  return { x: box.x + w.x0 * sx, y: box.y + box.height - w.y1 * sy, width: (w.x1 - w.x0) * sx, height: (w.y1 - w.y0) * sy };
}

/**
 * Word placement on a page shown with /Rotate (the OCR image is the page as displayed).
 * Returns the baseline start in user space, a text matrix rotation, and word width/height in user units.
 */
export function placeWord(w: OcrWordPx, imgW: number, imgH: number, box: { x: number; y: number; width: number; height: number }, rotation: number) {
  const rot = ((rotation % 360) + 360) % 360;
  const side = rot === 90 || rot === 270;
  const s = (side ? box.height : box.width) / imgW;
  const t = (side ? box.width : box.height) / imgH;
  const width = (w.x1 - w.x0) * s, height = (w.y1 - w.y0) * t;
  const x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height;
  const vx = w.x0 * s, vb = w.y1 * t; // left edge & baseline in view units
  switch (rot) {
    case 90: return { x: x0 + vb, y: y0 + vx, m: [0, 1, -1, 0] as const, width, height };
    case 180: return { x: x1 - vx, y: y0 + vb, m: [-1, 0, 0, -1] as const, width, height };
    case 270: return { x: x1 - vb, y: y1 - vx, m: [0, -1, 1, 0] as const, width, height };
    default: return { x: x0 + vx, y: y1 - vb, m: [1, 0, 0, 1] as const, width, height };
  }
}

export interface LayerResult { bytes: Uint8Array; written: number; skipped: number; skippedRotatedPages: number[] }

/**
 * Adds an invisible (render mode 3) text layer so scanned pages become searchable/selectable.
 * Handles pages with /Rotate 0/90/180/270. Visible content is never altered; OCR text is not trusted as dimensions.
 */
export async function addSearchableLayer(src: Uint8Array, pages: PageOcr[]): Promise<LayerResult> {
  const doc = await PDFDocument.load(src, { ignoreEncryption: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let written = 0, skipped = 0; const skippedRotatedPages: number[] = [];
  for (const p of pages) {
    const page = doc.getPage(p.pageIndex);
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    if (rot % 90 !== 0) { skippedRotatedPages.push(p.pageIndex + 1); skipped += p.words.length; continue; }
    const key = page.node.newFontDictionary('PITCHOcr', font.ref);
    const box = page.getCropBox();
    const { ok, skipped: bad } = partitionWords(p.words); skipped += bad.length;
    const ops: PDFOperator[] = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const w of ok) {
      const u = placeWord(w, p.imageWidth, p.imageHeight, box, rot);
      const size = Math.max(1, u.height);
      const natural = font.widthOfTextAtSize(w.text, size);
      ops.push(setFontAndSize(key, size));
      ops.push(PDFOperator.of('Tz' as any, [PDFNumber.of(natural > 0 ? (u.width / natural) * 100 : 100)]));
      ops.push(setTextMatrix(u.m[0], u.m[1], u.m[2], u.m[3], u.x, u.y));
      ops.push(showText(font.encodeText(w.text)));
      written++;
    }
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);
  }
  return { bytes: await doc.save({ useObjectStreams: false }), written, skipped, skippedRotatedPages };
}
