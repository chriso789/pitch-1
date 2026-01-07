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
  X,
  Mountain,
  Triangle,
  ArrowDownUp,
  Square,
  RefreshCw
} from 'lucide-react';
import { useMeasurementDrawing } from '@/hooks/useMeasurementDrawing';
import { calculatePolygonArea, calculatePolygonPerimeter } from '@/utils/measurementGeometry';

const POLYGON_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];

// Line type colors
const LINE_COLORS = {
  ridge: '#22c55e',   // Green
  hip: '#3b82f6',     // Blue
  valley: '#ef4444',  // Red
};

interface TracedLine {
  id: string;
  type: 'ridge' | 'hip' | 'valley';
  points: { x: number; y: number }[];
  lengthFt: number;
}

// Workflow steps: footprint first, then linear features
type WorkflowStep = 'footprint' | 'linear_features';

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
  const [mode, setMode] = useState<'select' | 'draw' | 'footprint' | 'ridge' | 'hip' | 'valley'>('footprint');
  const [mapStyle, setMapStyle] = useState<'satellite' | 'satellite-streets'>('satellite-streets');
  const [currentZoom, setCurrentZoom] = useState(initialZoom);
  const [pixelsPerFoot, setPixelsPerFoot] = useState(1);
  const [lockedPixelsPerFoot, setLockedPixelsPerFoot] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [showZoomWarning, setShowZoomWarning] = useState(false);
  
  // Workflow step state
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>('footprint');
  
  // Building footprint state (drawn perimeter)
  const [footprintPoints, setFootprintPoints] = useState<{ x: number; y: number }[]>([]);
  const [isFootprintComplete, setIsFootprintComplete] = useState(false);
  
  // Linear features state
  const [tracedLines, setTracedLines] = useState<TracedLine[]>([]);
  const [currentLinePoints, setCurrentLinePoints] = useState<{ x: number; y: number }[]>([]);
  const [isDrawingLine, setIsDrawingLine] = useState(false);

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

  // Render polygons, footprint and lines on canvas
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.getObjects().forEach(obj => canvas.remove(obj));

    // Render building footprint (if complete or in progress)
    if (footprintPoints.length > 0) {
      const footprintColor = '#f97316'; // Orange for footprint
      
      // Draw completed footprint polygon
      if (isFootprintComplete && footprintPoints.length >= 3) {
        const fabricPolygon = new FabricPolygon(footprintPoints, {
          fill: `${footprintColor}20`,
          stroke: footprintColor,
          strokeWidth: 4,
          selectable: false,
          evented: false,
        });
        canvas.add(fabricPolygon);
      }
      
      // Draw footprint edges (including in-progress)
      for (let i = 0; i < footprintPoints.length - 1; i++) {
        const line = new Line([
          footprintPoints[i].x, footprintPoints[i].y,
          footprintPoints[i + 1].x, footprintPoints[i + 1].y,
        ], {
          stroke: footprintColor,
          strokeWidth: isFootprintComplete ? 4 : 3,
          selectable: false,
          evented: false,
        });
        canvas.add(line);
      }
      
      // Close the polygon if complete
      if (isFootprintComplete && footprintPoints.length >= 3) {
        const line = new Line([
          footprintPoints[footprintPoints.length - 1].x, footprintPoints[footprintPoints.length - 1].y,
          footprintPoints[0].x, footprintPoints[0].y,
        ], {
          stroke: footprintColor,
          strokeWidth: 4,
          selectable: false,
          evented: false,
        });
        canvas.add(line);
      }
      
      // Draw footprint vertices
      footprintPoints.forEach((point, i) => {
        const circle = new Circle({
          left: point.x,
          top: point.y,
          radius: i === 0 ? 10 : 7,
          fill: i === 0 ? '#22c55e' : footprintColor,
          stroke: '#ffffff',
          strokeWidth: 3,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        canvas.add(circle);
      });
      
      // Add vertex count label
      if (footprintPoints.length >= 3) {
        const centerX = footprintPoints.reduce((sum, p) => sum + p.x, 0) / footprintPoints.length;
        const centerY = footprintPoints.reduce((sum, p) => sum + p.y, 0) / footprintPoints.length;
        
        const label = new Text(`Building Footprint\n${footprintPoints.length} vertices`, {
          left: centerX,
          top: centerY,
          fontSize: 14,
          fill: '#ffffff',
          backgroundColor: `${footprintColor}dd`,
          padding: 8,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        canvas.add(label);
      }
    }

    // Render completed facet polygons
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

    // Render completed traced lines
    tracedLines.forEach((tracedLine) => {
      const color = LINE_COLORS[tracedLine.type];
      for (let i = 0; i < tracedLine.points.length - 1; i++) {
        const line = new Line([
          tracedLine.points[i].x, tracedLine.points[i].y,
          tracedLine.points[i + 1].x, tracedLine.points[i + 1].y,
        ], {
          stroke: color,
          strokeWidth: 3,
          selectable: false,
          evented: false,
        });
        canvas.add(line);
      }
      
      // Add endpoints
      tracedLine.points.forEach((point) => {
        const circle = new Circle({
          left: point.x,
          top: point.y,
          radius: 5,
          fill: color,
          stroke: '#ffffff',
          strokeWidth: 2,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        canvas.add(circle);
      });

      // Add length label at midpoint
      if (tracedLine.points.length >= 2) {
        const midIndex = Math.floor(tracedLine.points.length / 2);
        const midPoint = tracedLine.points[midIndex];
        const label = new Text(`${tracedLine.lengthFt.toFixed(1)} ft`, {
          left: midPoint.x,
          top: midPoint.y - 15,
          fontSize: 12,
          fill: '#ffffff',
          backgroundColor: `${color}dd`,
          padding: 4,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        canvas.add(label);
      }
    });

    // Render current polygon drawing (for facets)
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

    // Render current line drawing (for ridges, hips, valleys)
    if (currentLinePoints.length > 0 && (mode === 'ridge' || mode === 'hip' || mode === 'valley')) {
      const lineColor = LINE_COLORS[mode as 'ridge' | 'hip' | 'valley'];
      
      for (let i = 0; i < currentLinePoints.length - 1; i++) {
        const line = new Line([
          currentLinePoints[i].x, currentLinePoints[i].y,
          currentLinePoints[i + 1].x, currentLinePoints[i + 1].y,
        ], {
          stroke: lineColor,
          strokeWidth: 3,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
        });
        canvas.add(line);
      }

      currentLinePoints.forEach((point, i) => {
        const circle = new Circle({
          left: point.x,
          top: point.y,
          radius: i === 0 ? 8 : 6,
          fill: lineColor,
          stroke: '#ffffff',
          strokeWidth: 2,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        canvas.add(circle);
      });
    }

    canvas.renderAll();
  }, [polygons, currentPoints, pixelsPerFoot, getCurrentArea, tracedLines, currentLinePoints, mode, footprintPoints, isFootprintComplete]);

  // Calculate line length in feet
  const calculateLineLengthFt = useCallback((points: { x: number; y: number }[]) => {
    if (points.length < 2) return 0;
    let totalLength = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      totalLength += Math.sqrt(dx * dx + dy * dy);
    }
    return totalLength / effectivePixelsPerFoot;
  }, [effectivePixelsPerFoot]);

  // Convert pixel coordinates to GPS
  const pixelToGeo = useCallback((x: number, y: number) => {
    const map = mapRef.current;
    if (!map) return { lat: centerLat, lng: centerLng };
    
    const center = map.getCenter();
    const zoom = map.getZoom();
    const metersPerPixel = (156543.03392 * Math.cos(center.lat * Math.PI / 180)) / Math.pow(2, zoom);
    
    const centerX = canvasSize.width / 2;
    const centerY = canvasSize.height / 2;
    
    const deltaX = x - centerX;
    const deltaY = centerY - y; // Invert Y
    
    const metersX = deltaX * metersPerPixel;
    const metersY = deltaY * metersPerPixel;
    
    const lat = center.lat + (metersY / 111320);
    const lng = center.lng + (metersX / (111320 * Math.cos(center.lat * Math.PI / 180)));
    
    return { lat, lng };
  }, [canvasSize, centerLat, centerLng]);

  // Generate WKT for polygon
  const generatePolygonWKT = useCallback((points: { x: number; y: number }[]) => {
    if (points.length < 3) return '';
    const geoPoints = points.map(p => pixelToGeo(p.x, p.y));
    // Close the polygon
    geoPoints.push(geoPoints[0]);
    const coordString = geoPoints.map(g => `${g.lng} ${g.lat}`).join(', ');
    return `POLYGON((${coordString}))`;
  }, [pixelToGeo]);

  // Generate WKT for linestring
  const generateLineWKT = useCallback((points: { x: number; y: number }[]) => {
    if (points.length < 2) return '';
    const geoPoints = points.map(p => pixelToGeo(p.x, p.y));
    const coordString = geoPoints.map(g => `${g.lng} ${g.lat}`).join(', ');
    return `LINESTRING(${coordString})`;
  }, [pixelToGeo]);

  const updateMeasurements = useCallback(() => {
    const map = mapRef.current;
    const center = map?.getCenter();
    const zoom = map?.getZoom() || initialZoom;
    
    // Build Mapbox static image URL for the current view
    const satelliteUrl = center 
      ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${center.lng},${center.lat},${zoom},0/${canvasSize.width}x${canvasSize.height}@2x?access_token=${mapboxToken}`
      : '';

    // Generate footprint perimeter WKT if complete
    const perimeterWkt = isFootprintComplete && footprintPoints.length >= 3 
      ? generatePolygonWKT(footprintPoints)
      : '';
    const perimeterVertexCount = isFootprintComplete ? footprintPoints.length : 0;

    // Convert polygons to faces with WKT
    const faces = polygons.map((p, index) => ({
      id: p.id,
      label: p.label || `Facet ${index + 1}`,
      boundary: p.points.map(pt => [pt.x / canvasSize.width, pt.y / canvasSize.height]),
      wkt: generatePolygonWKT(p.points),
      area_sqft: calculatePolygonArea(p.points, pixelsPerFoot),
      perimeter_ft: calculatePolygonPerimeter(p.points, pixelsPerFoot),
      pitch: '6/12',
      color: p.color || POLYGON_COLORS[index % POLYGON_COLORS.length],
    }));

    // Convert traced lines to tags format
    const ridgeLines = tracedLines.filter(l => l.type === 'ridge').map(l => ({
      wkt: generateLineWKT(l.points),
      length_ft: l.lengthFt,
    }));
    const hipLines = tracedLines.filter(l => l.type === 'hip').map(l => ({
      wkt: generateLineWKT(l.points),
      length_ft: l.lengthFt,
    }));
    const valleyLines = tracedLines.filter(l => l.type === 'valley').map(l => ({
      wkt: generateLineWKT(l.points),
      length_ft: l.lengthFt,
    }));

    // Calculate totals
    const totalRidgeLength = ridgeLines.reduce((sum, l) => sum + l.length_ft, 0);
    const totalHipLength = hipLines.reduce((sum, l) => sum + l.length_ft, 0);
    const totalValleyLength = valleyLines.reduce((sum, l) => sum + l.length_ft, 0);

    onMeasurementsChange?.({
      faces,
      // NEW: Include footprint perimeter data
      perimeter_wkt: perimeterWkt,
      perimeter_vertex_count: perimeterVertexCount,
      summary: {
        total_area_sqft: getTotalArea(),
        total_squares: getTotalArea() / 100,
        facet_count: polygons.length,
        ridge_length_ft: totalRidgeLength,
        hip_length_ft: totalHipLength,
        valley_length_ft: totalValleyLength,
      },
      tags: {
        ridge_lines: ridgeLines,
        hip_lines: hipLines,
        valley_lines: valleyLines,
      },
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      satelliteImageUrl: satelliteUrl,
      gps_coordinates: {
        lat: center?.lat || centerLat,
        lng: center?.lng || centerLng,
      },
      analysis_zoom: zoom,
      analysis_image_size: { width: canvasSize.width, height: canvasSize.height },
    });
  }, [polygons, tracedLines, pixelsPerFoot, getTotalArea, canvasSize, onMeasurementsChange, mapboxToken, centerLat, centerLng, initialZoom, generatePolygonWKT, generateLineWKT, footprintPoints, isFootprintComplete]);

  // Handle canvas clicks for drawing (placed after function definitions)
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const handleCanvasClick = (e: any) => {
      const pointer = canvas.getPointer(e.e);
      const point = { x: pointer.x, y: pointer.y };
      
      if (mode === 'footprint' && !isFootprintComplete) {
        // Add point to footprint
        setFootprintPoints(prev => [...prev, point]);
        if (mapRef.current) {
          mapRef.current.dragPan.disable();
        }
      } else if (mode === 'draw') {
        addPoint(point);
      } else if (mode === 'ridge' || mode === 'hip' || mode === 'valley') {
        // Add point to current line
        setCurrentLinePoints(prev => [...prev, point]);
        if (!isDrawingLine) {
          setIsDrawingLine(true);
          setLockedPixelsPerFoot(pixelsPerFoot);
        }
      }
    };

    const handleDoubleClick = () => {
      if (mode === 'footprint' && footprintPoints.length >= 3) {
        // Complete the footprint
        setIsFootprintComplete(true);
        setMode('select');
        if (mapRef.current) {
          mapRef.current.dragPan.enable();
        }
        toast.success(`Building footprint complete: ${footprintPoints.length} vertices`);
        setWorkflowStep('linear_features');
        // Trigger update after a short delay
        setTimeout(() => updateMeasurements(), 100);
      } else if (mode === 'draw' && isDrawing && currentPoints.length >= 3) {
        completePolygon();
      } else if ((mode === 'ridge' || mode === 'hip' || mode === 'valley') && currentLinePoints.length >= 2) {
        // Complete the line
        const lineType = mode as 'ridge' | 'hip' | 'valley';
        const lengthFt = calculateLineLengthFt(currentLinePoints);
        const newLine: TracedLine = {
          id: `${lineType}-${Date.now()}`,
          type: lineType,
          points: [...currentLinePoints],
          lengthFt,
        };
        setTracedLines(prev => [...prev, newLine]);
        setCurrentLinePoints([]);
        setIsDrawingLine(false);
        setLockedPixelsPerFoot(null);
        toast.success(`${lineType.charAt(0).toUpperCase() + lineType.slice(1)} line: ${lengthFt.toFixed(1)} ft`);
        // Trigger update after a short delay to allow state to settle
        setTimeout(() => updateMeasurements(), 100);
      }
    };

    canvas.on('mouse:down', handleCanvasClick);
    canvas.on('mouse:dblclick', handleDoubleClick);

    return () => {
      canvas.off('mouse:down', handleCanvasClick);
      canvas.off('mouse:dblclick', handleDoubleClick);
    };
  }, [mode, isDrawing, currentPoints, addPoint, completePolygon, currentLinePoints, isDrawingLine, pixelsPerFoot, calculateLineLengthFt, updateMeasurements, footprintPoints, isFootprintComplete]);

  // Start footprint drawing mode
  const handleStartFootprint = () => {
    setMode('footprint');
    setFootprintPoints([]);
    setIsFootprintComplete(false);
    if (mapRef.current) {
      mapRef.current.dragPan.disable();
    }
    toast.info('Click to trace building footprint corners. Double-click to complete.');
  };

  // Clear and redraw footprint
  const handleRedrawFootprint = () => {
    setFootprintPoints([]);
    setIsFootprintComplete(false);
    setWorkflowStep('footprint');
    setMode('footprint');
    if (mapRef.current) {
      mapRef.current.dragPan.disable();
    }
    toast.info('Redrawing footprint. Click corners of the building.');
  };

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

  const handleStartLineDraw = (lineType: 'ridge' | 'hip' | 'valley') => {
    setLockedPixelsPerFoot(pixelsPerFoot);
    setMode(lineType);
    setCurrentLinePoints([]);
    setIsDrawingLine(false);
    // Disable map drag when drawing
    if (mapRef.current) {
      mapRef.current.dragPan.disable();
    }
    toast.info(`Click to trace ${lineType} line. Double-click to complete.`);
  };

  const cancelLineDrawing = () => {
    setCurrentLinePoints([]);
    setIsDrawingLine(false);
    setLockedPixelsPerFoot(null);
    setMode('select');
    if (mapRef.current) {
      mapRef.current.dragPan.enable();
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
      {/* Workflow Step Indicator */}
        <div className="p-2 border-b">
          <div className="text-xs font-medium px-2 py-1 rounded bg-muted mb-2">
            Step {workflowStep === 'footprint' ? '1' : '2'}: {workflowStep === 'footprint' ? 'Draw Footprint' : 'Draw Lines'}
          </div>
          
          {/* Footprint Tool - FIRST */}
          <Button
            variant={mode === 'footprint' ? 'default' : isFootprintComplete ? 'outline' : 'secondary'}
            size="sm"
            onClick={isFootprintComplete ? handleRedrawFootprint : handleStartFootprint}
            className="justify-start w-full mb-1"
            style={{ color: mode === 'footprint' ? undefined : '#f97316' }}
          >
            {isFootprintComplete ? <RefreshCw className="h-4 w-4 mr-2" /> : <Square className="h-4 w-4 mr-2" />}
            {isFootprintComplete ? `Redraw (${footprintPoints.length} pts)` : 'Draw Footprint'}
          </Button>
          
          {isFootprintComplete && (
            <Badge variant="outline" className="text-green-600 border-green-300 w-full justify-center mb-1">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Footprint: {footprintPoints.length} vertices
            </Badge>
          )}
        </div>
        
        {/* Mode Selection - Facets (optional) */}
        <div className="p-2 border-b flex flex-col gap-1">
          <div className="text-xs text-muted-foreground px-2 py-1">Facets (optional)</div>
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
            Draw Facet
          </Button>
        </div>
        
        {/* Linear Feature Tools */}
        <div className="p-2 border-b flex flex-col gap-1">
          <div className="text-xs text-muted-foreground px-2 py-1">Linear Features</div>
          <Button
            variant={mode === 'ridge' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => handleStartLineDraw('ridge')}
            className="justify-start"
            style={{ color: mode === 'ridge' ? undefined : LINE_COLORS.ridge }}
          >
            <Mountain className="h-4 w-4 mr-2" />
            Ridge
          </Button>
          <Button
            variant={mode === 'hip' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => handleStartLineDraw('hip')}
            className="justify-start"
            style={{ color: mode === 'hip' ? undefined : LINE_COLORS.hip }}
          >
            <Triangle className="h-4 w-4 mr-2" />
            Hip
          </Button>
          <Button
            variant={mode === 'valley' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => handleStartLineDraw('valley')}
            className="justify-start"
            style={{ color: mode === 'valley' ? undefined : LINE_COLORS.valley }}
          >
            <ArrowDownUp className="h-4 w-4 mr-2" />
            Valley
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
            onClick={() => {
              clear();
              setTracedLines([]);
            }} 
            disabled={polygons.length === 0 && currentPoints.length === 0 && tracedLines.length === 0}
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
      <div className="absolute top-4 right-16 z-20 bg-background/95 backdrop-blur rounded-lg p-3 shadow-lg border max-w-xs">
        <div className="text-xs text-muted-foreground mb-1">Property</div>
        <div className="text-sm font-medium truncate max-w-[200px]">{address || 'Unknown'}</div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Total Area</div>
            <div className="text-lg font-bold text-primary">{getTotalArea().toFixed(0)} sq ft</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Facets</div>
            <div className="text-lg font-bold">{polygons.length}</div>
          </div>
        </div>
        
        {/* Linear feature stats */}
        {tracedLines.length > 0 && (
          <div className="mt-2 pt-2 border-t grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs text-muted-foreground">Ridge</div>
              <div className="text-sm font-bold" style={{ color: LINE_COLORS.ridge }}>
                {tracedLines.filter(l => l.type === 'ridge').reduce((sum, l) => sum + l.lengthFt, 0).toFixed(0)} ft
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Hip</div>
              <div className="text-sm font-bold" style={{ color: LINE_COLORS.hip }}>
                {tracedLines.filter(l => l.type === 'hip').reduce((sum, l) => sum + l.lengthFt, 0).toFixed(0)} ft
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Valley</div>
              <div className="text-sm font-bold" style={{ color: LINE_COLORS.valley }}>
                {tracedLines.filter(l => l.type === 'valley').reduce((sum, l) => sum + l.lengthFt, 0).toFixed(0)} ft
              </div>
            </div>
          </div>
        )}
        
        <div className="mt-2 flex items-center gap-2 flex-wrap">
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
            Click <strong>Facet</strong> then click on the map to trace roof edges. Double-click to complete.
          </p>
        </div>
      )}

      {isMapLoaded && (mode === 'ridge' || mode === 'hip' || mode === 'valley') && !isDrawingLine && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-background/95 backdrop-blur rounded-lg px-4 py-2 shadow-lg border">
          <p className="text-sm text-muted-foreground">
            Click to trace <strong>{mode}</strong> line. Double-click to complete.
          </p>
        </div>
      )}

      {/* Drawing Controls - shown during active polygon drawing */}
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

      {/* Line Drawing Controls - shown during active line drawing */}
      {isDrawingLine && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-background/95 backdrop-blur rounded-lg shadow-lg border p-2 flex items-center gap-2">
          <Badge style={{ backgroundColor: LINE_COLORS[mode as 'ridge' | 'hip' | 'valley'] }}>
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </Badge>
          <span className="text-sm text-muted-foreground px-2">
            {currentLinePoints.length} points | {calculateLineLengthFt(currentLinePoints).toFixed(1)} ft
          </span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setCurrentLinePoints(prev => prev.slice(0, -1))}
            disabled={currentLinePoints.length === 0}
          >
            <Undo2 className="h-4 w-4 mr-2" /> Undo Point
          </Button>
          <Button 
            variant="destructive" 
            size="sm" 
            onClick={cancelLineDrawing}
          >
            <X className="h-4 w-4 mr-2" /> Cancel
          </Button>
          {currentLinePoints.length >= 2 && (
            <Button 
              variant="default" 
              size="sm" 
              onClick={() => {
                const lineType = mode as 'ridge' | 'hip' | 'valley';
                const lengthFt = calculateLineLengthFt(currentLinePoints);
                const newLine: TracedLine = {
                  id: `${lineType}-${Date.now()}`,
                  type: lineType,
                  points: [...currentLinePoints],
                  lengthFt,
                };
                setTracedLines(prev => [...prev, newLine]);
                setCurrentLinePoints([]);
                setIsDrawingLine(false);
                setLockedPixelsPerFoot(null);
                toast.success(`${lineType.charAt(0).toUpperCase() + lineType.slice(1)} line: ${lengthFt.toFixed(1)} ft`);
                setTimeout(() => updateMeasurements(), 100);
              }}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" /> Complete
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
