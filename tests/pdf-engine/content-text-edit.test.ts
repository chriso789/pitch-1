import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { readPageText, checkReplacement, replaceSegmentText } from '@/lib/pdf-engine/contentTextEdit';

const text = (b: Uint8Array) => { writeFileSync('/tmp/cte.pdf', b); return execFileSync('pdftotext', ['/tmp/cte.pdf', '-']).toString(); };
const ttfPath = () => execFileSync('fc-match', ['-f', '%{file}', 'DejaVu Sans']).toString().trim();

async function standardFixture() {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([400, 300]);
  p.drawText('Policy ABC', { x: 40, y: 200, size: 12, font: f });
  p.drawText('Keep me', { x: 40, y: 150, size: 12, font: f, rotate: degrees(20) });
  d.getForm().createTextField('f1').addToPage(p, { x: 40, y: 40, width: 100, height: 20 });
  return d.save();
}

describe('genuine content-stream text editing', () => {
  it('standard font: replaces the real Tj operand, keeps other text/forms, old text not extractable', async () => {
    const src = await standardFixture(); const copy = src.slice();
    const pt = readPageText(await PDFDocument.load(src), 0);
    const seg = pt.segments.find(s => s.text === 'Policy ABC')!;
    expect(pt.fonts[seg.fontKey!].editable).toBe(true);
    const out = await replaceSegmentText(src, 0, seg.id, 'Policy XYZ');
    expect(src).toEqual(copy);
    const t = text(out);
    expect(t).toContain('Policy XYZ'); expect(t).not.toContain('Policy ABC'); expect(t).toContain('Keep me');
    expect((await PDFDocument.load(out)).getForm().getFields()).toHaveLength(1);
  });
  it('embedded subset font: allows only glyphs proven present, edits with original font', async () => {
    const d = await PDFDocument.create(); d.registerFontkit(fontkit);
    const f = await d.embedFont(readFileSync(ttfPath()), { subset: true });
    d.addPage([400, 300]).drawText('Hello World', { x: 40, y: 200, size: 14, font: f });
    const src = await d.save();
    const pt = readPageText(await PDFDocument.load(src), 0);
    const seg = pt.segments[0];
    expect(pt.fonts[seg.fontKey!].subset).toBe(true);
    expect(checkReplacement(pt, seg, 'Hello Zed').ok).toBe(false); // Z not in subset
    const out = await replaceSegmentText(src, 0, seg.id, 'World Hello');
    const t = text(out); expect(t).toContain('World Hello'); expect(t).not.toContain('Hello World');
  });
  it('missing font resource and empty text are rejected', async () => {
    const pt = readPageText(await PDFDocument.load(await standardFixture()), 0);
    expect(checkReplacement(pt, { ...pt.segments[0], fontKey: 'Nope' }, 'x').ok).toBe(false);
    expect(checkReplacement(pt, pt.segments[0], '').ok).toBe(false);
  });
});
