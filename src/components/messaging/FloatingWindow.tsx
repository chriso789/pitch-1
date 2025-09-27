import React, { useState } from "react";
import { X, Minus, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FloatingWindowProps {
  title: string;
  children: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
  onMinimize?: () => void;
  isMinimized?: boolean;
  className?: string;
  headerActions?: React.ReactNode;
  width?: number;
  height?: number;
}

export const FloatingWindow: React.FC<FloatingWindowProps> = ({
  title,
  children,
  isOpen,
  onClose,
  onMinimize,
  isMinimized = false,
  className,
  headerActions,
  width = 400,
  height = 500
}) => {
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

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
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  React.useEffect(() => {
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

  return (
    <div
      className={cn(
        "fixed z-50 bg-card border border-border rounded-lg shadow-strong transition-smooth",
        isMinimized ? "bottom-4" : "",
        className
      )}
      style={{
        left: position.x,
        bottom: isMinimized ? undefined : window.innerHeight - position.y - height,
        top: isMinimized ? undefined : position.y,
        width: isMinimized ? 250 : width,
        height: isMinimized ? 40 : height,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 border-b border-border bg-muted/30 rounded-t-lg cursor-move"
        onMouseDown={handleMouseDown}
      >
        <h3 className="font-semibold text-sm truncate">{title}</h3>
        <div className="flex items-center gap-1">
          {headerActions}
          {onMinimize && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={onMinimize}
            >
              {isMinimized ? <Maximize2 className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {!isMinimized && (
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
};