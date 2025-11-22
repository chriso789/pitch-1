import { useEffect, useRef, useCallback } from 'react';
import { Canvas as FabricCanvas } from 'fabric';

interface TouchControlsOptions {
  canvas: FabricCanvas | null;
  onTap?: (x: number, y: number) => void;
  onDoubleTap?: (x: number, y: number) => void;
  onPinchZoom?: (scale: number) => void;
  onPan?: (deltaX: number, deltaY: number) => void;
  onSwipe?: (direction: 'left' | 'right' | 'up' | 'down') => void;
  enablePinchZoom?: boolean;
  enablePan?: boolean;
}

export function useTouchControls({
  canvas,
  onTap,
  onDoubleTap,
  onPinchZoom,
  onPan,
  onSwipe,
  enablePinchZoom = true,
  enablePan = true,
}: TouchControlsOptions) {
  const lastTapRef = useRef<number>(0);
  const lastTouchDistanceRef = useRef<number>(0);
  const lastPanPositionRef = useRef<{ x: number; y: number } | null>(null);
  const touchStartPositionRef = useRef<{ x: number; y: number } | null>(null);
  const isPinchingRef = useRef(false);

  const detectSwipe = useCallback((startX: number, startY: number, endX: number, endY: number) => {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const minSwipeDistance = 50; // pixels

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minSwipeDistance) {
      return deltaX > 0 ? 'right' : 'left';
    } else if (Math.abs(deltaY) > minSwipeDistance) {
      return deltaY > 0 ? 'down' : 'up';
    }
    return null;
  }, []);

  const calculateDistance = useCallback((touch1: Touch, touch2: Touch) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!canvas) return;

    const touches = e.touches;
    
    if (touches.length === 2 && enablePinchZoom) {
      // Start pinch zoom
      isPinchingRef.current = true;
      lastTouchDistanceRef.current = calculateDistance(touches[0], touches[1]);
      e.preventDefault();
    } else if (touches.length === 1) {
      isPinchingRef.current = false;
      const touch = touches[0];
      lastPanPositionRef.current = { x: touch.clientX, y: touch.clientY };
      touchStartPositionRef.current = { x: touch.clientX, y: touch.clientY };
    }
  }, [canvas, enablePinchZoom, calculateDistance]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!canvas) return;

    const touches = e.touches;

    if (touches.length === 2 && enablePinchZoom && isPinchingRef.current) {
      // Handle pinch zoom
      const currentDistance = calculateDistance(touches[0], touches[1]);
      const scale = currentDistance / lastTouchDistanceRef.current;
      
      onPinchZoom?.(scale);
      lastTouchDistanceRef.current = currentDistance;
      e.preventDefault();
    } else if (touches.length === 1 && enablePan && lastPanPositionRef.current && !isPinchingRef.current) {
      // Handle pan
      const touch = touches[0];
      const deltaX = touch.clientX - lastPanPositionRef.current.x;
      const deltaY = touch.clientY - lastPanPositionRef.current.y;
      
      onPan?.(deltaX, deltaY);
      lastPanPositionRef.current = { x: touch.clientX, y: touch.clientY };
      e.preventDefault();
    }
  }, [canvas, enablePinchZoom, enablePan, calculateDistance, onPinchZoom, onPan]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!canvas) return;

    const touch = e.changedTouches[0];
    const rect = canvas.lowerCanvasEl.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    // Detect swipe gesture
    if (touchStartPositionRef.current && !isPinchingRef.current) {
      const swipeDirection = detectSwipe(
        touchStartPositionRef.current.x,
        touchStartPositionRef.current.y,
        touch.clientX,
        touch.clientY
      );
      
      if (swipeDirection && onSwipe) {
        onSwipe(swipeDirection);
      } else {
        // Handle tap if no swipe detected
        const now = Date.now();
        const timeSinceLastTap = now - lastTapRef.current;

        if (timeSinceLastTap < 300) {
          // Double tap detected
          onDoubleTap?.(x, y);
          lastTapRef.current = 0;
        } else {
          // Single tap
          setTimeout(() => {
            if (lastTapRef.current === now) {
              onTap?.(x, y);
            }
          }, 300);
          lastTapRef.current = now;
        }
      }
    }

    isPinchingRef.current = false;
    lastPanPositionRef.current = null;
    touchStartPositionRef.current = null;
  }, [canvas, onTap, onDoubleTap, onSwipe, detectSwipe]);

  useEffect(() => {
    if (!canvas) return;

    const canvasElement = canvas.lowerCanvasEl;
    
    canvasElement.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvasElement.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvasElement.addEventListener('touchend', handleTouchEnd);

    return () => {
      canvasElement.removeEventListener('touchstart', handleTouchStart);
      canvasElement.removeEventListener('touchmove', handleTouchMove);
      canvasElement.removeEventListener('touchend', handleTouchEnd);
    };
  }, [canvas, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    isPinching: isPinchingRef.current,
  };
}
