/**
 * PITCH PDF Compiler
 * Generates NEW PDFs from original + operation stream.
 * NEVER overwrites original PDF.
 */

import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import type { PdfEngineOperation, PdfEngineObject } from './engineTypes';

export async function compileFromOperations(
  originalPdfBytes: ArrayBuffer,
  operations: PdfEngineOperation[],
  objects: PdfEngineObject[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  const objectMap = new Map<string, PdfEngineObject>();
  objects.forEach(obj => objectMap.set(obj.id, obj));

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { helvetica, helveticaBold };

  for (const op of operations) {
    if (op.is_undone) continue;
    try {
      applyOp(pdfDoc, pages, op, objectMap, fonts);
    } catch (err) {
      console.warn(`[PdfCompiler] Skipping op ${op.id}:`, err);
    }
  }

  return await pdfDoc.save();
}

function applyOp(
  pdfDoc: PDFDocument,
  pages: ReturnType<PDFDocument['getPages']>,
  op: PdfEngineOperation,
  objectMap: Map<string, PdfEngineObject>,
  fonts: { helvetica: any; helveticaBold: any }
) {
  const p = op.operation_payload as any;

  switch (op.operation_type) {
    case 'add_text': {
      const pageIdx = (p.page_number ?? 1) - 1;
      if (pageIdx < 0 || pageIdx >= pages.length) return;
      const page = pages[pageIdx];
      page.drawText(p.text || '', {
        x: p.x || 0,
        y: p.y || 0,
        size: p.fontSize || 12,
        font: fonts.helvetica,
        color: parseColor(p.color),
      });
      break;
    }

    case 'replace_text': {
      const obj = op.target_object_id ? objectMap.get(op.target_object_id) : null;
      if (!obj) return;
      const pageNum = (obj.metadata as any)?.page_number ?? (obj.bounds as any)?.page_number ?? 1;
      const pageIdx = Math.max(0, Math.min(pageNum - 1, pages.length - 1));
      const page = pages[pageIdx];
      const b = obj.bounds;

      // White-out original
      if (b.width && b.height) {
        page.drawRectangle({
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height + 2,
          color: rgb(1, 1, 1),
        });
      }

      // Draw replacement
      const fi = obj.font_info || {};
      const font = fi.fontWeight === 'bold' ? fonts.helveticaBold : fonts.helvetica;
      page.drawText(p.replacement_text || p.new_text || '', {
        x: b.x,
        y: b.y,
        size: fi.fontSize || 12,
        font,
        color: parseColor(fi.color),
      });
      break;
    }

    case 'add_redaction':
    case 'apply_redaction': {
      const pageIdx = (p.page_number ?? 1) - 1;
      if (pageIdx < 0 || pageIdx >= pages.length) return;
      pages[pageIdx].drawRectangle({
        x: p.x || 0,
        y: p.y || 0,
        width: p.width || 100,
        height: p.height || 20,
        color: rgb(0, 0, 0),
      });
      break;
    }

    case 'rotate_page': {
      const pageIdx = (p.page_number ?? 1) - 1;
      if (pageIdx < 0 || pageIdx >= pages.length) return;
      const page = pages[pageIdx];
      const current = page.getRotation().angle || 0;
      page.setRotation(degrees(current + (p.degrees || 90)));
      break;
    }

    case 'delete_page': {
      const pageIdx = (p.page_number ?? 1) - 1;
      if (pageIdx >= 0 && pageIdx < pdfDoc.getPageCount()) {
        pdfDoc.removePage(pageIdx);
        pages.splice(pageIdx, 1);
      }
      break;
    }

    case 'delete_object': {
      const obj = op.target_object_id ? objectMap.get(op.target_object_id) : null;
      if (!obj) return;
      const b = obj.bounds;
      if (!b.width || !b.height) return;
      const pageNum = (obj.metadata as any)?.page_number ?? 1;
      const pageIdx = Math.max(0, Math.min(pageNum - 1, pages.length - 1));
      pages[pageIdx].drawRectangle({
        x: b.x, y: b.y, width: b.width, height: b.height + 2,
        color: rgb(1, 1, 1),
      });
      break;
    }

    case 'add_annotation': {
      const pageIdx = (p.page_number ?? 1) - 1;
      if (pageIdx < 0 || pageIdx >= pages.length) return;
      pages[pageIdx].drawRectangle({
        x: p.x || 0, y: p.y || 0,
        width: p.width || 100, height: p.height || 20,
        color: rgb(1, 0.92, 0),
        opacity: 0.3,
      });
      break;
    }

    default:
      break;
  }
}

function parseColor(colorStr?: string | null) {
  if (!colorStr) return rgb(0, 0, 0);
  if (colorStr.startsWith('#') && colorStr.length === 7) {
    const r = parseInt(colorStr.slice(1, 3), 16) / 255;
    const g = parseInt(colorStr.slice(3, 5), 16) / 255;
    const b = parseInt(colorStr.slice(5, 7), 16) / 255;
    return rgb(r, g, b);
  }
  return rgb(0, 0, 0);
}
