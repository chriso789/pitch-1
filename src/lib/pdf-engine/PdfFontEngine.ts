/**
 * PITCH PDF Font Engine
 * Manages embedded/subset font detection, fallback mapping,
 * metric matching, and kerning approximation.
 * No external font SDKs — pure internal engine.
 */

import { supabase } from '@/integrations/supabase/client';

export interface PdfFontInfo {
  id: string;
  pdf_document_id: string;
  font_name: string | null;
  font_family: string | null;
  embedded: boolean;
  subset: boolean;
  font_metadata: Record<string, unknown>;
  replacement_font: string | null;
  created_at: string;
}

/** Standard font fallback mapping for common PDF fonts */
const FONT_FALLBACK_MAP: Record<string, string> = {
  'Arial': 'Helvetica',
  'ArialMT': 'Helvetica',
  'Arial-BoldMT': 'Helvetica-Bold',
  'Arial-ItalicMT': 'Helvetica-Oblique',
  'TimesNewRomanPSMT': 'Times-Roman',
  'TimesNewRoman': 'Times-Roman',
  'TimesNewRomanPS-BoldMT': 'Times-Bold',
  'CourierNewPSMT': 'Courier',
  'Calibri': 'Helvetica',
  'Calibri-Bold': 'Helvetica-Bold',
  'Cambria': 'Times-Roman',
  'Verdana': 'Helvetica',
  'Georgia': 'Times-Roman',
  'Tahoma': 'Helvetica',
  'TrebuchetMS': 'Helvetica',
  'SegoeUI': 'Helvetica',
};

/** Approximate width ratios for common fonts relative to Helvetica */
const FONT_WIDTH_RATIOS: Record<string, number> = {
  'Helvetica': 1.0,
  'Helvetica-Bold': 1.05,
  'Times-Roman': 0.92,
  'Times-Bold': 0.95,
  'Courier': 1.2,
  'Courier-Bold': 1.2,
};

export class PdfFontEngine {
  /**
   * Extract font information from parsed PDF objects and persist.
   */
  static async extractAndPersistFonts(
    pdfDocumentId: string,
    objects: Array<{ font_info?: Record<string, unknown> }>
  ): Promise<PdfFontInfo[]> {
    const fontSet = new Map<string, { embedded: boolean; subset: boolean; metadata: Record<string, unknown> }>();

    for (const obj of objects) {
      const fi = obj.font_info as any;
      if (!fi?.fontFamily) continue;
      const name = fi.fontFamily;
      if (!fontSet.has(name)) {
        fontSet.set(name, {
          embedded: !!fi.embedded,
          subset: name.includes('+') || !!fi.subset,
          metadata: {
            fontSize: fi.fontSize,
            fontWeight: fi.fontWeight,
            color: fi.color,
          },
        });
      }
    }

    const rows = Array.from(fontSet.entries()).map(([fontName, info]) => ({
      pdf_document_id: pdfDocumentId,
      font_name: fontName,
      font_family: this.extractFontFamily(fontName),
      embedded: info.embedded,
      subset: info.subset,
      font_metadata: info.metadata,
      replacement_font: this.findReplacementFont(fontName),
    }));

    if (rows.length === 0) return [];

    const { data, error } = await (supabase as any)
      .from('pdf_fonts')
      .insert(rows)
      .select();

    if (error) {
      console.warn('[PdfFontEngine] Failed to persist fonts:', error);
      return [];
    }
    return data || [];
  }

  /**
   * Load fonts for a document.
   */
  static async loadFonts(pdfDocumentId: string): Promise<PdfFontInfo[]> {
    const { data, error } = await (supabase as any)
      .from('pdf_fonts')
      .select('*')
      .eq('pdf_document_id', pdfDocumentId);
    if (error) throw error;
    return data || [];
  }

  /**
   * Get the best replacement font for reconstruction.
   */
  static findReplacementFont(fontName: string): string {
    // Check direct mapping first
    if (FONT_FALLBACK_MAP[fontName]) return FONT_FALLBACK_MAP[fontName];

    // Strip subset prefix (e.g., "ABCDEF+Arial" → "Arial")
    const stripped = fontName.includes('+') ? fontName.split('+')[1] : fontName;
    if (FONT_FALLBACK_MAP[stripped]) return FONT_FALLBACK_MAP[stripped];

    // Heuristic matching
    const lower = stripped.toLowerCase();
    if (lower.includes('arial') || lower.includes('helvetica') || lower.includes('sans')) return 'Helvetica';
    if (lower.includes('times') || lower.includes('serif') || lower.includes('roman')) return 'Times-Roman';
    if (lower.includes('courier') || lower.includes('mono')) return 'Courier';

    // Default fallback
    return 'Helvetica';
  }

  /**
   * Extract base font family from a PDF font name.
   */
  static extractFontFamily(fontName: string): string {
    let name = fontName.includes('+') ? fontName.split('+')[1] : fontName;
    // Remove style suffixes
    name = name.replace(/-?(Bold|Italic|Oblique|Regular|Medium|Light|Semibold|ExtraBold|BoldItalic|BoldOblique)$/i, '');
    return name || fontName;
  }

  /**
   * Calculate approximate width multiplier for text replacement.
   * Ensures replaced text occupies roughly the same space.
   */
  static getWidthRatio(originalFont: string, replacementFont: string): number {
    const origRatio = FONT_WIDTH_RATIOS[originalFont] || 1.0;
    const replRatio = FONT_WIDTH_RATIOS[replacementFont] || 1.0;
    return origRatio / replRatio;
  }

  /**
   * Estimate text width in PDF points for a given font and size.
   */
  static estimateTextWidth(text: string, fontSize: number, fontName: string): number {
    const avgCharWidth = fontSize * 0.5; // Rough average for proportional fonts
    const ratio = FONT_WIDTH_RATIOS[fontName] || 1.0;
    return text.length * avgCharWidth * ratio;
  }

  /**
   * Get pdf-lib StandardFont name from our replacement font.
   */
  static toPdfLibStandardFont(replacementFont: string): string {
    const mapping: Record<string, string> = {
      'Helvetica': 'Helvetica',
      'Helvetica-Bold': 'HelveticaBold',
      'Helvetica-Oblique': 'HelveticaOblique',
      'Times-Roman': 'TimesRoman',
      'Times-Bold': 'TimesRomanBold',
      'Courier': 'Courier',
      'Courier-Bold': 'CourierBold',
    };
    return mapping[replacementFont] || 'Helvetica';
  }
}
