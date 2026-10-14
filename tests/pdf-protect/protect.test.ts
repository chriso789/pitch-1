import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { protectPdf, unprotectPdf, stripMetadata, validatePasswords, ALL_ALLOWED } from '@/lib/pdf-protect/protect';

const wasmPath = resolve('node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm');
const make = async () => { const d = await PDFDocument.create(); d.addPage([200, 200]); d.setTitle('Secret plans'); d.setAuthor('Jane'); return d.save(); };

describe('PDF protection', () => {
  it('rejects weak or reused passwords', () => {
    expect(validatePasswords('', 'short')).toMatch(/8/);
    expect(validatePasswords('samesame', 'samesame')).toMatch(/different/);
    expect(validatePasswords('', 'longenough')).toBeNull();
  });
  it('encrypts, refuses a wrong password, and unlocks with the right one', async () => {
    const enc = await protectPdf(await make(), 'open123', 'owner-pass-1', { ...ALL_ALLOWED, copy: false }, { wasmPath });
    const probe = await PDFDocument.load(enc, { ignoreEncryption: true });
    expect(probe.isEncrypted).toBe(true);
    await expect(unprotectPdf(enc, 'wrong', { wasmPath })).rejects.toThrow(/not correct/);
    const plain = await unprotectPdf(enc, 'open123', { wasmPath });
    expect((await PDFDocument.load(plain)).getPageCount()).toBe(1);
  }, 30000);
  it('strips metadata without touching pages', async () => {
    const r = await stripMetadata(await make());
    expect(r.removed).toEqual(expect.arrayContaining(['Title', 'Author']));
    const d = await PDFDocument.load(r.bytes, { updateMetadata: false });
    expect(d.getTitle()).toBeUndefined(); expect(d.getPageCount()).toBe(1);
  });
});
