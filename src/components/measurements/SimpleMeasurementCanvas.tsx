import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas as FabricCanvas, Circle, Line, Polygon as FabricPolygon, FabricImage, Text } from 'fabric';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { 
  Pencil, 
  Undo2, 
  Redo2, 
  Trash2, 
  Home, 
  Loader2,
  CheckCircle2,
  MousePointer2,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  MapPin,
  AlertTriangle,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useMeasurementDrawing } from '@/hooks/useMeasurementDrawing';
import { calculatePolygonArea, calculatePolygonPerimeter, convertSolarPolygonToPoints } from '@/utils/measurementGeometry';
import { supabase } from '@/integrations/supabase/client';
import { RidgeLineVisualizer } from './RidgeLineVisualizer';
import { FacetSplittingTools } from './FacetSplittingTools';
import { useMobileMeasurementControls } from './SimpleMeasurementCanvas.touch';
import { MobileToolbar } from './MobileToolbar';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTouchControls } from '@/hooks/useTouchControls';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';
import { offlineManager } from '@/services/offlineManager';

// Color palette for polygons
const POLYGON_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
];

interface SimpleMeasurementCanvasProps {
  satelliteImageUrl: string;
  propertyId?: string;
  address?: string;
  centerLat?: number;
  centerLng?: number;
  zoom?: number;
  width?: number;
  height?: number;
  onMeasurementsChange?: (measurements: any) => void;
}

export function SimpleMeasurementCanvas({
  satelliteImageUrl,
  propertyId,
  address,
  centerLat = 0,
  centerLng = 0,
  zoom = 20,
  width = 1200,
  height = 800,
  onMeasurementsChange,
}: SimpleMeasurementCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState(true);
  const [isDetectingBuilding, setIsDetectingBuilding] = useState(false);
  const [pixelsPerFoot, setPixelsPerFoot] = useState(1);
  const [mode, setMode] = useState<'select' | 'draw'>('draw');
  const [detectedLinearFeatures, setDetectedLinearFeatures] = useState<any>(null);
  const [showLinearFeatures, setShowLinearFeatures] = useState(true);
  const [buildingPolygon, setBuildingPolygon] = useState<[number, number][]>([]);
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const [zoomAdjustment, setZoomAdjustment] = useState(0);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [fabricZoomLevel, setFabricZoomLevel] = useState(1);
  const [coordinateOffset, setCoordinateOffset] = useState(0);

  const isMobile = useIsMobile();
  const { vibrate, isSupported: hapticSupported } = useHapticFeedback();

  const {
    polygons,
    currentPoints,
    isDrawing,
    selectedPolygonId,
    startDrawing,
    addPoint,
    completePolygon,
    cancelDrawing,
    movePoint,
    deletePolygon,
    undo,
    redo,
    clear,
    importBuildingOutline,
    getCurrentArea,
    getCurrentPerimeter,
    getTotalArea,
    canUndo,
    canRedo,
  } = useMeasurementDrawing({
    pixelsPerFoot,
    snapThreshold: 15,
    onPolygonComplete: (polygon) => {
      const area = calculatePolygonArea(polygon.points, pixelsPerFoot);
      toast.success(`${polygon.label} completed: ${area.toFixed(0)} sq ft`);
      updateMeasurements();
    },
  });

  // Initialize canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width,
      height,
      backgroundColor: '#1a1a1a',
      selection: false,
      allowTouchScrolling: isMobile, // Enable touch scrolling on mobile
    });

    fabricCanvasRef.current = canvas;

    return () => {
      canvas.dispose();
    };
  }, [width, height, isMobile]);

  // Load satellite image with offline caching
  useEffect(() => {
    if (!fabricCanvasRef.current || !satelliteImageUrl) return;

    const loadImage = async () => {
      setIsLoadingImage(true);
      
      try {
        // Try to get cached image first
        let imageUrl = satelliteImageUrl;
        if (propertyId && offlineManager.isOnline()) {
          const cached = await offlineManager.getCachedSatelliteImage(propertyId, Math.round(currentZoom));
          if (cached) {
            imageUrl = cached;
            console.log('Loaded satellite image from cache');
          } else {
            // Cache the new image for offline use
            const cachedUrl = await offlineManager.cacheSatelliteImage(
              satelliteImageUrl,
              propertyId,
              centerLat,
              centerLng,
              Math.round(currentZoom)
            );
            if (cachedUrl) {
              imageUrl = cachedUrl;
              console.log('Cached satellite image for offline use');
            }
          }
        }

        const img = await FabricImage.fromURL(imageUrl, {
          crossOrigin: 'anonymous',
        });
        
        if (!fabricCanvasRef.current) return;

        img.scaleToWidth(width);
        img.scaleToHeight(height);
        img.set({ selectable: false, evented: false });
        
        fabricCanvasRef.current.backgroundImage = img;
        fabricCanvasRef.current.renderAll();
        setIsLoadingImage(false);

        // Calculate approximate pixels per foot based on zoom
        const feetPerPixel = Math.pow(2, 20 - currentZoom) * 0.3;
        setPixelsPerFoot(1 / feetPerPixel);
      } catch (error) {
        console.error('Error loading satellite image:', error);
        toast.error('Failed to load satellite image');
        setIsLoadingImage(false);
      }
    };

    loadImage();
  }, [satelliteImageUrl, width, height, currentZoom, propertyId, centerLat, centerLng]);

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

  // Render polygons and current drawing
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Clear existing objects (except background)
    canvas.getObjects().forEach(obj => canvas.remove(obj));

    // Render completed polygons
    polygons.forEach((polygon, index) => {
      const points = polygon.points.flatMap(p => [p.x, p.y]);
      
      const fabricPolygon = new FabricPolygon(polygon.points, {
        fill: `${polygon.color}40`,
        stroke: polygon.color,
        strokeWidth: 3,
        selectable: false,
        evented: false,
      });
      
      canvas.add(fabricPolygon);

      // Add corner points
      polygon.points.forEach((point, i) => {
        const circle = new Circle({
          left: point.x,
          top: point.y,
          radius: isMobile ? 12 : 6,
          fill: polygon.color,
          stroke: '#ffffff',
          strokeWidth: isMobile ? 3 : 2,
          originX: 'center',
          originY: 'center',
          selectable: true,
          hasControls: false,
          hasBorders: false,
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
          fontSize: 16,
          fill: '#ffffff',
          backgroundColor: `${polygon.color}dd`,
          padding: 8,
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
      // Draw lines between points
      for (let i = 0; i < currentPoints.length - 1; i++) {
        const line = new Line([
          currentPoints[i].x,
          currentPoints[i].y,
          currentPoints[i + 1].x,
          currentPoints[i + 1].y,
        ], {
          stroke: '#3b82f6',
          strokeWidth: 2,
          selectable: false,
          evented: false,
        });
        canvas.add(line);
      }

      // Draw points
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

      // Show live area if 3+ points
      if (currentPoints.length >= 3) {
        const centerX = currentPoints.reduce((sum, p) => sum + p.x, 0) / currentPoints.length;
        const centerY = currentPoints.reduce((sum, p) => sum + p.y, 0) / currentPoints.length;
        const area = getCurrentArea();
        
        const label = new Text(`${area.toFixed(0)} sq ft`, {
          left: centerX,
          top: centerY,
          fontSize: 18,
          fontWeight: 'bold',
          fill: '#ffffff',
          backgroundColor: '#3b82f6dd',
          padding: 10,
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

  // Auto-detect building using Google Solar API
  const handleAutoDetect = useCallback(async () => {
    if (!address && !centerLat && !centerLng) {
      toast.error('Address or coordinates required for auto-detection');
      return;
    }

    setIsDetectingBuilding(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('measure', {
        body: {
          action: 'pull',
          propertyId: propertyId || 'temp',
          lat: centerLat,
          lng: centerLng,
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Failed to detect building');

      const measurement = data.data.measurement;
      
      if (measurement?.buildingFootprint?.coordinates) {
        const coords = measurement.buildingFootprint.coordinates[0];
        const geoCoords = coords.map(c => [c.lng, c.lat] as [number, number]);
        setBuildingPolygon(geoCoords);
        
        const points = convertSolarPolygonToPoints(
          coords,
          centerLng,
          centerLat,
          zoom,
          width,
          height
        );
        
        importBuildingOutline(points);
        
        // Extract linear features (ridge, hip, valley)
        if (measurement.linear_features) {
          const ridges = measurement.linear_features.filter((f: any) => f.type === 'ridge');
          const hips = measurement.linear_features.filter((f: any) => f.type === 'hip');
          const valleys = measurement.linear_features.filter((f: any) => f.type === 'valley');
          
          setDetectedLinearFeatures({
            ridges: ridges.map((f: any) => ({
              ...f,
              points: f.wkt ? parseLineString(f.wkt) : undefined,
            })),
            hips: hips.map((f: any) => ({
              ...f,
              points: f.wkt ? parseLineString(f.wkt) : undefined,
            })),
            valleys: valleys.map((f: any) => ({
              ...f,
              points: f.wkt ? parseLineString(f.wkt) : undefined,
            })),
          });
          
          toast.success(
            'Building detected with roof topology!',
            { 
              description: `${ridges.length} ridges, ${hips.length} hips, ${valleys.length} valleys`
            }
          );
        } else {
          toast.success('Building outline detected and imported');
        }
      } else {
        toast.error('No building outline found');
      }
    } catch (error: any) {
      console.error('Auto-detect error:', error);
      toast.error(error.message || 'Failed to detect building');
    } finally {
      setIsDetectingBuilding(false);
    }
  }, [address, centerLat, centerLng, propertyId, zoom, width, height, importBuildingOutline]);

  const updateMeasurements = useCallback(() => {
    // Convert polygons to comprehensive measurement format
    const faces = polygons.map((p, index) => ({
      id: p.id,
      label: p.label || `Facet ${index + 1}`,
      boundary: p.points.map(pt => [pt.x / width, pt.y / height]), // Normalized 0-1
      area_sqft: calculatePolygonArea(p.points, pixelsPerFoot),
      plan_area_sqft: calculatePolygonArea(p.points, pixelsPerFoot),
      perimeter_ft: calculatePolygonPerimeter(p.points, pixelsPerFoot),
      pitch: '6/12', // default
      direction: 'N', // default
      color: p.color || POLYGON_COLORS[index % POLYGON_COLORS.length],
    }));

    const comprehensiveMeasurement = {
      faces,
      linear_features: detectedLinearFeatures || { ridges: [], hips: [], valleys: [] },
      summary: {
        total_area_sqft: getTotalArea(),
        total_squares: getTotalArea() / 100,
        perimeter_ft: polygons.reduce((sum, p) => sum + calculatePolygonPerimeter(p.points, pixelsPerFoot), 0),
        facet_count: polygons.length,
        pitch: '6/12', // default global pitch
        waste_pct: 10, // default waste
      },
      tags: {}, // Will be populated with ridge/hip/valley data
      buildingFootprint: buildingPolygon,
      canvasWidth: width,
      canvasHeight: height,
      satelliteImageUrl,
    };
    
    onMeasurementsChange?.(comprehensiveMeasurement);
  }, [polygons, pixelsPerFoot, getTotalArea, detectedLinearFeatures, buildingPolygon, width, height, satelliteImageUrl, onMeasurementsChange]);

  const handleStartDrawing = () => {
    setMode('draw');
    startDrawing();
    if (isMobile) {
      vibrate('light');
      toast.info('Tap to add corners. Double-tap to close polygon.');
    } else {
      toast.info('Click to add corners. Click first point or double-click to close polygon.');
    }
  };

  const handleApplySplit = useCallback((splitLine: any) => {
    // Convert geo coordinates to canvas pixels if needed
    // For now, just show a toast - full implementation would split the polygon
    toast.info('Split line applied - implementation in progress');
    console.log('Split line:', splitLine);
  }, []);

  // Helper to parse WKT LINESTRING
  const parseLineString = (wkt: string): [number, number][] => {
    const match = wkt.match(/LINESTRING\(([^)]+)\)/);
    if (!match) return [];
    
    return match[1]
      .split(',')
      .map(pair => {
        const [lng, lat] = pair.trim().split(' ').map(Number);
        return [lng, lat] as [number, number];
      });
  };

  const handleRegenerateSatellite = async (newZoomAdjustment?: number) => {
    if (!propertyId) {
      toast.error('Property ID required for regeneration');
      return;
    }

    setIsRegenerating(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('generate-measurement-visualization', {
        body: {
          property_id: propertyId,
          verified_address_lat: centerLat,
          verified_address_lng: centerLng,
          zoom_adjustment: newZoomAdjustment ?? zoomAdjustment
        }
      });

      if (error) throw error;
      
      if (data?.ok && data.data?.visualization_url) {
        // Force reload with cache buster
        const newUrl = `${data.data.visualization_url}?t=${Date.now()}`;
        
        // Update canvas with new satellite image
        if (fabricCanvasRef.current) {
          FabricImage.fromURL(newUrl).then((img) => {
            img.scaleToWidth(width);
            img.scaleToHeight(height);
            img.set({ selectable: false, evented: false });
            
            const canvas = fabricCanvasRef.current;
            if (canvas) {
              const existingBg = canvas.backgroundImage;
              if (existingBg) {
                canvas.remove(existingBg as any);
              }
              canvas.backgroundImage = img as any;
              canvas.renderAll();
            }
          });
        }

        setCurrentZoom(data.data.metadata?.zoom || currentZoom);
        toast.success('Satellite view updated successfully');
      } else {
        throw new Error(data?.error || 'Failed to regenerate satellite view');
      }
    } catch (err) {
      console.error('Regeneration error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to regenerate satellite view');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleZoomIn = () => {
    const newAdjustment = Math.min(zoomAdjustment + 1, 3);
    setZoomAdjustment(newAdjustment);
    handleRegenerateSatellite(newAdjustment);
  };

  const handleZoomOut = () => {
    const newAdjustment = Math.max(zoomAdjustment - 1, -2);
    setZoomAdjustment(newAdjustment);
    handleRegenerateSatellite(newAdjustment);
  };

  const handleZoomReset = () => {
    setZoomAdjustment(0);
    handleRegenerateSatellite(0);
  };

  // Mobile touch controls integration - imported at top
  useMobileMeasurementControls(
    fabricCanvasRef.current,
    mode,
    isDrawing,
    addPoint,
    completePolygon,
    setFabricZoomLevel
  );

  // Mouse wheel zoom functionality
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || isMobile) return;

    const handleMouseWheel = (opt: any) => {
      const delta = opt.e.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      
      // Clamp zoom between 0.5x and 3x
      zoom = Math.max(0.5, Math.min(3, zoom));
      
      const point = { x: opt.e.offsetX, y: opt.e.offsetY };
      canvas.zoomToPoint(point as any, zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
      
      setFabricZoomLevel(zoom);
    };

    canvas.on('mouse:wheel', handleMouseWheel);

    return () => {
      canvas.off('mouse:wheel', handleMouseWheel);
    };
  }, [fabricCanvasRef.current, isMobile]);

  // Keyboard shortcuts for zoom
  useEffect(() => {
    if (isMobile) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        const newZoom = Math.min(canvas.getZoom() * 1.1, 3);
        canvas.setZoom(newZoom);
        canvas.renderAll();
        setFabricZoomLevel(newZoom);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        const newZoom = Math.max(canvas.getZoom() * 0.9, 0.5);
        canvas.setZoom(newZoom);
        canvas.renderAll();
        setFabricZoomLevel(newZoom);
      } else if (e.key === '0') {
        e.preventDefault();
        canvas.setZoom(1);
        canvas.renderAll();
        setFabricZoomLevel(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fabricCanvasRef.current, isMobile]);

  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Render mobile toolbar if on mobile
  if (isMobile) {
    return (
      <>
        <div className="flex flex-col gap-4 pb-24">
          {/* Offline indicator */}
          {isOffline && (
            <Card className="p-3 bg-destructive/10 border-destructive">
              <div className="flex items-center gap-2 text-destructive">
                <WifiOff className="h-4 w-4" />
                <span className="text-sm font-medium">Offline Mode - Changes will sync when online</span>
              </div>
            </Card>
          )}

          {/* Live Measurements */}
          <Card className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Facets</div>
                <div className="text-2xl font-bold">{polygons.length}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Area</div>
                <div className="text-2xl font-bold text-primary">
                  {getTotalArea().toFixed(0)} sf
                </div>
              </div>
            </div>
          </Card>

          {/* Canvas */}
          <Card className="relative overflow-hidden touch-none">
            {isLoadingImage && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Loading...</p>
                </div>
              </div>
            )}
            
            <canvas ref={canvasRef} className="w-full touch-none" />
          </Card>
        </div>

        {/* Mobile Toolbar */}
        <MobileToolbar
          mode={mode}
          isDrawing={isDrawing}
          canUndo={canUndo}
          canRedo={canRedo}
          currentArea={getCurrentArea()}
          totalArea={getTotalArea()}
          facetCount={polygons.length}
          showLinearFeatures={showLinearFeatures}
          isDetectingBuilding={isDetectingBuilding}
          onStartDrawing={handleStartDrawing}
          onUndo={undo}
          onRedo={redo}
          onClear={clear}
          onAutoDetect={handleAutoDetect}
          onToggleLinearFeatures={() => setShowLinearFeatures(!showLinearFeatures)}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          onCompletePolygon={completePolygon}
        />
      </>
    );
  }

  // Desktop render
  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            {/* Coordinate accuracy display */}
            <div className="flex items-center gap-2 border-r border-border pr-4">
              <Badge variant="outline" className="text-xs">
                <MapPin className="h-3 w-3 mr-1" />
                {centerLat.toFixed(6)}, {centerLng.toFixed(6)}
              </Badge>
              
              <Badge variant="secondary" className="text-xs">
                Canvas: {fabricZoomLevel.toFixed(1)}x
              </Badge>
            </div>

            <div className="flex items-center gap-2 border-r border-border pr-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleZoomOut}
                disabled={isRegenerating || zoomAdjustment <= -2}
                title="Zoom Out (- key)"
                className="h-8"
              >
                <ZoomOut className="h-3 w-3 mr-1" />
                Out (-)
              </Button>
              <Badge variant="secondary" className="min-w-[80px] justify-center">
                Map: {(currentZoom + zoomAdjustment).toFixed(1)}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleZoomIn}
                disabled={isRegenerating || zoomAdjustment >= 3}
                title="Zoom In (+ key)"
                className="h-8"
              >
                <ZoomIn className="h-3 w-3 mr-1" />
                In (+)
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleZoomReset}
                disabled={isRegenerating || zoomAdjustment === 0}
                title="Reset Zoom (0 key)"
                className="h-8"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset (0)
              </Button>
              <span className="text-xs text-muted-foreground">
                or scroll
              </span>
            </div>

            <div className="flex items-center gap-2">
            <Button
              variant={mode === 'draw' ? 'default' : 'outline'}
              size="sm"
              onClick={handleStartDrawing}
              disabled={isDrawing}
            >
              <Pencil className="w-4 h-4 mr-2" />
              {isDrawing ? 'Drawing...' : 'Draw Polygon'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleAutoDetect}
              disabled={isDetectingBuilding || isDrawing}
            >
              {isDetectingBuilding ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Home className="w-4 h-4 mr-2" />
              )}
              Auto-Detect Building
            </Button>

            {isDrawing && (
              <Button
                variant="outline"
                size="sm"
                onClick={completePolygon}
                disabled={currentPoints.length < 3}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Complete
              </Button>
            )}
          </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={undo}
              disabled={!canUndo}
              title="Undo"
            >
              <Undo2 className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={redo}
              disabled={!canRedo}
              title="Redo"
            >
              <Redo2 className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={clear}
              disabled={polygons.length === 0}
              title="Clear All"
            >
              <Trash2 className="w-4 h-4" />
            </Button>

            {detectedLinearFeatures && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowLinearFeatures(!showLinearFeatures)}
                title={showLinearFeatures ? 'Hide Ridge/Hip/Valley Lines' : 'Show Ridge/Hip/Valley Lines'}
              >
                {showLinearFeatures ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className="gap-1">
              <MapPin className="h-3 w-3" />
              {centerLat.toFixed(6)}, {centerLng.toFixed(6)}
            </Badge>
            {address && (
              <Badge variant="secondary" className="max-w-[300px] truncate">
                {address}
              </Badge>
            )}
          </div>
        </div>
      </Card>

      {/* Live Measurements */}
      <Card className="p-4">
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <div className="text-sm text-muted-foreground">Total Facets</div>
            <div className="text-2xl font-bold">{polygons.length}</div>
          </div>

          <div>
            <div className="text-sm text-muted-foreground">Total Area</div>
            <div className="text-2xl font-bold text-primary">
              {getTotalArea().toFixed(0)} sq ft
            </div>
          </div>

          {isDrawing && currentPoints.length >= 3 && (
            <div>
              <div className="text-sm text-muted-foreground">Current Drawing</div>
              <div className="text-2xl font-bold text-blue-500">
                {getCurrentArea().toFixed(0)} sq ft
              </div>
            </div>
          )}

          {isDrawing && (
            <Badge variant="secondary" className="text-sm">
              <MousePointer2 className="w-3 h-3 mr-1" />
              {currentPoints.length} points
            </Badge>
          )}
        </div>
      </Card>

      {/* Facet Splitting Tools */}
      {buildingPolygon.length >= 3 && (
        <FacetSplittingTools
          buildingPolygon={buildingPolygon}
          linearFeatures={detectedLinearFeatures}
          onApplySplit={handleApplySplit}
          disabled={isDrawing}
        />
      )}

      {/* Canvas */}
      <Card className="relative overflow-hidden">
        {isLoadingImage && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading satellite image...</p>
            </div>
          </div>
        )}
        
        <canvas ref={canvasRef} />
        
        {/* Ridge/Hip/Valley Line Visualizer */}
        <RidgeLineVisualizer
          canvas={fabricCanvasRef.current}
          linearFeatures={detectedLinearFeatures}
          centerLng={centerLng}
          centerLat={centerLat}
          zoom={zoom}
          canvasWidth={width}
          canvasHeight={height}
          visible={showLinearFeatures}
        />
      </Card>

      {/* Linear Features Legend */}
      {detectedLinearFeatures && showLinearFeatures && (
        <Card className="p-3">
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5 bg-[#10b981] border-dashed" />
              <span className="text-muted-foreground">Ridge Lines</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5 bg-[#3b82f6] border-dashed" />
              <span className="text-muted-foreground">Hip Lines</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5 bg-[#ef4444] border-dashed" />
              <span className="text-muted-foreground">Valley Lines</span>
            </div>
          </div>
        </Card>
      )}

      {/* Instructions */}
      {isDrawing && (
        <Card className="p-4 bg-blue-500/10 border-blue-500/20">
          <div className="flex items-start gap-3">
            <MousePointer2 className="w-5 h-5 text-blue-500 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Drawing Tips:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Click to add corners to your polygon</li>
                <li>• Click the first point (green) or double-click to close</li>
                <li>• Area updates in real-time as you draw</li>
                <li>• Press Esc to cancel current drawing</li>
              </ul>
            </div>
          </div>
        </Card>
      )}
    </div>
  ); // End desktop render
}
