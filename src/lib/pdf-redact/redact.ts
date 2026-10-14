import { PDFDocument, PDFName, PDFDict, PDFRef, PDFArray, PDFStream, type PDFObject } from 'pdf-lib';

/** Redaction box as fractions (0–1) of the page's unrotated crop box, origin top-left. */
export interface RedactBox { x: number; y: number; w: number; h: number }
/** Page already rendered (unrotated) with the boxes burned in as solid black. */
export interface FlattenedPage { pageIndex: number; jpeg: Uint8Array }

export function normalizeBox(b: RedactBox): RedactBox | null {
  const x = Math.max(0, Math.min(1, Math.min(b.x, b.x + b.w))), y = Math.max(0, Math.min(1, Math.min(b.y, b.y + b.h)));
  const x2 = Math.max(0, Math.min(1, Math.max(b.x, b.x + b.w))), y2 = Math.max(0, Math.min(1, Math.max(b.y, b.y + b.h)));
  return x2 - x < 0.002 || y2 - y < 0.002 ? null : { x, y, w: x2 - x, h: y2 - y };
}

/**
 * True redaction: every page with a redaction is replaced by a flat image of itself with the
 * areas blacked out. All of that page's text, vector drawings, annotations and form fields are
 * deleted — not covered. Other pages are left byte-for-byte as objects in the file.
 * Then verified: redacted pages must contain only the one image and nothing else.
 */
export async function applyRedactions(src: Uint8Array, pages: FlattenedPage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(src, { updateMetadata: false });
  const targets = new Set(pages.map(p => p.pageIndex));
  // Remove form fields that have any widget on a redacted page (their values are hidden data).
  try {
    const form = doc.getForm();
    const refs = new Set(doc.getPages().filter((_, i) => targets.has(i)).map(p => p.ref.toString()));
    for (const f of form.getFields()) {
      if (f.acroField.getWidgets().some(w => { const p = w.P(); return p && refs.has(p.toString()); })) form.removeField(f);
    }
  } catch { /* no form */ }
  for (const p of pages) {
    const page = doc.getPage(p.pageIndex);
    const box = page.getCropBox();
    const n = page.node;
    n.delete(PDFName.of('Annots')); n.delete(PDFName.of('Contents'));
    n.delete(PDFName.of('Group')); n.delete(PDFName.of('Thumb')); n.delete(PDFName.of('PieceInfo'));
    n.set(PDFName.of('Resources'), doc.context.obj({ XObject: {} }));
    const img = await doc.embedJpg(p.jpeg);
    page.drawImage(img, { x: box.x, y: box.y, width: box.width, height: box.height });
  }
  collectGarbage(doc); // removed objects must not survive as orphans in the file
  const out = await doc.save({ useObjectStreams: false });
  await verifyRedacted(out, [...targets]);
  return out;
}

export async function verifyRedacted(bytes: Uint8Array, pageIndexes: number[]) {
  const d = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const i of pageIndexes) {
    const n = d.getPage(i).node;
    if (n.lookup(PDFName.of('Annots'))) throw new Error(`Redaction check failed: page ${i + 1} still has annotations.`);
    const res = n.lookup(PDFName.of('Resources'), PDFDict);
    const keys = res.keys().map(k => k.asString());
    if (keys.some(k => k !== '/XObject')) throw new Error(`Redaction check failed: page ${i + 1} still has fonts or drawings.`);
    const xo = res.lookup(PDFName.of('XObject'), PDFDict);
    const entries = xo.entries();
    if (entries.length !== 1) throw new Error(`Redaction check failed: page ${i + 1} has extra content.`);
    const img = d.context.lookup(entries[0][1] as PDFRef) as any;
    if (img?.dict?.get(PDFName.of('Subtype'))?.toString() !== '/Image') throw new Error(`Redaction check failed: page ${i + 1} is not a flat image.`);
  }
}

/** Deletes every object not reachable from the trailer, so removed content is truly gone from the bytes. */
export function collectGarbage(doc: PDFDocument) {
  const ctx = doc.context, seen = new Set<string>();
  const visit = (o: PDFObject | undefined) => {
    if (!o) return;
    if (o instanceof PDFRef) { const k = o.toString(); if (seen.has(k)) return; seen.add(k); visit(ctx.lookup(o)); return; }
    if (o instanceof PDFDict) { for (const [, v] of o.entries()) visit(v); return; }
    if (o instanceof PDFArray) { for (const v of o.asArray()) visit(v); return; }
    if (o instanceof PDFStream) visit(o.dict);
  };
  const t = ctx.trailerInfo as any;
  [t.Root, t.Info, t.Encrypt, t.ID].forEach(visit);
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.toString())) ctx.delete(ref);
}
