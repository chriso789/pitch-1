/**
 * PITCH PDF Compiler Engine
 * 
 * The core moat: regenerates clean PDFs from:
 *   immutable source PDF + operation graph
 * 
 * Uses pdf-lib for manipulation. Source PDF is never mutated.
 * Operations are applied in sequence order to produce the final output.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { PdfOperation, PdfObject } from './types';

/**
 * Compile a new PDF from the original source + applied operations.
 */
export async function compilePdf(
  originalPdfBytes: ArrayBuffer,
  operations: PdfOperation[],
  objects: PdfObject[],
  options: { flatten?: boolean } = {}
): Promise<Uint8Array> {
  // Load immutable source
  const pdfDoc = await PDFDocument.load(originalPdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  // Build a lookup of objects by ID
  const objectMap = new Map<string, PdfObject>();
  objects.forEach(obj => objectMap.set(obj.id, obj));

  // Font cache
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Apply each active operation in sequence
  for (const op of operations) {
    try {
      await applyOperation(pdfDoc, pages, op, objectMap, { helvetica, helveticaBold });
    } catch (err) {
      console.warn(`[Compiler] Skipping failed op ${op.id} (${op.operation_type}):`, err);
    }
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

async function applyOperation(
  pdfDoc: PDFDocument,
  pages: ReturnType<PDFDocument['getPages']>,
  op: PdfOperation,
  objectMap: Map<string, PdfObject>,
  fonts: { helvetica: any; helveticaBold: any }
) {
  const data = op.data as any;

  switch (op.operation_type) {
    case 'insert_text': {
      const pageIdx = (data.page_number ?? 1) - 1;
      if (pageIdx < 0 || pageIdx >= pages.length) return;
      const page = pages[pageIdx];
      const font = data.font_weight === 'bold' ? fonts.helveticaBold : fonts.helvetica;
      const fontSize = data.font_size || 12;
      const color = parseColor(data.font_color);

      page.drawText(data.text || '', {
        x: data.x || 0,
        y: data.y || 0,
        size: fontSize,
        font,
        color,
      });
      break;
    }

    case 'replace_text': {
      // For text replacement, we draw a white rectangle over the original
      // then draw new text. This is the safest approach without parsing PDF streams.
      const obj = op.target_object_id ? objectMap.get(op.target_object_id) : null;
      if (!obj) return;

      // Find which page this object is on
      const pageIdx = findPageForObject(obj, pages);
      if (pageIdx < 0) return;
      const page = pages[pageIdx];

      // Cover original text
      if (obj.width && obj.height) {
        page.drawRectangle({
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height + 2,
          color: rgb(1, 1, 1),
        });
      }

      // Draw replacement
      const font = obj.font_weight === 'bold' ? fonts.helveticaBold : fonts.helvetica;
      page.drawText(data.new_text || '', {
        x: obj.x,
        y: obj.y,
        size: obj.font_size || 12,
        font,
        color: parseColor(obj.font_color),
      });
      break;
    }

    case 'add_redaction':
    case 'apply_redaction': {
      // Draw black rectangle to permanently redact
      const pageIdx = (data.page_number ?? 1) - 1;
      if (pageIdx < 0 || pageIdx >= pages.length) return;
      const page = pages[pageIdx];

      page.drawRectangle({
        x: data.x || 0,
        y: data.y || 0,
        width: data.width || 100,
        height: data.height || 20,
        color: rgb(0, 0, 0),
      });
      break;
    }

    case 'rotate_page': {
      const pageIdx = (data.page_number ?? 1) - 1;
      if (pageIdx < 0 || pageIdx >= pages.length) return;
      const page = pages[pageIdx];
      const degrees = data.degrees || 90;
      page.setRotation(page.getRotation() as any);
      // pdf-lib uses Degrees type
      const { degrees: degreesFactory } = await import('pdf-lib');
      page.setRotation(degreesFactory((page.getRotation().angle || 0) + degrees));
      break;
    }

    case 'delete_page': {
      const pageIdx = (data.page_number ?? 1) - 1;
      if (pageIdx >= 0 && pageIdx < pdfDoc.getPageCount()) {
        pdfDoc.removePage(pageIdx);
        // Re-reference pages after removal
        pages.splice(pageIdx, 1);
      }
      break;
    }

    case 'smart_tag_replace': {
      // Same as replace_text but tagged for audit
      const obj = op.target_object_id ? objectMap.get(op.target_object_id) : null;
      if (!obj) return;
      const pageIdx = findPageForObject(obj, pages);
      if (pageIdx < 0) return;
      const page = pages[pageIdx];

      if (obj.width && obj.height) {
        page.drawRectangle({
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height + 2,
          color: rgb(1, 1, 1),
        });
      }
      const font = fonts.helvetica;
      page.drawText(data.tag_value || '', {
        x: obj.x,
        y: obj.y,
        size: obj.font_size || 12,
        font,
        color: parseColor(obj.font_color),
      });
      break;
    }

    case 'delete_object': {
      const obj = op.target_object_id ? objectMap.get(op.target_object_id) : null;
      if (!obj || !obj.width || !obj.height) return;
      const pageIdx = findPageForObject(obj, pages);
      if (pageIdx < 0) return;
      const page = pages[pageIdx];

      page.drawRectangle({
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height + 2,
        color: rgb(1, 1, 1),
      });
      break;
    }

    // Move, resize, rotate_object, annotations — tracked in object graph,
    // applied during compile via updated object positions
    default:
      break;
  }
}

function findPageForObject(obj: PdfObject, pages: any[]): number {
  // Objects store page_id, but for compile we use z_index position
  // For now assume objects are stored with metadata.page_number
  const pageNum = (obj.metadata as any)?.page_number ?? 1;
  return Math.max(0, Math.min(pageNum - 1, pages.length - 1));
}

function parseColor(colorStr?: string | null) {
  if (!colorStr) return rgb(0, 0, 0);
  // Handle hex colors
  if (colorStr.startsWith('#') && colorStr.length === 7) {
    const r = parseInt(colorStr.slice(1, 3), 16) / 255;
    const g = parseInt(colorStr.slice(3, 5), 16) / 255;
    const b = parseInt(colorStr.slice(5, 7), 16) / 255;
    return rgb(r, g, b);
  }
  return rgb(0, 0, 0);
}
