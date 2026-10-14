import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { compressPdf, repairPdf } from '@/lib/pdf-health/health';

const wasmPath = resolve('node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm');
const make = async () => {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) { const p = d.addPage([300, 300]); for (let j = 0; j < 40; j++) p.drawText(`Line ${j} of page ${i}`, { x: 10, y: 280 - j * 7, size: 6, font: f }); }
  return d.save({ useObjectStreams: false, objectsPerTick: Infinity });
};

describe('PDF file health', () => {
  it('compresses losslessly and keeps every page', async () => {
    const src = await make();
    const r = await compressPdf(src, { wasmPath });
    expect(r.after).toBeLessThanOrEqual(r.before);
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(3);
  }, 30000);
  it('rebuilds a file with a broken index', async () => {
    const src = await make();
    const txt = new TextDecoder('latin1').decode(src);
    const broken = new Uint8Array(Buffer.from(txt.replace(/startxref\s+\d+/, 'startxref\n999999'), 'latin1'));
    const r = await repairPdf(broken, { wasmPath });
    expect(r.pages).toBe(3);
  }, 30000);
});
