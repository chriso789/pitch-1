import { describe, it, expect } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { applyFillSign } from '@/lib/pdf-engine/fillSign';

// 1x1 PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));

async function fixture(rotate = 0) {
  const d = await PDFDocument.create();
  const p = d.addPage([612, 792]); p.setRotation(degrees(rotate));
  d.getForm().createTextField('name').addToPage(p, { x: 50, y: 50, width: 100, height: 20 });
  return d.save();
}

describe('Fill & Sign', () => {
  it('places signature, text, date and check; keeps form fields; original untouched', async () => {
    const src = await fixture();
    const copy = src.slice();
    const out = await applyFillSign(src, [
      { id: '1', page: 0, kind: 'signature', x: 0.1, y: 0.8, w: 0.3, h: 0.06, png: PNG },
      { id: '2', page: 0, kind: 'text', x: 0.1, y: 0.1, w: 0.3, h: 0.03, text: 'Policy 123' },
      { id: '3', page: 0, kind: 'check', x: 0.5, y: 0.5, w: 0.03, h: 0.03 },
    ]);
    expect(src).toEqual(copy);
    const re = await PDFDocument.load(out);
    expect(re.getForm().getFields().map(f => f.getName())).toEqual(['name']);
    expect(out.length).toBeGreaterThan(src.length);
  });
  it('works on rotated pages', async () => {
    const out = await applyFillSign(await fixture(90), [{ id: '1', page: 0, kind: 'initials', x: 0.1, y: 0.1, w: 0.1, h: 0.05, png: PNG }]);
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(90);
  });
  it('blocks unsupported characters instead of substituting', async () => {
    await expect(applyFillSign(await fixture(), [{ id: '1', page: 0, kind: 'text', x: 0, y: 0, w: 0.2, h: 0.03, text: '签名' }])).rejects.toThrow(/Nothing was saved/);
  });
});
