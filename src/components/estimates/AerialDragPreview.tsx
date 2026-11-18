import React, { useEffect, useRef, useState } from 'react';
import { Move } from 'lucide-react';
import { aerialDragToPanDelta } from '@/lib/estimates/aerialDrag';

interface AerialDragPreviewProps {
  src: string;
  rotationDeg: number;
  lat: number;
  /** Called once on release with the pan change produced by the drag. */
  onPanBy: (dPanX: number, dPanY: number) => void;
}

/**
 * Drag-to-position preview for the aerial cover photo. The picture follows the
 * pointer while dragging; on release the new center is committed and the
 * offset is held until the re-centered image has loaded, so it doesn't jump.
 */
export function AerialDragPreview({ src, rotationDeg, lat, onPanBy }: AerialDragPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const pendingSrcRef = useRef<string | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => { if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current); }, []);

  const clearOffsetSoon = () => {
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    // Safety net in case the new image never reports loading.
    resetTimerRef.current = window.setTimeout(() => setOffset({ x: 0, y: 0 }), 5000);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y, id: e.pointerId };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    setOffset({ x: e.clientX - d.x, y: e.clientY - d.y });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
      setOffset({ x: 0, y: 0 });
      return;
    }
    const width = containerRef.current?.getBoundingClientRect().width ?? 0;
    const { dPanX, dPanY } = aerialDragToPanDelta({ dx, dy, displayWidth: width, rotationDeg, lat });
    pendingSrcRef.current = src;
    clearOffsetSoon();
    onPanBy(dPanX, dPanY);
  };

  const onImageLoad = () => {
    // A different image means the re-centered view arrived; drop the drag offset.
    if (pendingSrcRef.current !== null && pendingSrcRef.current !== src) {
      pendingSrcRef.current = null;
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
      setOffset({ x: 0, y: 0 });
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full aspect-[2/1] overflow-hidden rounded border border-border bg-muted select-none touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="application"
      aria-label="Drag to position the aerial view"
    >
      <img
        src={src}
        alt="Aerial cover photo — drag to reposition"
        draggable={false}
        onLoad={onImageLoad}
        className="pointer-events-none h-full w-full object-cover"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      />
      <div className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1 rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-foreground">
        <Move className="h-3 w-3" />
        Drag to position
      </div>
    </div>
  );
}
