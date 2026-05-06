/**
 * PITCH PDF Overlay Renderer
 * Renders the editable object layer on top of PDF.js canvas.
 */

import type { PdfEngineObject, PdfEngineOperation } from './engineTypes';

export interface OverlayRenderItem {
  id: string;
  type: 'text' | 'redaction' | 'annotation' | 'highlight';
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  style?: {
    fill?: string;
    stroke?: string;
    opacity?: number;
    fontSize?: number;
    fontFamily?: string;
  };
}

/**
 * Convert objects + active operations into renderable overlay items.
 */
export function buildOverlayItems(
  objects: PdfEngineObject[],
  operations: PdfEngineOperation[],
  pageNumber: number
): OverlayRenderItem[] {
  const items: OverlayRenderItem[] = [];
  const activeOps = operations.filter(op => !op.is_undone);

  // Build replacement map
  const replacements = new Map<string, string>();
  const deletedIds = new Set<string>();

  for (const op of activeOps) {
    if (op.operation_type === 'replace_text' && op.target_object_id) {
      const p = op.operation_payload as any;
      replacements.set(op.target_object_id, p.replacement_text || p.new_text || '');
    }
    if (op.operation_type === 'delete_object' && op.target_object_id) {
      deletedIds.add(op.target_object_id);
    }
  }

  // Render text objects
  for (const obj of objects) {
    if ((obj.metadata as any)?.page_number !== pageNumber) continue;
    if (deletedIds.has(obj.id)) continue;

    if (obj.object_type === 'text') {
      const displayText = replacements.get(obj.id) || (obj.content as any)?.text || '';
      items.push({
        id: obj.id,
        type: 'text',
        x: obj.bounds.x,
        y: obj.bounds.y,
        width: obj.bounds.width,
        height: obj.bounds.height,
        content: displayText,
        style: {
          fontSize: obj.font_info?.fontSize || 12,
          fontFamily: obj.font_info?.fontFamily || 'Helvetica',
          fill: obj.font_info?.color || '#000',
        },
      });
    }
  }

  // Render operation-added items (annotations, redactions)
  for (const op of activeOps) {
    const p = op.operation_payload as any;
    if ((p.page_number ?? 1) !== pageNumber) continue;

    if (op.operation_type === 'add_redaction' || op.operation_type === 'apply_redaction') {
      items.push({
        id: op.id,
        type: 'redaction',
        x: p.x || 0,
        y: p.y || 0,
        width: p.width || 100,
        height: p.height || 20,
        style: { fill: 'rgba(0,0,0,0.8)' },
      });
    }

    if (op.operation_type === 'add_annotation') {
      items.push({
        id: op.id,
        type: 'annotation',
        x: p.x || 0,
        y: p.y || 0,
        width: p.width || 100,
        height: p.height || 20,
        content: p.text || '',
        style: { fill: 'rgba(255,234,0,0.3)', stroke: '#f59e0b' },
      });
    }
  }

  return items;
}
