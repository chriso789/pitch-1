import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas as FabricCanvas, Line, Circle, FabricImage, FabricText } from 'fabric';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  MousePointer, Mountain, Triangle, ArrowDownUp, Square, 
  Undo2, Trash2, Save, Minus, Slash, ZoomIn, ZoomOut, RefreshCw, AlertCircle,
  Move, Maximize
} from 'lucide-react';
import { useRoofTracer, TracerTool, TracedLine } from '@/hooks/useRoofTracer';
import { toast } from 'sonner';

interface TrainingCanvasProps {
  satelliteImageUrl: string;
  centerLat: number;
  centerLng: number;
  zoom?: number;
  existingTraces?: {
    id: string;
    trace_type: string;
    length_ft: number;
    canvas_points: { x: number; y: number }[];
  }[];
  onSave: (linearFeatures: { type: string; wkt: string; length_ft: number; points: { x: number; y: number }[] }[]) => void;
}

const TOOL_CONFIG: { tool: TracerTool; label: string; icon: React.ReactNode; shortcut: string; color: string }[] = [
  { tool: 'select', label: 'Select', icon: <MousePointer className="h-4 w-4" />, shortcut: 'S', color: '#6b7280' },
  { tool: 'ridge', label: 'Ridge', icon: <Mountain className="h-4 w-4" />, shortcut: 'R', color: '#22c55e' },
  { tool: 'hip', label: 'Hip', icon: <Triangle className="h-4 w-4" />, shortcut: 'H', color: '#8b5cf6' },
  { tool: 'valley', label: 'Valley', icon: <ArrowDownUp className="h-4 w-4" />, shortcut: 'V', color: '#ef4444' },
  { tool: 'eave', label: 'Eave', icon: <Minus className="h-4 w-4" />, shortcut: 'E', color: '#14b8a6' },
  { tool: 'rake', label: 'Rake', icon: <Slash className="h-4 w-4" />, shortcut: 'K', color: '#06b6d4' },
  { tool: 'perimeter', label: 'Perimeter', icon: <Square className="h-4 w-4" />, shortcut: 'P', color: '#f97316' },
];

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 700;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4.0;
const ZOOM_STEP = 0.15;

export function TrainingCanvas({
  satelliteImageUrl,
  centerLat,
  centerLng,
  zoom = 20,
  existingTraces = [],
  onSave,
}: TrainingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [previewPoint, setPreviewPoint] = useState<{ x: number; y: number } | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Zoom and pan state
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPosition = useRef<{ x: number; y: number } | null>(null);

  const tracer = useRoofTracer({
    centerLat,
    centerLng,
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    zoom,
  });

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      selection: false,
      renderOnAddRemove: true,
    });

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, []);

  // Load satellite image as background
  useEffect(() => {
    if (!fabricCanvas || !satelliteImageUrl) return;

    setImageLoaded(false);
    setImageError(null);

    FabricImage.fromURL(satelliteImageUrl, { crossOrigin: 'anonymous' })
      .then((img) => {
        if (!img) {
          setImageError('Failed to load image');
          return;
        }

        const scaleX = CANVAS_WIDTH / (img.width || CANVAS_WIDTH);
        const scaleY = CANVAS_HEIGHT / (img.height || CANVAS_HEIGHT);

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
        setImageError(null);
      })
      .catch((err) => {
        console.error('Failed to load satellite image:', err);
        setImageError('Failed to load satellite image. The URL may be invalid or blocked.');
      });
  }, [fabricCanvas, satelliteImageUrl, reloadKey]);

  const handleRetryImage = () => {
    setReloadKey((k) => k + 1);
  };

  // Render traced lines on canvas
  const renderLines = useCallback(() => {
    if (!fabricCanvas) return;

    fabricCanvas.getObjects().forEach((obj) => {
      fabricCanvas.remove(obj);
    });

    // Draw completed lines
    tracer.tracedLines.forEach((line) => {
      if (line.points.length < 2) return;

      const color = tracer.getToolColor(line.type);

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

      line.points.forEach((point) => {
        const circle = new Circle({
          left: point.x - 5,
          top: point.y - 5,
          radius: 5,
          fill: color,
          stroke: '#fff',
          strokeWidth: 2,
          selectable: false,
          evented: false,
        });
        fabricCanvas.add(circle);
      });

      // Length label
      if (line.points.length >= 2) {
        const midX = (line.points[0].x + line.points[line.points.length - 1].x) / 2;
        const midY = (line.points[0].y + line.points[line.points.length - 1].y) / 2;

        const label = new FabricText(`${line.lengthFt} ft`, {
          left: midX,
          top: midY - 14,
          fontSize: 12,
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

    // Draw preview line
    if (tracer.isDrawing && tracer.currentPoints.length > 0 && previewPoint) {
      const color = tracer.getToolColor(tracer.activeTool);
      const startPoint = tracer.currentPoints[0];

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

      const startCircle = new Circle({
        left: startPoint.x - 6,
        top: startPoint.y - 6,
        radius: 6,
        fill: color,
        stroke: '#fff',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
      fabricCanvas.add(startCircle);

      const previewLength = tracer.calculateLengthFt([startPoint, previewPoint]);
      const previewLabel = new FabricText(`${previewLength} ft`, {
        left: (startPoint.x + previewPoint.x) / 2,
        top: (startPoint.y + previewPoint.y) / 2 - 16,
        fontSize: 13,
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

  useEffect(() => {
    renderLines();
  }, [renderLines]);

  // Zoom functions
  const handleZoomIn = useCallback(() => {
    if (!fabricCanvas) return;
    const newZoom = Math.min(canvasZoom + ZOOM_STEP, MAX_ZOOM);
    setCanvasZoom(newZoom);
    fabricCanvas.setZoom(newZoom);
    fabricCanvas.renderAll();
  }, [fabricCanvas, canvasZoom]);

  const handleZoomOut = useCallback(() => {
    if (!fabricCanvas) return;
    const newZoom = Math.max(canvasZoom - ZOOM_STEP, MIN_ZOOM);
    setCanvasZoom(newZoom);
    fabricCanvas.setZoom(newZoom);
    fabricCanvas.renderAll();
  }, [fabricCanvas, canvasZoom]);

  const handleZoomReset = useCallback(() => {
    if (!fabricCanvas) return;
    setCanvasZoom(1);
    fabricCanvas.setZoom(1);
    fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    fabricCanvas.renderAll();
  }, [fabricCanvas]);

  const handleZoomFit = useCallback(() => {
    if (!fabricCanvas) return;
    setCanvasZoom(1);
    fabricCanvas.setZoom(1);
    fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    fabricCanvas.renderAll();
  }, [fabricCanvas]);

  // Mouse wheel zoom
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleWheel = (opt: any) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY;
      let newZoom = canvasZoom * (delta > 0 ? 0.9 : 1.1);
      newZoom = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);

      // Zoom toward mouse position
      const pointer = fabricCanvas.getScenePoint(e);
      fabricCanvas.zoomToPoint(pointer, newZoom);
      setCanvasZoom(newZoom);
    };

    fabricCanvas.on('mouse:wheel', handleWheel);
    return () => {
      fabricCanvas.off('mouse:wheel', handleWheel);
    };
  }, [fabricCanvas, canvasZoom]);

  // Track space key for panning
  const spaceKeyPressed = useRef(false);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spaceKeyPressed.current) {
        spaceKeyPressed.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceKeyPressed.current = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Handle mouse events for drawing and panning
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleMouseDown = (e: any) => {
      const evt = e.e as MouseEvent;
      
      // Middle mouse or Space+click for panning
      if (evt.button === 1 || (evt.button === 0 && spaceKeyPressed.current)) {
        setIsPanning(true);
        lastPanPosition.current = { x: evt.clientX, y: evt.clientY };
        fabricCanvas.defaultCursor = 'grabbing';
        return;
      }

      const pointer = fabricCanvas.getScenePoint(evt);

      if (tracer.activeTool === 'select') return;

      if (tracer.isDrawing) {
        tracer.completeLine(pointer);
        setPreviewPoint(null);
        setHasChanges(true);
      } else {
        tracer.startLine(pointer);
      }
    };

    const handleMouseMove = (e: any) => {
      const evt = e.e as MouseEvent;
      
      // Handle panning
      if (isPanning && lastPanPosition.current) {
        const deltaX = evt.clientX - lastPanPosition.current.x;
        const deltaY = evt.clientY - lastPanPosition.current.y;
        
        const vpt = fabricCanvas.viewportTransform;
        if (vpt) {
          vpt[4] += deltaX;
          vpt[5] += deltaY;
          fabricCanvas.setViewportTransform(vpt);
        }
        
        lastPanPosition.current = { x: evt.clientX, y: evt.clientY };
        return;
      }

      if (!tracer.isDrawing) return;
      const pointer = fabricCanvas.getScenePoint(evt);
      setPreviewPoint(pointer);
    };

    const handleMouseUp = () => {
      if (isPanning) {
        setIsPanning(false);
        lastPanPosition.current = null;
        fabricCanvas.defaultCursor = 'default';
      }
    };

    fabricCanvas.on('mouse:down', handleMouseDown);
    fabricCanvas.on('mouse:move', handleMouseMove);
    fabricCanvas.on('mouse:up', handleMouseUp);

    return () => {
      fabricCanvas.off('mouse:down', handleMouseDown);
      fabricCanvas.off('mouse:move', handleMouseMove);
      fabricCanvas.off('mouse:up', handleMouseUp);
    };
  }, [fabricCanvas, tracer, isPanning]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        tracer.cancelLine();
        setPreviewPoint(null);
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        tracer.undoLast();
        setHasChanges(true);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        handleZoomReset();
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
        tracer.setActiveTool('select');
      } else if (e.key.toLowerCase() === 'r') {
        tracer.setActiveTool('ridge');
      } else if (e.key.toLowerCase() === 'h') {
        tracer.setActiveTool('hip');
      } else if (e.key.toLowerCase() === 'v') {
        tracer.setActiveTool('valley');
      } else if (e.key.toLowerCase() === 'e') {
        tracer.setActiveTool('eave');
      } else if (e.key.toLowerCase() === 'k') {
        tracer.setActiveTool('rake');
      } else if (e.key.toLowerCase() === 'p') {
        tracer.setActiveTool('perimeter');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tracer, handleZoomIn, handleZoomOut, handleZoomReset]);

  const handleSave = () => {
    const linearFeatures = tracer.tracedLines.map((line) => ({
      type: line.type,
      wkt: tracer.generateWKT(line.points),
      length_ft: line.lengthFt,
      points: line.points,
    }));

    if (linearFeatures.length === 0) {
      toast.error('Please trace at least one roof feature');
      return;
    }

    onSave(linearFeatures);
    setHasChanges(false);
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-1 flex-wrap">
          <TooltipProvider>
            {TOOL_CONFIG.map(({ tool, label, icon, shortcut, color }) => (
              <Tooltip key={tool}>
                <TooltipTrigger asChild>
                  <Button
                    variant={tracer.activeTool === tool ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => tracer.setActiveTool(tool)}
                    className="gap-1.5"
                    style={tracer.activeTool === tool ? { backgroundColor: color } : {}}
                  >
                    {icon}
                    <span className="hidden md:inline">{label}</span>
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
          {/* Zoom Controls */}
          <div className="flex items-center gap-0.5 mr-2 border-r pr-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={handleZoomOut} disabled={canvasZoom <= MIN_ZOOM}>
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Zoom Out (-)</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <Badge variant="secondary" className="min-w-[50px] justify-center text-xs">
              {Math.round(canvasZoom * 100)}%
            </Badge>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={handleZoomIn} disabled={canvasZoom >= MAX_ZOOM}>
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Zoom In (+)</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={handleZoomFit}>
                    <Maximize className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Fit to View (0)</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              tracer.undoLast();
              setHasChanges(true);
            }}
            disabled={tracer.tracedLines.length === 0}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              tracer.clearAll();
              setHasChanges(true);
            }}
            disabled={tracer.tracedLines.length === 0}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div 
        ref={containerRef}
        className="relative border rounded-lg overflow-hidden bg-black"
        style={{ cursor: isPanning ? 'grabbing' : (canvasZoom > 1 ? 'grab' : 'crosshair') }}
      >
        <canvas ref={canvasRef} className="block" />

        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/80">
            <div className="text-sm text-muted-foreground">Loading satellite image...</div>
          </div>
        )}

        {imageError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/90 gap-3">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <div className="text-sm text-destructive font-medium">Failed to load satellite image</div>
            <Button variant="outline" size="sm" onClick={handleRetryImage}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        )}

        {/* Scale Bar */}
        {imageLoaded && (
          <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1 bg-black/70 p-2 rounded text-white text-xs">
            <div className="flex items-center gap-1">
              <div className="w-16 h-1 bg-white border border-black" />
              <span>{Math.round((tracer.feetPerPixel * 64) / canvasZoom)} ft</span>
            </div>
            <span className="text-[10px] opacity-70">
              {canvasZoom > 1 ? `${Math.round(canvasZoom * 100)}% • ` : ''}Scroll to zoom • Drag to pan
            </span>
          </div>
        )}

        {/* Drawing hints */}
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
      <div className="flex flex-wrap items-center gap-2 p-3 bg-muted/30 rounded-lg text-sm">
        <span className="text-muted-foreground font-medium">Traced:</span>
        {tracer.totals.ridgeCount > 0 && (
          <Badge variant="outline" style={{ borderColor: '#22c55e', color: '#22c55e' }}>
            {tracer.totals.ridgeCount} ridge{tracer.totals.ridgeCount !== 1 ? 's' : ''} ({Math.round(tracer.totals.ridge)} ft)
          </Badge>
        )}
        {tracer.totals.hipCount > 0 && (
          <Badge variant="outline" style={{ borderColor: '#8b5cf6', color: '#8b5cf6' }}>
            {tracer.totals.hipCount} hip{tracer.totals.hipCount !== 1 ? 's' : ''} ({Math.round(tracer.totals.hip)} ft)
          </Badge>
        )}
        {tracer.totals.valleyCount > 0 && (
          <Badge variant="outline" style={{ borderColor: '#ef4444', color: '#ef4444' }}>
            {tracer.totals.valleyCount} valley{tracer.totals.valleyCount !== 1 ? 's' : ''} ({Math.round(tracer.totals.valley)} ft)
          </Badge>
        )}
        {tracer.totals.eaveCount > 0 && (
          <Badge variant="outline" style={{ borderColor: '#14b8a6', color: '#14b8a6' }}>
            {tracer.totals.eaveCount} eave{tracer.totals.eaveCount !== 1 ? 's' : ''} ({Math.round(tracer.totals.eave)} ft)
          </Badge>
        )}
        {tracer.totals.rakeCount > 0 && (
          <Badge variant="outline" style={{ borderColor: '#06b6d4', color: '#06b6d4' }}>
            {tracer.totals.rakeCount} rake{tracer.totals.rakeCount !== 1 ? 's' : ''} ({Math.round(tracer.totals.rake)} ft)
          </Badge>
        )}
        {tracer.totals.perimeter > 0 && (
          <Badge variant="outline" style={{ borderColor: '#f97316', color: '#f97316' }}>
            Perimeter: {Math.round(tracer.totals.perimeter)} ft
          </Badge>
        )}
        {tracer.tracedLines.length === 0 && (
          <span className="text-muted-foreground italic">No features traced yet</span>
        )}
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button 
          onClick={handleSave} 
          disabled={tracer.tracedLines.length === 0}
          size="lg"
        >
          <Save className="h-4 w-4 mr-2" />
          Save Traced Features
          {hasChanges && <Badge variant="secondary" className="ml-2">Unsaved</Badge>}
        </Button>
      </div>
    </div>
  );
}
