import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas as FabricCanvas, IText, Rect, FabricImage } from 'fabric';
import type { PdfEngineObject } from '@/lib/pdf-engine/engineTypes';
import { scaleBounds, createMapping } from '@/lib/pdf-engine/PdfCoordinateMapper';

interface PdfCanvasProps {
  pageImageUrl: string;
  pageWidth: number;
  pageHeight: number;
  pageNumber: number;
  objects: PdfEngineObject[];
  mode: 'select' | 'annotate' | 'redact' | 'text';
  scale?: number;
  onObjectSelected?: (obj: PdfEngineObject | null) => void;
  onTextReplace?: (objectId: string, newText: string) => void;
  onObjectMoved?: (objectId: string, x: number, y: number) => void;
  onAddRedaction?: (bounds: { x: number; y: number; width: number; height: number; pageNumber: number }) => void;
  onAddAnnotation?: (bounds: { x: number; y: number; width: number; height: number; text: string; pageNumber: number }) => void;
}

export function PdfCanvas({
  pageImageUrl, pageWidth, pageHeight, pageNumber, objects,
  mode, scale = 1.5,
  onObjectSelected, onTextReplace, onObjectMoved, onAddRedaction, onAddAnnotation,
}: PdfCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = new FabricCanvas(canvasRef.current, {
      width: pageWidth * scale,
      height: pageHeight * scale,
      selection: mode === 'select',
    });
    fabricRef.current = canvas;

    FabricImage.fromURL(pageImageUrl, { crossOrigin: 'anonymous' }).then((img) => {
      img.scaleX = (pageWidth * scale) / (img.width || 1);
      img.scaleY = (pageHeight * scale) / (img.height || 1);
      canvas.backgroundImage = img;
      canvas.renderAll();
      setReady(true);
    });

    canvas.on('selection:created', (e) => {
      const sel = (e as any).selected?.[0];
      if (sel?._engineObjId && onObjectSelected) {
        const obj = objects.find(o => o.id === sel._engineObjId);
        onObjectSelected(obj || null);
      }
    });
    canvas.on('selection:cleared', () => onObjectSelected?.(null));

    canvas.on('object:modified', (e) => {
      const t = (e as any).target;
      if (t?._engineObjId && onObjectMoved) {
        onObjectMoved(t._engineObjId, (t.left || 0) / scale, (t.top || 0) / scale);
      }
    });

    return () => { canvas.dispose(); fabricRef.current = null; };
  }, [pageImageUrl, pageWidth, pageHeight, scale]);

  // Drawing mode for annotations/redactions
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.selection = mode === 'select';
    canvas.defaultCursor = mode === 'select' ? 'default' : 'crosshair';

    if (mode === 'annotate' || mode === 'redact') {
      let startX = 0, startY = 0;
      let rect: Rect | null = null;

      const onDown = (e: any) => {
        const p = canvas.getScenePoint(e.e);
        startX = p.x; startY = p.y;
        rect = new Rect({
          left: startX, top: startY, width: 0, height: 0,
          fill: mode === 'redact' ? 'rgba(0,0,0,0.7)' : 'rgba(255,234,0,0.3)',
          stroke: mode === 'redact' ? '#000' : '#f59e0b',
          strokeWidth: 1, selectable: false,
        });
        canvas.add(rect);
      };
      const onMove = (e: any) => {
        if (!rect) return;
        const p = canvas.getScenePoint(e.e);
        rect.set({
          width: Math.abs(p.x - startX), height: Math.abs(p.y - startY),
          left: Math.min(p.x, startX), top: Math.min(p.y, startY),
        });
        canvas.renderAll();
      };
      const onUp = () => {
        if (!rect || !rect.width || !rect.height) return;
        const b = {
          x: (rect.left || 0) / scale, y: (rect.top || 0) / scale,
          width: (rect.width || 0) / scale, height: (rect.height || 0) / scale,
          pageNumber,
        };
        if (mode === 'redact') onAddRedaction?.(b);
        else onAddAnnotation?.({ ...b, text: '' });
        rect = null;
      };

      canvas.on('mouse:down', onDown);
      canvas.on('mouse:move', onMove);
      canvas.on('mouse:up', onUp);
      return () => {
        canvas.off('mouse:down', onDown);
        canvas.off('mouse:move', onMove);
        canvas.off('mouse:up', onUp);
      };
    }
  }, [mode, scale, pageNumber, onAddRedaction, onAddAnnotation]);

  // Render text objects
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !ready) return;

    const toRemove = canvas.getObjects().filter((o: any) => o._engineObj);
    toRemove.forEach(o => canvas.remove(o));

    const mapping = createMapping(pageWidth, pageHeight, scale);
    const pageObjects = objects.filter(o => (o.metadata as any)?.page_number === pageNumber && o.object_type === 'text');

    for (const obj of pageObjects) {
      const text = (obj.content as any)?.text || '';
      const sb = scaleBounds(obj.bounds, mapping);
      const itext = new IText(text, {
        left: sb.x, top: sb.y,
        fontSize: (obj.font_info?.fontSize || 12) * scale,
        fontFamily: obj.font_info?.fontFamily || 'Helvetica',
        fill: obj.font_info?.color || '#000',
        selectable: mode === 'select',
        editable: mode === 'select',
        hasControls: mode === 'select',
      });
      (itext as any)._engineObjId = obj.id;
      (itext as any)._engineObj = true;
      canvas.add(itext);
    }
    canvas.renderAll();
  }, [objects, ready, scale, mode, pageNumber, pageWidth, pageHeight]);

  return (
    <div className="relative" style={{ width: pageWidth * scale, height: pageHeight * scale }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
