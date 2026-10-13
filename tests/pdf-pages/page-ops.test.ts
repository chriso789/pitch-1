import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, rgb, StandardFonts } from 'pdf-lib';
import { compilePlan, inspectPdf, planFromSource, parseRange, planWarnings, readBookmarks, splitPlan, setBookmarks, newKey, type SourcePdf, type PlanPage } from '@/lib/pdf-pages/pageOps';

// Fixture: 3 large-format (36x24in) vector "drawing" sheets, each with a text label, a line
// annotation (stand-in for a measurement), one form field and a bookmark per sheet.
async function makeDrawingSet(n = 3, tag = 'A'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([2592, 1728]);
    p.drawText(`${tag}-${i + 1}`, { x: 100, y: 1600, size: 48, font });
    p.drawLine({ start: { x: 200, y: 200 }, end: { x: 2200, y: 200 }, thickness: 2, color: rgb(0, 0, 0) });
    const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Line', Rect: [200, 190, 2200, 210], L: [200, 200, 2200, 200], Contents: PDFString.of(`measure-${tag}-${i + 1}`), P: p.ref });
    p.node.addAnnot(doc.context.register(annot));
    form.createTextField(`${tag}_field_${i + 1}`).addToPage(p, { x: 100, y: 100, width: 200, height: 30 });
  }
  setBookmarks(doc, Array.from({ length: n }, (_, i) => ({ title: `Sheet ${tag}-${i + 1}`, page: i + 1 })));
  doc.setTitle(`Set ${tag}`);
  return doc.save();
}
const labelOf = async (bytes: Uint8Array) => {
  const d = await PDFDocument.load(bytes);
  return d.getPages().map((p) => {
    const line = (p.node.Annots()?.asArray() ?? []).map((r) => d.context.lookup(r) as PDFDict).find((x) => x.get(PDFName.of('Subtype'))?.toString() === '/Line');
    return line ? (line.lookup(PDFName.of('Contents')) as PDFString).decodeText() : null;
  });
};

let A: SourcePdf, B: SourcePdf;
beforeAll(async () => { A = { id: 'a', name: 'A.pdf', bytes: await makeDrawingSet(3, 'A') }; B = { id: 'b', name: 'B.pdf', bytes: await makeDrawingSet(2, 'B') }; });

describe('page organizer', () => {
  it('inspects pages, fields, bookmarks', async () => {
    const i = await inspectPdf(A.bytes);
    expect(i.pageCount).toBe(3); expect(i.formFieldCount).toBe(3); expect(i.bookmarkCount).toBe(3);
    expect(i.pages[0]).toMatchObject({ width: 2592, height: 1728 });
  });

  it('reorders, keeping annotations, form fields, bookmarks and metadata', async () => {
    const plan = planFromSource(A, 3); const out = await compilePlan([plan[2], plan[0], plan[1]], [A]);
    expect(await labelOf(out)).toEqual(['measure-A-3', 'measure-A-1', 'measure-A-2']);
    const d = await PDFDocument.load(out);
    expect(d.getForm().getFields().map((f) => f.getName()).sort()).toEqual(['A_field_1', 'A_field_2', 'A_field_3']);
    expect(readBookmarks(d)).toEqual([{ title: 'Sheet A-1', page: 2 }, { title: 'Sheet A-2', page: 3 }, { title: 'Sheet A-3', page: 1 }]);
    expect(d.getTitle()).toBe('Set A');
    expect(d.getPage(0).getWidth()).toBe(2592);
  });

  it('does not modify the source bytes', async () => {
    const before = A.bytes.slice(); await compilePlan(planFromSource(A, 3).reverse(), [A]);
    expect(A.bytes).toEqual(before);
  });

  it('deletes pages and drops dead bookmark links', async () => {
    const plan = planFromSource(A, 3); const out = await compilePlan([plan[0], plan[2]], [A]);
    const d = await PDFDocument.load(out);
    expect(d.getPageCount()).toBe(2);
    expect(readBookmarks(d).map((b) => b.page)).toEqual([1, 0, 2]);
  });

  it('duplicates, inserts blank and merges another PDF', async () => {
    const pa = planFromSource(A, 3), pb = planFromSource(B, 2);
    const blank: PlanPage = { key: newKey(), sourceId: null, sourceIndex: 0, rotate: 0, size: [612, 792] };
    const out = await compilePlan([pa[0], { ...pa[0], key: newKey() }, blank, pb[1], pa[1]], [A, B]);
    expect(await labelOf(out)).toEqual(['measure-A-1', 'measure-A-1', null, 'measure-B-2', 'measure-A-2']);
    const d = await PDFDocument.load(out);
    expect(d.getPage(2).getSize()).toEqual({ width: 612, height: 792 });
  });

  it('rotates, crops and resizes', async () => {
    const p = planFromSource(A, 3);
    const out = await compilePlan([{ ...p[0], rotate: 90 }, { ...p[1], crop: { x: 0.5, y: 0, w: 0.5, h: 0.5 } }, { ...p[2], size: [1296, 864] }], [A]);
    const d = await PDFDocument.load(out);
    expect(d.getPage(0).getRotation().angle).toBe(90);
    expect(d.getPage(1).getCropBox()).toMatchObject({ x: 1296, y: 0, width: 1296, height: 864 });
    expect(d.getPage(2).getSize()).toEqual({ width: 1296, height: 864 });
    const annot = d.context.lookup((d.getPage(2).node.Annots() as PDFArray).get(0)) as PDFDict;
    expect((annot.lookup(PDFName.of('Rect')) as PDFArray).asArray().map(Number)).toEqual([100, 95, 1100, 105]);
  });

  it('stamps page numbers, header/footer and watermark; sets metadata and bookmarks', async () => {
    const out = await compilePlan(planFromSource(A, 3), [A], {
      stamps: { pageNumbers: { format: 'Page {n} of {total}', position: 'bottom-right', start: 1, size: 10 }, header: { left: 'PITCH', size: 9 }, footer: { center: 'Job 42', size: 9 }, textWatermark: { text: 'FOR REVIEW', size: 60, opacity: 0.2, angle: 30 } },
      metadata: { title: 'Issued set', author: 'PITCH', keywords: ['roof', 'IFC'] },
      bookmarks: [{ title: 'Cover', page: 1 }, { title: 'Roof plan', page: 3 }],
    });
    const d = await PDFDocument.load(out);
    expect(d.getTitle()).toBe('Issued set'); expect(d.getAuthor()).toBe('PITCH');
    expect(readBookmarks(d)).toEqual([{ title: 'Cover', page: 1 }, { title: 'Roof plan', page: 3 }]);
    expect(out.byteLength).toBeGreaterThan(A.bytes.byteLength);
  });

  it('splits into files and parses ranges', async () => {
    const parts = await splitPlan(planFromSource(A, 3), [A], 2);
    expect(await Promise.all(parts.map(async (b) => (await PDFDocument.load(b)).getPageCount()))).toEqual([2, 1]);
    expect(parseRange('1, 3-4', 5)).toEqual([1, 3, 4]);
    expect(() => parseRange('4-9', 5)).toThrow();
  });

  it('warns about signatures, dropped pages and merged forms', async () => {
    const d = await PDFDocument.load(A.bytes); d.getForm().acroForm.dict.set(PDFName.of('SigFlags'), d.context.obj(3));
    const signed = { id: 's', name: 'S.pdf', bytes: await d.save() };
    const info = { s: await inspectPdf(signed.bytes), b: await inspectPdf(B.bytes) };
    const p = planFromSource(signed, 3); const w = planWarnings([p[0], ...planFromSource(B, 1)], [signed, B], info);
    expect(w.join(' ')).toMatch(/digital signatures/); expect(w.join(' ')).toMatch(/2 original page/); expect(w.join(' ')).toMatch(/Form fields in "B.pdf"/);
  });
});
