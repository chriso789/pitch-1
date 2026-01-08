import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Pencil,
  Circle,
  Square,
  ArrowRight,
  Type,
  Eraser,
  Undo2,
  Redo2,
  Save,
  X,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type CustomerPhoto } from '@/hooks/usePhotos';
import { toast } from '@/components/ui/use-toast';

type DrawingTool = 'pen' | 'arrow' | 'circle' | 'rectangle' | 'text' | 'eraser';

const COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'White', value: '#ffffff' },
  { name: 'Black', value: '#000000' },
];

interface PhotoMarkupEditorProps {
  photo: CustomerPhoto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (annotatedImageUrl: string) => Promise<void>;
}

export const PhotoMarkupEditor: React.FC<PhotoMarkupEditorProps> = ({
  photo,
  open,
  onOpenChange,
  onSave,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<DrawingTool>('pen');
  const [color, setColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isSaving, setIsSaving] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [textPosition, setTextPosition] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);

  // Load image into canvas
  useEffect(() => {
    if (!open || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Set canvas size to match image
      const maxWidth = Math.min(800, window.innerWidth - 100);
      const maxHeight = window.innerHeight - 300;
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
      
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Save initial state
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setHistory([imageData]);
      setHistoryIndex(0);
      setImageLoaded(true);
    };
    img.onerror = () => {
      toast({
        title: 'Failed to load image',
        description: 'Could not load the photo for editing',
        variant: 'destructive',
      });
    };
    img.src = photo.file_url;

    return () => {
      setImageLoaded(false);
      setHistory([]);
      setHistoryIndex(-1);
    };
  }, [open, photo.file_url]);

  // Save current state to history
  const saveToHistory = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(imageData);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  // Undo
  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    const prevIndex = historyIndex - 1;
    ctx.putImageData(history[prevIndex], 0, 0);
    setHistoryIndex(prevIndex);
  }, [history, historyIndex]);

  // Redo
  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    const nextIndex = historyIndex + 1;
    ctx.putImageData(history[nextIndex], 0, 0);
    setHistoryIndex(nextIndex);
  }, [history, historyIndex]);

  // Clear annotations
  const handleClear = useCallback(() => {
    if (history.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.putImageData(history[0], 0, 0);
    setHistory([history[0]]);
    setHistoryIndex(0);
  }, [history]);

  // Get mouse position relative to canvas
  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // Handle mouse down
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getMousePos(e);
    setStartPos(pos);
    setIsDrawing(true);

    if (tool === 'text') {
      setTextPosition(pos);
      setShowTextInput(true);
      setIsDrawing(false);
      return;
    }

    if (tool === 'pen' || tool === 'eraser') {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;

      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
      ctx.lineWidth = tool === 'eraser' ? strokeWidth * 3 : strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  };

  // Handle mouse move
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    const pos = getMousePos(e);

    if (tool === 'pen' || tool === 'eraser') {
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (tool === 'arrow' || tool === 'circle' || tool === 'rectangle') {
      // Restore previous state and redraw shape
      if (historyIndex >= 0) {
        ctx.putImageData(history[historyIndex], 0, 0);
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.fillStyle = color;

      if (tool === 'arrow') {
        drawArrow(ctx, startPos.x, startPos.y, pos.x, pos.y);
      } else if (tool === 'circle') {
        const radius = Math.sqrt(
          Math.pow(pos.x - startPos.x, 2) + Math.pow(pos.y - startPos.y, 2)
        );
        ctx.beginPath();
        ctx.arc(startPos.x, startPos.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (tool === 'rectangle') {
        ctx.strokeRect(
          startPos.x,
          startPos.y,
          pos.x - startPos.x,
          pos.y - startPos.y
        );
      }
    }
  };

  // Handle mouse up
  const handleMouseUp = () => {
    if (isDrawing) {
      setIsDrawing(false);
      saveToHistory();
    }
  };

  // Draw arrow helper
  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ) => {
    const headLength = 15;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  };

  // Add text
  const handleAddText = () => {
    if (!textInput.trim()) {
      setShowTextInput(false);
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    ctx.font = `${strokeWidth * 6}px sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(textInput, textPosition.x, textPosition.y);

    saveToHistory();
    setTextInput('');
    setShowTextInput(false);
  };

  // Save annotated image
  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsSaving(true);
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      await onSave(dataUrl);
    } catch (error) {
      console.error('Save error:', error);
      toast({
        title: 'Save failed',
        description: 'Could not save the annotated image',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[95vh] p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Photo Markup Editor
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col lg:flex-row">
          {/* Tools sidebar */}
          <div className="lg:w-16 flex lg:flex-col items-center gap-2 p-2 border-b lg:border-b-0 lg:border-r bg-muted/30">
            <Button
              variant={tool === 'pen' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setTool('pen')}
              title="Pencil"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant={tool === 'arrow' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setTool('arrow')}
              title="Arrow"
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant={tool === 'circle' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setTool('circle')}
              title="Circle"
            >
              <Circle className="h-4 w-4" />
            </Button>
            <Button
              variant={tool === 'rectangle' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setTool('rectangle')}
              title="Rectangle"
            >
              <Square className="h-4 w-4" />
            </Button>
            <Button
              variant={tool === 'text' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setTool('text')}
              title="Text"
            >
              <Type className="h-4 w-4" />
            </Button>
            <Button
              variant={tool === 'eraser' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setTool('eraser')}
              title="Eraser"
            >
              <Eraser className="h-4 w-4" />
            </Button>

            <Separator className="my-1" />

            <Button
              variant="ghost"
              size="icon"
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              title="Undo"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              title="Redo"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClear}
              title="Clear All"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          {/* Canvas area */}
          <div className="flex-1 p-4 overflow-auto bg-gray-100 dark:bg-gray-900" ref={containerRef}>
            <div className="relative inline-block">
              <canvas
                ref={canvasRef}
                className={cn(
                  'max-w-full rounded shadow-lg',
                  tool === 'pen' && 'cursor-crosshair',
                  tool === 'eraser' && 'cursor-cell',
                  tool === 'text' && 'cursor-text'
                )}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />

              {/* Text input overlay */}
              {showTextInput && (
                <div
                  className="absolute z-10"
                  style={{
                    left: `${(textPosition.x / (canvasRef.current?.width || 1)) * 100}%`,
                    top: `${(textPosition.y / (canvasRef.current?.height || 1)) * 100}%`,
                  }}
                >
                  <div className="flex gap-1">
                    <Input
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      placeholder="Enter text..."
                      className="w-48"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddText();
                        if (e.key === 'Escape') setShowTextInput(false);
                      }}
                    />
                    <Button size="sm" onClick={handleAddText}>
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowTextInput(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Color and size panel */}
          <div className="lg:w-40 p-3 border-t lg:border-t-0 lg:border-l space-y-4 bg-muted/30">
            <div>
              <Label className="text-xs mb-2 block">Color</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c.value}
                    className={cn(
                      'w-8 h-8 rounded-full border-2 transition-transform',
                      color === c.value ? 'scale-110 border-primary' : 'border-transparent'
                    )}
                    style={{ backgroundColor: c.value }}
                    onClick={() => setColor(c.value)}
                    title={c.name}
                  />
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs mb-2 block">Size: {strokeWidth}</Label>
              <Slider
                value={[strokeWidth]}
                onValueChange={([v]) => setStrokeWidth(v)}
                min={1}
                max={10}
                step={1}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="px-4 py-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !imageLoaded}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Annotations
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PhotoMarkupEditor;
