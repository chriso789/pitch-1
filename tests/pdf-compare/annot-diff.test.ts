import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { listAnnots, diffAnnots } from '@/lib/pdf-compare/annotDiff';

async function make(notes: { rect: number[]; text: string }[]) {
  const doc = await PDFDocument.create(); const p = doc.addPage([600, 400]);
  const refs = notes.map(n => doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: n.rect, Contents: PDFString.of(n.text) })));
  p.node.set(PDFName.of('Annots'), doc.context.obj(refs));
  return doc.save();
}

describe('annotation diff', () => {
  it('finds added, removed and changed comments', async () => {
    const a = await listAnnots(await make([{ rect: [10, 10, 30, 30], text: 'keep' }, { rect: [50, 50, 70, 70], text: 'old' }, { rect: [100, 100, 120, 120], text: 'gone' }]), 0);
    const b = await listAnnots(await make([{ rect: [10, 10, 30, 30], text: 'keep' }, { rect: [51, 50, 70, 70], text: 'new' }, { rect: [200, 200, 220, 220], text: 'fresh' }]), 0);
    const d = diffAnnots(a, b);
    expect(d.unchanged).toBe(1);
    expect(d.changed.map(c => c.after.contents)).toEqual(['new']);
    expect(d.added.map(x => x.contents)).toEqual(['fresh']);
    expect(d.removed.map(x => x.contents)).toEqual(['gone']);
  });
});
