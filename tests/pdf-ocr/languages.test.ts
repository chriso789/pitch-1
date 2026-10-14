import { describe, it, expect } from 'vitest';
import { ocrLangString } from '@/lib/pdf-ocr/languages';
import { partitionWords } from '@/lib/pdf-ocr/searchableLayer';
describe('OCR languages', () => {
  it('always includes English and drops unknown codes', () => {
    expect(ocrLangString(undefined)).toBe('eng');
    expect(ocrLangString(['spa', 'xxx', 'spa', 'fra'])).toBe('eng+spa+fra');
  });
  it('keeps accented Latin words in the searchable layer', () => {
    const w = (text: string) => ({ text, x0: 0, y0: 0, x1: 1, y1: 1, confidence: 90 });
    expect(partitionWords([w('Techo'), w('Größe'), w('façade'), w('ação')]).ok).toHaveLength(4);
  });
});
