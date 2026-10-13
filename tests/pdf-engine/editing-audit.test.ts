// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { PDFDocument, StandardFonts, PDFName } from 'pdf-lib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { compileFromOperations } from '@/lib/pdf-engine/PdfCompiler';
import { compilePdf } from '@/lib/pdf-engine/compiler';
import { PdfBinaryRebuilder } from '@/lib/pdf-engine/PdfBinaryRebuilder';
import { readPdfFields, savePdfFields } from '@/lib/pdf-engine/formEditing';
import { inspectPageFonts } from '@/lib/pdf-engine/textCapabilities';
import type { PdfEngineObject, PdfEngineOperation } from '@/lib/pdf-engine/engineTypes';
import type { PdfObject, PdfOperation } from '@/lib/pdf-engine/types';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

async function fixture() {
  const doc = await PDFDocument.create(); const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('ORIGINAL AUDIT TEXT', { x: 60, y: 700, size: 12, font });
  return doc.save();
}
function extract(bytes: Uint8Array) {
  const dir = mkdtempSync(join(tmpdir(), 'pitch-pdf-audit-'));
  try { const file = join(dir, 'output.pdf'); writeFileSync(file, bytes); return execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const object = { id: 'text1', metadata: { page_number: 1 }, bounds: { x: 60, y: 700, width: 180, height: 12 }, font_info: { fontFamily: 'Helvetica', fontSize: 12 } } as PdfEngineObject;
const operation = { id: 'op1', operation_type: 'replace_text', target_object_id: 'text1', operation_payload: { replacement_text: 'NEW AUDIT TEXT' }, is_undone: false } as PdfEngineOperation;

describe('independent existing engine audit', () => {
  it('V2 compiler leaves original text extractable — proves replacement is an overlay', async () => {
    const bytes = await fixture(); const original = bytes.slice();
    const out = await compileFromOperations(bytes.slice().buffer as ArrayBuffer, [operation], [object]);
    expect(extract(out)).toContain('ORIGINAL AUDIT TEXT'); expect(extract(out)).toContain('NEW AUDIT TEXT');
    expect(bytes).toEqual(original);
  });
  it('workspace compiler also retains old text', async () => {
    const bytes = await fixture();
    const obj = { id: 'text1', z_index: 0, x: 60, y: 700, width: 180, height: 12, font_size: 12, font_color: null } as PdfObject;
    const op = { id: 'op1', operation_type: 'replace_text', target_object_id: 'text1', data: { new_text: 'NEW AUDIT TEXT' } } as PdfOperation;
    const out = await compilePdf(bytes.slice().buffer as ArrayBuffer, [op], [obj]);
    expect(extract(out)).toContain('ORIGINAL AUDIT TEXT'); expect(extract(out)).toContain('NEW AUDIT TEXT');
  });
  it('rebuilder never reports cosmetic replacement as true reconstruction', async () => {
    const bytes = await fixture();
    const result = await PdfBinaryRebuilder.reconstruct(bytes.slice().buffer as ArrayBuffer, [operation], [object], 'true_reconstruction');
    expect(result.mode).toBe('safe_overlay'); expect(result.objectsReconstructed).toBe(0); expect(result.warnings.join(' ')).toContain('not implemented');
    expect(extract(result.pdfBytes)).toContain('ORIGINAL AUDIT TEXT');
  });
  it('identifies standard fonts without inventing embedded programs', async () => {
    const fonts = await inspectPageFonts(await fixture(), 0);
    expect(fonts[0]).toMatchObject({ name: 'Helvetica', embedded: false, subset: false, complexEncoding: false });
  });
  it('flags embedded subset and Type0 encoding conservatively', async () => {
    const doc = await PDFDocument.create(); const page = doc.addPage(); const ctx = doc.context;
    const stream = ctx.register(ctx.stream(new Uint8Array([1, 2, 3])));
    page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: { Type: 'Font', Subtype: 'Type0', BaseFont: 'ABCDEF+AuditFont', Encoding: 'Identity-H', DescendantFonts: [{ FontDescriptor: { FontFile2: stream } }] } } }));
    expect((await inspectPageFonts(await doc.save(), 0))[0]).toMatchObject({ name: 'ABCDEF+AuditFont', subset: true, embedded: true, complexEncoding: true });
  });
  it('scanned image-only documents expose no font resources or fillable fields', async () => {
    const doc = await PDFDocument.create(); const page = doc.addPage();
    const png = await doc.embedPng('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    page.drawImage(png, { x: 0, y: 0, width: 612, height: 792 }); const bytes = await doc.save();
    expect(extract(bytes).trim()).toBe(''); expect(await inspectPageFonts(bytes, 0)).toEqual([]); expect(await readPdfFields(bytes)).toEqual([]);
  });
});

describe('genuine AcroForm editing', () => {
  it('changes field values, saves a new binary, and reopens with page text unchanged', async () => {
    const doc = await PDFDocument.load(await fixture()); const page = doc.getPage(0); const form = doc.getForm();
    const text = form.createTextField('Insured'); text.setText('Old company'); text.addToPage(page, { x: 60, y: 550, width: 260, height: 30 });
    const checkbox = form.createCheckBox('Confirmed'); checkbox.addToPage(page, { x: 60, y: 500, width: 20, height: 20 });
    const dropdown = form.createDropdown('Coverage'); dropdown.addOptions(['Roofing', 'General']); dropdown.select('General'); dropdown.addToPage(page, { x: 60, y: 450, width: 260, height: 30 });
    const bytes = await doc.save(); const original = bytes.slice();
    const out = await savePdfFields(bytes, { Insured: 'New company', Confirmed: true, Coverage: 'Roofing' });
    expect(await readPdfFields(out)).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Insured', value: 'New company' }), expect.objectContaining({ name: 'Confirmed', value: true }), expect.objectContaining({ name: 'Coverage', value: 'Roofing' })]));
    const textOut = extract(out); expect(textOut).toContain('New company'); expect(textOut).not.toContain('Old company'); expect(textOut).toContain('ORIGINAL AUDIT TEXT');
    expect(bytes).toEqual(original);
  });
  it('blocks unsupported Unicode, read-only fields, and invalid choices', async () => {
    const doc = await PDFDocument.create(); const page = doc.addPage(); const form = doc.getForm();
    const field = form.createTextField('Name'); field.addToPage(page); const locked = form.createTextField('Locked'); locked.enableReadOnly();
    const choice = form.createDropdown('Choice'); choice.addOptions(['A']);
    const bytes = await doc.save();
    await expect(savePdfFields(bytes, { Name: '屋根' })).rejects.toThrow('No file was saved');
    await expect(savePdfFields(bytes, { Locked: 'change' })).rejects.toThrow('read-only');
    await expect(savePdfFields(bytes, { Choice: 'B' })).rejects.toThrow('Invalid choice');
  });
});