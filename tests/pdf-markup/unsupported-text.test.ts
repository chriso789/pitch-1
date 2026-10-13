import { it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { writeMarkups } from '@/lib/pdf-markup/markups';

it('blocks unsupported markup characters instead of exporting question marks', async () => {
  const doc = await PDFDocument.create(); doc.addPage(); const bytes = await doc.save();
  await expect(writeMarkups(bytes, [{ id: 'unicode', page: 0, type: 'text', center: [100, 100], w: 100, h: 50, text: '屋根', color: [0, 0, 0], width: 0, opacity: 1, author: 'Test', createdAt: '2026-10-13T00:00:00Z' }])).rejects.toThrow('No characters were substituted');
});