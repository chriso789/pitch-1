import { it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readPageText, replaceSegmentText, rewriteSegment, checkReplacement } from '@/lib/pdf-engine/contentTextEdit';
import { openForEditing } from '@/lib/pdf-engine/decrypt';
it('probe', async () => {
  for (const f of ['a1','a2','a3','a4','a5','a6']) {
  const b = Uint8Array.from(readFileSync(`/tmp/acord/${f}.pdf`));
  const r = await openForEditing(b, { wasmPath: resolve('node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm') });
  const pt = readPageText(await PDFDocument.load(r.bytes), 0);
  const seg = pt.segments.find(s => /CERTIFICATE HOLDER\.?\s*$/.test(s.text) || /REPRESENTATIVE OR PRODUCER/.test(s.text));
  const editable = pt.segments.filter(s => s.text.trim() && checkReplacement(pt, s, s.text.split('').reverse().join('')).ok).length;
  let msg = '';
  if (seg) {
    try { const o = await replaceSegmentText(r.bytes, 0, seg.id, seg.text.replace('HOLDER', 'HOLDERS')); msg += 'inplace OK; '; writeFileSync(`/tmp/acord/${f}-inplace.pdf`, o); } catch (e) { msg += 'inplace: ' + (e as Error).message + '; '; }
    try { const o = await rewriteSegment(r.bytes, 0, seg.id, { text: 'TEST MOVED TEXT', font: { kind: 'standard', name: StandardFonts.HelveticaBold }, size: 10, matrix: [8,0,0,8,40,400], dx: 0, dy: 0, color: [1,0,0] }); msg += 'rewrite OK'; writeFileSync(`/tmp/acord/${f}-rewrite.pdf`, o); } catch (e) { msg += 'rewrite: ' + (e as Error).message; }
  }
  console.log(f, r.decrypted, 'segs', pt.segments.length, 'reverse-editable', editable, JSON.stringify(seg?.text), seg?.dependentNext, msg);
  }
}, 60000);
