import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas as FabricCanvas, Line, Circle, FabricImage, FabricText } from 'fabric';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { MousePointer, Mountain, Triangle, ArrowDownUp, Square, Undo2, Trash2, Save, X } from 'lucide-react';
import { useRoofTracer, TracerTool, TracedLine } from '@/hooks/useRoofTracer';
import { toast } from 'sonner';

interface RoofTracerOverlayProps {
  satelliteImageUrl: string;
  centerLat: number;
  centerLng: number;
  zoom?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  onSave: (linearFeatures: { type: string; wkt: string; length_ft: number }[]) => void;
  onCancel: () => void;
}

const TOOL_CONFIG: { tool: TracerTool; label: string; icon: React.ReactNode; shortcut: string }[] = [
  { tool: 'select', label: 'Select', icon: <MousePointer className="h-4 w-4" />, shortcut: 'S' },
  { tool: 'ridge', label: 'Ridge', icon: <Mountain className="h-4 w-4" />, shortcut: 'R' },
  { tool: 'hip', label: 'Hip', icon: <Triangle className="h-4 w-4" />, shortcut: 'H' },
  { tool: 'valley', label: 'Valley', icon: <ArrowDownUp className="h-4 w-4" />, shortcut: 'V' },
  { tool: 'perimeter', label: 'Perimeter', icon: <Square className="h-4 w-4" />, shortcut: 'P' },
];

export function RoofTracerOverlay({
  satelliteImageUrl,
  centerLat,
  centerLng,
  zoom = 20,
  canvasWidth = 800,
  canvasHeight = 600,
  onSave,
  onCancel,
}: RoofTracerOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [previewPoint, setPreviewPoint] = useState<{ x: number; y: number } | null>(null);
  
  const tracer = useRoofTracer({
    centerLat,
    centerLng,
    canvasWidth,
    canvasHeight,
    zoom,
  });
  
  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const canvas = new FabricCanvas(canvasRef.current, {
      width: canvasWidth,
      height: canvasHeight,
      selection: false,
      renderOnAddRemove: true,
    });
    
    setFabricCanvas(canvas);
    
    return () => {
      canvas.dispose();
    };
  }, [canvasWidth, canvasHeight]);
  
  // Load satellite image as background
  useEffect(() => {
    if (!fabricCanvas || !satelliteImageUrl) return;
    
    setImageLoaded(false);
    
    FabricImage.fromURL(satelliteImageUrl, { crossOrigin: 'anonymous' })
      .then((img) => {
        if (!img) return;
        
        // Scale image to fit canvas
        const scaleX = canvasWidth / (img.width || canvasWidth);
        const scaleY = canvasHeight / (img.height || canvasHeight);
        
        img.set({
          scaleX,
          scaleY,
          left: 0,
          top: 0,
          selectable: false,
          evented: false,
        });
        
        fabricCanvas.backgroundImage = img;
        fabricCanvas.renderAll();
        setImageLoaded(true);
      })
      .catch((err) => {
        console.error('Failed to load satellite image:', err);
        toast.error('Failed to load satellite image');
      });
  }, [fabricCanvas, satelliteImageUrl, canvasWidth, canvasHeight]);
  
  // Render traced lines on canvas
  const renderLines = useCallback(() => {
    if (!fabricCanvas) return;
    
    // Clear existing objects (keep background)
    fabricCanvas.getObjects().forEach(obj => {
      fabricCanvas.remove(obj);
    });
    
    // Draw completed lines
    tracer.tracedLines.forEach((line) => {
      if (line.points.length < 2) return;
      
      const color = tracer.getToolColor(line.type);
      
      // Draw line segments
      for (let i = 0; i < line.points.length - 1; i++) {
        const fabricLine = new Line(
          [line.points[i].x, line.points[i].y, line.points[i + 1].x, line.points[i + 1].y],
          {
            stroke: color,
            strokeWidth: 3,
            selectable: false,
            evented: false,
          }
        );
        fabricCanvas.add(fabricLine);
      }
      
      // Draw endpoints
      line.points.forEach((point, idx) => {
        const circle = new Circle({
          left: point.x - 4,
          top: point.y - 4,
          radius: 4,
          fill: color,
          stroke: '#fff',
          strokeWidth: 1,
          selectable: false,
          evented: false,
        });
        fabricCanvas.add(circle);
      });
      
      // Add length label at midpoint
      if (line.points.length >= 2) {
        const midX = (line.points[0].x + line.points[line.points.length - 1].x) / 2;
        const midY = (line.points[0].y + line.points[line.points.length - 1].y) / 2;
        
        const label = new FabricText(`${line.lengthFt} ft`, {
          left: midX,
          top: midY - 12,
          fontSize: 11,
          fill: '#fff',
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
          textBackgroundColor: color,
          selectable: false,
          evented: false,
          originX: 'center',
        });
        fabricCanvas.add(label);
      }
    });
    
    // Draw current line in progress
    if (tracer.isDrawing && tracer.currentPoints.length > 0 && previewPoint) {
      const color = tracer.getToolColor(tracer.activeTool);
      const startPoint = tracer.currentPoints[0];
      
      // Preview line
      const previewLine = new Line(
        [startPoint.x, startPoint.y, previewPoint.x, previewPoint.y],
        {
          stroke: color,
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
        }
      );
      fabricCanvas.add(previewLine);
      
      // Start point
      const startCircle = new Circle({
        left: startPoint.x - 5,
        top: startPoint.y - 5,
        radius: 5,
        fill: color,
        stroke: '#fff',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
      fabricCanvas.add(startCircle);
      
      // Preview length
      const dx = previewPoint.x - startPoint.x;
      const dy = previewPoint.y - startPoint.y;
      const previewLength = tracer.calculateLengthFt([startPoint, previewPoint]);
      
      const previewLabel = new FabricText(`${previewLength} ft`, {
        left: (startPoint.x + previewPoint.x) / 2,
        top: (startPoint.y + previewPoint.y) / 2 - 15,
        fontSize: 12,
        fill: color,
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        selectable: false,
        evented: false,
        originX: 'center',
      });
      fabricCanvas.add(previewLabel);
    }
    
    fabricCanvas.renderAll();
  }, [fabricCanvas, tracer, previewPoint]);
  
  // Re-render when lines or preview changes
  useEffect(() => {
    renderLines();
  }, [renderLines]);
  
  // Handle mouse events
  useEffect(() => {
    if (!fabricCanvas) return;
    
    const handleMouseDown = (e: any) => {
      const pointer = fabricCanvas.getScenePoint(e.e);
      
      if (tracer.activeTool === 'select') return;
      
      if (tracer.isDrawing) {
        // Complete the line
        tracer.completeLine(pointer);
        setPreviewPoint(null);
      } else {
        // Start a new line
        tracer.startLine(pointer);
      }
    };
    
    const handleMouseMove = (e: any) => {
      if (!tracer.isDrawing) return;
      const pointer = fabricCanvas.getScenePoint(e.e);
      setPreviewPoint(pointer);
    };
    
    fabricCanvas.on('mouse:down', handleMouseDown);
    fabricCanvas.on('mouse:move', handleMouseMove);
    
    return () => {
      fabricCanvas.off('mouse:down', handleMouseDown);
      fabricCanvas.off('mouse:move', handleMouseMove);
    };
  }, [fabricCanvas, tracer]);
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        tracer.cancelLine();
        setPreviewPoint(null);
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        tracer.undoLast();
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
        tracer.setActiveTool('select');
      } else if (e.key.toLowerCase() === 'r') {
        tracer.setActiveTool('ridge');
      } else if (e.key.toLowerCase() === 'h') {
        tracer.setActiveTool('hip');
      } else if (e.key.toLowerCase() === 'v') {
        tracer.setActiveTool('valley');
      } else if (e.key.toLowerCase() === 'p') {
        tracer.setActiveTool('perimeter');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tracer]);
  
  const handleSave = () => {
    const linearFeatures = tracer.generateLinearFeaturesWKT();
    if (linearFeatures.length === 0) {
      toast.error('Please trace at least one roof feature');
      return;
    }
    onSave(linearFeatures);
  };
  
  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 p-2 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-1">
          <TooltipProvider>
            {TOOL_CONFIG.map(({ tool, label, icon, shortcut }) => (
              <Tooltip key={tool}>
                <TooltipTrigger asChild>
                  <Button
                    variant={tracer.activeTool === tool ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => tracer.setActiveTool(tool)}
                    className="gap-1"
                    style={tracer.activeTool === tool ? { backgroundColor: tracer.getToolColor(tool) } : {}}
                  >
                    {icon}
                    <span className="hidden sm:inline">{label}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{label} ({shortcut})</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>
        </div>
        
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={tracer.undoLast}
            disabled={tracer.tracedLines.length === 0}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={tracer.clearAll}
            disabled={tracer.tracedLines.length === 0}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {/* Canvas */}
      <div className="relative border rounded-lg overflow-hidden bg-black">
        <canvas ref={canvasRef} className="block" />
        
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/80">
            <div className="text-sm text-muted-foreground">Loading satellite image...</div>
          </div>
        )}
        
        {/* Drawing hint */}
        {tracer.activeTool !== 'select' && !tracer.isDrawing && imageLoaded && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-black/70 text-white text-sm rounded-full">
            Click to start {tracer.activeTool} line
          </div>
        )}
        
        {tracer.isDrawing && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-black/70 text-white text-sm rounded-full">
            Click to complete line • ESC to cancel
          </div>
        )}
      </div>
      
      {/* Totals Summary */}
      <div className="flex flex-wrap items-center gap-2 p-2 bg-muted/30 rounded-lg text-sm">
        <span className="text-muted-foreground">Traced:</span>
        {tracer.totals.ridgeCount > 0 && (
          <Badge variant="outline" style={{ borderColor: tracer.getToolColor('ridge'), color: tracer.getToolColor('ridge') }}>
            {tracer.totals.ridgeCount} ridge{tracer.totals.ridgeCount !== 1 ? 's' : ''} ({Math.round(tracer.totals.ridge)} ft)
          </Badge>
        )}
        {tracer.totals.hipCount > 0 && (
          <Badge variant="outline" style={{ borderColor: tracer.getToolColor('hip'), color: tracer.getToolColor('hip') }}>
            {tracer.totals.hipCount} hip{tracer.totals.hipCount !== 1 ? 's' : ''} ({Math.round(tracer.totals.hip)} ft)
          </Badge>
        )}
        {tracer.totals.valleyCount > 0 && (
          <Badge variant="outline" style={{ borderColor: tracer.getToolColor('valley'), color: tracer.getToolColor('valley') }}>
            {tracer.totals.valleyCount} valley{tracer.totals.valleyCount !== 1 ? 's' : ''} ({Math.round(tracer.totals.valley)} ft)
          </Badge>
        )}
        {tracer.totals.perimeter > 0 && (
          <Badge variant="outline" style={{ borderColor: tracer.getToolColor('perimeter'), color: tracer.getToolColor('perimeter') }}>
            Perimeter: {Math.round(tracer.totals.perimeter)} ft
          </Badge>
        )}
        {tracer.tracedLines.length === 0 && (
          <span className="text-muted-foreground italic">No features traced yet</span>
        )}
      </div>
      
      {/* Action Buttons */}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          <X className="h-4 w-4 mr-1" />
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={tracer.tracedLines.length === 0}>
          <Save className="h-4 w-4 mr-1" />
          Save Traced Features
        </Button>
      </div>
    </div>
  );
}
