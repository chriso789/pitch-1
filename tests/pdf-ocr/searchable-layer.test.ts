import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { addSearchableLayer, partitionWords, pxToUser, placeWord } from '@/lib/pdf-ocr/searchableLayer';

const word = (text: string, x0 = 100, y0 = 100) => ({ text, x0, y0, x1: x0 + 200, y1: y0 + 40, confidence: 90 });

describe('OCR searchable layer', () => {
  it('maps image pixels to PDF user space (y flipped)', () => {
    const u = pxToUser(word('A', 0, 0), 1224, 1584, { x: 0, y: 0, width: 612, height: 792 });
    expect(u).toEqual({ x: 0, y: 772, width: 100, height: 20 });
  });
  it('reports characters it cannot encode instead of substituting', () => {
    const r = partitionWords([word('ROOF'), word('屋根'), word('  ')]);
    expect(r.ok.map(w => w.text)).toEqual(['ROOF']); expect(r.skipped).toHaveLength(2);
  });
  it('adds invisible text on normal and rotated pages without touching the original', async () => {
    const d = await PDFDocument.create(); d.addPage([612, 792]); d.addPage([612, 792]).setRotation(degrees(90));
    const src = await d.save();
    const copy = src.slice();
    const r = await addSearchableLayer(src, [
      { pageIndex: 0, imageWidth: 1224, imageHeight: 1584, words: [word('SHEET'), word('A-101', 400, 100)] },
      { pageIndex: 1, imageWidth: 1584, imageHeight: 1224, words: [word('X')] },
    ]);
    expect(src).toEqual(copy);
    expect(r.written).toBe(3); expect(r.skippedRotatedPages).toEqual([]);
    const out = await PDFDocument.load(r.bytes);
    for (const i of [0, 1]) {
      const fonts = out.getPage(i).node.Resources()!.lookup(PDFName.of('Font')) as any;
      expect(fonts.keys().some((k: any) => k.asString().startsWith('/PITCHOcr'))).toBe(true);
    }
  });
  it('maps view pixels to user space for each rotation', () => {
    const box = { x: 0, y: 0, width: 600, height: 800 };
    const w = { text: 'A', x0: 0, y0: 0, x1: 10, y1: 10, confidence: 90 };
    // image = displayed page at 1 px per unit
    expect(placeWord(w, 600, 800, box, 0)).toMatchObject({ x: 0, y: 790, m: [1, 0, 0, 1] });
    expect(placeWord(w, 800, 600, box, 90)).toMatchObject({ x: 10, y: 0, m: [0, 1, -1, 0] });
    expect(placeWord(w, 600, 800, box, 180)).toMatchObject({ x: 600, y: 10, m: [-1, 0, 0, -1] });
    expect(placeWord(w, 800, 600, box, 270)).toMatchObject({ x: 590, y: 800, m: [0, -1, 1, 0] });
  });
});
