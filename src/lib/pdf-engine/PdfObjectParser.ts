/**
 * PITCH PDF Object Parser
 * Converts raw PDF.js extraction into normalized editable object graph.
 */

import { loadPDFFromArrayBuffer } from '@/lib/pdfRenderer';

export interface ParsedTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  fontSize?: number;
  transform?: number[];
}

export interface ParsedPage {
  page_number: number;
  width: number;
  height: number;
  rotation: number;
  text_items: ParsedTextItem[];
  full_text: string;
}

/**
 * Parse a PDF ArrayBuffer into normalized page + object data.
 */
export async function parsePdfToObjectGraph(
  arrayBuffer: ArrayBuffer,
  options: { maxPages?: number } = {}
): Promise<ParsedPage[]> {
  const { maxPages = 200 } = options;
  const pdf = await loadPDFFromArrayBuffer(arrayBuffer);
  const pageCount = Math.min(pdf.numPages, maxPages);
  const pages: ParsedPage[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await (page as any).getTextContent();

    const textItems: ParsedTextItem[] = [];
    const textParts: string[] = [];

    for (const item of (textContent.items || [])) {
      if (!item.str || !item.str.trim()) continue;

      const tx = item.transform;
      const x = tx?.[4] ?? 0;
      // PDF.js gives y from bottom; convert to top-down
      const rawY = tx?.[5] ?? 0;
      const fontSize = tx ? Math.abs(tx[0]) : 12;
      const height = item.height || fontSize;
      const width = item.width || 0;

      textItems.push({
        str: item.str,
        x,
        y: rawY,
        width,
        height,
        fontName: item.fontName,
        fontSize,
        transform: tx,
      });
      textParts.push(item.str);
    }

    pages.push({
      page_number: i,
      width: viewport.width,
      height: viewport.height,
      rotation: (page as any).rotate || 0,
      text_items: textItems,
      full_text: textParts.join(' '),
    });
  }

  pdf.destroy();
  return pages;
}

/**
 * Group adjacent text items into logical text blocks (lines).
 */
export function groupTextIntoBlocks(items: ParsedTextItem[], lineThreshold = 3): ParsedTextItem[][] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => {
    const yDiff = Math.abs(a.y - b.y);
    if (yDiff > lineThreshold) return b.y - a.y; // top to bottom (PDF coords)
    return a.x - b.x;
  });

  const lines: ParsedTextItem[][] = [];
  let currentLine: ParsedTextItem[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = currentLine[currentLine.length - 1];
    const curr = sorted[i];
    if (Math.abs(curr.y - prev.y) <= lineThreshold) {
      currentLine.push(curr);
    } else {
      lines.push(currentLine);
      currentLine = [curr];
    }
  }
  lines.push(currentLine);
  return lines;
}
