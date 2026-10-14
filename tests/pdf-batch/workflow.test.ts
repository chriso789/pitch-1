import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { runWorkflow, resolvePages, validateSteps } from '@/lib/pdf-batch/workflow';

async function make(n: number) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([600, 800]);
  d.setTitle('Secret'); d.setAuthor('Someone');
  return d.save();
}

describe('pdf batch workflow', () => {
  it('resolves page ranges and rejects bad ones', () => {
    expect(resolvePages('all', 3)).toEqual([0, 1, 2]);
    expect(resolvePages('1-2, 2,3', 3)).toEqual([0, 1, 2]);
    expect(() => resolvePages('4', 3)).toThrow();
    expect(() => resolvePages('x', 3)).toThrow();
  });
  it('validates steps', () => {
    expect(validateSteps([])).toBeTruthy();
    expect(validateSteps([{ type: 'watermark', text: 'Ωmega', opacity: 0.3 }])).toMatch(/font/);
    expect(validateSteps([{ type: 'page_numbers', format: 'Page' }])).toMatch(/\{n\}/);
    expect(validateSteps([{ type: 'strip_metadata' }])).toBeNull();
  });
  it('chains steps and reopens the output', async () => {
    const r = await runWorkflow(await make(4), [
      { type: 'keep_pages', pages: '1-3' },
      { type: 'rotate', pages: '2', angle: 90 },
      { type: 'page_numbers', format: 'Page {n} of {total}' },
      { type: 'watermark', text: 'DRAFT', opacity: 0.2 },
      { type: 'strip_metadata' },
    ]);
    expect(r.pagesIn).toBe(4);
    expect(r.pagesOut).toBe(3);
    const d = await PDFDocument.load(r.bytes, { updateMetadata: false });
    expect(d.getPage(1).getRotation().angle).toBe(90);
    expect(d.getAuthor() ?? '').toBe('');
    expect(r.log).toHaveLength(5);
  });
});

describe('pdf batch ocr hook', () => {
  it('runs the injected OCR step and refuses without it', async () => {
    const src = await make(2);
    await expect(runWorkflow(src, [{ type: 'ocr' }])).rejects.toThrow(/not available/);
    const r = await runWorkflow(src, [{ type: 'ocr' }, { type: 'keep_pages', pages: '1' }], { ocr: async b => ({ bytes: b, note: 'ocr ran' }) });
    expect(r.log[0]).toBe('ocr ran');
    expect(r.pagesOut).toBe(1);
    expect(validateSteps([{ type: 'ocr' }, { type: 'ocr' }])).toMatch(/one step/);
  });
});
