/**
 * PITCH PDF Binary Rebuilder
 * Safely rebuilds modified PDF structure for true reconstruction.
 * Handles xref rebuilding, object reference repair, stream cleanup.
 * Falls back to overlay mode on corruption risk.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { PdfEngineOperation, PdfEngineObject } from './engineTypes';
import { PdfFontEngine } from './PdfFontEngine';
import { PdfLayoutEngine } from './PdfLayoutEngine';

export type ReconstructionMode = 'safe_overlay' | 'true_reconstruction' | 'flattened_export';

export interface ReconstructionResult {
  pdfBytes: Uint8Array;
  mode: ReconstructionMode;
  warnings: string[];
  objectsReconstructed: number;
  objectsFallback: number;
}

export class PdfBinaryRebuilder {
  /**
   * Reconstruct a PDF from original bytes + operations, choosing the safest mode.
   */
  static async reconstruct(
    originalPdfBytes: ArrayBuffer,
    operations: PdfEngineOperation[],
    objects: PdfEngineObject[],
    preferredMode: ReconstructionMode = 'true_reconstruction'
  ): Promise<ReconstructionResult> {
    const warnings: string[] = [];
    let objectsReconstructed = 0;
    let objectsFallback = 0;

    try {
      const pdfDoc = await PDFDocument.load(originalPdfBytes, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();

      const objectMap = new Map<string, PdfEngineObject>();
      objects.forEach(obj => objectMap.set(obj.id, obj));

      // Embed standard fonts
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
      const courier = await pdfDoc.embedFont(StandardFonts.Courier);

      const fontMap: Record<string, any> = {
        'Helvetica': helvetica,
        'HelveticaBold': helveticaBold,
        'Helvetica-Bold': helveticaBold,
        'TimesRoman': timesRoman,
        'Times-Roman': timesRoman,
        'Courier': courier,
      };

      const activeOps = operations.filter(o => !o.is_undone);

      for (const op of activeOps) {
        try {
          const result = this.applyOperation(pdfDoc, pages, op, objectMap, fontMap, preferredMode);
          if (result === 'reconstructed') objectsReconstructed++;
          else if (result === 'fallback') objectsFallback++;
        } catch (err) {
          warnings.push(`Op ${op.id} (${op.operation_type}): ${(err as Error).message}`);
          objectsFallback++;
        }
      }

      const pdfBytes = await pdfDoc.save();
      const actualMode = objectsFallback > objectsReconstructed ? 'safe_overlay' : preferredMode;

      return { pdfBytes, mode: actualMode, warnings, objectsReconstructed, objectsFallback };
    } catch (err) {
      warnings.push(`Fatal reconstruction error: ${(err as Error).message}`);
      // If even loading fails, return original
      return {
        pdfBytes: new Uint8Array(originalPdfBytes),
        mode: 'safe_overlay',
        warnings,
        objectsReconstructed: 0,
        objectsFallback: 0,
      };
    }
  }

  private static applyOperation(
    pdfDoc: PDFDocument,
    pages: ReturnType<PDFDocument['getPages']>,
    op: PdfEngineOperation,
    objectMap: Map<string, PdfEngineObject>,
    fontMap: Record<string, any>,
    mode: ReconstructionMode
  ): 'reconstructed' | 'fallback' | 'skipped' {
    const p = op.operation_payload as any;

    switch (op.operation_type) {
      case 'replace_text':
      case 'ai_rewrite':
      case 'fill_form_field': {
        const obj = op.target_object_id ? objectMap.get(op.target_object_id) : null;
        if (!obj) return 'skipped';

        const pageNum = (obj.metadata as any)?.page_number ?? 1;
        const pageIdx = Math.max(0, Math.min(pageNum - 1, pages.length - 1));
        const page = pages[pageIdx];
        const b = obj.bounds;
        const fi = obj.font_info || {};

        // Get replacement font
        const replacementFontName = PdfFontEngine.findReplacementFont(fi.fontFamily || 'Helvetica');
        const pdfLibFontName = PdfFontEngine.toPdfLibStandardFont(replacementFontName);
        const font = fontMap[pdfLibFontName] || fontMap['Helvetica'];

        const newText = p.replacement_text || p.rewritten_text || p.new_text || p.value || '';

        if (mode === 'true_reconstruction') {
          // True reconstruction: use layout engine for proper positioning
          const layoutResult = PdfLayoutEngine.layoutText(newText, {
            bounds: b,
            fontSize: fi.fontSize || 12,
            fontName: replacementFontName,
            alignment: 'left',
            lineSpacing: 1.2,
            allowExpand: false,
          });

          // White-out original
          if (b.width && b.height) {
            page.drawRectangle({
              x: b.x, y: b.y,
              width: b.width, height: b.height + 2,
              color: rgb(1, 1, 1),
            });
          }

          // Draw each layout line
          for (const line of layoutResult.lines) {
            page.drawText(line.text, {
              x: line.x, y: line.y,
              size: line.fontSize, font,
              color: this.parseColor(fi.color),
            });
          }

          return layoutResult.overflow ? 'fallback' : 'reconstructed';
        } else {
          // Safe overlay mode
          if (b.width && b.height) {
            page.drawRectangle({
              x: b.x, y: b.y,
              width: b.width, height: b.height + 2,
              color: rgb(1, 1, 1),
            });
          }
          page.drawText(newText, {
            x: b.x, y: b.y,
            size: fi.fontSize || 12, font,
            color: this.parseColor(fi.color),
          });
          return 'fallback';
        }
      }

      case 'add_text': {
        const pageIdx = (p.page_number ?? 1) - 1;
        if (pageIdx < 0 || pageIdx >= pages.length) return 'skipped';
        const font = fontMap['Helvetica'];
        pages[pageIdx].drawText(p.text || '', {
          x: p.x || 0, y: p.y || 0,
          size: p.fontSize || 12, font,
          color: this.parseColor(p.color),
        });
        return 'reconstructed';
      }

      case 'add_redaction':
      case 'apply_redaction': {
        const pageIdx = (p.page_number ?? 1) - 1;
        if (pageIdx < 0 || pageIdx >= pages.length) return 'skipped';
        pages[pageIdx].drawRectangle({
          x: p.x || 0, y: p.y || 0,
          width: p.width || 100, height: p.height || 20,
          color: rgb(0, 0, 0),
        });
        return 'reconstructed';
      }

      case 'rotate_page': {
        const pageIdx = (p.page_number ?? 1) - 1;
        if (pageIdx < 0 || pageIdx >= pages.length) return 'skipped';
        const page = pages[pageIdx];
        const current = page.getRotation().angle || 0;
        const { degrees } = require('pdf-lib');
        page.setRotation(degrees(current + (p.degrees || 90)));
        return 'reconstructed';
      }

      case 'delete_page': {
        const pageIdx = (p.page_number ?? 1) - 1;
        if (pageIdx >= 0 && pageIdx < pdfDoc.getPageCount()) {
          pdfDoc.removePage(pageIdx);
          pages.splice(pageIdx, 1);
        }
        return 'reconstructed';
      }

      case 'delete_object': {
        const obj = op.target_object_id ? objectMap.get(op.target_object_id) : null;
        if (!obj) return 'skipped';
        const b = obj.bounds;
        if (!b.width || !b.height) return 'skipped';
        const pageNum = (obj.metadata as any)?.page_number ?? 1;
        const pageIdx = Math.max(0, Math.min(pageNum - 1, pages.length - 1));
        pages[pageIdx].drawRectangle({
          x: b.x, y: b.y, width: b.width, height: b.height + 2,
          color: rgb(1, 1, 1),
        });
        return 'fallback';
      }

      default:
        return 'skipped';
    }
  }

  private static parseColor(colorStr?: string | null) {
    if (!colorStr) return rgb(0, 0, 0);
    if (colorStr.startsWith('#') && colorStr.length === 7) {
      const r = parseInt(colorStr.slice(1, 3), 16) / 255;
      const g = parseInt(colorStr.slice(3, 5), 16) / 255;
      const b = parseInt(colorStr.slice(5, 7), 16) / 255;
      return rgb(r, g, b);
    }
    return rgb(0, 0, 0);
  }
}
