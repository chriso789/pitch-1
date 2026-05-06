/**
 * PITCH PDF OCR Engine
 * Client-side OCR using Tesseract.js for scanned PDF pages.
 * Extracts text from rendered page images and creates text objects.
 */

import { supabase } from '@/integrations/supabase/client';
import type { PdfEnginePage } from './engineTypes';

export interface OcrResult {
  pageNumber: number;
  text: string;
  words: OcrWord[];
  confidence: number;
}

export interface OcrWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  line: number;
}

/**
 * Run OCR on a rendered page image using the pdf-ocr edge function.
 */
export async function ocrPageImage(
  imageDataUrl: string,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  renderScale: number = 1.5
): Promise<OcrResult> {
  // Convert data URL to base64 payload
  const base64 = imageDataUrl.split(',')[1];

  const { data, error } = await supabase.functions.invoke('pdf-ocr', {
    body: {
      image_base64: base64,
      page_number: pageNumber,
      page_width: pageWidth,
      page_height: pageHeight,
      render_scale: renderScale,
    },
  });

  if (error) throw error;
  return data as OcrResult;
}

/**
 * Persist OCR results as text objects in the object store.
 */
export async function persistOcrObjects(
  pdfDocumentId: string,
  pageId: string,
  pageNumber: number,
  ocrResult: OcrResult
): Promise<number> {
  // Group words into lines for better text objects
  const lineMap = new Map<number, OcrWord[]>();
  for (const word of ocrResult.words) {
    const lineWords = lineMap.get(word.line) || [];
    lineWords.push(word);
    lineMap.set(word.line, lineWords);
  }

  const objectRows: any[] = [];
  let keyCounter = 0;

  for (const [lineNum, words] of lineMap) {
    if (words.length === 0) continue;
    const lineText = words.map(w => w.text).join(' ');
    const minX = Math.min(...words.map(w => w.x));
    const minY = Math.min(...words.map(w => w.y));
    const maxX = Math.max(...words.map(w => w.x + w.width));
    const maxY = Math.max(...words.map(w => w.y + w.height));
    const avgConfidence = words.reduce((s, w) => s + w.confidence, 0) / words.length;

    keyCounter++;
    objectRows.push({
      pdf_document_id: pdfDocumentId,
      page_id: pageId,
      object_type: 'text',
      object_key: `ocr_${pageNumber}_${keyCounter}`,
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      transform: {},
      content: { text: lineText, source: 'ocr', confidence: avgConfidence },
      font_info: { fontSize: maxY - minY },
      z_index: 0,
      is_editable: true,
      metadata: { page_number: pageNumber, ocr: true, confidence: avgConfidence },
    });
  }

  // Batch insert
  const CHUNK = 200;
  for (let i = 0; i < objectRows.length; i += CHUNK) {
    const chunk = objectRows.slice(i, i + CHUNK);
    await (supabase as any).from('pdf_engine_objects').insert(chunk);
  }

  // Update page extracted_text
  await (supabase as any)
    .from('pdf_engine_pages')
    .update({ extracted_text: ocrResult.text })
    .eq('id', pageId);

  return objectRows.length;
}
