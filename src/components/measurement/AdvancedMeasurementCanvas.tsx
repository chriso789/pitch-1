import React, { useEffect, useRef, useState } from "react";
import { Canvas as FabricCanvas, Circle, Line, Polygon, Point, FabricImage } from "fabric";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Square, 
  Move, 
  Ruler, 
  Mountain, 
  Triangle, 
  ArrowDownUp, 
  RotateCcw, 
  Layers,
  Eye,
  EyeOff
} from "lucide-react";
import { toast } from "sonner";

interface MeasurementLayer {
  id: string;
  name: string;
  type: 'perimeter' | 'ridge' | 'hip' | 'valley' | 'planimeter';
  color: string;
  visible: boolean;
  objects: any[];
  measurements: {
    length?: number;
    area?: number;
    angle?: number;
  };
}

interface AdvancedMeasurementCanvasProps {
  satelliteImageUrl: string;
  onMeasurementsChange: (measurements: any) => void;
  pixelToFeetRatio?: number;
}

export const AdvancedMeasurementCanvas: React.FC<AdvancedMeasurementCanvasProps> = ({
  satelliteImageUrl,
  onMeasurementsChange,
  pixelToFeetRatio = 0.6
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'perimeter' | 'ridge' | 'hip' | 'valley' | 'planimeter'>('select');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  
  const [layers, setLayers] = useState<MeasurementLayer[]>([
    { id: 'perimeter', name: 'Roof Perimeter', type: 'perimeter', color: '#ff0000', visible: true, objects: [], measurements: {} },
    { id: 'ridges', name: 'Ridges', type: 'ridge', color: '#00ff00', visible: true, objects: [], measurements: {} },
    { id: 'hips', name: 'Hips', type: 'hip', color: '#0000ff', visible: true, objects: [], measurements: {} },
    { id: 'valleys', name: 'Valleys', type: 'valley', color: '#ff00ff', visible: true, objects: [], measurements: {} },
    { id: 'planimeter', name: 'Planimeter Areas', type: 'planimeter', color: '#ffff00', visible: true, objects: [], measurements: {} }
  ]);

  useEffect(() => {
    if (!canvasRef.current || !satelliteImageUrl) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 640,
      height: 640,
      backgroundColor: "#ffffff",
      selection: activeTool === 'select'
    });

    // Load satellite image as background
    FabricImage.fromURL(satelliteImageUrl).then((img) => {
      if (img) {
        img.scaleToWidth(640);
        img.scaleToHeight(640);
        img.selectable = false;
        img.evented = false;
        canvas.backgroundImage = img;
        canvas.renderAll();
      }
    }).catch(console.error);

    setFabricCanvas(canvas);

    // Canvas event handlers
    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);

    return () => {
      canvas.dispose();
    };
  }, [satelliteImageUrl, activeTool]);

  const handleMouseDown = (event: any) => {
    if (activeTool === 'select') return;

    const pointer = event.pointer;
    setIsDrawing(true);
    setCurrentPath([new Point(pointer.x, pointer.y)]);
  };

  const handleMouseMove = (event: any) => {
    if (!isDrawing || activeTool === 'select') return;

    const pointer = event.pointer;
    setCurrentPath(prev => [...prev, new Point(pointer.x, pointer.y)]);
  };

  const handleMouseUp = () => {
    if (!isDrawing || !fabricCanvas) return;

    setIsDrawing(false);
    
    const activeLayer = layers.find(l => l.type === activeTool);
    if (!activeLayer || currentPath.length < 2) {
      setCurrentPath([]);
      return;
    }

    createMeasurementObject();
    setCurrentPath([]);
  };

  const createMeasurementObject = () => {
    if (!fabricCanvas || currentPath.length < 2) return;

    const activeLayer = layers.find(l => l.type === activeTool);
    if (!activeLayer) return;

    let measurementObject;

    switch (activeTool) {
      case 'perimeter':
      case 'planimeter':
        // Create polygon for perimeter/planimeter
        const polygonPoints = currentPath.map(p => ({ x: p.x, y: p.y }));
        measurementObject = new Polygon(polygonPoints, {
          fill: 'transparent',
          stroke: activeLayer.color,
          strokeWidth: 2,
          opacity: 0.7,
          selectable: true
        });
        break;

      case 'ridge':
      case 'hip':
      case 'valley':
        // Create line for ridges, hips, valleys
        const startPoint = currentPath[0];
        const endPoint = currentPath[currentPath.length - 1];
        measurementObject = new Line([startPoint.x, startPoint.y, endPoint.x, endPoint.y], {
          stroke: activeLayer.color,
          strokeWidth: 3,
          selectable: true
        });
        break;
    }

    if (measurementObject) {
      // Add measurement data to object
      const measurements = calculateObjectMeasurement(measurementObject, activeTool);
      measurementObject.set('measurementData', measurements);
      measurementObject.set('layerType', activeTool);

      fabricCanvas.add(measurementObject);
      
      // Update layer with new object
      setLayers(prev => prev.map(layer => 
        layer.type === activeTool 
          ? { ...layer, objects: [...layer.objects, measurementObject] }
          : layer
      ));

      // Recalculate all measurements
      updateAllMeasurements();
    }
  };

  const calculateObjectMeasurement = (obj: any, type: string) => {
    const measurements: any = {};

    switch (type) {
      case 'perimeter':
      case 'planimeter':
        if (obj.points) {
          // Calculate area using shoelace formula
          let area = 0;
          let perimeter = 0;
          const points = obj.points;
          
          for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
            
            const dx = points[j].x - points[i].x;
            const dy = points[j].y - points[i].y;
            perimeter += Math.sqrt(dx * dx + dy * dy);
          }
          
          area = Math.abs(area) / 2;
          measurements.area = area * Math.pow(pixelToFeetRatio, 2);
          measurements.perimeter = perimeter * pixelToFeetRatio;
        }
        break;

      case 'ridge':
      case 'hip':
      case 'valley':
        // Calculate line length
        const dx = obj.x2 - obj.x1;
        const dy = obj.y2 - obj.y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        measurements.length = length * pixelToFeetRatio;
        
        // Calculate angle
        measurements.angle = Math.atan2(dy, dx) * (180 / Math.PI);
        break;
    }

    return measurements;
  };

  const updateAllMeasurements = () => {
    const allMeasurements = {
      perimeter: { area: 0, perimeter: 0, count: 0 },
      ridges: { totalLength: 0, count: 0, lines: [] },
      hips: { totalLength: 0, count: 0, lines: [] },
      valleys: { totalLength: 0, count: 0, lines: [] },
      planimeter: { totalArea: 0, count: 0, areas: [] }
    };

    // Process each layer
    layers.forEach(layer => {
      layer.objects.forEach(obj => {
        const measurements = obj.measurementData || {};
        
        switch (layer.type) {
          case 'perimeter':
            allMeasurements.perimeter.area += measurements.area || 0;
            allMeasurements.perimeter.perimeter += measurements.perimeter || 0;
            allMeasurements.perimeter.count++;
            break;
            
          case 'ridge':
            allMeasurements.ridges.totalLength += measurements.length || 0;
            allMeasurements.ridges.count++;
            allMeasurements.ridges.lines.push({
              length: measurements.length || 0,
              angle: measurements.angle || 0
            });
            break;
            
          case 'hip':
            allMeasurements.hips.totalLength += measurements.length || 0;
            allMeasurements.hips.count++;
            allMeasurements.hips.lines.push({
              length: measurements.length || 0,
              angle: measurements.angle || 0
            });
            break;
            
          case 'valley':
            allMeasurements.valleys.totalLength += measurements.length || 0;
            allMeasurements.valleys.count++;
            allMeasurements.valleys.lines.push({
              length: measurements.length || 0,
              angle: measurements.angle || 0
            });
            break;
            
          case 'planimeter':
            allMeasurements.planimeter.totalArea += measurements.area || 0;
            allMeasurements.planimeter.count++;
            allMeasurements.planimeter.areas.push(measurements.area || 0);
            break;
        }
      });
    });

    onMeasurementsChange(allMeasurements);
  };

  const toggleLayerVisibility = (layerId: string) => {
    setLayers(prev => prev.map(layer => {
      if (layer.id === layerId) {
        const newVisibility = !layer.visible;
        
        // Update object visibility in canvas
        layer.objects.forEach(obj => {
          obj.visible = newVisibility;
        });
        
        fabricCanvas?.renderAll();
        
        return { ...layer, visible: newVisibility };
      }
      return layer;
    }));
  };

  const clearLayer = (layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer || !fabricCanvas) return;

    // Remove objects from canvas
    layer.objects.forEach(obj => {
      fabricCanvas.remove(obj);
    });

    // Clear layer objects
    setLayers(prev => prev.map(l => 
      l.id === layerId 
        ? { ...l, objects: [] }
        : l
    ));

    updateAllMeasurements();
    
    toast.success(`${layer.name} cleared`);
  };

  const clearAllMeasurements = () => {
    if (!fabricCanvas) return;

    layers.forEach(layer => {
      layer.objects.forEach(obj => {
        fabricCanvas.remove(obj);
      });
    });

    setLayers(prev => prev.map(layer => ({ ...layer, objects: [] })));
    updateAllMeasurements();
    
    toast.success("All measurements cleared");
  };

  return (
    <div className="space-y-4">
      {/* Tool Selection */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeTool === 'select' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTool('select')}
        >
          <Move className="h-4 w-4 mr-2" />
          Select
        </Button>
        <Button
          variant={activeTool === 'perimeter' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTool('perimeter')}
        >
          <Square className="h-4 w-4 mr-2" />
          Perimeter
        </Button>
        <Button
          variant={activeTool === 'ridge' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTool('ridge')}
        >
          <Mountain className="h-4 w-4 mr-2" />
          Ridge
        </Button>
        <Button
          variant={activeTool === 'hip' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTool('hip')}
        >
          <Triangle className="h-4 w-4 mr-2" />
          Hip
        </Button>
        <Button
          variant={activeTool === 'valley' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTool('valley')}
        >
          <ArrowDownUp className="h-4 w-4 mr-2" />
          Valley
        </Button>
        <Button
          variant={activeTool === 'planimeter' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTool('planimeter')}
        >
          <Ruler className="h-4 w-4 mr-2" />
          Planimeter
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <Button
          variant="outline"
          size="sm"
          onClick={clearAllMeasurements}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Clear All
        </Button>
      </div>

      {/* Canvas */}
      <div className="relative border border-border rounded-lg overflow-hidden">
        <canvas
          ref={canvasRef}
          className="max-w-full cursor-crosshair"
        />
        
        {/* Active Tool Indicator */}
        <div className="absolute top-2 left-2">
          <Badge variant="default">
            {activeTool === 'select' ? 'Select Mode' : `Drawing ${activeTool}`}
          </Badge>
        </div>
      </div>

      {/* Layer Controls */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Measurement Layers
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {layers.map(layer => (
            <div key={layer.id} className="flex items-center gap-2 p-2 border rounded-md">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: layer.color }}
              />
              <span className="text-sm flex-1">{layer.name}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleLayerVisibility(layer.id)}
              >
                {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearLayer(layer.id)}
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdvancedMeasurementCanvas;