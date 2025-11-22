// Touch controls integration for SimpleMeasurementCanvas
// This file contains the touch event handlers and pinch-to-zoom logic

import { useCallback, Dispatch, SetStateAction } from 'react';
import { Canvas as FabricCanvas } from 'fabric';
import { useTouchControls } from '@/hooks/useTouchControls';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';

export function useMobileMeasurementControls(
  canvas: FabricCanvas | null,
  mode: 'select' | 'draw',
  isDrawing: boolean,
  addPoint: (point: { x: number; y: number }) => void,
  completePolygon: () => void,
  setFabricZoomLevel: Dispatch<SetStateAction<number>>
) {
  const { vibrate } = useHapticFeedback();

  const handleTap = useCallback((x: number, y: number) => {
    if (mode !== 'draw') return;
    
    addPoint({ x, y });
    vibrate('light'); // Haptic feedback on point placement
  }, [mode, addPoint, vibrate]);

  const handleDoubleTap = useCallback((x: number, y: number) => {
    if (mode === 'draw' && isDrawing) {
      completePolygon();
      vibrate('success'); // Haptic feedback on completion
    }
  }, [mode, isDrawing, completePolygon, vibrate]);

  const handlePinchZoom = useCallback((scale: number) => {
    if (!canvas) return;

    setFabricZoomLevel((prev: number) => {
      const newZoom = Math.max(0.5, Math.min(3, prev * scale));
      canvas.setZoom(newZoom);
      canvas.renderAll();
      return newZoom;
    });
  }, [canvas, setFabricZoomLevel]);

  const handlePan = useCallback((deltaX: number, deltaY: number) => {
    if (!canvas) return;

    const vpt = canvas.viewportTransform;
    if (vpt) {
      vpt[4] += deltaX;
      vpt[5] += deltaY;
      canvas.requestRenderAll();
    }
  }, [canvas]);

  const handleSwipe = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    if (direction === 'up' && mode === 'draw' && isDrawing) {
      completePolygon();
      vibrate('success');
    }
    // Future: Add left/right swipes for facet navigation
  }, [mode, isDrawing, completePolygon, vibrate]);

  useTouchControls({
    canvas,
    onTap: handleTap,
    onDoubleTap: handleDoubleTap,
    onPinchZoom: handlePinchZoom,
    onPan: handlePan,
    onSwipe: handleSwipe,
    enablePinchZoom: true,
    enablePan: !isDrawing, // Disable pan while drawing
  });

  return {
    handleTap,
    handleDoubleTap,
    handlePinchZoom,
    handlePan,
  };
}
