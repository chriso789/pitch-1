import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Canvas as FabricCanvas, Circle, Line, Polygon as FabricPolygon, Text } from 'fabric';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { 
  Pencil, 
  Undo2, 
  Trash2, 
  Loader2,
  MousePointer2,
  ZoomIn,
  ZoomOut,
  Layers,
  Home,
  CheckCircle2,
  X
} from 'lucide-react';
import { useMeasurementDrawing } from '@/hooks/useMeasurementDrawing';
import { calculatePolygonArea, calculatePolygonPerimeter } from '@/utils/measurementGeometry';

const POLYGON_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];

interface InteractiveMapCanvasProps {
  mapboxToken: string;
  centerLat: number;
  centerLng: number;
  initialZoom?: number;
  address?: string;
  onMeasurementsChange?: (measurements: any) => void;
}

export function InteractiveMapCanvas({
  mapboxToken,
  centerLat,
  centerLng,
  initialZoom = 20,
  address,
  onMeasurementsChange,
}: InteractiveMapCanvasProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);
  
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [mode, setMode] = useState<'select' | 'draw'>('draw');
  const [mapStyle, setMapStyle] = useState<'satellite' | 'satellite-streets'>('satellite-streets');
const [currentZoom, setCurrentZoom] = useState(initialZoom);
  const [pixelsPerFoot, setPixelsPerFoot] = useState(1);
  const [lockedPixelsPerFoot, setLockedPixelsPerFoot] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [showZoomWarning, setShowZoomWarning] = useState(false);

  // Calculate pixels per foot based on zoom and latitude
  const calculatePixelsPerFoot = useCallback((zoom: number, lat: number) => {
    const metersPerPixel = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom);
    const feetPerPixel = metersPerPixel * 3.28084;
    return 1 / feetPerPixel;
  }, []);

  // Use locked scale when drawing to prevent mid-draw scale changes
  const effectivePixelsPerFoot = lockedPixelsPerFoot ?? pixelsPerFoot;

  const {
    polygons,
    currentPoints,
    isDrawing,
    startDrawing,
    addPoint,
    completePolygon,
    cancelDrawing,
    removeLastPoint,
    deletePolygon,
    undo,
    clear,
    getCurrentArea,
    getTotalArea,
    canUndo,
  } = useMeasurementDrawing({
    pixelsPerFoot: effectivePixelsPerFoot,
    snapThreshold: 15,
    onPolygonComplete: (polygon) => {
      const area = calculatePolygonArea(polygon.points, effectivePixelsPerFoot);
      toast.success(`${polygon.label} completed: ${area.toFixed(0)} sq ft`);
      // Unlock scale after polygon complete
      setLockedPixelsPerFoot(null);
      updateMeasurements();
    },
  });

  // Initialize Mapbox map
  useEffect(() => {
    if (!mapContainerRef.current || !mapboxToken || !centerLat || !centerLng) return;

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: `mapbox://styles/mapbox/${mapStyle}-v12`,
      center: [centerLng, centerLat],
      zoom: initialZoom,
      pitch: 0,
      bearing: 0,
      maxZoom: 22,
      minZoom: 15,
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right');

    map.on('load', () => {
      setIsMapLoaded(true);
      setCurrentZoom(map.getZoom());
      setPixelsPerFoot(calculatePixelsPerFoot(map.getZoom(), centerLat));
    });

    map.on('zoom', () => {
      const zoom = map.getZoom();
      setCurrentZoom(zoom);
      setPixelsPerFoot(calculatePixelsPerFoot(zoom, centerLat));
    });

    map.on('resize', () => {
      if (mapContainerRef.current) {
        setCanvasSize({
          width: mapContainerRef.current.clientWidth,
          height: mapContainerRef.current.clientHeight,
        });
      }
    });

    mapRef.current = map;

    // Get initial size
    if (mapContainerRef.current) {
      setCanvasSize({
        width: mapContainerRef.current.clientWidth,
        height: mapContainerRef.current.clientHeight,
      });
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapboxToken, centerLat, centerLng, initialZoom, mapStyle, calculatePixelsPerFoot]);

  // Initialize Fabric canvas overlay
  useEffect(() => {
    if (!canvasRef.current || !isMapLoaded) return;

    // Clear the raw canvas context first to ensure transparency
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    }

    const canvas = new FabricCanvas(canvasRef.current, {
      width: canvasSize.width,
      height: canvasSize.height,
      selection: false,
    });

    // Force transparency - Fabric.js v6 needs explicit undefined background
    canvas.backgroundColor = undefined;
    canvas.renderAll();

    fabricCanvasRef.current = canvas;

    return () => {
      canvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, [isMapLoaded, canvasSize.width, canvasSize.height]);

  // Handle canvas clicks for drawing
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const handleCanvasClick = (e: any) => {
      if (mode !== 'draw') return;
      const pointer = canvas.getPointer(e.e);
      addPoint({ x: pointer.x, y: pointer.y });
    };

    const handleDoubleClick = () => {
      if (mode === 'draw' && isDrawing && currentPoints.length >= 3) {
        completePolygon();
      }
    };

    canvas.on('mouse:down', handleCanvasClick);
    canvas.on('mouse:dblclick', handleDoubleClick);

    return () => {
      canvas.off('mouse:down', handleCanvasClick);
      canvas.off('mouse:dblclick', handleDoubleClick);
    };
  }, [mode, isDrawing, currentPoints, addPoint, completePolygon]);

  // Render polygons on canvas
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.getObjects().forEach(obj => canvas.remove(obj));

    // Render completed polygons
    polygons.forEach((polygon, index) => {
      const fabricPolygon = new FabricPolygon(polygon.points, {
        fill: `${polygon.color}40`,
        stroke: polygon.color,
        strokeWidth: 3,
        selectable: false,
        evented: false,
      });
      canvas.add(fabricPolygon);

      // Add corner points
      polygon.points.forEach((point) => {
        const circle = new Circle({
          left: point.x,
          top: point.y,
          radius: 6,
          fill: polygon.color,
          stroke: '#ffffff',
          strokeWidth: 2,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        canvas.add(circle);
      });

      // Add label with area
      if (polygon.points.length >= 3) {
        const centerX = polygon.points.reduce((sum, p) => sum + p.x, 0) / polygon.points.length;
        const centerY = polygon.points.reduce((sum, p) => sum + p.y, 0) / polygon.points.length;
        const area = calculatePolygonArea(polygon.points, pixelsPerFoot);
        
        const label = new Text(`${polygon.label}\n${area.toFixed(0)} sq ft`, {
          left: centerX,
          top: centerY,
          fontSize: 14,
          fill: '#ffffff',
          backgroundColor: `${polygon.color}dd`,
          padding: 6,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        canvas.add(label);
      }
    });

    // Render current drawing
    if (currentPoints.length > 0) {
      for (let i = 0; i < currentPoints.length - 1; i++) {
        const line = new Line([
          currentPoints[i].x, currentPoints[i].y,
          currentPoints[i + 1].x, currentPoints[i + 1].y,
        ], {
          stroke: '#3b82f6',
          strokeWidth: 2,
          selectable: false,
          evented: false,
        });
        canvas.add(line);
      }

      currentPoints.forEach((point, i) => {
        const circle = new Circle({
          left: point.x,
          top: point.y,
          radius: i === 0 ? 8 : 6,
          fill: i === 0 ? '#10b981' : '#3b82f6',
          stroke: '#ffffff',
          strokeWidth: 2,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        canvas.add(circle);
      });

      if (currentPoints.length >= 3) {
        const centerX = currentPoints.reduce((sum, p) => sum + p.x, 0) / currentPoints.length;
        const centerY = currentPoints.reduce((sum, p) => sum + p.y, 0) / currentPoints.length;
        const area = getCurrentArea();
        
        const label = new Text(`${area.toFixed(0)} sq ft`, {
          left: centerX,
          top: centerY,
          fontSize: 16,
          fontWeight: 'bold',
          fill: '#ffffff',
          backgroundColor: '#3b82f6dd',
          padding: 8,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        canvas.add(label);
      }
    }

    canvas.renderAll();
  }, [polygons, currentPoints, pixelsPerFoot, getCurrentArea]);

  const updateMeasurements = useCallback(() => {
    const map = mapRef.current;
    const center = map?.getCenter();
    const zoom = map?.getZoom() || initialZoom;
    
    // Build Mapbox static image URL for the current view
    const satelliteUrl = center 
      ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${center.lng},${center.lat},${zoom},0/${canvasSize.width}x${canvasSize.height}@2x?access_token=${mapboxToken}`
      : '';

    const faces = polygons.map((p, index) => ({
      id: p.id,
      label: p.label || `Facet ${index + 1}`,
      boundary: p.points.map(pt => [pt.x / canvasSize.width, pt.y / canvasSize.height]),
      area_sqft: calculatePolygonArea(p.points, pixelsPerFoot),
      perimeter_ft: calculatePolygonPerimeter(p.points, pixelsPerFoot),
      pitch: '6/12',
      color: p.color || POLYGON_COLORS[index % POLYGON_COLORS.length],
    }));

    onMeasurementsChange?.({
      faces,
      summary: {
        total_area_sqft: getTotalArea(),
        total_squares: getTotalArea() / 100,
        facet_count: polygons.length,
      },
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      satelliteImageUrl: satelliteUrl,
      gps_coordinates: {
        lat: center?.lat || centerLat,
        lng: center?.lng || centerLng,
      },
      analysis_zoom: zoom,
    });
  }, [polygons, pixelsPerFoot, getTotalArea, canvasSize, onMeasurementsChange, mapboxToken, centerLat, centerLng, initialZoom]);

  const handleStartDrawing = () => {
    // Lock pixelsPerFoot at drawing start to prevent mid-draw scale changes
    setLockedPixelsPerFoot(pixelsPerFoot);
    setMode('draw');
    startDrawing();
    // Disable map drag when drawing
    if (mapRef.current) {
      mapRef.current.dragPan.disable();
    }
    
    // Show zoom warning if below recommended level
    if (currentZoom < 19) {
      setShowZoomWarning(true);
      toast.warning(`Zoom level ${currentZoom.toFixed(1)} is below recommended (19+). Increase zoom for better accuracy.`);
    } else {
      toast.info('Click to add corners. Double-click to close polygon.');
    }
  };

  const handleSelectMode = () => {
    setMode('select');
    // Re-enable map drag in select mode
    if (mapRef.current) {
      mapRef.current.dragPan.enable();
    }
  };

  const toggleMapStyle = () => {
    const newStyle = mapStyle === 'satellite' ? 'satellite-streets' : 'satellite';
    setMapStyle(newStyle);
    if (mapRef.current) {
      mapRef.current.setStyle(`mapbox://styles/mapbox/${newStyle}-v12`);
    }
  };

  const handleZoomIn = () => {
    if (mapRef.current) {
      mapRef.current.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (mapRef.current) {
      mapRef.current.zoomOut();
    }
  };

  const handleResetView = () => {
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [centerLng, centerLat],
        zoom: initialZoom,
        pitch: 0,
        bearing: 0,
      });
    }
  };

  if (!mapboxToken || !centerLat || !centerLng) {
    return (
      <div className="flex items-center justify-center h-full bg-muted">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
          <p className="text-muted-foreground">Loading map data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[600px]">
      {/* Map Container */}
      <div ref={mapContainerRef} className="absolute inset-0" />
      
      {/* Fabric Canvas Overlay */}
      {isMapLoaded && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-auto"
          style={{ 
            zIndex: 10,
            background: 'transparent',
            backgroundColor: 'transparent',
          }}
        />
      )}

      {/* Loading Overlay */}
      {!isMapLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2">Loading satellite imagery...</span>
        </div>
      )}

      {/* Unified Toolbar */}
      <div className="absolute top-4 left-4 z-20 bg-background/95 backdrop-blur rounded-lg shadow-lg border overflow-hidden">
        {/* Mode Selection */}
        <div className="p-2 border-b flex flex-col gap-1">
          <Button
            variant={mode === 'select' ? 'default' : 'ghost'}
            size="sm"
            onClick={handleSelectMode}
            className="justify-start"
          >
            <MousePointer2 className="h-4 w-4 mr-2" />
            Select
          </Button>
          <Button
            variant={mode === 'draw' ? 'default' : 'ghost'}
            size="sm"
            onClick={handleStartDrawing}
            className="justify-start"
          >
            <Pencil className="h-4 w-4 mr-2" />
            Draw
          </Button>
        </div>
        
        {/* Zoom Controls */}
        <div className="p-2 border-b flex flex-col gap-1">
          <Button variant="ghost" size="icon" onClick={handleZoomIn} title="Zoom In">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleZoomOut} title="Zoom Out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleResetView} title="Reset View">
            <Home className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleMapStyle} title="Toggle Map Style">
            <Layers className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Actions */}
        <div className="p-2 flex flex-col gap-1">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={undo} 
            disabled={!canUndo && !isDrawing}
            title="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={clear} 
            disabled={polygons.length === 0 && currentPoints.length === 0}
            title="Clear All"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Zoom Warning Banner */}
      {showZoomWarning && currentZoom < 19 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-yellow-500/95 text-yellow-950 backdrop-blur rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
          <ZoomIn className="h-4 w-4" />
          <span className="text-sm font-medium">Zoom in for better accuracy (current: {currentZoom.toFixed(1)}, recommended: 19+)</span>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 px-2 text-yellow-950 hover:bg-yellow-600/50"
            onClick={() => {
              handleZoomIn();
              if (currentZoom >= 18) setShowZoomWarning(false);
            }}
          >
            Zoom In
          </Button>
        </div>
      )}

      {/* Stats Panel */}
      <div className="absolute top-4 right-16 z-20 bg-background/95 backdrop-blur rounded-lg p-3 shadow-lg border">
        <div className="text-xs text-muted-foreground mb-1">Property</div>
        <div className="text-sm font-medium truncate max-w-[200px]">{address || 'Unknown'}</div>
        <div className="mt-2 flex items-center gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Total Area</div>
            <div className="text-lg font-bold text-primary">{getTotalArea().toFixed(0)} sq ft</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Facets</div>
            <div className="text-lg font-bold">{polygons.length}</div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Badge 
            variant={currentZoom < 19 ? "destructive" : "outline"} 
            className="text-xs"
          >
            Zoom: {currentZoom.toFixed(1)} {currentZoom < 19 ? '⚠️' : '✓'}
          </Badge>
          {lockedPixelsPerFoot && (
            <Badge variant="secondary" className="text-xs">
              Scale Locked
            </Badge>
          )}
        </div>
      </div>

      {/* Instructions */}
      {isMapLoaded && mode === 'draw' && !isDrawing && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-background/95 backdrop-blur rounded-lg px-4 py-2 shadow-lg border">
          <p className="text-sm text-muted-foreground">
            Click <strong>Draw</strong> then click on the map to trace roof edges. Double-click to complete.
          </p>
        </div>
      )}

      {/* Drawing Controls - shown during active drawing */}
      {isDrawing && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-background/95 backdrop-blur rounded-lg shadow-lg border p-2 flex items-center gap-2">
          <span className="text-sm text-muted-foreground px-2">
            {currentPoints.length} points
          </span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={removeLastPoint}
            disabled={currentPoints.length === 0}
          >
            <Undo2 className="h-4 w-4 mr-2" /> Undo Point
          </Button>
          <Button 
            variant="destructive" 
            size="sm" 
            onClick={() => {
              cancelDrawing();
              setMode('select');
              if (mapRef.current) {
                mapRef.current.dragPan.enable();
              }
            }}
          >
            <X className="h-4 w-4 mr-2" /> Cancel
          </Button>
          {currentPoints.length >= 3 && (
            <Button 
              variant="default" 
              size="sm" 
              onClick={completePolygon}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" /> Complete
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
