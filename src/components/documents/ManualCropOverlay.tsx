/**
 * Manual Crop Overlay Component
 * 
 * Provides draggable corner handles for manual document boundary adjustment
 * when auto-detection fails or confidence is low.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Check, X, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DetectedCorners, Point } from '@/utils/documentEdgeDetection';

interface ManualCropOverlayProps {
  /** Captured image to crop */
  imageUrl: string;
  /** Initial corners from detection (or null for default) */
  initialCorners?: DetectedCorners | null;
  /** Image dimensions */
  imageWidth: number;
  imageHeight: number;
  /** Callback when user confirms corners */
  onConfirm: (corners: DetectedCorners) => void;
  /** Callback when user cancels */
  onCancel: () => void;
}

interface DragState {
  corner: 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft' | null;
  startX: number;
  startY: number;
}

export function ManualCropOverlay({
  imageUrl,
  initialCorners,
  imageWidth,
  imageHeight,
  onConfirm,
  onCancel,
}: ManualCropOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [corners, setCorners] = useState<DetectedCorners>(() => 
    initialCorners || getDefaultCorners(imageWidth, imageHeight)
  );
  const [dragState, setDragState] = useState<DragState>({ corner: null, startX: 0, startY: 0 });
  
  // Calculate display scale
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const containerAspect = rect.width / rect.height;
        const imageAspect = imageWidth / imageHeight;
        
        let width: number, height: number;
        if (containerAspect > imageAspect) {
          height = rect.height;
          width = height * imageAspect;
        } else {
          width = rect.width;
          height = width / imageAspect;
        }
        
        setDisplaySize({ width, height });
      }
    };
    
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [imageWidth, imageHeight]);
  
  // Scale factor from image coords to display coords
  const scale = displaySize.width / imageWidth;
  
  // Convert image coords to display coords
  const toDisplay = useCallback((point: Point): Point => ({
    x: point.x * scale,
    y: point.y * scale,
  }), [scale]);
  
  // Convert display coords to image coords
  const toImage = useCallback((point: Point): Point => ({
    x: point.x / scale,
    y: point.y / scale,
  }), [scale]);
  
  // Handle drag start
  const handleDragStart = useCallback((
    corner: DragState['corner'],
    e: React.MouseEvent | React.TouchEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    setDragState({ corner, startX: clientX, startY: clientY });
  }, []);
  
  // Handle drag move
  useEffect(() => {
    if (!dragState.corner) return;
    
    const handleMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      
      if (!containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      const offsetX = (rect.width - displaySize.width) / 2;
      const offsetY = (rect.height - displaySize.height) / 2;
      
      // Calculate position relative to image display area
      const displayX = clientX - rect.left - offsetX;
      const displayY = clientY - rect.top - offsetY;
      
      // Clamp to image bounds
      const clampedX = Math.max(0, Math.min(displaySize.width, displayX));
      const clampedY = Math.max(0, Math.min(displaySize.height, displayY));
      
      // Convert to image coordinates
      const imagePoint = toImage({ x: clampedX, y: clampedY });
      
      setCorners(prev => ({
        ...prev,
        [dragState.corner!]: imagePoint,
      }));
    };
    
    const handleEnd = () => {
      setDragState({ corner: null, startX: 0, startY: 0 });
    };
    
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
    
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [dragState.corner, displaySize, toImage]);
  
  // Reset to default corners
  const handleReset = useCallback(() => {
    setCorners(initialCorners || getDefaultCorners(imageWidth, imageHeight));
  }, [initialCorners, imageWidth, imageHeight]);
  
  // Confirm with validation
  const handleConfirm = useCallback(() => {
    // Ensure corners have reasonable confidence
    onConfirm({
      ...corners,
      confidence: 1.0, // Manual selection = full confidence
    });
  }, [corners, onConfirm]);
  
  // Display corners
  const displayCorners = {
    topLeft: toDisplay(corners.topLeft),
    topRight: toDisplay(corners.topRight),
    bottomRight: toDisplay(corners.bottomRight),
    bottomLeft: toDisplay(corners.bottomLeft),
  };
  
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-4 w-4 mr-2" />
          Cancel
        </Button>
        <span className="font-medium">Adjust Corners</span>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
      </div>
      
      {/* Instructions */}
      <div className="px-4 py-2 bg-muted/50 text-center text-sm text-muted-foreground">
        Drag the corner handles to match document edges
      </div>
      
      {/* Image with crop overlay */}
      <div 
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-black flex items-center justify-center"
      >
        {/* Image */}
        <img
          src={imageUrl}
          alt="Document to crop"
          className="max-w-full max-h-full object-contain"
          style={{ width: displaySize.width, height: displaySize.height }}
          draggable={false}
        />
        
        {/* Overlay SVG */}
        {displaySize.width > 0 && (
          <svg
            className="absolute pointer-events-none"
            style={{
              width: displaySize.width,
              height: displaySize.height,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
            viewBox={`0 0 ${displaySize.width} ${displaySize.height}`}
          >
            {/* Darkened area outside selection */}
            <defs>
              <mask id="cropMask">
                <rect width="100%" height="100%" fill="white" />
                <polygon
                  points={`
                    ${displayCorners.topLeft.x},${displayCorners.topLeft.y}
                    ${displayCorners.topRight.x},${displayCorners.topRight.y}
                    ${displayCorners.bottomRight.x},${displayCorners.bottomRight.y}
                    ${displayCorners.bottomLeft.x},${displayCorners.bottomLeft.y}
                  `}
                  fill="black"
                />
              </mask>
            </defs>
            
            {/* Dark overlay outside crop area */}
            <rect
              width="100%"
              height="100%"
              fill="rgba(0, 0, 0, 0.5)"
              mask="url(#cropMask)"
            />
            
            {/* Crop boundary */}
            <polygon
              points={`
                ${displayCorners.topLeft.x},${displayCorners.topLeft.y}
                ${displayCorners.topRight.x},${displayCorners.topRight.y}
                ${displayCorners.bottomRight.x},${displayCorners.bottomRight.y}
                ${displayCorners.bottomLeft.x},${displayCorners.bottomLeft.y}
              `}
              fill="none"
              stroke="hsl(142, 76%, 36%)"
              strokeWidth="3"
            />
            
            {/* Edge lines */}
            {['topLeft-topRight', 'topRight-bottomRight', 'bottomRight-bottomLeft', 'bottomLeft-topLeft'].map((edge, i) => {
              const [start, end] = edge.split('-') as [keyof typeof displayCorners, keyof typeof displayCorners];
              return (
                <line
                  key={edge}
                  x1={displayCorners[start].x}
                  y1={displayCorners[start].y}
                  x2={displayCorners[end].x}
                  y2={displayCorners[end].y}
                  stroke="hsl(142, 76%, 36%)"
                  strokeWidth="2"
                  strokeDasharray="8,4"
                />
              );
            })}
          </svg>
        )}
        
        {/* Draggable corner handles */}
        {displaySize.width > 0 && (
          <div
            className="absolute"
            style={{
              width: displaySize.width,
              height: displaySize.height,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          >
            {(['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const).map((corner) => (
              <div
                key={corner}
                className={cn(
                  "absolute w-12 h-12 -translate-x-1/2 -translate-y-1/2",
                  "touch-none cursor-grab active:cursor-grabbing",
                  dragState.corner === corner && "z-10"
                )}
                style={{
                  left: displayCorners[corner].x,
                  top: displayCorners[corner].y,
                }}
                onMouseDown={(e) => handleDragStart(corner, e)}
                onTouchStart={(e) => handleDragStart(corner, e)}
              >
                {/* Large touch target */}
                <div className="absolute inset-0 rounded-full bg-transparent" />
                
                {/* Visible handle */}
                <div
                  className={cn(
                    "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
                    "w-6 h-6 rounded-full border-4",
                    "bg-white border-primary shadow-lg",
                    dragState.corner === corner && "scale-125 bg-primary"
                  )}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Action buttons */}
      <div className="flex items-center justify-center gap-4 px-4 py-4 border-t bg-background">
        <Button variant="outline" size="lg" onClick={onCancel} className="flex-1 max-w-32">
          Cancel
        </Button>
        <Button 
          size="lg" 
          onClick={handleConfirm}
          className="flex-1 max-w-48 gradient-primary"
        >
          <Check className="h-5 w-5 mr-2" />
          Apply Crop
        </Button>
      </div>
    </div>
  );
}

/**
 * Generate default corners (centered rectangle with margins)
 */
function getDefaultCorners(width: number, height: number): DetectedCorners {
  const marginX = width * 0.1;
  const marginY = height * 0.1;
  
  return {
    topLeft: { x: marginX, y: marginY },
    topRight: { x: width - marginX, y: marginY },
    bottomRight: { x: width - marginX, y: height - marginY },
    bottomLeft: { x: marginX, y: height - marginY },
    confidence: 0.5,
  };
}
