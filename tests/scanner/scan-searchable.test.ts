import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { isLowQualityPage, pickProbeWords, normaliseForSearch } from '@/lib/scan-ocr/scanSearchable';
import { addSearchableLayer } from '@/lib/pdf-ocr/searchableLayer';

const w = (text: string, confidence = 95) => ({ text, x0: 10, y0: 10, x1: 110, y1: 40, confidence });

describe('UltraScan searchable PDF', () => {
  it('flags low-quality OCR pages', () => {
    expect(isLowQualityPage({ page: 1, mean_confidence: 50, words: 10, low_confidence_words: 0 })).toBe(true);
    expect(isLowQualityPage({ page: 1, mean_confidence: 90, words: 10, low_confidence_words: 4 })).toBe(true);
    expect(isLowQualityPage({ page: 1, mean_confidence: 90, words: 10, low_confidence_words: 1 })).toBe(false);
  });
  it('only probes confident plain words and never alters them', () => {
    const pages = [{ pageIndex: 0, imageWidth: 100, imageHeight: 100, words: [w('Contract'), w('ab'), w('Signed', 40), w('Roofing')] }];
    expect(pickProbeWords(pages)).toEqual(['Contract', 'Roofing']);
    expect(normaliseForSearch('  Roof   Co ')).toBe('roof co');
  });
  it('keeps the scan image and adds text behind it', async () => {
    const d = await PDFDocument.create();
    const png = await d.embedPng(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)));
    const p = d.addPage([612, 792]); p.drawImage(png, { x: 0, y: 0, width: 612, height: 792 });
    const r = await addSearchableLayer(await d.save(), [{ pageIndex: 0, imageWidth: 1224, imageHeight: 1584, words: [w('AGREEMENT')] }]);
    expect(r.written).toBe(1);
    const out = await PDFDocument.load(r.bytes);
    const xo = out.getPage(0).node.Resources()!.lookup((await import('pdf-lib')).PDFName.of('XObject')) as any;
    expect(xo.keys().length).toBe(1); // original image untouched, still present
  });
});
