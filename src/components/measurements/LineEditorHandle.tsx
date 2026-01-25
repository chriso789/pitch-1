// =====================================================
// Phase 73: Interactive Line Editor Handle
// Draggable vertex handles for diagram editing
// =====================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface Point {
  x: number;
  y: number;
}

interface LineEditorHandleProps {
  id: string;
  position: Point;
  type: 'start' | 'end' | 'midpoint' | 'corner';
  isSelected?: boolean;
  isLocked?: boolean;
  onDragStart?: (id: string, position: Point) => void;
  onDrag?: (id: string, position: Point) => void;
  onDragEnd?: (id: string, position: Point) => void;
  onClick?: (id: string) => void;
  className?: string;
}

const HANDLE_SIZE = 10;
const HANDLE_SIZE_SELECTED = 14;

export function LineEditorHandle({
  id,
  position,
  type,
  isSelected = false,
  isLocked = false,
  onDragStart,
  onDrag,
  onDragEnd,
  onClick,
  className,
}: LineEditorHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const handleRef = useRef<HTMLDivElement>(null);

  // Handle colors by type
  const handleColors = {
    start: 'bg-green-500 border-green-700',
    end: 'bg-red-500 border-red-700',
    midpoint: 'bg-blue-500 border-blue-700',
    corner: 'bg-yellow-500 border-yellow-700',
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isLocked) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const rect = handleRef.current?.parentElement?.getBoundingClientRect();
    if (!rect) return;
    
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
    
    onDragStart?.(id, position);
  }, [id, position, isLocked, onDragStart]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || isLocked) return;
    
    const newPosition = {
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y,
    };
    
    onDrag?.(id, newPosition);
  }, [isDragging, isLocked, id, dragOffset, onDrag]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    setIsDragging(false);
    
    const newPosition = {
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y,
    };
    
    onDragEnd?.(id, newPosition);
  }, [isDragging, id, dragOffset, onDragEnd]);

  // Add global mouse listeners when dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isDragging) {
      onClick?.(id);
    }
  };

  const size = isSelected ? HANDLE_SIZE_SELECTED : HANDLE_SIZE;

  return (
    <div
      ref={handleRef}
      className={cn(
        'absolute rounded-full border-2 transition-all duration-100',
        handleColors[type],
        isSelected && 'ring-2 ring-primary ring-offset-1',
        isDragging && 'opacity-70 scale-110',
        isLocked ? 'cursor-not-allowed opacity-50' : 'cursor-move',
        className
      )}
      style={{
        left: position.x - size / 2,
        top: position.y - size / 2,
        width: size,
        height: size,
        zIndex: isDragging ? 1000 : isSelected ? 100 : 10,
      }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`${type} handle`}
    />
  );
}

// Line editor with multiple handles
interface LineEditorProps {
  lineId: string;
  startPoint: Point;
  endPoint: Point;
  containerWidth: number;
  containerHeight: number;
  isSelected?: boolean;
  isLocked?: boolean;
  showMidpoint?: boolean;
  onLineChange?: (lineId: string, start: Point, end: Point) => void;
  onLineSelect?: (lineId: string) => void;
}

export function LineEditor({
  lineId,
  startPoint,
  endPoint,
  containerWidth,
  containerHeight,
  isSelected = false,
  isLocked = false,
  showMidpoint = true,
  onLineChange,
  onLineSelect,
}: LineEditorProps) {
  const [localStart, setLocalStart] = useState(startPoint);
  const [localEnd, setLocalEnd] = useState(endPoint);

  // Convert normalized (0-1) to pixel coordinates
  const toPixels = (point: Point): Point => ({
    x: point.x * containerWidth,
    y: point.y * containerHeight,
  });

  // Convert pixel to normalized coordinates
  const toNormalized = (point: Point): Point => ({
    x: point.x / containerWidth,
    y: point.y / containerHeight,
  });

  const startPixels = toPixels(localStart);
  const endPixels = toPixels(localEnd);
  const midpoint: Point = {
    x: (startPixels.x + endPixels.x) / 2,
    y: (startPixels.y + endPixels.y) / 2,
  };

  const handleDrag = (handleId: string, newPosition: Point) => {
    const normalized = toNormalized(newPosition);
    
    if (handleId === `${lineId}-start`) {
      setLocalStart(normalized);
    } else if (handleId === `${lineId}-end`) {
      setLocalEnd(normalized);
    } else if (handleId === `${lineId}-mid`) {
      // Move both points equally
      const dx = (newPosition.x - midpoint.x) / containerWidth;
      const dy = (newPosition.y - midpoint.y) / containerHeight;
      setLocalStart({ x: localStart.x + dx, y: localStart.y + dy });
      setLocalEnd({ x: localEnd.x + dx, y: localEnd.y + dy });
    }
  };

  const handleDragEnd = () => {
    onLineChange?.(lineId, localStart, localEnd);
  };

  const handleClick = (handleId: string) => {
    onLineSelect?.(lineId);
  };

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Line visualization */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <line
          x1={startPixels.x}
          y1={startPixels.y}
          x2={endPixels.x}
          y2={endPixels.y}
          stroke={isSelected ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
          strokeWidth={isSelected ? 3 : 2}
          strokeDasharray={isSelected ? undefined : '5,5'}
        />
      </svg>
      
      {/* Handles */}
      <div className="pointer-events-auto">
        <LineEditorHandle
          id={`${lineId}-start`}
          position={startPixels}
          type="start"
          isSelected={isSelected}
          isLocked={isLocked}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          onClick={handleClick}
        />
        
        <LineEditorHandle
          id={`${lineId}-end`}
          position={endPixels}
          type="end"
          isSelected={isSelected}
          isLocked={isLocked}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          onClick={handleClick}
        />
        
        {showMidpoint && (
          <LineEditorHandle
            id={`${lineId}-mid`}
            position={midpoint}
            type="midpoint"
            isSelected={isSelected}
            isLocked={isLocked}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            onClick={handleClick}
          />
        )}
      </div>
    </div>
  );
}

// Hook for line editing state
export function useLineEditor(initialLines: Array<{ id: string; start: Point; end: Point }>) {
  const [lines, setLines] = useState(initialLines);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<typeof initialLines>>([initialLines]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const updateLine = useCallback((lineId: string, start: Point, end: Point) => {
    setLines(prev => {
      const updated = prev.map(line =>
        line.id === lineId ? { ...line, start, end } : line
      );
      
      // Add to history
      const newHistory = [...history.slice(0, historyIndex + 1), updated];
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      
      return updated;
    });
  }, [history, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setLines(history[historyIndex - 1]);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setLines(history[historyIndex + 1]);
    }
  }, [history, historyIndex]);

  const selectLine = useCallback((lineId: string | null) => {
    setSelectedLineId(lineId);
  }, []);

  return {
    lines,
    selectedLineId,
    updateLine,
    selectLine,
    undo,
    redo,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
  };
}

export default LineEditorHandle;
