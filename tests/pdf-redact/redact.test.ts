import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { applyRedactions, normalizeBox } from '@/lib/pdf-redact/redact';

// 1×1 white JPEG
const JPEG = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='), c => c.charCodeAt(0));

async function make() {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (const t of ['SSN 123-45-6789', 'Keep me']) d.addPage([300, 300]).drawText(t, { x: 20, y: 150, font: f, size: 12 });
  const form = d.getForm(); form.createTextField('ssn').setText('123-45-6789'); form.getTextField('ssn').addToPage(d.getPage(0), { x: 10, y: 10 });
  return d.save();
}
const has = (b: Uint8Array, s: string) => new TextDecoder('latin1').decode(b).includes(s);

describe('true redaction', () => {
  it('normalizes dragged boxes and drops slivers', () => {
    const n = normalizeBox({ x: 0.5, y: 0.5, w: -0.2, h: -0.1 })!; expect(n.x).toBeCloseTo(0.3); expect(n.y).toBeCloseTo(0.4); expect(n.w).toBeCloseTo(0.2); expect(n.h).toBeCloseTo(0.1);
    expect(normalizeBox({ x: 0.1, y: 0.1, w: 0.0001, h: 0.3 })).toBeNull();
  });
  it('removes text and form values from the redacted page, keeps other pages', async () => {
    const src = await make();
    const before = (await PDFDocument.load(src)).context.enumerateIndirectObjects().length;
    expect(has(src, '(ssn)')).toBe(true);
    const out = await applyRedactions(src, [{ pageIndex: 0, jpeg: JPEG }]);
    expect(has(out, '(ssn)')).toBe(false);
    const d = await PDFDocument.load(out);
    expect(d.getPageCount()).toBe(2);
    expect(d.context.enumerateIndirectObjects().length).toBeLessThan(before);
    expect(d.getForm().getFields()).toHaveLength(0);
    expect(d.getPage(1).node.Contents()).toBeDefined();
  });
});
