/**
 * PITCH PDF Layout Engine
 * Handles line wrapping, spacing, alignment, overflow, and multiline expansion
 * for text replacement in reconstructed PDFs.
 */

import { PdfFontEngine } from './PdfFontEngine';

export type TextAlignment = 'left' | 'center' | 'right' | 'justify';

export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutLine {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
}

export interface LayoutResult {
  lines: LayoutLine[];
  totalHeight: number;
  overflow: boolean;
  expandedBounds: LayoutBounds;
}

export interface LayoutOptions {
  bounds: LayoutBounds;
  fontSize: number;
  fontName: string;
  alignment: TextAlignment;
  lineSpacing: number;  // multiplier, e.g. 1.2
  allowExpand: boolean;  // allow vertical expansion
  maxLines?: number;
}

export class PdfLayoutEngine {
  /**
   * Layout text within bounds, handling wrapping and alignment.
   */
  static layoutText(text: string, options: LayoutOptions): LayoutResult {
    const { bounds, fontSize, fontName, alignment, lineSpacing, allowExpand, maxLines } = options;
    const lineHeight = fontSize * lineSpacing;
    const maxWidth = bounds.width;

    // Word-wrap text into lines
    const wrappedLines = this.wordWrap(text, maxWidth, fontSize, fontName);

    // Apply max lines limit
    const effectiveLines = maxLines ? wrappedLines.slice(0, maxLines) : wrappedLines;
    const totalHeight = effectiveLines.length * lineHeight;
    const overflow = wrappedLines.length > effectiveLines.length || (!allowExpand && totalHeight > bounds.height);

    // Calculate positions
    const lines: LayoutLine[] = effectiveLines.map((lineText, i) => {
      const lineWidth = PdfFontEngine.estimateTextWidth(lineText, fontSize, fontName);
      let x = bounds.x;

      switch (alignment) {
        case 'center':
          x = bounds.x + (maxWidth - lineWidth) / 2;
          break;
        case 'right':
          x = bounds.x + maxWidth - lineWidth;
          break;
        case 'justify':
          // For justify, we'd need to space words — fall back to left for now
          break;
        default:
          break;
      }

      // PDF coordinates: y goes up, so first line is at top of bounds
      const y = bounds.y + bounds.height - (i + 1) * lineHeight;

      return { text: lineText, x, y, width: lineWidth, fontSize };
    });

    const expandedBounds: LayoutBounds = {
      ...bounds,
      height: allowExpand ? Math.max(bounds.height, totalHeight) : bounds.height,
    };

    return { lines, totalHeight, overflow, expandedBounds };
  }

  /**
   * Word-wrap text to fit within maxWidth.
   */
  static wordWrap(text: string, maxWidth: number, fontSize: number, fontName: string): string[] {
    if (!text) return [''];
    const paragraphs = text.split('\n');
    const result: string[] = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(w => w.length > 0);
      if (words.length === 0) {
        result.push('');
        continue;
      }

      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = PdfFontEngine.estimateTextWidth(testLine, fontSize, fontName);

        if (testWidth > maxWidth && currentLine) {
          result.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) result.push(currentLine);
    }

    return result.length > 0 ? result : [''];
  }

  /**
   * Calculate the font size needed to fit text within bounds (single line).
   */
  static fitFontSize(text: string, bounds: LayoutBounds, fontName: string, maxFontSize: number = 72): number {
    let fontSize = maxFontSize;
    while (fontSize > 4) {
      const width = PdfFontEngine.estimateTextWidth(text, fontSize, fontName);
      if (width <= bounds.width && fontSize <= bounds.height) return fontSize;
      fontSize -= 0.5;
    }
    return 4;
  }

  /**
   * Detect text alignment from existing objects on a page.
   */
  static detectAlignment(
    objects: Array<{ bounds: LayoutBounds; content?: Record<string, unknown> }>,
    pageWidth: number
  ): TextAlignment {
    if (objects.length === 0) return 'left';

    const centerThreshold = 5; // px tolerance
    const rightThreshold = 5;

    let centerCount = 0;
    let rightCount = 0;
    let leftCount = 0;

    for (const obj of objects) {
      const objCenter = obj.bounds.x + obj.bounds.width / 2;
      const pageCenter = pageWidth / 2;
      const objRight = obj.bounds.x + obj.bounds.width;

      if (Math.abs(objCenter - pageCenter) < centerThreshold) centerCount++;
      else if (Math.abs(objRight - pageWidth + 36) < rightThreshold) rightCount++; // 36pt margin
      else leftCount++;
    }

    if (centerCount > leftCount && centerCount > rightCount) return 'center';
    if (rightCount > leftCount) return 'right';
    return 'left';
  }

  /**
   * Calculate vertical shift needed when replacing multi-line text.
   * Returns the amount to shift subsequent objects down.
   */
  static calculateVerticalShift(
    originalHeight: number,
    newHeight: number
  ): number {
    return newHeight - originalHeight;
  }
}
