import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { writeMarkups, readMarkups, inspectAnnotations, pageContentText, bbox, type Markup } from '@/lib/pdf-markup/markups';
import { compilePlan, planFromSource } from '@/lib/pdf-pages/pageOps';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const now = '2026-10-13T00:00:00.000Z';
const base = { color: [0.85, 0.1, 0.1] as [number, number, number], width: 2, opacity: 0.9, author: 'Tester', createdAt: now };
const all = (): Markup[] => [
  { ...base, id: 'm-text', page: 0, type: 'text', center: [400, 1500], w: 300, h: 80, text: 'Verify flashing detail', fontSize: 18, fill: null },
  { ...base, id: 'm-hl', page: 0, type: 'highlight', color: [1, 0.9, 0], quads: [[[100, 1650], [600, 1650], [100, 1600], [600, 1600]]] },
  { ...base, id: 'm-ul', page: 0, type: 'underline', quads: [[[100, 1650], [600, 1650], [100, 1600], [600, 1600]]] },
  { ...base, id: 'm-so', page: 0, type: 'strikeout', quads: [[[100, 1650], [600, 1650], [100, 1600], [600, 1600]]] },
  { ...base, id: 'm-line', page: 0, type: 'line', points: [[200, 200], [2200, 200]] },
  { ...base, id: 'm-arrow', page: 0, type: 'arrow', points: [[300, 300], [900, 700]] },
  { ...base, id: 'm-rect', page: 0, type: 'rect', center: [1200, 900], w: 400, h: 200, rotation: 30, fill: [0.9, 0.9, 1] },
  { ...base, id: 'm-ell', page: 0, type: 'ellipse', center: [1800, 900], w: 300, h: 150 },
  { ...base, id: 'm-pl', page: 0, type: 'polyline', points: [[100, 100], [300, 150], [500, 100]] },
  { ...base, id: 'm-pg', page: 0, type: 'polygon', points: [[700, 100], [900, 100], [800, 250]] },
  { ...base, id: 'm-cloud', page: 0, type: 'cloud', points: [[1000, 1000], [1600, 1000], [1600, 1400], [1000, 1400]] },
  { ...base, id: 'm-call', page: 0, type: 'callout', center: [2000, 1500], w: 300, h: 90, points: [[1700, 1200]], text: 'RFI-12: confirm drain size', fill: [1, 1, 1] },
  { ...base, id: 'm-note', page: 0, type: 'note', center: [2400, 1600], w: 24, h: 24, text: 'Check with GC', color: [1, 0.85, 0.2], replies: [{ id: 'r1', author: 'PM', text: 'Confirmed 4in drain', createdAt: now }] },
  { ...base, id: 'm-stamp', page: 0, type: 'stamp', center: [2200, 400], w: 300, h: 90, label: 'Approved as noted' },
  { ...base, id: 'm-img', page: 0, type: 'image', center: [400, 400], w: 200, h: 100, image: { data: PNG, type: 'png' } },
  { ...base, id: 'm-cover', page: 0, type: 'cover', center: [1300, 1650], w: 300, h: 40, fill: [1, 1, 1], text: 'REV B', fontSize: 14, color: [0, 0, 0] },
];

let SRC: Uint8Array;
beforeAll(async () => {
  const d = await PDFDocument.create();
  d.addPage([2592, 1728]); // ARCH D landscape
  const e = d.addPage([2592, 3456]); e.setRotation(degrees(90)); // ARCH E, rotated sheet
  SRC = await d.save();
});

describe('markup engine', () => {
  it('writes every markup type as a real annotation with an appearance stream and reopens it losslessly', async () => {
    const ms = all();
    const out = await writeMarkups(SRC, ms);
    const back = await readMarkups(out);
    expect(back.markups.map((m) => m.id)).toEqual(ms.map((m) => m.id));
    expect(back.markups).toEqual(ms);
    const annots = (await inspectAnnotations(out))[0];
    const sub = Object.fromEntries(annots.filter((a) => !a.irt).map((a) => [a.nm, a.subtype]));
    expect(sub).toMatchObject({ 'm-text': '/FreeText', 'm-hl': '/Highlight', 'm-ul': '/Underline', 'm-so': '/StrikeOut', 'm-line': '/Line', 'm-arrow': '/Line', 'm-rect': '/Square', 'm-ell': '/Circle', 'm-pl': '/PolyLine', 'm-pg': '/Polygon', 'm-cloud': '/Polygon', 'm-call': '/FreeText', 'm-note': '/Text', 'm-stamp': '/Stamp', 'm-img': '/Stamp', 'm-cover': '/Square' });
    expect(annots.filter((a) => !a.irt).every((a) => a.hasAP && a.apText.length > 10)).toBe(true);
    expect(annots.find((a) => a.nm === 'm-call')!.it).toBe('/FreeTextCallout');
    expect(annots.find((a) => a.nm === 'm-cloud')!.be).toBe(true);
    expect(annots.find((a) => a.nm === 'm-hl')!.quad).toEqual([100, 1650, 600, 1650, 100, 1600, 600, 1600]);
    expect(annots.filter((a) => a.irt)).toHaveLength(1);
    expect(annots.find((a) => a.nm === 'm-img')!.apText).toMatch(/\/Im0 Do/);
  });

  it('places annotation rectangles exactly around the user-space geometry (incl. rotation)', async () => {
    const out = await writeMarkups(SRC, all());
    const annots = (await inspectAnnotations(out))[0];
    for (const m of all()) {
      const r = annots.find((a) => a.nm === m.id)!.rect!; const b = bbox(m);
      r.forEach((v, i) => expect(v).toBeCloseTo(b[i], 2));
    }
    // 30 deg rotated 400x200 rect: bbox half-width = 200cos30+100sin30 = 223.2
    const rr = annots.find((a) => a.nm === 'm-rect')!.rect!;
    expect(rr[2] - rr[0]).toBeCloseTo(2 * 223.205 + 8, 1);
  });

  it('re-saving replaces PITCH markups but keeps other annotations; edits persist', async () => {
    const d = await PDFDocument.load(SRC); const p = d.getPage(0);
    p.node.addAnnot(d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] })));
    const withLink = await d.save();
    const v1 = await writeMarkups(withLink, all());
    const edited = all().filter((m) => m.id !== 'm-line').map((m) => (m.id === 'm-text' ? { ...m, text: 'Edited', center: [500, 1400] as [number, number] } : m));
    const v2 = await writeMarkups(v1, edited);
    const back = await readMarkups(v2);
    expect(back.markups).toHaveLength(edited.length);
    expect(back.markups.find((m) => m.id === 'm-text')).toMatchObject({ text: 'Edited', center: [500, 1400] });
    expect(back.otherAnnotations).toEqual([{ page: 0, subtype: 'Link' }]);
  });

  it('markups on a rotated ARCH E sheet keep user-space coordinates', async () => {
    const m: Markup = { ...base, id: 'r1', page: 1, type: 'text', center: [1296, 1728], w: 400, h: 100, rotation: 90, text: 'Upright on rotated sheet' };
    const out = await writeMarkups(SRC, [m]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    expect((await readMarkups(out)).markups[0]).toEqual(m);
  });

  it('flatten burns markups into the page content stream (no annotations left)', async () => {
    const out = await writeMarkups(SRC, all().filter((m) => m.type !== 'note'), { flatten: true });
    expect((await inspectAnnotations(out))[0]).toHaveLength(0);
    const doc = await PDFDocument.load(out);
    expect(pageContentText(doc, doc.getPage(0))).toMatch(/\/PITCHFx0 Do/);
  });

  it('markups survive page reorder by the page organizer', async () => {
    const v = await writeMarkups(SRC, all());
    const src = { id: 's', name: 's.pdf', bytes: v };
    const reordered = await compilePlan(planFromSource(src, 2).reverse(), [src]);
    const back = await readMarkups(reordered);
    expect(back.markups).toHaveLength(all().length);
    expect(back.markups.every((m) => m.page === 1)).toBe(true);
  });

  it('rejects markups on a missing page', async () => {
    await expect(writeMarkups(SRC, [{ ...all()[0], page: 9 }])).rejects.toThrow(/page 10/);
  });
});
