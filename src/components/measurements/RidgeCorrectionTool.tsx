import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { 
  MousePointer2, 
  Move, 
  Save, 
  X, 
  Undo2, 
  RotateCcw,
  Eye,
  EyeOff,
  Crosshair,
  Trash2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface RidgeLine {
  id: string;
  type: 'ridge' | 'hip' | 'valley';
  startX: number; // percentage 0-100
  startY: number;
  endX: number;
  endY: number;
  lengthFt?: number;
}

interface RidgeCorrectionToolProps {
  satelliteImageUrl: string;
  currentRidges: RidgeLine[];
  currentHips?: RidgeLine[];
  currentValleys?: RidgeLine[];
  perimeterPoints?: { x: number; y: number }[]; // percentage coords
  canvasWidth?: number;
  canvasHeight?: number;
  onSave: (correctedLines: RidgeLine[]) => void;
  onCancel: () => void;
}

type Tool = 'select' | 'draw-ridge' | 'draw-hip' | 'draw-valley';

export function RidgeCorrectionTool({
  satelliteImageUrl,
  currentRidges = [],
  currentHips = [],
  currentValleys = [],
  perimeterPoints = [],
  canvasWidth = 640,
  canvasHeight = 640,
  onSave,
  onCancel,
}: RidgeCorrectionToolProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [lines, setLines] = useState<RidgeLine[]>([
    ...currentRidges.map(r => ({ ...r, type: 'ridge' as const })),
    ...currentHips.map(r => ({ ...r, type: 'hip' as const })),
    ...currentValleys.map(r => ({ ...r, type: 'valley' as const })),
  ]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [dragPoint, setDragPoint] = useState<'start' | 'end' | null>(null);
  const [showPerimeter, setShowPerimeter] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false);
  const [imageOpacity, setImageOpacity] = useState(100);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [history, setHistory] = useState<RidgeLine[][]>([]);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Line colors
  const LINE_COLORS = {
    ridge: '#90EE90',  // Light green
    hip: '#9B59B6',    // Purple
    valley: '#DC3545', // Red
  };

  // Load satellite image
  useEffect(() => {
    if (!satelliteImageUrl) return;
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.onerror = () => {
      console.error('Failed to load satellite image');
      toast.error('Failed to load satellite image');
    };
    img.src = satelliteImageUrl;
  }, [satelliteImageUrl]);

  // Convert percentage to canvas pixels
  const pctToCanvas = useCallback((pctX: number, pctY: number) => ({
    x: (pctX / 100) * canvasWidth,
    y: (pctY / 100) * canvasHeight,
  }), [canvasWidth, canvasHeight]);

  // Convert canvas pixels to percentage
  const canvasToPct = useCallback((canvasX: number, canvasY: number) => ({
    x: (canvasX / canvasWidth) * 100,
    y: (canvasY / canvasHeight) * 100,
  }), [canvasWidth, canvasHeight]);

  // Draw everything
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw satellite image
    if (imageRef.current && imageLoaded) {
      ctx.globalAlpha = imageOpacity / 100;
      ctx.drawImage(imageRef.current, 0, 0, canvasWidth, canvasHeight);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    // Draw perimeter
    if (showPerimeter && perimeterPoints.length > 2) {
      ctx.beginPath();
      const firstPt = pctToCanvas(perimeterPoints[0].x, perimeterPoints[0].y);
      ctx.moveTo(firstPt.x, firstPt.y);
      perimeterPoints.slice(1).forEach(pt => {
        const p = pctToCanvas(pt.x, pt.y);
        ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw original lines (faded) if showing
    if (showOriginal) {
      const originals = [...currentRidges, ...currentHips, ...currentValleys];
      originals.forEach(line => {
        const start = pctToCanvas(line.startX, line.startY);
        const end = pctToCanvas(line.endX, line.endY);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    // Draw current lines
    lines.forEach(line => {
      const start = pctToCanvas(line.startX, line.startY);
      const end = pctToCanvas(line.endX, line.endY);
      const isSelected = line.id === selectedLineId;
      
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = LINE_COLORS[line.type];
      ctx.lineWidth = isSelected ? 4 : 3;
      ctx.stroke();

      // Draw endpoints
      [start, end].forEach((pt, i) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isSelected ? 8 : 6, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? '#FFFFFF' : LINE_COLORS[line.type];
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Draw type label
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeText(line.type.toUpperCase(), midX - 20, midY - 8);
      ctx.fillText(line.type.toUpperCase(), midX - 20, midY - 8);
    });

    // Draw preview line when drawing
    if (drawStart && activeTool.startsWith('draw-')) {
      // Draw start point
      const startCanvas = pctToCanvas(drawStart.x, drawStart.y);
      ctx.beginPath();
      ctx.arc(startCanvas.x, startCanvas.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [lines, selectedLineId, showPerimeter, showOriginal, imageOpacity, imageLoaded, 
      perimeterPoints, currentRidges, currentHips, currentValleys, drawStart, activeTool,
      canvasWidth, canvasHeight, pctToCanvas]);

  // Redraw on state changes
  useEffect(() => {
    draw();
  }, [draw]);

  // Get mouse position in percentage
  const getMousePct = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const x = ((e.clientX - rect.left) * scaleX / canvasWidth) * 100;
    const y = ((e.clientY - rect.top) * scaleY / canvasHeight) * 100;
    return { x, y };
  };

  // Find line near point
  const findLineNearPoint = (pctX: number, pctY: number, threshold = 5): RidgeLine | null => {
    for (const line of lines) {
      // Check endpoints first
      const distStart = Math.hypot(pctX - line.startX, pctY - line.startY);
      const distEnd = Math.hypot(pctX - line.endX, pctY - line.endY);
      if (distStart < threshold || distEnd < threshold) return line;
      
      // Check line proximity
      const lineLen = Math.hypot(line.endX - line.startX, line.endY - line.startY);
      if (lineLen < 1) continue;
      
      const t = Math.max(0, Math.min(1, 
        ((pctX - line.startX) * (line.endX - line.startX) + 
         (pctY - line.startY) * (line.endY - line.startY)) / (lineLen * lineLen)
      ));
      const closestX = line.startX + t * (line.endX - line.startX);
      const closestY = line.startY + t * (line.endY - line.startY);
      const dist = Math.hypot(pctX - closestX, pctY - closestY);
      if (dist < threshold) return line;
    }
    return null;
  };

  // Check if near endpoint
  const getNearEndpoint = (pctX: number, pctY: number, line: RidgeLine, threshold = 5): 'start' | 'end' | null => {
    const distStart = Math.hypot(pctX - line.startX, pctY - line.startY);
    const distEnd = Math.hypot(pctX - line.endX, pctY - line.endY);
    if (distStart < threshold) return 'start';
    if (distEnd < threshold) return 'end';
    return null;
  };

  // Save to history
  const saveHistory = () => {
    setHistory(prev => [...prev.slice(-20), [...lines]]);
  };

  // Handle mouse down
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pct = getMousePct(e);

    if (activeTool === 'select') {
      const line = findLineNearPoint(pct.x, pct.y);
      if (line) {
        setSelectedLineId(line.id);
        const endpoint = getNearEndpoint(pct.x, pct.y, line);
        if (endpoint) {
          setDragPoint(endpoint);
          saveHistory();
        }
      } else {
        setSelectedLineId(null);
      }
    } else if (activeTool.startsWith('draw-')) {
      if (!drawStart) {
        setDrawStart(pct);
      }
    }
  };

  // Handle mouse move
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pct = getMousePct(e);

    if (dragPoint && selectedLineId) {
      setLines(prev => prev.map(line => {
        if (line.id !== selectedLineId) return line;
        if (dragPoint === 'start') {
          return { ...line, startX: pct.x, startY: pct.y };
        } else {
          return { ...line, endX: pct.x, endY: pct.y };
        }
      }));
    }
  };

  // Handle mouse up
  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pct = getMousePct(e);

    if (activeTool.startsWith('draw-') && drawStart) {
      const dist = Math.hypot(pct.x - drawStart.x, pct.y - drawStart.y);
      if (dist > 3) { // Minimum line length
        saveHistory();
        const type = activeTool.replace('draw-', '') as 'ridge' | 'hip' | 'valley';
        const newLine: RidgeLine = {
          id: `${type}-${Date.now()}`,
          type,
          startX: drawStart.x,
          startY: drawStart.y,
          endX: pct.x,
          endY: pct.y,
        };
        setLines(prev => [...prev, newLine]);
        setSelectedLineId(newLine.id);
      }
      setDrawStart(null);
    }

    setDragPoint(null);
  };

  // Undo
  const handleUndo = () => {
    if (history.length === 0) return;
    const lastState = history[history.length - 1];
    setLines(lastState);
    setHistory(prev => prev.slice(0, -1));
  };

  // Reset
  const handleReset = () => {
    saveHistory();
    setLines([
      ...currentRidges.map(r => ({ ...r, type: 'ridge' as const })),
      ...currentHips.map(r => ({ ...r, type: 'hip' as const })),
      ...currentValleys.map(r => ({ ...r, type: 'valley' as const })),
    ]);
    setSelectedLineId(null);
  };

  // Delete selected
  const handleDelete = () => {
    if (!selectedLineId) return;
    saveHistory();
    setLines(prev => prev.filter(l => l.id !== selectedLineId));
    setSelectedLineId(null);
  };

  // Save
  const handleSave = () => {
    onSave(lines);
    toast.success(`Saved ${lines.length} corrected lines`);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tool Selection */}
          <div className="flex items-center gap-1 border-r pr-2 mr-2">
            <Button
              variant={activeTool === 'select' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTool('select')}
              title="Select & Move"
            >
              <MousePointer2 className="h-4 w-4" />
            </Button>
            <Button
              variant={activeTool === 'draw-ridge' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTool('draw-ridge')}
              className={activeTool === 'draw-ridge' ? 'bg-green-600' : ''}
              title="Draw Ridge"
            >
              <Crosshair className="h-4 w-4" />
              <span className="ml-1 text-xs">Ridge</span>
            </Button>
            <Button
              variant={activeTool === 'draw-hip' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTool('draw-hip')}
              className={activeTool === 'draw-hip' ? 'bg-purple-600' : ''}
              title="Draw Hip"
            >
              <Crosshair className="h-4 w-4" />
              <span className="ml-1 text-xs">Hip</span>
            </Button>
            <Button
              variant={activeTool === 'draw-valley' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTool('draw-valley')}
              className={activeTool === 'draw-valley' ? 'bg-red-600' : ''}
              title="Draw Valley"
            >
              <Crosshair className="h-4 w-4" />
              <span className="ml-1 text-xs">Valley</span>
            </Button>
          </div>

          {/* Actions */}
          <Button variant="outline" size="sm" onClick={handleUndo} disabled={history.length === 0}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleDelete} 
            disabled={!selectedLineId}
            className="text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>

          {/* Visibility */}
          <div className="flex items-center gap-1 border-l pl-2 ml-2">
            <Button
              variant={showPerimeter ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowPerimeter(!showPerimeter)}
              title="Toggle Perimeter"
            >
              {showPerimeter ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
            <Button
              variant={showOriginal ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowOriginal(!showOriginal)}
              title="Toggle Original Lines"
            >
              Original
            </Button>
          </div>

          {/* Opacity slider */}
          <div className="flex items-center gap-2 ml-4">
            <span className="text-xs text-muted-foreground">Image:</span>
            <Slider
              value={[imageOpacity]}
              onValueChange={([v]) => setImageOpacity(v)}
              min={20}
              max={100}
              step={5}
              className="w-24"
            />
          </div>

          {/* Save/Cancel */}
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={onCancel}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              <Save className="h-4 w-4 mr-1" /> Save Corrections
            </Button>
          </div>
        </div>
      </Card>

      {/* Canvas */}
      <div className="relative border rounded-lg overflow-hidden bg-muted">
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className={cn(
            "cursor-crosshair",
            activeTool === 'select' && "cursor-default",
            dragPoint && "cursor-grabbing"
          )}
          style={{ maxWidth: '100%', height: 'auto' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => setDragPoint(null)}
        />
        
        {/* Legend */}
        <div className="absolute bottom-2 left-2 flex gap-2 bg-background/80 px-2 py-1 rounded text-xs">
          <Badge variant="outline" className="bg-[#90EE90]/20 text-[#90EE90] border-[#90EE90]">
            Ridge ({lines.filter(l => l.type === 'ridge').length})
          </Badge>
          <Badge variant="outline" className="bg-[#9B59B6]/20 text-[#9B59B6] border-[#9B59B6]">
            Hip ({lines.filter(l => l.type === 'hip').length})
          </Badge>
          <Badge variant="outline" className="bg-[#DC3545]/20 text-[#DC3545] border-[#DC3545]">
            Valley ({lines.filter(l => l.type === 'valley').length})
          </Badge>
        </div>

        {/* Instructions */}
        <div className="absolute top-2 left-2 bg-background/80 px-2 py-1 rounded text-xs text-muted-foreground">
          {activeTool === 'select' && 'Click endpoints to drag • Click line to select'}
          {activeTool.startsWith('draw-') && 'Click to set start, click again to set end'}
        </div>
      </div>
    </div>
  );
}
