import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { readPageText, replaceSegmentText } from '@/lib/pdf-engine/contentTextEdit';
import { verifyOnlyEditedTextChanged, type PlacedText } from '@/lib/pdf-engine/textVerify';

async function items(bytes: Uint8Array): Promise<PlacedText[]> {
  const pdf = await (pdfjs as any).getDocument({ data: bytes.slice(), disableWorker: true, isEvalSupported: false }).promise;
  const c = await (await pdf.getPage(1)).getTextContent();
  await pdf.destroy();
  return c.items.filter((i: any) => i.str?.trim()).map((i: any) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
}

describe('independent edit verification', () => {
  it('accepts an in-place edit even when the viewer splits the new text (double space)', async () => {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.HelveticaBold);
    const p = d.addPage([612, 792]);
    p.drawText('CERTIFICATE OF LIABILITY INSURANCE', { x: 150, y: 740, size: 14, font: f });
    p.drawText('DATE (MM/DD/YYYY)', { x: 480, y: 740, size: 7, font: f });
    p.drawText('INSURER A :', { x: 300, y: 600, size: 7, font: f });
    const src = await d.save();
    const seg = readPageText(await PDFDocument.load(src), 0).segments.find(s => s.text.startsWith('CERTIFICATE'))!;
    const draft = 'CERTIFICATE  LIABILITY INSURANCE';
    const out = await replaceSegmentText(src, 0, seg.id, draft);
    const [before, after] = [await items(src), await items(out)];
    const orig = before.find(i => i.str.startsWith('CERTIFICATE'))!;
    expect(verifyOnlyEditedTextChanged(before, after, { original: orig, x: orig.x, y: orig.y, dir: [1, 0], size: 14, text: draft })).toEqual({ ok: true });
  });

  it('rejects when any other text moved', () => {
    const before = [{ str: 'Title', x: 10, y: 100 }, { str: 'Other', x: 10, y: 50 }];
    const after = [{ str: 'New title', x: 10, y: 100 }, { str: 'Other', x: 12, y: 50 }];
    const r = verifyOnlyEditedTextChanged(before, after, { original: before[0], x: 10, y: 100, dir: [1, 0], size: 12, text: 'New title' });
    expect(r.ok).toBe(false);
  });

  it('rejects when the new text is missing', () => {
    const before = [{ str: 'Title', x: 10, y: 100 }];
    const r = verifyOnlyEditedTextChanged(before, [], { original: before[0], x: 10, y: 100, dir: [1, 0], size: 12, text: 'X' });
    expect(r.ok).toBe(false);
  });
});
