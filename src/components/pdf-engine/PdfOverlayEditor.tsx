/**
 * PITCH PDF Overlay Editor
 * Fabric.js canvas overlay on top of PDF.js rendered pages.
 * This is Layer 2 — the visual editing surface.
 * All edits create operations, never mutate the source PDF.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { fabric } from 'fabric';
import type { PdfObject } from '@/lib/pdf-engine/types';

interface OverlayEditorProps {
  /** Data URL of the rendered PDF page */
  pageImageUrl: string;
  pageWidth: number;
  pageHeight: number;
  pageNumber: number;
  objects: PdfObject[];
  onObjectSelected?: (obj: PdfObject | null) => void;
  onTextEdit?: (objectId: string, newText: string) => void;
  onObjectMoved?: (objectId: string, x: number, y: number) => void;
  onAddAnnotation?: (annotation: { x: number; y: number; width: number; height: number; text: string; pageNumber: number }) => void;
  onAddRedaction?: (redaction: { x: number; y: number; width: number; height: number; pageNumber: number }) => void;
  mode: 'select' | 'annotate' | 'redact' | 'text';
  scale?: number;
}

export function PdfOverlayEditor({
  pageImageUrl,
  pageWidth,
  pageHeight,
  pageNumber,
  objects,
  onObjectSelected,
  onTextEdit,
  onObjectMoved,
  onAddAnnotation,
  onAddRedaction,
  mode,
  scale = 1,
}: OverlayEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Initialize Fabric canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: pageWidth * scale,
      height: pageHeight * scale,
      selection: mode === 'select',
    });

    fabricRef.current = canvas;

    // Set background to rendered PDF page
    fabric.Image.fromURL(pageImageUrl, (img) => {
      img.scaleX = (pageWidth * scale) / (img.width || 1);
      img.scaleY = (pageHeight * scale) / (img.height || 1);
      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
      setIsReady(true);
    }, { crossOrigin: 'anonymous' });

    // Handle selection
    canvas.on('selection:created', (e) => {
      const selected = e.selected?.[0];
      if (selected && (selected as any)._pitchObjectId && onObjectSelected) {
        const obj = objects.find(o => o.id === (selected as any)._pitchObjectId);
        onObjectSelected(obj || null);
      }
    });

    canvas.on('selection:cleared', () => {
      onObjectSelected?.(null);
    });

    // Handle object movement
    canvas.on('object:modified', (e) => {
      const target = e.target;
      if (target && (target as any)._pitchObjectId && onObjectMoved) {
        onObjectMoved(
          (target as any)._pitchObjectId,
          (target.left || 0) / scale,
          (target.top || 0) / scale
        );
      }
    });

    // Handle text editing
    canvas.on('text:changed', (e) => {
      const target = e.target as fabric.IText;
      if (target && (target as any)._pitchObjectId && onTextEdit) {
        onTextEdit((target as any)._pitchObjectId, target.text || '');
      }
    });

    return () => {
      canvas.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageImageUrl, pageWidth, pageHeight, scale]);

  // Update mode
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.selection = mode === 'select';
    canvas.defaultCursor = mode === 'select' ? 'default' : 'crosshair';

    // Drawing mode for annotations/redactions
    if (mode === 'annotate' || mode === 'redact') {
      let startX = 0, startY = 0;
      let rect: fabric.Rect | null = null;

      const onMouseDown = (e: fabric.IEvent<MouseEvent>) => {
        const pointer = canvas.getPointer(e.e);
        startX = pointer.x;
        startY = pointer.y;
        rect = new fabric.Rect({
          left: startX,
          top: startY,
          width: 0,
          height: 0,
          fill: mode === 'redact' ? 'rgba(0,0,0,0.7)' : 'rgba(255,234,0,0.3)',
          stroke: mode === 'redact' ? '#000' : '#f59e0b',
          strokeWidth: 1,
          selectable: false,
        });
        canvas.add(rect);
      };

      const onMouseMove = (e: fabric.IEvent<MouseEvent>) => {
        if (!rect) return;
        const pointer = canvas.getPointer(e.e);
        rect.set({
          width: Math.abs(pointer.x - startX),
          height: Math.abs(pointer.y - startY),
          left: Math.min(pointer.x, startX),
          top: Math.min(pointer.y, startY),
        });
        canvas.renderAll();
      };

      const onMouseUp = () => {
        if (!rect || !rect.width || !rect.height) return;
        const bounds = {
          x: (rect.left || 0) / scale,
          y: (rect.top || 0) / scale,
          width: (rect.width || 0) / scale,
          height: (rect.height || 0) / scale,
          pageNumber,
        };

        if (mode === 'redact') {
          onAddRedaction?.(bounds);
        } else {
          onAddAnnotation?.({ ...bounds, text: '' });
        }
        rect = null;
      };

      canvas.on('mouse:down', onMouseDown);
      canvas.on('mouse:move', onMouseMove);
      canvas.on('mouse:up', onMouseUp);

      return () => {
        canvas.off('mouse:down', onMouseDown as any);
        canvas.off('mouse:move', onMouseMove as any);
        canvas.off('mouse:up', onMouseUp as any);
      };
    }
  }, [mode, scale, pageNumber, onAddAnnotation, onAddRedaction]);

  // Render text objects as interactive Fabric objects
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !isReady) return;

    // Remove previous PITCH objects (keep background)
    const toRemove = canvas.getObjects().filter((o: any) => o._pitchObject);
    toRemove.forEach(o => canvas.remove(o));

    // Add text objects
    const textObjects = objects.filter(o => o.object_type === 'text' && !o.is_deleted);
    for (const obj of textObjects) {
      const itext = new fabric.IText(obj.content || '', {
        left: obj.x * scale,
        top: obj.y * scale,
        fontSize: (obj.font_size || 12) * scale,
        fontFamily: obj.font_family || 'Helvetica',
        fill: obj.font_color || '#000',
        opacity: obj.opacity,
        selectable: mode === 'select',
        editable: mode === 'select',
        hasControls: mode === 'select',
      });
      (itext as any)._pitchObjectId = obj.id;
      (itext as any)._pitchObject = true;
      canvas.add(itext);
    }

    canvas.renderAll();
  }, [objects, isReady, scale, mode]);

  return (
    <div className="relative" style={{ width: pageWidth * scale, height: pageHeight * scale }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
