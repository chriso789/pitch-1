// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { imagesToPdf, sniffImage, fitBox, htmlToBlocks, blocksToPdf, unsupportedChars } from '@/lib/pdf-convert/toPdf';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwH4QZYAwAX8YH+UJAAj8AAAAASUVORK5CYII='), c => c.charCodeAt(0));

describe('image → PDF', () => {
  it('detects formats and makes one page per image, landscape when wide', async () => {
    expect(sniffImage(PNG)).toBe('png');
    const out = await imagesToPdf([{ name: 'a', bytes: PNG, kind: 'png' }, { name: 'b', bytes: PNG, kind: 'png' }], { pageSize: 'letter' });
    const pdf = await PDFDocument.load(out);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getWidth()).toBe(792);
  });
  it('never upscales small images', () => { expect(fitBox(100, 50, 500, 500)).toEqual({ width: 100, height: 50 }); });
});

describe('Word → PDF', () => {
  it('turns headings, lists, tables into pages', async () => {
    const blocks = htmlToBlocks('<h1>Scope</h1><p>Hello <strong>bold</strong></p><ul><li>One</li><li>Two</li></ul><table><tr><td>A</td><td>B</td></tr></table>');
    expect(blocks.map(b => b.type)).toEqual(['heading', 'para', 'para', 'para', 'row']);
    const pdf = await PDFDocument.load(await blocksToPdf(blocks, 'Test'));
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe('Test');
  });
  it('blocks characters the fonts cannot draw instead of substituting', async () => {
    const blocks = htmlToBlocks('<p>Roof 屋根</p>');
    const f = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    expect(unsupportedChars(blocks, f)).toEqual(['屋', '根']);
    await expect(blocksToPdf(blocks)).rejects.toThrow(/Nothing was converted/);
  });
});
