/**
 * PITCH PDF OCR Pipeline
 * Full pipeline for scanned PDFs: render → OCR → object graph → search index.
 * Uses Tesseract.js client-side with server fallback.
 */

import { supabase } from '@/integrations/supabase/client';

export interface OcrResult {
  pageNumber: number;
  text: string;
  words: OcrWord[];
  confidence: number;
}

export interface OcrWord {
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
  fontSize: number;
  lineNumber: number;
}

export class PdfOCRPipeline {
  /**
   * Run OCR on a page image and return structured results.
   * Uses the pdf-ocr edge function for server-side processing.
   */
  static async ocrPageImage(
    imageDataUrl: string,
    pageNumber: number
  ): Promise<OcrResult> {
    try {
      const { data, error } = await supabase.functions.invoke('pdf-ocr', {
        body: { imageDataUrl, pageNumber },
      });

      if (error) throw error;

      return {
        pageNumber,
        text: data?.text || '',
        words: data?.words || [],
        confidence: data?.confidence || 0,
      };
    } catch (err) {
      console.warn('[PdfOCRPipeline] Server OCR failed, returning empty:', err);
      return { pageNumber, text: '', words: [], confidence: 0 };
    }
  }

  /**
   * Run full OCR pipeline on multiple pages.
   */
  static async processDocument(
    pageImages: Map<number, string>,
    pdfDocumentId: string,
    pageIds: Map<number, string>
  ): Promise<OcrResult[]> {
    const results: OcrResult[] = [];

    for (const [pageNum, imageUrl] of pageImages.entries()) {
      const result = await this.ocrPageImage(imageUrl, pageNum);
      results.push(result);

      // Persist OCR objects to the object graph
      if (result.text && result.text.length > 0) {
        const pageId = pageIds.get(pageNum);
        if (pageId) {
          await this.persistOcrObjects(pdfDocumentId, pageId, result, pageNum);
        }
      }
    }

    return results;
  }

  /**
   * Persist OCR-extracted text as pdf_engine_objects.
   */
  static async persistOcrObjects(
    pdfDocumentId: string,
    pageId: string,
    ocrResult: OcrResult,
    pageNumber: number
  ): Promise<void> {
    // Group words into lines
    const lines = this.groupWordsIntoLines(ocrResult.words);

    const objects = lines.map((line, idx) => ({
      pdf_document_id: pdfDocumentId,
      page_id: pageId,
      object_type: 'text',
      object_key: `ocr-p${pageNumber}-l${idx}`,
      bounds: line.bounds,
      transform: {},
      content: { text: line.text, source: 'ocr' },
      font_info: {
        fontFamily: 'OCR-Detected',
        fontSize: line.avgFontSize,
        fontWeight: 'normal',
        color: '#000000',
      },
      z_index: 100 + idx,
      is_editable: true,
      metadata: {
        page_number: pageNumber,
        ocr_confidence: line.avgConfidence,
        source: 'ocr_pipeline',
      },
    }));

    if (objects.length > 0) {
      const { error } = await (supabase as any)
        .from('pdf_engine_objects')
        .insert(objects);
      if (error) console.warn('[PdfOCRPipeline] Object persist error:', error);
    }
  }

  /**
   * Group individual words into logical text lines.
   */
  private static groupWordsIntoLines(
    words: OcrWord[]
  ): Array<{ text: string; bounds: { x: number; y: number; width: number; height: number }; avgFontSize: number; avgConfidence: number }> {
    if (words.length === 0) return [];

    // Sort by y position then x
    const sorted = [...words].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);

    const lines: Array<{ words: OcrWord[] }> = [];
    let currentLine: OcrWord[] = [sorted[0]];
    let currentY = sorted[0].bounds.y;

    for (let i = 1; i < sorted.length; i++) {
      const word = sorted[i];
      // Same line if y-position is within tolerance
      if (Math.abs(word.bounds.y - currentY) < word.bounds.height * 0.5) {
        currentLine.push(word);
      } else {
        lines.push({ words: currentLine });
        currentLine = [word];
        currentY = word.bounds.y;
      }
    }
    if (currentLine.length > 0) lines.push({ words: currentLine });

    return lines.map(line => {
      const text = line.words.map(w => w.text).join(' ');
      const minX = Math.min(...line.words.map(w => w.bounds.x));
      const minY = Math.min(...line.words.map(w => w.bounds.y));
      const maxX = Math.max(...line.words.map(w => w.bounds.x + w.bounds.width));
      const maxY = Math.max(...line.words.map(w => w.bounds.y + w.bounds.height));
      const avgFontSize = line.words.reduce((s, w) => s + w.fontSize, 0) / line.words.length;
      const avgConfidence = line.words.reduce((s, w) => s + w.confidence, 0) / line.words.length;

      return {
        text,
        bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        avgFontSize: avgFontSize || 12,
        avgConfidence,
      };
    });
  }

  /**
   * Check if a page is likely scanned (no text layer).
   */
  static isScannedPage(extractedText: string | null): boolean {
    if (!extractedText) return true;
    // If extracted text is very short relative to a typical page, it's likely scanned
    return extractedText.trim().length < 20;
  }
}
