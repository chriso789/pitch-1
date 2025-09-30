import React, { useState, useEffect } from "react";
import { X, Minus, Maximize2, GripHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FloatingPipelinePanelProps {
  title: string;
  children: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
  onMinimize?: () => void;
  isMinimized?: boolean;
  className?: string;
}

export const FloatingPipelinePanel: React.FC<FloatingPipelinePanelProps> = ({
  title,
  children,
  isOpen,
  onClose,
  onMinimize,
  isMinimized = false,
  className,
}) => {
  // Load position from localStorage or use default
  const getInitialPosition = () => {
    const saved = localStorage.getItem('pipeline-panel-position');
    if (saved) {
      return JSON.parse(saved);
    }
    return { x: 20, y: 60 }; // Default top-left position
  };

  const [position, setPosition] = useState(getInitialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Save position to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('pipeline-panel-position', JSON.stringify(position));
  }, [position]);

  // Save open/minimized state
  useEffect(() => {
    localStorage.setItem('pipeline-panel-open', isOpen.toString());
    localStorage.setItem('pipeline-panel-minimized', isMinimized.toString());
  }, [isOpen, isMinimized]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - 300)),
        y: Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - 60))
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  if (!isOpen) return null;

  const panelWidth = isMinimized ? 300 : 'calc(100vw - 40px)';
  const panelHeight = isMinimized ? 48 : 'calc(100vh - 120px)';

  return (
    <div
      className={cn(
        "fixed z-50 bg-card border border-border rounded-lg shadow-strong transition-smooth",
        className
      )}
      style={{
        left: position.x,
        top: position.y,
        width: panelWidth,
        height: panelHeight,
        maxWidth: '95vw',
        maxHeight: '90vh',
      }}
    >
      {/* Header - Draggable */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30 rounded-t-lg cursor-move select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">{title}</h3>
        </div>
        <div className="flex items-center gap-1">
          {onMinimize && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onMinimize}
            >
              {isMinimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {!isMinimized && (
        <div className="h-[calc(100%-48px)] overflow-auto p-4">
          {children}
        </div>
      )}
    </div>
  );
};
