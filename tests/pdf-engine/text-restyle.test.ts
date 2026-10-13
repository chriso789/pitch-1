import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readPageText, replaceSegmentText, rewriteSegment, checkRestyle } from '@/lib/pdf-engine/contentTextEdit';
import { openForEditing } from '@/lib/pdf-engine/decrypt';

const dir = mkdtempSync(join(tmpdir(), 'restyle-'));
const bbox = (b: Uint8Array) => { const f = join(dir, 'o.pdf'); writeFileSync(f, b); return execFileSync('pdftotext', ['-bbox', f, '-'], { encoding: 'utf8' }); };
const words = (html: string) => [...html.matchAll(/xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]+)</g)].map(m => ({ x: +m[1], y: +m[2], w: m[3] }));
const wasmPath = resolve('node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm');

/** Hand-written content: a chained line (Tj Tj with no repositioning) plus an independent line. */
async function chainedFixture() {
  const d = await PDFDocument.create(); const page = d.addPage([400, 300]);
  const f = await d.embedFont(StandardFonts.Helvetica);
  const key = page.node.newFontDictionary(f.name, f.ref).toString();
  const content = `BT ${key} 12 Tf 40 200 Td (Name: ) Tj (Acme Roofing) Tj ( LLC) Tj ET\nBT ${key} 12 Tf 40 150 Td (Other line) Tj ET\n`;
  page.node.set(PDFName.of('Contents'), d.context.register(d.context.flateStream(content)));
  return d.save();
}

describe('restyle / move existing text (no overlay)', () => {
  it('in-place edit on a chained line keeps the following text exactly where it was', async () => {
    const src = await chainedFixture();
    const before = words(bbox(src)); const llcBefore = before.find(w => w.w === 'LLC')!;
    const pt = readPageText(await PDFDocument.load(src), 0);
    const seg = pt.segments.find(s => s.text === 'Acme Roofing')!;
    expect(seg.dependentNext).toBe(true);
    const out = await replaceSegmentText(src, 0, seg.id, 'Acme');
    const after = words(bbox(out));
    expect(after.map(w => w.w)).toContain('Acme'); expect(after.map(w => w.w)).not.toContain('Roofing');
    const llc = after.find(w => w.w === 'LLC')!;
    expect(Math.abs(llc.x - llcBefore.x)).toBeLessThan(0.05);
  });

  it('move + new font/size/colour removes the original operator and writes real text at the new position', async () => {
    const src = await chainedFixture();
    const pt = readPageText(await PDFDocument.load(src), 0);
    const seg = pt.segments.find(s => s.text === 'Acme Roofing')!;
    const before = words(bbox(src)); const llcBefore = before.find(w => w.w === 'LLC')!;
    const out = await rewriteSegment(src, 0, seg.id, { text: 'Acme Roofing', font: { kind: 'standard', name: StandardFonts.TimesRomanBold }, size: 16, matrix: [12, 0, 0, 12, 40 + 33.35, 200], dx: 10, dy: -60, color: [0.8, 0, 0] });
    const after = words(bbox(out));
    const acme = after.find(w => w.w === 'Acme')!;
    expect(acme.y).toBeGreaterThan(before.find(w => w.w === 'Acme')!.y + 50); // moved down the page
    const llc = after.find(w => w.w === 'LLC')!;
    expect(Math.abs(llc.x - llcBefore.x)).toBeLessThan(0.05); // rest of line untouched
    expect(after.filter(w => w.w === 'Acme')).toHaveLength(1); // old copy really gone
    const re = readPageText(await PDFDocument.load(out), 0);
    expect(re.segments[seg.id].text).toBe('');
    expect(Object.values(re.fonts).some(f => f.baseFont === 'Times-Bold')).toBe(true);
  });

  it('restyle can use another font already on the page (e.g. the bold variant)', async () => {
    const d = await PDFDocument.create(); const p = d.addPage([400, 300]);
    const r = await d.embedFont(StandardFonts.Helvetica), b = await d.embedFont(StandardFonts.HelveticaBold);
    p.drawText('Regular words', { x: 40, y: 200, size: 10, font: r }); p.drawText('Bold', { x: 40, y: 150, size: 10, font: b });
    const src = await d.save(); const pt = readPageText(await PDFDocument.load(src), 0);
    const seg = pt.segments.find(s => s.text === 'Regular words')!;
    const boldKey = Object.values(pt.fonts).find(f => f.baseFont === 'Helvetica-Bold')!.key;
    const out = await rewriteSegment(src, 0, seg.id, { text: 'Regular words', font: { kind: 'page', key: boldKey }, size: 10, matrix: [10, 0, 0, 10, 40, 200], dx: 0, dy: 0 });
    const re = readPageText(await PDFDocument.load(out), 0);
    expect(re.segments.at(-1)!.text).toBe('Regular words'); expect(re.segments.at(-1)!.fontKey).toBe(boldKey);
  });

  it('rejects line breaks and characters a standard font cannot draw', async () => {
    const pt = readPageText(await PDFDocument.load(await chainedFixture()), 0);
    const seg = pt.segments[0];
    expect(checkRestyle(pt, seg, { text: 'a\nb', font: { kind: 'standard', name: StandardFonts.Helvetica }, size: 10 }).ok).toBe(false);
    expect(checkRestyle(pt, seg, { text: 'Ω', font: { kind: 'standard', name: StandardFonts.Helvetica }, size: 10 }).ok).toBe(false);
  });

  it('owner-protected PDF (no open password) is unlocked locally and becomes editable; password-protected stays blocked', async () => {
    const plain = join(dir, 'plain.pdf'), prot = join(dir, 'prot.pdf'), pw = join(dir, 'pw.pdf');
    writeFileSync(plain, await chainedFixture());
    execFileSync('qpdf', ['--allow-weak-crypto', '--encrypt', '', 'owner123', '128', '--use-aes=n', '--modify=none', '--', plain, prot]);
    execFileSync('qpdf', ['--encrypt', 'user1', 'owner123', '256', '--', plain, pw]);
    const enc = Uint8Array.from(readFileSync(prot));
    const opened = await openForEditing(enc, { wasmPath });
    expect(opened.decrypted).toBe(true);
    const pt = readPageText(await PDFDocument.load(opened.bytes), 0);
    const seg = pt.segments.find(s => s.text === 'Other line')!;
    const out = await replaceSegmentText(opened.bytes, 0, seg.id, 'Line other');
    expect(words(bbox(out)).map(w => w.w)).toContain('other');
    await expect(openForEditing(Uint8Array.from(readFileSync(pw)), { wasmPath })).rejects.toThrow(/password/);
  }, 60000);
});
