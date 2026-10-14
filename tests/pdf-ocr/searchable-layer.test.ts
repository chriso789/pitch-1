import { describe, it, expect } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { addSearchableLayer, partitionWords, pxToUser } from '@/lib/pdf-ocr/searchableLayer';

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
  it('adds invisible text without touching the original and skips rotated pages', async () => {
    const d = await PDFDocument.create(); d.addPage([612, 792]); d.addPage([612, 792]).setRotation(degrees(90));
    const src = await d.save();
    const copy = src.slice();
    const r = await addSearchableLayer(src, [
      { pageIndex: 0, imageWidth: 1224, imageHeight: 1584, words: [word('SHEET'), word('A-101', 400, 100)] },
      { pageIndex: 1, imageWidth: 1224, imageHeight: 1584, words: [word('X')] },
    ]);
    expect(src).toEqual(copy);
    expect(r.written).toBe(2); expect(r.skippedRotatedPages).toEqual([2]);
    const out = await PDFDocument.load(r.bytes);
    expect(out.getPageCount()).toBe(2);
    const text = new TextDecoder('latin1').decode(r.bytes);
    expect(text).toContain('3 Tr'); expect(text).toContain('PITCHOcr');
  });
});
