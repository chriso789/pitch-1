/**
 * Dimensional accuracy + coordinate tests run identically against both engines:
 * the real PdfCraft WASM engine and the PITCH JS fallback.
 * Fixtures are synthetic PDFs with known geometry (1/8" = 1'-0" roof outline).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFName, PDFNumber, rgb } from 'pdf-lib';
import { initSync } from '@/lib/wasm/pitch_pdfcraft_measure/pitch_pdfcraft_measure.js';
import { pdfcraftEngine } from '@/lib/plan-measure/pdfcraftEngine';
import { jsEngine } from '@/lib/plan-measure/jsEngine';
import { scaleFromRatio, snapToGeometry, pitchFactor, verifyError, parseFeet } from '@/lib/plan-measure/geometry';
import type { MeasureEngine, PageBox, Pt } from '@/lib/plan-measure/types';

beforeAll(() => {
  initSync({ module: readFileSync(path.resolve(__dirname, '../../public/wasm/pitch_pdfcraft_measure_bg.wasm')) });
});

// 40' x 25' roof at 1/8" = 1' => 5" x 3.125" on paper => 360 x 225 pt (UserUnit 1).
const RECT: Pt[] = [[100, 100], [460, 100], [460, 325], [100, 325]];

async function fixture(opts: { rotate?: number; crop?: [number, number, number, number]; userUnit?: number; rect?: Pt[] } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([1224, 792]);
  const r = opts.rect ?? RECT;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: 1, color: rgb(0, 0, 0) });
  }
  if (opts.rotate) page.setRotation({ type: 'degrees', angle: opts.rotate } as any);
  if (opts.crop) { const [x0, y0, x1, y1] = opts.crop; page.setCropBox(x0, y0, x1 - x0, y1 - y0); }
  if (opts.userUnit) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(opts.userUnit));
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

const engines: MeasureEngine[] = [pdfcraftEngine, jsEngine];

describe.each(engines.map((e) => [e.id, e]))('%s engine', (_id, engine) => {
  it('calibrates from a known dimension and measures the other sides exactly', () => {
    const s = engine.calibrate(RECT[0], RECT[1], 40, 'ft');
    expect(engine.reading('distance', [RECT[1], RECT[2]], s).value).toBeCloseTo(25, 9);
    expect(engine.reading('perimeter', [...RECT, RECT[0]], s).value).toBeCloseTo(130, 9);
    expect(engine.reading('area', RECT, s).value).toBeCloseTo(1000, 7);
  });

  it('matches a stated 1/8" = 1\' scale, including UserUnit 2 sheets', () => {
    const s1 = scaleFromRatio(0.125, 1, 'ft', 1);
    expect(engine.reading('distance', [[0, 0], [360, 0]], s1).value).toBeCloseTo(40, 9);
    const s2 = scaleFromRatio(0.125, 1, 'ft', 2);
    expect(engine.reading('distance', [[0, 0], [180, 0]], s2).value).toBeCloseTo(40, 9);
  });

  it('measures an L-shaped (reflex) roof area correctly', () => {
    const s = scaleFromRatio(0.125, 1, 'ft', 1);
    // 40x25 minus a 10x10 notch = 900 sf
    const L: Pt[] = [[0, 0], [360, 0], [360, 225], [90, 225], [90, 135], [0, 135]];
    expect(engine.reading('area', L, s).value).toBeCloseTo(40 * 25 - 10 * 10, 7);
  });

  it('rejects invalid calibration instead of assuming a scale', () => {
    expect(() => engine.calibrate([1, 1], [1, 1], 10, 'ft')).toThrow();
    expect(() => engine.calibrate([0, 0], [10, 0], 0, 'ft')).toThrow();
    expect(() => engine.calibrate([0, 0], [10, 0], NaN, 'ft')).toThrow();
  });

  it.each([0, 90, 180, 270])('round-trips view <-> user on a cropped, rotated (%i°) UserUnit 2 page', (rotate) => {
    const box: PageBox = { rotate, crop: [36, 18, 1188, 774], userUnit: 2 };
    for (const p of [[0, 0], [123.5, 77.25], [900, 400]] as Pt[]) {
      const u = engine.viewToUser(box, p);
      const v = engine.userToView(box, u);
      expect(v[0]).toBeCloseTo(p[0], 6); expect(v[1]).toBeCloseTo(p[1], 6);
    }
  });
});

describe('engine parity', () => {
  it.each([0, 90, 180, 270])('PdfCraft and JS transforms agree (rotate %i)', (rotate) => {
    for (const uu of [1, 2]) {
      const box: PageBox = { rotate, crop: [36, 18, 1188, 774], userUnit: uu };
      for (const p of [[0, 0], [50, 700], [1000, 10]] as Pt[]) {
        const a = pdfcraftEngine.viewToUser(box, p), b = jsEngine.viewToUser(box, p);
        expect(a[0]).toBeCloseTo(b[0], 9); expect(a[1]).toBeCloseTo(b[1], 9);
      }
    }
  });
  it('top-left of the shown page maps to the expected crop corner', () => {
    expect(jsEngine.viewToUser({ rotate: 0, crop: [36, 18, 1188, 774], userUnit: 1 }, [0, 0])).toEqual([36, 774]);
    expect(pdfcraftEngine.viewToUser({ rotate: 90, crop: [36, 18, 1188, 774], userUnit: 1 }, [0, 0])).toEqual([36, 18]);
  });
});

describe('PdfCraft vector snapping and embedded annotations', () => {
  it('extracts vector endpoints from a rotated, cropped sheet and snaps to the corner', async () => {
    const pdf = await fixture({ rotate: 90, crop: [36, 36, 1188, 756] });
    const g = pdfcraftEngine.geometry(pdf, 0)!;
    expect(g.segments.length).toBeGreaterThanOrEqual(4);
    const hit = snapToGeometry(g, [462, 98], 6);
    expect(hit?.kind).toBe('endpoint');
    expect(hit!.point[0]).toBeCloseTo(460, 0); expect(hit!.point[1]).toBeCloseTo(100, 0);
    const mid = snapToGeometry(g, [281, 101], 4);
    expect(mid?.kind).toBe('midpoint');
  });

  it('writes ISO measurement annotations that survive save and reopen', async () => {
    const pdf = await fixture();
    const scale = scaleFromRatio(0.125, 1, 'ft', 1);
    const out = pdfcraftEngine.embed(pdf, [
      { page: 0, kind: 'area', points: RECT, scale, label: 'Roof A', author: 'test', id: 'm-1', color: [1, 0, 0] },
      { page: 0, kind: 'distance', points: [RECT[0], RECT[1]], scale, label: 'Eave', author: 'test', id: 'm-2', color: [0, 0, 1] },
    ])!;
    expect(out.byteLength).toBeGreaterThan(pdf.byteLength);
    // original bytes are untouched (incremental save appends)
    expect(Buffer.from(out.slice(0, pdf.byteLength)).equals(Buffer.from(pdf))).toBe(true);
    const list = pdfcraftEngine.listEmbedded(out)!;
    expect(list.map((m) => m.id).sort()).toEqual(['m-1', 'm-2']);
    expect(list.find((m) => m.id === 'm-1')!.reading.value).toBeCloseTo(1000, 6);
    expect(list.find((m) => m.id === 'm-2')!.reading.value).toBeCloseTo(40, 9);
    // reopen through pdf-lib as an independent reader
    const re = await PDFDocument.load(out);
    expect(re.getPageCount()).toBe(1);
  });

  it('rejects self-intersecting area outlines', async () => {
    const pdf = await fixture();
    const scale = scaleFromRatio(0.125, 1, 'ft', 1);
    expect(() => pdfcraftEngine.embed(pdf, [{ page: 0, kind: 'area', points: [[0, 0], [100, 100], [100, 0], [0, 100]], scale, label: '', author: '', id: 'x', color: [0, 0, 0] }])).toThrow();
  });
});

describe('helpers', () => {
  it('pitch factor and verification tolerance', () => {
    expect(pitchFactor(4)).toBeCloseTo(1.05409, 5);
    expect(1000 * pitchFactor(6)).toBeCloseTo(1118.034, 3);
    expect(verifyError(40.2, 40)).toBeCloseTo(0.005, 9);
  });
  it('parses feet-inch dimension strings', () => {
    expect(parseFeet(`12'-6"`)).toBeCloseTo(12.5);
    expect(parseFeet('40')).toBe(40);
    expect(parseFeet('150in')).toBeCloseTo(12.5);
    expect(Number.isNaN(parseFeet('abc'))).toBe(true);
  });
});
