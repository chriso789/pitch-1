import { useEffect, useRef, useState } from "react";
import { Canvas as FabricCanvas, Line, Polygon, Circle, Text as FabricText, FabricObject, FabricImage } from "fabric";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Move, Mountain, Triangle, ArrowDownUp, Square, Trash2, RotateCcw, Eye, EyeOff, MapPin, StickyNote, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useLRUImageCache } from "@/hooks/useLRUImageCache";

interface Point {
  x: number;
  y: number;
}

interface ComprehensiveMeasurementOverlayProps {
  satelliteImageUrl: string;
  measurement: any;
  tags: Record<string, any>;
  centerLng: number;
  centerLat: number;
  zoom: number;
  onMeasurementUpdate: (updatedMeasurement: any, updatedTags: Record<string, any>) => void;
  canvasWidth?: number;
  canvasHeight?: number;
}

type EditMode = 'select' | 'add-ridge' | 'add-hip' | 'add-valley' | 'add-facet' | 'delete' | 'add-marker' | 'add-note' | 'add-damage';

interface Annotation {
  id: string;
  type: 'marker' | 'note' | 'damage';
  position: Point;
  text?: string;
  normalizedPosition: [number, number];
}

export function ComprehensiveMeasurementOverlay({
  satelliteImageUrl,
  measurement,
  tags,
  centerLng,
  centerLat,
  zoom,
  onMeasurementUpdate,
  canvasWidth = 640,
  canvasHeight = 480,
}: ComprehensiveMeasurementOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [editMode, setEditMode] = useState<EditMode>('select');
  const [layers, setLayers] = useState({
    facets: true,
    ridges: true,
    hips: true,
    valleys: true,
    perimeter: true,
    annotations: true,
  });
  const [drawPoints, setDrawPoints] = useState<Point[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [pendingAnnotation, setPendingAnnotation] = useState<{ position: Point; type: 'note' | 'damage' } | null>(null);
  const [noteText, setNoteText] = useState('');
  
  // Store original data for reset
  const originalDataRef = useRef({ measurement, tags });
  
  // LRU cache for satellite images (max 10 images to prevent memory issues)
  const imageCache = useLRUImageCache({ maxSize: 10 });

  // Load and cache satellite image with LRU eviction
  useEffect(() => {
    // Check if image is in cache
    const cachedImage = imageCache.getImage(satelliteImageUrl);
    
    if (cachedImage) {
      // Use cached image
      if (fabricCanvas) {
        fabricCanvas.backgroundImage = cachedImage;
        fabricCanvas.renderAll();
      }
      return;
    }

    // Load new image
    console.log('Loading satellite image:', satelliteImageUrl);
    FabricImage.fromURL(satelliteImageUrl, {
      crossOrigin: 'anonymous',
    }).then((img) => {
      // Cache the loaded image
      imageCache.setImage(satelliteImageUrl, img);
      
      // Update canvas background if canvas exists
      if (fabricCanvas) {
        fabricCanvas.backgroundImage = img;
        fabricCanvas.renderAll();
      }
      
      // Log cache stats
      const stats = imageCache.getCacheStats();
      console.log(`[Cache Stats] ${stats.size}/${stats.maxSize} images cached`);
    }).catch((error) => {
      console.error('Failed to load satellite image:', error);
      toast.error('Failed to load satellite image');
    });
  }, [satelliteImageUrl, fabricCanvas, imageCache]);

  // Initialize canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: canvasWidth,
      height: canvasHeight,
      backgroundColor: "#1a1a1a",
      selection: editMode === 'select',
    });

    // Use cached image if available
    const cachedImage = imageCache.getImage(satelliteImageUrl);
    if (cachedImage) {
      console.log('Applying cached image to new canvas');
      canvas.backgroundImage = cachedImage;
      canvas.renderAll();
    }

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [canvasWidth, canvasHeight, satelliteImageUrl, imageCache]);

  // Update canvas selection mode
  useEffect(() => {
    if (!fabricCanvas) return;
    fabricCanvas.selection = editMode === 'select';
    fabricCanvas.renderAll();
  }, [editMode, fabricCanvas]);

  // Draw all measurement overlays
  useEffect(() => {
    if (!fabricCanvas || !measurement) return;

    // Clear existing overlays (keep background)
    const objects = fabricCanvas.getObjects();
    objects.forEach(obj => {
      const objData = (obj as any).data;
      if (objData?.type !== 'background') {
        fabricCanvas.remove(obj);
      }
    });

    drawAllMeasurements();
    fabricCanvas.renderAll();
  }, [fabricCanvas, measurement, tags, layers]);

  // Handle canvas clicks for drawing mode
  useEffect(() => {
    if (!fabricCanvas) return;

      const handleMouseDown = (event: any) => {
      if (editMode === 'select') return;

      const pointer = fabricCanvas.getPointer(event.e);
      const point = { x: pointer.x, y: pointer.y };

      if (editMode === 'delete') {
        const target = fabricCanvas.findTarget(event.e);
        const targetData = (target as any)?.data;
        if (target && targetData?.editable) {
          handleDeleteObject(target);
        }
        return;
      }

      if (editMode === 'add-ridge' || editMode === 'add-hip' || editMode === 'add-valley') {
        handleAddLine(point);
      } else if (editMode === 'add-facet') {
        handleAddFacetPoint(point);
      } else if (editMode === 'add-marker') {
        handleAddAnnotation(point, 'marker');
      } else if (editMode === 'add-note') {
        setPendingAnnotation({ position: point, type: 'note' });
        setNoteDialogOpen(true);
      } else if (editMode === 'add-damage') {
        setPendingAnnotation({ position: point, type: 'damage' });
        setNoteDialogOpen(true);
      }
    };

    fabricCanvas.on('mouse:down', handleMouseDown);

    return () => {
      fabricCanvas.off('mouse:down', handleMouseDown);
    };
  }, [fabricCanvas, editMode, drawPoints]);

  const drawAllMeasurements = () => {
    if (!fabricCanvas) return;

    // Draw roof facets
    if (layers.facets && measurement?.faces) {
      drawRoofFacets();
    }

    // Draw ridge lines
    if (layers.ridges && tags['lf.ridge']) {
      drawFeatureLines('ridge', tags['ridge_lines'] || [], 'green');
    }

    // Draw hip lines
    if (layers.hips && tags['lf.hip']) {
      drawFeatureLines('hip', tags['hip_lines'] || [], 'blue');
    }

    // Draw valley lines
    if (layers.valleys && tags['lf.valley']) {
      drawFeatureLines('valley', tags['valley_lines'] || [], 'red');
    }

    // Draw perimeter
    if (layers.perimeter) {
      drawPerimeter();
    }

    // Draw annotations
    if (layers.annotations) {
      drawAnnotations();
    }
  };

  const drawRoofFacets = () => {
    if (!fabricCanvas || !measurement?.faces) return;

    measurement.faces.forEach((face: any, index: number) => {
      if (!face.boundary || face.boundary.length < 3) return;

      const points = face.boundary.map((coord: number[]) => ({
        x: coord[0] * canvasWidth,
        y: coord[1] * canvasHeight,
      }));

      const polygon = new Polygon(points, {
        fill: `hsl(${(index * 60) % 360}, 50%, 50%, 0.2)`,
        stroke: `hsl(${(index * 60) % 360}, 70%, 60%)`,
        strokeWidth: 2,
        selectable: editMode === 'select',
        hasControls: true,
        hasBorders: true,
      });

      (polygon as any).data = { type: 'facet', editable: true, faceIndex: index };
      fabricCanvas.add(polygon);

      // Add area label
      const center = getPolygonCenter(points);
      const area = face.area || 0;
      const label = new FabricText(`${area.toFixed(1)} sq ft`, {
        left: center.x,
        top: center.y,
        fontSize: 12,
        fill: 'white',
        backgroundColor: 'rgba(0,0,0,0.6)',
        originX: 'center',
        originY: 'center',
        selectable: false,
      });
      (label as any).data = { type: 'label' };
      fabricCanvas.add(label);
    });
  };

  const drawFeatureLines = (type: string, lines: any[], color: string) => {
    if (!fabricCanvas) return;

    lines.forEach((lineData: any, index: number) => {
      const start = lineData.start || lineData[0];
      const end = lineData.end || lineData[1];
      
      if (!start || !end) return;

      const line = new Line(
        [
          start[0] * canvasWidth,
          start[1] * canvasHeight,
          end[0] * canvasWidth,
          end[1] * canvasHeight,
        ],
        {
          stroke: color,
          strokeWidth: 3,
          strokeDashArray: type === 'ridge' ? [] : [10, 5],
          selectable: editMode === 'select',
          hasControls: false,
          hasBorders: false,
        }
      );

      (line as any).data = { type, editable: true, lineIndex: index };
      fabricCanvas.add(line);

      // Add length label
      const length = lineData.length || calculateLineLength(start, end);
      const midX = ((start[0] + end[0]) / 2) * canvasWidth;
      const midY = ((start[1] + end[1]) / 2) * canvasHeight;

      const label = new FabricText(`${Math.round(length)} ft`, {
        left: midX,
        top: midY - 10,
        fontSize: 11,
        fill: 'white',
        backgroundColor: `${color}`,
        padding: 2,
        originX: 'center',
        originY: 'center',
        selectable: false,
      });
      (label as any).data = { type: 'label' };
      fabricCanvas.add(label);
    });
  };

  const drawPerimeter = () => {
    if (!fabricCanvas || !measurement?.boundary) return;

    const boundary = measurement.boundary;
    for (let i = 0; i < boundary.length; i++) {
      const start = boundary[i];
      const end = boundary[(i + 1) % boundary.length];

      const line = new Line(
        [
          start[0] * canvasWidth,
          start[1] * canvasHeight,
          end[0] * canvasWidth,
          end[1] * canvasHeight,
        ],
        {
          stroke: 'orange',
          strokeWidth: 2,
          selectable: false,
          evented: false,
        }
      );

      (line as any).data = { type: 'perimeter' };
      fabricCanvas.add(line);
    }
  };

  const handleAddLine = (point: Point) => {
    if (drawPoints.length === 0) {
      // First point
      setDrawPoints([point]);
      drawTempPoint(point);
      toast.info("Click to set end point");
    } else if (drawPoints.length === 1) {
      // Second point - complete the line
      const newLine = { start: drawPoints[0], end: point };
      addNewLine(editMode.replace('add-', '') as 'ridge' | 'hip' | 'valley', newLine);
      setDrawPoints([]);
      clearTempDrawings();
    }
  };

  const handleAddFacetPoint = (point: Point) => {
    const newPoints = [...drawPoints, point];
    setDrawPoints(newPoints);
    drawTempPoint(point);

    // Check if user clicked near the first point to close the polygon
    if (newPoints.length > 2) {
      const first = newPoints[0];
      const dist = Math.sqrt(Math.pow(point.x - first.x, 2) + Math.pow(point.y - first.y, 2));
      if (dist < 15) {
        // Close the polygon
        addNewFacet(newPoints);
        setDrawPoints([]);
        clearTempDrawings();
        return;
      }
    }

    if (newPoints.length === 1) {
      toast.info("Click to add more points. Click near first point to close.");
    }
  };

  const drawTempPoint = (point: Point) => {
    if (!fabricCanvas) return;

    const circle = new Circle({
      left: point.x,
      top: point.y,
      radius: 5,
      fill: 'yellow',
      originX: 'center',
      originY: 'center',
      selectable: false,
    });
    (circle as any).data = { type: 'temp' };
    fabricCanvas.add(circle);
    fabricCanvas.renderAll();
  };

  const clearTempDrawings = () => {
    if (!fabricCanvas) return;
    const tempObjects = fabricCanvas.getObjects().filter((obj: FabricObject) => (obj as any).data?.type === 'temp');
    tempObjects.forEach(obj => fabricCanvas.remove(obj));
    fabricCanvas.renderAll();
  };

  const addNewLine = (type: 'ridge' | 'hip' | 'valley', line: { start: Point; end: Point }) => {
    const normalizedStart = [line.start.x / canvasWidth, line.start.y / canvasHeight];
    const normalizedEnd = [line.end.x / canvasWidth, line.end.y / canvasHeight];
    const length = calculateLineLength(normalizedStart, normalizedEnd);

    const lineKey = `${type}_lines`;
    const lfKey = `lf.${type}`;
    
    const existingLines = tags[lineKey] || [];
    const newLines = [...existingLines, { start: normalizedStart, end: normalizedEnd, length }];
    
    const totalLength = newLines.reduce((sum, l) => sum + (l.length || 0), 0);
    
    const updatedTags = {
      ...tags,
      [lineKey]: newLines,
      [lfKey]: totalLength,
    };

    setHasChanges(true);
    onMeasurementUpdate(measurement, updatedTags);
    toast.success(`Added ${type} line: ${Math.round(length)} ft`);
  };

  const addNewFacet = (points: Point[]) => {
    const normalizedPoints = points.map(p => [p.x / canvasWidth, p.y / canvasHeight]);
    const area = calculatePolygonArea(normalizedPoints);

    const newFace = {
      boundary: normalizedPoints,
      area,
      pitch: measurement.faces?.[0]?.pitch || 5,
    };

    const updatedFaces = [...(measurement.faces || []), newFace];
    const updatedMeasurement = {
      ...measurement,
      faces: updatedFaces,
    };

    setHasChanges(true);
    onMeasurementUpdate(updatedMeasurement, tags);
    toast.success(`Added roof facet: ${area.toFixed(1)} sq ft`);
  };

  const drawAnnotations = () => {
    if (!fabricCanvas) return;

    const annotations: Annotation[] = tags.annotations || [];
    
    annotations.forEach((annotation, index) => {
      const pos = {
        x: annotation.normalizedPosition[0] * canvasWidth,
        y: annotation.normalizedPosition[1] * canvasHeight,
      };

      let icon: FabricObject;
      let color: string;

      if (annotation.type === 'marker') {
        // Draw marker pin
        icon = new Circle({
          left: pos.x,
          top: pos.y,
          radius: 8,
          fill: 'hsl(var(--primary))',
          stroke: 'white',
          strokeWidth: 2,
          originX: 'center',
          originY: 'center',
          selectable: editMode === 'select',
        });
        color = 'hsl(var(--primary))';
      } else if (annotation.type === 'note') {
        // Draw note icon
        icon = new Polygon(
          [
            { x: pos.x - 10, y: pos.y - 10 },
            { x: pos.x + 10, y: pos.y - 10 },
            { x: pos.x + 10, y: pos.y + 10 },
            { x: pos.x - 10, y: pos.y + 10 },
          ],
          {
            fill: 'hsl(var(--secondary))',
            stroke: 'white',
            strokeWidth: 2,
            selectable: editMode === 'select',
          }
        );
        color = 'hsl(var(--secondary))';
      } else {
        // Draw damage warning triangle
        icon = new Polygon(
          [
            { x: pos.x, y: pos.y - 12 },
            { x: pos.x - 10, y: pos.y + 8 },
            { x: pos.x + 10, y: pos.y + 8 },
          ],
          {
            fill: 'hsl(var(--destructive))',
            stroke: 'white',
            strokeWidth: 2,
            selectable: editMode === 'select',
          }
        );
        color = 'hsl(var(--destructive))';
      }

      (icon as any).data = { type: 'annotation', editable: true, annotationIndex: index };
      fabricCanvas.add(icon);

      // Add text label if present
      if (annotation.text) {
        const label = new FabricText(annotation.text, {
          left: pos.x,
          top: pos.y + 20,
          fontSize: 11,
          fill: 'white',
          backgroundColor: color,
          padding: 3,
          originX: 'center',
          originY: 'top',
          selectable: false,
        });
        (label as any).data = { type: 'annotation-label', annotationIndex: index };
        fabricCanvas.add(label);
      }
    });
  };

  const handleAddAnnotation = (point: Point, type: 'marker' | 'note' | 'damage', text?: string) => {
    const normalizedPosition: [number, number] = [point.x / canvasWidth, point.y / canvasHeight];
    
    const newAnnotation: Annotation = {
      id: `${type}-${Date.now()}`,
      type,
      position: point,
      normalizedPosition,
      text,
    };

    const existingAnnotations = tags.annotations || [];
    const updatedAnnotations = [...existingAnnotations, newAnnotation];
    
    const updatedTags = {
      ...tags,
      annotations: updatedAnnotations,
    };

    setHasChanges(true);
    onMeasurementUpdate(measurement, updatedTags);
    toast.success(`Added ${type} annotation`);
  };

  const handleSaveNote = () => {
    if (!pendingAnnotation || !noteText.trim()) {
      toast.error("Please enter note text");
      return;
    }

    handleAddAnnotation(pendingAnnotation.position, pendingAnnotation.type, noteText);
    setNoteDialogOpen(false);
    setPendingAnnotation(null);
    setNoteText('');
  };

  const handleDeleteObject = (target: FabricObject) => {
    const targetData = (target as any).data;
    if (!targetData?.editable) return;

    const { type, lineIndex, faceIndex, annotationIndex } = targetData;

    if (type === 'ridge' || type === 'hip' || type === 'valley') {
      const lineKey = `${type}_lines`;
      const lines = [...(tags[lineKey] || [])];
      lines.splice(lineIndex, 1);
      
      const totalLength = lines.reduce((sum, l) => sum + (l.length || 0), 0);
      const updatedTags = {
        ...tags,
        [lineKey]: lines,
        [`lf.${type}`]: totalLength,
      };

      setHasChanges(true);
      onMeasurementUpdate(measurement, updatedTags);
      toast.success(`Deleted ${type} line`);
    } else if (type === 'facet') {
      const faces = [...(measurement.faces || [])];
      faces.splice(faceIndex, 1);
      
      const updatedMeasurement = {
        ...measurement,
        faces,
      };

      setHasChanges(true);
      onMeasurementUpdate(updatedMeasurement, tags);
      toast.success("Deleted roof facet");
    } else if (type === 'annotation') {
      const annotations = [...(tags.annotations || [])];
      annotations.splice(annotationIndex, 1);
      
      const updatedTags = {
        ...tags,
        annotations,
      };

      setHasChanges(true);
      onMeasurementUpdate(measurement, updatedTags);
      toast.success("Deleted annotation");
    }
  };

  const handleReset = () => {
    onMeasurementUpdate(originalDataRef.current.measurement, originalDataRef.current.tags);
    setHasChanges(false);
    setDrawPoints([]);
    clearTempDrawings();
    toast.success("Reset to original measurements");
  };

  const toggleLayer = (layerKey: string) => {
    setLayers(prev => ({ ...prev, [layerKey]: !prev[layerKey] }));
  };

  const getPolygonCenter = (points: Point[]): Point => {
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  };

  const calculateLineLength = (start: number[], end: number[]): number => {
    // Simplified calculation - in real implementation would use geo distance
    const dx = (end[0] - start[0]) * canvasWidth;
    const dy = (end[1] - start[1]) * canvasHeight;
    return Math.sqrt(dx * dx + dy * dy) * 0.5; // Scale factor for feet
  };

  const calculatePolygonArea = (points: number[][]): number => {
    // Shoelace formula for polygon area
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i][0] * points[j][1];
      area -= points[j][0] * points[i][1];
    }
    return Math.abs(area / 2) * canvasWidth * canvasHeight * 0.1; // Scale to sq ft
  };

  const getModeInstructions = (mode: EditMode): string => {
    switch (mode) {
      case 'select':
        return 'Click and drag objects to move them. Use handles to resize.';
      case 'add-ridge':
        return 'Click to place start point, then click again for end point.';
      case 'add-hip':
        return 'Click to place start point, then click again for end point.';
      case 'add-valley':
        return 'Click to place start point, then click again for end point.';
      case 'add-facet':
        return 'Click to place corners. Click near first point to close polygon.';
      case 'delete':
        return 'Click on any line, facet, or annotation to delete it.';
      case 'add-marker':
        return 'Click to place a custom marker on the measurement.';
      case 'add-note':
        return 'Click to place a note with custom text.';
      case 'add-damage':
        return 'Click to mark a damage indicator with notes.';
      default:
        return '';
    }
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <Button 
            size="sm" 
            variant={editMode === 'select' ? 'default' : 'outline'} 
            onClick={() => setEditMode('select')}
          >
            <Move className="h-4 w-4 mr-1" /> Select
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-ridge' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-ridge')}
          >
            <Mountain className="h-4 w-4 mr-1" /> Ridge
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-hip' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-hip')}
          >
            <Triangle className="h-4 w-4 mr-1" /> Hip
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-valley' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-valley')}
          >
            <ArrowDownUp className="h-4 w-4 mr-1" /> Valley
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-facet' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-facet')}
          >
            <Square className="h-4 w-4 mr-1" /> Facet
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-marker' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-marker')}
          >
            <MapPin className="h-4 w-4 mr-1" /> Marker
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-note' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-note')}
          >
            <StickyNote className="h-4 w-4 mr-1" /> Note
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'add-damage' ? 'default' : 'outline'} 
            onClick={() => setEditMode('add-damage')}
          >
            <AlertTriangle className="h-4 w-4 mr-1" /> Damage
          </Button>
          <Button 
            size="sm" 
            variant={editMode === 'delete' ? 'destructive' : 'outline'} 
            onClick={() => setEditMode('delete')}
          >
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
        </div>
        
        <Button size="sm" variant="outline" onClick={handleReset} disabled={!hasChanges}>
          <RotateCcw className="h-4 w-4 mr-1" /> Reset
        </Button>
      </div>
      
      {/* Layer toggles */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(layers).map(([key, visible]) => (
          <Badge 
            key={key}
            variant={visible ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => toggleLayer(key)}
          >
            {visible ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </Badge>
        ))}
      </div>
      
      {/* Canvas */}
      <div className="border border-border rounded-lg overflow-hidden bg-muted relative">
        <canvas ref={canvasRef} />
        
        {/* Mode indicator */}
        <div className="absolute top-2 left-2">
          <Badge variant="default">
            {editMode === 'select' ? 'Select Mode' : `Drawing ${editMode.replace('add-', '')}`}
          </Badge>
        </div>
        
        {hasChanges && (
          <div className="absolute top-2 right-2">
            <Badge variant="secondary">Modified</Badge>
          </div>
        )}
        
        {/* Instructions */}
        <div className="absolute bottom-2 right-2 bg-background/90 p-2 rounded text-xs max-w-xs">
          {getModeInstructions(editMode)}
        </div>
      </div>
      
      {/* Legend */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-4 h-1 bg-green-500"></div>
          <span>Ridge</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-1 border-t-2 border-dashed border-blue-500"></div>
          <span>Hip</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-1 border-t-2 border-dashed border-red-500"></div>
          <span>Valley</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-1 bg-orange-500"></div>
          <span>Perimeter</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-primary/20 border border-primary"></div>
          <span>Facet</span>
        </div>
        <div className="flex items-center gap-1">
          <MapPin className="h-4 w-4 text-primary" />
          <span>Marker</span>
        </div>
        <div className="flex items-center gap-1">
          <StickyNote className="h-4 w-4 text-secondary" />
          <span>Note</span>
        </div>
        <div className="flex items-center gap-1">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span>Damage</span>
        </div>
      </div>

      {/* Note/Damage Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={(open) => {
        setNoteDialogOpen(open);
        if (!open) {
          setPendingAnnotation(null);
          setNoteText('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add {pendingAnnotation?.type === 'damage' ? 'Damage' : 'Note'} Annotation
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="note-text">
                {pendingAnnotation?.type === 'damage' ? 'Damage Description' : 'Note Text'}
              </Label>
              <Input
                id="note-text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={pendingAnnotation?.type === 'damage' ? 'Describe the damage...' : 'Enter your note...'}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveNote} disabled={!noteText.trim()}>
              Add Annotation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
