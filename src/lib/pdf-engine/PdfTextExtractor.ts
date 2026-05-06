/**
 * PITCH PDF Text Extractor
 * Extract searchable text from parsed pages.
 */

import type { PdfEngineObject } from './engineTypes';

export interface TextSearchResult {
  objectId: string;
  pageNumber: number;
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Search for text across all objects.
 */
export function searchText(
  objects: PdfEngineObject[],
  query: string,
  caseSensitive = false
): TextSearchResult[] {
  const results: TextSearchResult[] = [];
  const q = caseSensitive ? query : query.toLowerCase();

  for (const obj of objects) {
    if (obj.object_type !== 'text') continue;
    const text = (obj.content as any)?.text || '';
    const compareText = caseSensitive ? text : text.toLowerCase();
    if (compareText.includes(q)) {
      results.push({
        objectId: obj.id,
        pageNumber: (obj.metadata as any)?.page_number ?? 1,
        text,
        bounds: obj.bounds,
      });
    }
  }

  return results;
}

/**
 * Get full text for a specific page.
 */
export function getPageText(objects: PdfEngineObject[], pageNumber: number): string {
  return objects
    .filter(o => o.object_type === 'text' && (o.metadata as any)?.page_number === pageNumber)
    .sort((a, b) => {
      const ay = a.bounds.y, by = b.bounds.y;
      if (Math.abs(ay - by) > 3) return by - ay;
      return a.bounds.x - b.bounds.x;
    })
    .map(o => (o.content as any)?.text || '')
    .join(' ');
}
