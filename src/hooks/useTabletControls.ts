import { useEffect, useRef, useCallback } from 'react';
import { Canvas as FabricCanvas } from 'fabric';
import { useHapticFeedback } from './useHapticFeedback';

interface TabletControlsOptions {
  canvas: FabricCanvas | null;
  enabled?: boolean;
  onPinchZoom?: (scale: number, point: { x: number; y: number }) => void;
  onTwoFingerPan?: (deltaX: number, deltaY: number) => void;
  onLongPress?: (x: number, y: number, target: any) => void;
  minZoom?: number;
  maxZoom?: number;
}

export function useTabletControls({
  canvas,
  enabled = true,
  onPinchZoom,
  onTwoFingerPan,
  onLongPress,
  minZoom = 0.5,
  maxZoom = 3,
}: TabletControlsOptions) {
  const { vibrate, isSupported } = useHapticFeedback();
  const lastTouchDistanceRef = useRef<number>(0);
  const lastPanPositionRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPinchingRef = useRef(false);
  const initialZoomRef = useRef(1);

  const calculateDistance = useCallback((touch1: Touch, touch2: Touch) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const calculateMidpoint = useCallback((touch1: Touch, touch2: Touch) => {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    };
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!canvas || !enabled) return;

    const touches = e.touches;
    
    if (touches.length === 2) {
      // Two-finger gesture - prepare for pinch or pan
      isPinchingRef.current = true;
      lastTouchDistanceRef.current = calculateDistance(touches[0], touches[1]);
      const midpoint = calculateMidpoint(touches[0], touches[1]);
      lastPanPositionRef.current = midpoint;
      initialZoomRef.current = canvas.getZoom();
      e.preventDefault();
      
      // Clear any long-press timer
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    } else if (touches.length === 1) {
      // Single touch - prepare for long-press detection
      isPinchingRef.current = false;
      const touch = touches[0];
      const pointer = canvas.getPointer(e);
      const target = canvas.findTarget(e as any);
      
      // Start long-press timer
      longPressTimerRef.current = setTimeout(() => {
        if (onLongPress && target) {
          vibrate('medium'); // 20ms haptic feedback
          onLongPress(pointer.x, pointer.y, target);
        }
      }, 800); // 800ms for long press
    }
  }, [canvas, enabled, calculateDistance, calculateMidpoint, onLongPress, vibrate]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!canvas || !enabled) return;

    const touches = e.touches;

    // Cancel long-press if finger moves
    if (longPressTimerRef.current && touches.length === 1) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (touches.length === 2 && isPinchingRef.current) {
      e.preventDefault();
      
      const currentDistance = calculateDistance(touches[0], touches[1]);
      const currentMidpoint = calculateMidpoint(touches[0], touches[1]);
      
      // Detect if this is primarily a pinch (distance change) or pan (position change)
      const distanceChange = Math.abs(currentDistance - lastTouchDistanceRef.current);
      const positionChange = lastPanPositionRef.current 
        ? Math.sqrt(
            Math.pow(currentMidpoint.x - lastPanPositionRef.current.x, 2) +
            Math.pow(currentMidpoint.y - lastPanPositionRef.current.y, 2)
          )
        : 0;
      
      if (distanceChange > positionChange && onPinchZoom) {
        // Pinch zoom gesture
        const scale = currentDistance / lastTouchDistanceRef.current;
        const newZoom = Math.min(Math.max(initialZoomRef.current * scale, minZoom), maxZoom);
        
        onPinchZoom(newZoom, currentMidpoint);
        
        // Light haptic feedback on zoom
        if (Math.abs(scale - 1) > 0.1) {
          vibrate('light');
        }
      } else if (onTwoFingerPan && lastPanPositionRef.current) {
        // Two-finger pan gesture
        const deltaX = currentMidpoint.x - lastPanPositionRef.current.x;
        const deltaY = currentMidpoint.y - lastPanPositionRef.current.y;
        
        onTwoFingerPan(deltaX, deltaY);
      }
      
      lastTouchDistanceRef.current = currentDistance;
      lastPanPositionRef.current = currentMidpoint;
    }
  }, [canvas, enabled, calculateDistance, calculateMidpoint, onPinchZoom, onTwoFingerPan, minZoom, maxZoom, vibrate]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    // Clear long-press timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (e.touches.length === 0) {
      isPinchingRef.current = false;
      lastPanPositionRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!canvas || !enabled) return;

    const canvasElement = canvas.lowerCanvasEl;
    
    canvasElement.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvasElement.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvasElement.addEventListener('touchend', handleTouchEnd);
    canvasElement.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      canvasElement.removeEventListener('touchstart', handleTouchStart);
      canvasElement.removeEventListener('touchmove', handleTouchMove);
      canvasElement.removeEventListener('touchend', handleTouchEnd);
      canvasElement.removeEventListener('touchcancel', handleTouchEnd);
      
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, [canvas, enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    isPinching: isPinchingRef.current,
    isHapticSupported: isSupported,
  };
}
