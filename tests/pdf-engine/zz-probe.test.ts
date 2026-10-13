import { it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { readPageText } from '@/lib/pdf-engine/contentTextEdit';
it('probe', async () => {
  for (const f of ['a1','a2','a3','a4','a5','a6']) {
    const b = Uint8Array.from(readFileSync(`/tmp/acord/${f}.pdf`));
    try {
      const d = await PDFDocument.load(b, { updateMetadata: false, ignoreEncryption: true });
      const pt = readPageText(d, 0);
      const fonts = Object.values(pt.fonts).map(x => `${x.key}:${x.baseFont}:${x.editable ? 'OK' : x.reason}`);
      console.log(f, 'enc', d.isEncrypted, 'segs', pt.segments.length, pt.blocked ?? '', '\n  ', fonts.join('\n   '), '\n  sample:', pt.segments.slice(0,5).map(s=>s.text).join(' | '));
    } catch (e) { console.log(f, 'ERR', (e as Error).stack?.split('\n').slice(0,8).join('\n')); }
  }
}, 60000);
