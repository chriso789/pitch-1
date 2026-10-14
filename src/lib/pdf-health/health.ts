import { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFArray } from 'pdf-lib';
import { qpdfRun } from '@/lib/pdf-protect/protect';

/**
 * Phase 2G — file health. Runs locally (qpdf WASM + pdf-lib); nothing is uploaded.
 * Every result is reopened and must keep the same page count, or it is rejected.
 */
export type JpegReencoder = (jpeg: Uint8Array, maxDim: number, quality: number) => Promise<{ bytes: Uint8Array; width: number; height: number } | null>;
export interface CompressOptions { images?: { maxDim: number; quality: number; encode: JpegReencoder }; wasmPath?: string }
export interface CompressResult { bytes: Uint8Array; before: number; after: number; imagesShrunk: number; note: string }

const ok = (c: number) => c === 0 || c === 3;
async function pageCount(b: Uint8Array) { return (await PDFDocument.load(b.slice(), { updateMetadata: false })).getPageCount(); }

/** Re-encodes oversized RGB/gray JPEG photos. Only replaces an image when the new one is smaller. */
async function shrinkImages(src: Uint8Array, o: NonNullable<CompressOptions['images']>) {
  const d = await PDFDocument.load(src, { updateMetadata: false });
  let n = 0;
  for (const [ref, obj] of d.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const f = dict.get(PDFName.of('Filter'));
    const filt = f instanceof PDFArray ? (f.size() === 1 ? f.get(0) : null) : f;
    if (filt !== PDFName.of('DCTDecode') || dict.has(PDFName.of('Decode'))) continue;
    const cs = dict.get(PDFName.of('ColorSpace'));
    if (cs !== PDFName.of('DeviceRGB') && cs !== PDFName.of('DeviceGray')) continue; // CMYK/ICC left as-is
    const w = (dict.get(PDFName.of('Width')) as PDFNumber)?.asNumber?.() ?? 0;
    const h = (dict.get(PDFName.of('Height')) as PDFNumber)?.asNumber?.() ?? 0;
    if (Math.max(w, h) <= o.maxDim && o.quality >= 0.9) continue;
    const r = await o.encode(obj.contents, o.maxDim, o.quality).catch(() => null);
    if (!r || r.bytes.length >= obj.contents.length) continue;
    const ns = d.context.stream(r.bytes, {
      Type: 'XObject', Subtype: 'Image', Width: r.width, Height: r.height,
      ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode',
      ...(dict.has(PDFName.of('SMask')) ? { SMask: dict.get(PDFName.of('SMask')) } : {}),
    } as any);
    d.context.assign(ref, ns); n++;
  }
  return { bytes: n ? await d.save({ useObjectStreams: false, updateFieldAppearances: false }) : src, n };
}

export async function compressPdf(src: Uint8Array, opts: CompressOptions = {}): Promise<CompressResult> {
  const before = src.length;
  const pages = await pageCount(src);
  let work = src, imagesShrunk = 0;
  if (opts.images) { const s = await shrinkImages(src, opts.images); work = s.bytes; imagesShrunk = s.n; }
  const r = await qpdfRun(['--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9',
    '--remove-unreferenced-resources=yes', '$IN', '$OUT'], work, opts.wasmPath);
  const out = ok(r.code) && r.out ? r.out : work;
  if ((await pageCount(out)) !== pages) throw new Error('Verification failed: the compressed file lost pages. Nothing was saved.');
  if (out.length >= before) return { bytes: src, before, after: before, imagesShrunk: 0, note: 'Already as small as it can safely get; no change.' };
  const pct = Math.round((1 - out.length / before) * 100);
  return { bytes: out, before, after: out.length, imagesShrunk, note: `Compressed ${pct}% smaller${imagesShrunk ? `, ${imagesShrunk} photo(s) resized` : ''}` };
}

/** Rebuilds the file's internal index and structure. Never invents content. */
export async function repairPdf(src: Uint8Array, opts: { wasmPath?: string } = {}): Promise<{ bytes: Uint8Array; pages: number; warnings: boolean }> {
  let r = await qpdfRun(['--object-streams=preserve', '$IN', '$OUT'], src, opts.wasmPath);
  let fixed = false;
  if (!ok(r.code) || !r.out) {
    // Second route: pdf-lib reads objects in file order (ignores a broken index), then qpdf re-checks the rebuild.
    let resaved: Uint8Array;
    try { resaved = await (await PDFDocument.load(src.slice(), { updateMetadata: false, throwOnInvalidObject: false })).save({ useObjectStreams: false }); }
    catch { throw new Error('This file is too damaged to rebuild.'); }
    r = await qpdfRun(['--object-streams=preserve', '$IN', '$OUT'], resaved, opts.wasmPath);
    if (!ok(r.code) || !r.out) throw new Error('This file is too damaged to rebuild.');
    fixed = true;
  }
  let pages = 0;
  try { pages = await pageCount(r.out); } catch { throw new Error('The rebuilt file still cannot be opened.'); }
  if (!pages) throw new Error('No pages could be recovered.');
  return { bytes: r.out, pages, warnings: fixed || r.code === 3 };
}

/** Browser JPEG re-encoder (canvas). */
export const canvasReencoder: JpegReencoder = async (jpeg, maxDim, quality) => {
  const bmp = await createImageBitmap(new Blob([jpeg.slice().buffer], { type: 'image/jpeg' }));
  const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h); bmp.close();
  const blob: Blob | null = await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
  return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h } : null;
};
