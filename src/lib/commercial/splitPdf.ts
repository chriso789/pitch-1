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
