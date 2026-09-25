import { PDFDocument } from "pdf-lib";

export interface PdfChunk {
  bytes: Uint8Array;
  firstPage: number; // 1-indexed, inclusive
  lastPage: number;
}

/**
 * Splits a large plan-set PDF into page-range chunks that each stay under `limitBytes`.
 * Keeps page order so sheet numbering stays intact.
 */
export async function splitPdfBySize(
  file: File,
  limitBytes = 28 * 1024 * 1024,
  onProgress?: (msg: string) => void,
): Promise<PdfChunk[]> {
  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const total = src.getPageCount();
  if (file.size <= limitBytes) {
    return [{ bytes: new Uint8Array(await file.arrayBuffer()), firstPage: 1, lastPage: total }];
  }

  const chunks: PdfChunk[] = [];
  let start = 0;
  // first guess at how many pages fit in a chunk
  let guess = Math.max(1, Math.floor((total * limitBytes) / file.size));

  while (start < total) {
    let count = Math.min(guess, total - start);
    let bytes = await extract(src, start, count);
    let guard = 0;
    while (bytes.byteLength > limitBytes && count > 1 && guard++ < 6) {
      count = Math.max(1, Math.floor((count * limitBytes) / bytes.byteLength * 0.9));
      bytes = await extract(src, start, count);
    }
    if (bytes.byteLength > limitBytes) {
      // CAD exports often share one giant resource set across every page, so even a
      // single copied page is huge. Fall back to rendering the remaining pages as images.
      onProgress?.("Plan pages are very heavy — converting to images…");
      const rest = await rasterizeRange(file, start, total, limitBytes, onProgress);
      chunks.push(...rest);
      return chunks;
    }
    chunks.push({ bytes, firstPage: start + 1, lastPage: start + count });
    onProgress?.(`Prepared pages ${start + 1}–${start + count} of ${total}`);
    guess = count;
    start += count;
  }
  return chunks;
}

async function extract(src: PDFDocument, start: number, count: number): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const indices = Array.from({ length: count }, (_, i) => start + i);
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save({ useObjectStreams: true });
}

async function loadPdfJs() {
  const pdfjs: any = await import("pdfjs-dist");
  // @ts-ignore - Vite-specific import query
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.js?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

/** Renders pages [start, total) to high-res JPEGs and packs them into size-limited PDFs. */
async function rasterizeRange(file: File, start: number, total: number, limitBytes: number, onProgress?: (m: string) => void): Promise<PdfChunk[]> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const MAX_SIDE = 5000; // keeps dimensions/notes legible on large sheets
  const chunks: PdfChunk[] = [];
  let out = await PDFDocument.create();
  let size = 0, first = start + 1;
  const flush = async (last: number) => {
    if (out.getPageCount() === 0) return;
    chunks.push({ bytes: await out.save(), firstPage: first, lastPage: last });
    out = await PDFDocument.create(); size = 0; first = last + 1;
  };
  for (let i = start; i < total; i++) {
    onProgress?.(`Converting page ${i + 1} of ${total}…`);
    const page = await doc.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(MAX_SIDE / Math.max(base.width, base.height), 4);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.82));
    const jpg = new Uint8Array(await blob.arrayBuffer());
    canvas.width = canvas.height = 0; page.cleanup();
    if (size + jpg.byteLength > limitBytes) await flush(i);
    const img = await out.embedJpg(jpg);
    out.addPage([base.width, base.height]).drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
    size += jpg.byteLength;
  }
  await flush(total);
  await doc.destroy();
  return chunks;
}
