/**
 * PITCH PDF Object Extractor
 * Uses PDF.js to extract the text layer and build the editable object graph.
 * Runs client-side after upload.
 */

import { loadPDFFromArrayBuffer } from '@/lib/pdfRenderer';
import type { PdfTextItem } from './types';

export interface ExtractedPage {
  page_number: number;
  width: number;
  height: number;
  text_items: PdfTextItem[];
  thumbnail_data_url: string;
}

/**
 * Extract all pages from a PDF ArrayBuffer into an editable object graph.
 */
export async function extractPdfObjects(
  arrayBuffer: ArrayBuffer,
  options: { scale?: number; maxPages?: number } = {}
): Promise<ExtractedPage[]> {
  const { scale = 1.5, maxPages = 200 } = options;
  const pdf = await loadPDFFromArrayBuffer(arrayBuffer);
  const pageCount = Math.min(pdf.numPages, maxPages);
  const pages: ExtractedPage[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 }); // native coords

    // Extract text content
    const textContent = await (page as any).getTextContent();
    const textItems: PdfTextItem[] = (textContent.items || [])
      .filter((item: any) => item.str && item.str.trim())
      .map((item: any) => ({
        str: item.str,
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        width: item.width ?? 0,
        height: item.height ?? 0,
        fontName: item.fontName,
        fontSize: item.transform ? Math.abs(item.transform[0]) : undefined,
        transform: item.transform,
      }));

    // Render thumbnail
    const thumbViewport = page.getViewport({ scale: 0.3 });
    const canvas = document.createElement('canvas');
    canvas.width = thumbViewport.width;
    canvas.height = thumbViewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport: thumbViewport }).promise;
    const thumbnail_data_url = canvas.toDataURL('image/jpeg', 0.6);

    pages.push({
      page_number: i,
      width: viewport.width,
      height: viewport.height,
      text_items: textItems,
      thumbnail_data_url,
    });
  }

  pdf.destroy();
  return pages;
}
