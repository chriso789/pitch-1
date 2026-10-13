import { it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readPageText } from '@/lib/pdf-engine/contentTextEdit';
import { openForEditing } from '@/lib/pdf-engine/decrypt';
it('probe', async () => {
  const b = Uint8Array.from(readFileSync(`/tmp/acord/a1.pdf`));
  const r = await openForEditing(b, { wasmPath: resolve('node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm') });
  const d = await PDFDocument.load(r.bytes);
  const pt = readPageText(d, 0);
  console.log(r.decrypted, pt.segments.length, Object.values(pt.fonts).map(f=>f.baseFont+':'+(f.reason??'OK')), pt.segments.slice(0,4).map(s=>s.text));
}, 60000);
