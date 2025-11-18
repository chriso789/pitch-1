import { useEffect, useRef, useState } from 'react';
import { Canvas as FabricCanvas, Line, Polygon, Circle, FabricImage } from 'fabric';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Scissors, Undo, Save, X, Lightbulb, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  splitPolygonByLine,
  suggestSplitLines,
  calculatePolygonArea,
  getFacetColor,
  type SplitLine,
  type SplitFacet,
} from '@/utils/polygonSplitting';

interface FacetSplitterOverlayProps {
  satelliteImageUrl: string;
  buildingPolygon: [number, number][]; // Normalized coordinates [0-1]
  measurement: any;
  onSave: (splitFacets: SplitFacet[]) => void;
  onCancel: () => void;
  canvasWidth?: number;
  canvasHeight?: number;
}

export function FacetSplitterOverlay({
  satelliteImageUrl,
  buildingPolygon,
  measurement,
  onSave,
  onCancel,
  canvasWidth = 640,
  canvasHeight = 480,
}: FacetSplitterOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [currentFacets, setCurrentFacets] = useState<SplitFacet[]>([]);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [suggestedLines, setSuggestedLines] = useState<SplitLine[]>([]);
  const undoStackRef = useRef<SplitFacet[][]>([]);

  // Initialize canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: canvasWidth,
      height: canvasHeight,
      selection: false,
    });

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [canvasWidth, canvasHeight]);

  // Load satellite image
  useEffect(() => {
    if (!fabricCanvas || !satelliteImageUrl) return;

    FabricImage.fromURL(satelliteImageUrl, { crossOrigin: 'anonymous' }).then((img) => {
      img.scaleToWidth(canvasWidth);
      img.scaleToHeight(canvasHeight);
      img.selectable = false;
      fabricCanvas.backgroundImage = img;
      fabricCanvas.renderAll();
    });
  }, [fabricCanvas, satelliteImageUrl, canvasWidth, canvasHeight]);

  // Initialize with building polygon as first facet
  useEffect(() => {
    if (buildingPolygon.length > 0 && currentFacets.length === 0) {
      const initialFacet: SplitFacet = {
        id: 'facet-0',
        points: buildingPolygon,
        area: calculatePolygonArea(buildingPolygon),
        color: getFacetColor(0),
      };
      setCurrentFacets([initialFacet]);
    }
  }, [buildingPolygon]);

  // Auto-detect suggested split lines
  useEffect(() => {
    if (buildingPolygon.length > 0 && measurement) {
      const suggestions = suggestSplitLines(measurement, buildingPolygon);
      setSuggestedLines(suggestions);
      
      if (suggestions.length > 0) {
        toast.info(`Found ${suggestions.length} suggested split line(s) from ridge/hip/valley data`);
      }
    }
  }, [buildingPolygon, measurement]);

  // Render facets on canvas
  useEffect(() => {
    if (!fabricCanvas) return;

    // Clear existing facets
    fabricCanvas.getObjects().forEach((obj) => {
      if (obj.get('data')?.type === 'facet') {
        fabricCanvas.remove(obj);
      }
    });

    // Render each facet
    currentFacets.forEach((facet) => {
      const canvasPoints = facet.points.map(([x, y]) => ({
        x: x * canvasWidth,
        y: y * canvasHeight,
      }));

      const polygon = new Polygon(canvasPoints, {
        fill: facet.color + '40', // 25% opacity
        stroke: facet.color,
        strokeWidth: 2,
        selectable: false,
        evented: false,
      } as any);
      
      (polygon as any).data = { type: 'facet', id: facet.id };

      fabricCanvas.add(polygon);
    });

    fabricCanvas.renderAll();
  }, [currentFacets, fabricCanvas, canvasWidth, canvasHeight]);

  // Render suggested lines
  useEffect(() => {
    if (!fabricCanvas || suggestedLines.length === 0) return;

    // Clear existing suggestions
    fabricCanvas.getObjects().forEach((obj) => {
      if (obj.get('data')?.type === 'suggestion') {
        fabricCanvas.remove(obj);
      }
    });

    // Render suggested lines
    suggestedLines.forEach((splitLine, index) => {
      const line = new Line(
        [
          splitLine.start[0] * canvasWidth,
          splitLine.start[1] * canvasHeight,
          splitLine.end[0] * canvasWidth,
          splitLine.end[1] * canvasHeight,
        ],
        {
          stroke: '#ffcc00',
          strokeWidth: 2,
          strokeDashArray: [10, 5],
          selectable: false,
          evented: false,
        } as any
      );
      
      (line as any).data = { type: 'suggestion', index };

      fabricCanvas.add(line);
    });

    fabricCanvas.renderAll();
  }, [suggestedLines, fabricCanvas, canvasWidth, canvasHeight]);

  // Handle canvas click to draw split line
  const handleCanvasClick = (e: any) => {
    if (!isDrawing) return;

    const pointer = fabricCanvas?.getPointer(e.e);
    if (!pointer) return;

    const normalizedX = pointer.x / canvasWidth;
    const normalizedY = pointer.y / canvasHeight;

    const newPoint: [number, number] = [normalizedX, normalizedY];
    const newPoints = [...drawPoints, newPoint];
    setDrawPoints(newPoints);

    // If we have 2 points, execute the split
    if (newPoints.length === 2) {
      executeSplit({ start: newPoints[0], end: newPoints[1] });
      setDrawPoints([]);
      setIsDrawing(false);
    } else {
      // Draw temporary point
      const circle = new Circle({
        left: pointer.x,
        top: pointer.y,
        radius: 5,
        fill: '#3b82f6',
        selectable: false,
        evented: false,
      } as any);
      
      (circle as any).data = { type: 'temp-point' };
      fabricCanvas?.add(circle);
    }
  };

  // Execute polygon split
  const executeSplit = (splitLine: SplitLine) => {
    // Save current state for undo
    undoStackRef.current.push(JSON.parse(JSON.stringify(currentFacets)));

    // Find which facet to split (use the largest one for now)
    const sortedFacets = [...currentFacets].sort((a, b) => b.area - a.area);
    const facetToSplit = sortedFacets[0];

    const result = splitPolygonByLine(facetToSplit.points, splitLine);

    if (!result) {
      toast.error('Split line does not properly divide the facet');
      return;
    }

    // Remove the original facet
    const remainingFacets = currentFacets.filter((f) => f.id !== facetToSplit.id);

    // Create two new facets
    const newFacet1: SplitFacet = {
      id: `facet-${Date.now()}-1`,
      points: result.facet1,
      area: calculatePolygonArea(result.facet1),
      color: getFacetColor(currentFacets.length),
      pitch: facetToSplit.pitch,
      direction: facetToSplit.direction,
    };

    const newFacet2: SplitFacet = {
      id: `facet-${Date.now()}-2`,
      points: result.facet2,
      area: calculatePolygonArea(result.facet2),
      color: getFacetColor(currentFacets.length + 1),
      pitch: facetToSplit.pitch,
      direction: facetToSplit.direction,
    };

    setCurrentFacets([...remainingFacets, newFacet1, newFacet2]);
    toast.success('Facet split successfully');
  };

  // Apply suggested split line
  const applySuggestedLine = (index: number) => {
    if (index < 0 || index >= suggestedLines.length) return;
    executeSplit(suggestedLines[index]);
    
    // Remove the applied suggestion
    const newSuggestions = suggestedLines.filter((_, i) => i !== index);
    setSuggestedLines(newSuggestions);
  };

  // Undo last split
  const handleUndo = () => {
    if (undoStackRef.current.length === 0) {
      toast.info('Nothing to undo');
      return;
    }

    const previousState = undoStackRef.current.pop();
    if (previousState) {
      setCurrentFacets(previousState);
      toast.success('Undone last split');
    }
  };

  // Start drawing mode
  const handleStartDrawing = () => {
    setIsDrawing(true);
    setDrawPoints([]);
    
    // Clear temporary points
    fabricCanvas?.getObjects().forEach((obj) => {
      if (obj.get('data')?.type === 'temp-point') {
        fabricCanvas.remove(obj);
      }
    });
    
    toast.info('Click two points to draw a split line');
  };

  // Save split facets
  const handleSave = () => {
    if (currentFacets.length < 2) {
      toast.error('Must have at least 2 facets');
      return;
    }

    onSave(currentFacets);
  };

  // Listen to canvas click events
  useEffect(() => {
    if (!fabricCanvas) return;

    fabricCanvas.on('mouse:down', handleCanvasClick);

    return () => {
      fabricCanvas.off('mouse:down', handleCanvasClick);
    };
  }, [fabricCanvas, isDrawing, drawPoints]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Split Building into Roof Facets</h3>
          <p className="text-sm text-muted-foreground">
            Draw lines to divide the building into individual roof planes
          </p>
        </div>
        <Badge variant="secondary">
          {currentFacets.length} Facet{currentFacets.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleStartDrawing}
          disabled={isDrawing}
          size="sm"
          variant={isDrawing ? 'default' : 'outline'}
        >
          <Scissors className="h-4 w-4 mr-2" />
          {isDrawing ? 'Drawing...' : 'Draw Split Line'}
        </Button>

        {suggestedLines.length > 0 && (
          <Button
            onClick={() => applySuggestedLine(0)}
            size="sm"
            variant="outline"
          >
            <Lightbulb className="h-4 w-4 mr-2" />
            Apply Suggestion ({suggestedLines.length})
          </Button>
        )}

        <Button onClick={handleUndo} size="sm" variant="outline">
          <Undo className="h-4 w-4 mr-2" />
          Undo
        </Button>

        <div className="flex-1" />

        <Button onClick={onCancel} size="sm" variant="outline">
          <X className="h-4 w-4 mr-2" />
          Cancel
        </Button>

        <Button onClick={handleSave} size="sm">
          <Save className="h-4 w-4 mr-2" />
          Save Facets
        </Button>
      </div>

      {/* Canvas */}
      <div className="border rounded-lg overflow-hidden bg-muted">
        <canvas ref={canvasRef} />
      </div>

      {/* Facet List */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Facets</h4>
        <div className="grid grid-cols-2 gap-2">
          {currentFacets.map((facet, index) => (
            <div
              key={facet.id}
              className="flex items-center gap-2 p-2 border rounded-lg"
            >
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: facet.color }}
              />
              <div className="flex-1 text-sm">
                <div className="font-medium">Facet {index + 1}</div>
                <div className="text-muted-foreground">{facet.area.toFixed(0)} sq ft</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
