import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Canvas as FabricCanvas, Line, FabricImage, FabricText, Circle, Point } from 'fabric';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Columns2, AlertCircle, Hand, ZoomIn, ZoomOut, RotateCcw, Filter, FilterX } from 'lucide-react';

interface TrainingOverlayComparisonProps {
  satelliteImageUrl: string;
  centerLat: number;
  centerLng: number;
  zoom?: number;
  manualTraces: {
    id: string;
    trace_type: string;
    length_ft: number;
    canvas_points: { x: number; y: number }[];
  }[];
  aiLinearFeatures: {
    id?: string;
    type: string;
    wkt: string;
    length_ft: number;
  }[];
  // The AI measurement's own center for proper WKT alignment
  aiMeasurementCenter?: { lat: number; lng: number };
  // View mode: 'original' shows raw AI detection, 'corrected' shows user-trained result
  viewMode?: 'original' | 'corrected';
}

// Match TrainingCanvas dimensions exactly
const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 700;

// Original satellite image size (Google Static Maps returns 640x640)
const ORIGINAL_IMAGE_SIZE = 640;

// Color schemes for different trace types
const TRACE_COLORS: Record<string, string> = {
  ridge: '#22c55e',
  hip: '#8b5cf6',
  valley: '#ef4444',
  eave: '#14b8a6',
  rake: '#06b6d4',
  perimeter: '#f97316',
};

// Parse WKT LINESTRING to canvas points with aspect ratio correction
function parseWKTLineString(
  wkt: string,
  centerLat: number,
  centerLng: number,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number
): { x: number; y: number }[] {
  // Guard: wkt must be a string
  if (typeof wkt !== 'string') {
    console.warn('[parseWKTLineString] wkt is not a string:', typeof wkt);
    return [];
  }

  try {
    const match = wkt.match(/LINESTRING\s*\(([^)]+)\)/i);
    if (!match) return [];

    const coordPairs = match[1].split(',').map(pair => {
      const [lng, lat] = pair.trim().split(/\s+/).map(Number);
      return { lat, lng };
    });

    // Filter out any NaN coordinates
    const validCoordPairs = coordPairs.filter(c => isFinite(c.lat) && isFinite(c.lng));
    if (validCoordPairs.length < 2) {
      console.warn('[parseWKTLineString] Not enough valid coordinates in WKT');
      return [];
    }

    // Base meters per pixel for the ORIGINAL 640x640 square image
    const baseMetersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
    
    // Scale factors for aspect ratio correction (canvas is stretched from 640x640 to 900x700)
    const scaleX = canvasWidth / ORIGINAL_IMAGE_SIZE;   // 900/640 = 1.406
    const scaleY = canvasHeight / ORIGINAL_IMAGE_SIZE;  // 700/640 = 1.094
    
    // Effective meters-per-pixel on the stretched canvas (different for X and Y)
    const metersPerPixelX = baseMetersPerPixel / scaleX;
    const metersPerPixelY = baseMetersPerPixel / scaleY;
    
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);

    const points = validCoordPairs.map(coord => {
      const dLat = coord.lat - centerLat;
      const dLng = coord.lng - centerLng;
      
      // Use separate meters-per-pixel for X and Y axes
      const dY = dLat * metersPerDegLat / metersPerPixelY;
      const dX = dLng * metersPerDegLng / metersPerPixelX;

      return {
        x: canvasWidth / 2 + dX,
        y: canvasHeight / 2 - dY,
      };
    });

    // Filter out any NaN results
    return points.filter(p => isFinite(p.x) && isFinite(p.y));
  } catch (err) {
    console.error('[parseWKTLineString] Failed to parse WKT:', err, wkt?.slice?.(0, 50));
    return [];
  }
}

// Calculate totals by type
function calculateTotals(traces: { trace_type: string; length_ft: number }[] | undefined | null): Record<string, number> {
  const totals: Record<string, number> = {};
  if (!Array.isArray(traces)) return totals;
  traces.forEach(t => {
    if (!t?.trace_type) return;
    const type = t.trace_type.toLowerCase();
    totals[type] = (totals[type] || 0) + (t.length_ft || 0);
  });
  return totals;
}

function calculateAITotals(features: { type: string; length_ft: number }[] | undefined | null): Record<string, number> {
  const totals: Record<string, number> = {};
  if (!Array.isArray(features)) return totals;
  features.forEach(f => {
    if (!f?.type) return;
    const type = f.type.toLowerCase();
    totals[type] = (totals[type] || 0) + (f.length_ft || 0);
  });
  return totals;
}

// Plausibility thresholds for linear features - same as SchematicRoofDiagram
const LINE_PLAUSIBILITY = {
  MAX_LINES_PER_TYPE: 20,
  MAX_STARBURST_RATIO: 0.50,
  MIN_LINE_LENGTH_FT: 2,
  MAX_LINE_LENGTH_FT: 200,
  MIN_LINES_FOR_STARBURST: 8,
  ABSOLUTE_MAX_CONVERGENCE: 6,
};

// Label collision detection - track rendered label bounds
interface LabelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function checkLabelCollision(newLabel: LabelBounds, existingLabels: LabelBounds[]): boolean {
  return existingLabels.some(existing =>
    !(newLabel.x + newLabel.width < existing.x ||
      newLabel.x > existing.x + existing.width ||
      newLabel.y + newLabel.height < existing.y ||
      newLabel.y > existing.y + existing.height)
  );
}

// Filter out implausible AI features - SAME logic as SchematicRoofDiagram
interface FeatureWithPoints {
  id?: string;
  type: string;
  wkt: string;
  length_ft: number;
  points: { x: number; y: number }[];
}

function filterPlausibleFeatures(
  features: FeatureWithPoints[]
): { plausible: FeatureWithPoints[]; implausibleCount: number; starburstDetected: boolean } {
  // Separate eaves/rakes from interior lines - eaves/rakes bypass filtering
  const eavesRakes = features.filter(f => f.type === 'eave' || f.type === 'rake');
  const interiorLines = features.filter(f => f.type !== 'eave' && f.type !== 'rake');

  // Count interior lines by type
  const typeCounts: Record<string, number> = {};
  interiorLines.forEach(f => {
    typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
  });

  // Check for starburst pattern - lines converging at one point
  const allEndpoints: Record<string, number> = {};
  interiorLines.forEach(f => {
    if (f.points && f.points.length >= 2) {
      const startKey = `${f.points[0].x.toFixed(0)},${f.points[0].y.toFixed(0)}`;
      allEndpoints[startKey] = (allEndpoints[startKey] || 0) + 1;
      const lastIdx = f.points.length - 1;
      const endKey = `${f.points[lastIdx].x.toFixed(0)},${f.points[lastIdx].y.toFixed(0)}`;
      allEndpoints[endKey] = (allEndpoints[endKey] || 0) + 1;
    }
  });

  const maxAtSinglePoint = Math.max(...Object.values(allEndpoints), 0);
  const totalInteriorEndpoints = interiorLines.length * 2;
  const starburstRatio = totalInteriorEndpoints > 0 ? maxAtSinglePoint / totalInteriorEndpoints : 0;

  const highConvergencePoints = Object.entries(allEndpoints)
    .filter(([_, count]) => count >= Math.max(3, interiorLines.length * 0.25));

  let plausibleInterior = interiorLines;
  let starburstDetected = false;

  const hasEnoughLines = interiorLines.length >= LINE_PLAUSIBILITY.MIN_LINES_FOR_STARBURST;
  const isTrueStarburst = highConvergencePoints.length === 1 &&
    maxAtSinglePoint >= LINE_PLAUSIBILITY.ABSOLUTE_MAX_CONVERGENCE &&
    starburstRatio > LINE_PLAUSIBILITY.MAX_STARBURST_RATIO;

  if (hasEnoughLines && isTrueStarburst) {
    console.warn('[TrainingOverlay] Starburst pattern detected - hiding interior lines');
    plausibleInterior = [];
    starburstDetected = true;
  } else {
    // Filter individual interior lines
    plausibleInterior = interiorLines.filter(f => {
      if (f.length_ft < LINE_PLAUSIBILITY.MIN_LINE_LENGTH_FT) return false;
      if (f.length_ft > LINE_PLAUSIBILITY.MAX_LINE_LENGTH_FT) return false;
      if (typeCounts[f.type] > LINE_PLAUSIBILITY.MAX_LINES_PER_TYPE) return false;
      return true;
    });
  }

  // Always include eaves/rakes with basic length filter
  const plausibleEavesRakes = eavesRakes.filter(f => f.length_ft >= 1);

  return {
    plausible: [...plausibleEavesRakes, ...plausibleInterior],
    implausibleCount: features.length - plausibleEavesRakes.length - plausibleInterior.length,
    starburstDetected
  };
}

export function TrainingOverlayComparison({
  satelliteImageUrl,
  centerLat,
  centerLng,
  zoom = 20,
  manualTraces,
  aiLinearFeatures,
  aiMeasurementCenter,
  viewMode = 'original',
}: TrainingOverlayComparisonProps) {
  // Use the AI measurement's center for WKT conversion if provided
  // This ensures AI features align correctly with the satellite image
  const aiCenterLat = aiMeasurementCenter?.lat ?? centerLat;
  const aiCenterLng = aiMeasurementCenter?.lng ?? centerLng;
  const manualCanvasRef = useRef<HTMLCanvasElement>(null);
  const aiCanvasRef = useRef<HTMLCanvasElement>(null);
  const [manualFabricCanvas, setManualFabricCanvas] = useState<FabricCanvas | null>(null);
  const [aiFabricCanvas, setAiFabricCanvas] = useState<FabricCanvas | null>(null);
  const [manualImageLoaded, setManualImageLoaded] = useState(false);
  const [aiImageLoaded, setAiImageLoaded] = useState(false);
  
  // Pan and zoom state
  const [isPanMode, setIsPanMode] = useState(false);
  const [syncCanvases, setSyncCanvases] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showFiltered, setShowFiltered] = useState(true); // Default to filtered view for clean diagrams
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  // Initialize manual traces canvas
  useEffect(() => {
    if (!manualCanvasRef.current) return;
    const canvas = new FabricCanvas(manualCanvasRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      selection: false,
      renderOnAddRemove: true,
    });
    setManualFabricCanvas(canvas);
    return () => { canvas.dispose(); };
  }, []);

  // Initialize AI canvas
  useEffect(() => {
    if (!aiCanvasRef.current) return;
    const canvas = new FabricCanvas(aiCanvasRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      selection: false,
      renderOnAddRemove: true,
    });
    setAiFabricCanvas(canvas);
    return () => { canvas.dispose(); };
  }, []);

  // Load satellite image on manual canvas
  useEffect(() => {
    if (!manualFabricCanvas || !satelliteImageUrl) return;
    setManualImageLoaded(false);
    FabricImage.fromURL(satelliteImageUrl, { crossOrigin: 'anonymous' })
      .then((img) => {
        if (!img) return;
        const scaleX = CANVAS_WIDTH / (img.width || CANVAS_WIDTH);
        const scaleY = CANVAS_HEIGHT / (img.height || CANVAS_HEIGHT);
        img.set({ scaleX, scaleY, left: 0, top: 0, selectable: false, evented: false });
        manualFabricCanvas.backgroundImage = img;
        manualFabricCanvas.renderAll();
        setManualImageLoaded(true);
      })
      .catch(console.error);
  }, [manualFabricCanvas, satelliteImageUrl]);

  // Load satellite image on AI canvas
  useEffect(() => {
    if (!aiFabricCanvas || !satelliteImageUrl) return;
    setAiImageLoaded(false);
    FabricImage.fromURL(satelliteImageUrl, { crossOrigin: 'anonymous' })
      .then((img) => {
        if (!img) return;
        const scaleX = CANVAS_WIDTH / (img.width || CANVAS_WIDTH);
        const scaleY = CANVAS_HEIGHT / (img.height || CANVAS_HEIGHT);
        img.set({ scaleX, scaleY, left: 0, top: 0, selectable: false, evented: false });
        aiFabricCanvas.backgroundImage = img;
        aiFabricCanvas.renderAll();
        setAiImageLoaded(true);
      })
      .catch(console.error);
  }, [aiFabricCanvas, satelliteImageUrl]);

  // Render manual traces
  const renderManualTraces = useCallback(() => {
    if (!manualFabricCanvas || !manualImageLoaded) return;
    manualFabricCanvas.getObjects().forEach((obj) => manualFabricCanvas.remove(obj));

    // Ensure manualTraces is always an array
    const safeManualTraces = Array.isArray(manualTraces) ? manualTraces : [];

    safeManualTraces.forEach((trace) => {
      if (!trace.canvas_points || trace.canvas_points.length < 2) return;
      const color = TRACE_COLORS[trace.trace_type] || '#6b7280';

      for (let i = 0; i < trace.canvas_points.length - 1; i++) {
        const line = new Line(
          [trace.canvas_points[i].x, trace.canvas_points[i].y, trace.canvas_points[i + 1].x, trace.canvas_points[i + 1].y],
          { stroke: color, strokeWidth: 3, selectable: false, evented: false }
        );
        manualFabricCanvas.add(line);
      }

      // Add endpoint circles
      trace.canvas_points.forEach((point) => {
        const circle = new Circle({
          left: point.x - 4, top: point.y - 4, radius: 4,
          fill: color, stroke: '#fff', strokeWidth: 1, selectable: false, evented: false,
        });
        manualFabricCanvas.add(circle);
      });

      // Add length label at midpoint
      if (trace.canvas_points.length >= 2) {
        const firstPt = trace.canvas_points[0];
        const lastPt = trace.canvas_points[trace.canvas_points.length - 1];
        const midX = (firstPt.x + lastPt.x) / 2;
        const midY = (firstPt.y + lastPt.y) / 2;
        const label = new FabricText(`${Math.round(trace.length_ft)}ft`, {
          left: midX, top: midY - 12, fontSize: 11, fill: '#fff', fontFamily: 'sans-serif',
          fontWeight: 'bold', textBackgroundColor: color, selectable: false, evented: false, originX: 'center',
        });
        manualFabricCanvas.add(label);
      }
    });

    manualFabricCanvas.renderAll();
  }, [manualFabricCanvas, manualImageLoaded, manualTraces]);

  // Render AI lines - with plausibility filtering and label collision detection
  const renderAILines = useCallback(() => {
    if (!aiFabricCanvas || !aiImageLoaded) return;
    aiFabricCanvas.getObjects().forEach((obj) => aiFabricCanvas.remove(obj));

    // Ensure aiLinearFeatures is an array
    const safeAiFeatures = Array.isArray(aiLinearFeatures) ? aiLinearFeatures : [];

    // Parse WKT and add canvas points to each feature
    const featuresWithPoints = safeAiFeatures
      .filter(feature => feature && typeof feature.wkt === 'string' && typeof feature.type === 'string')
      .map(feature => ({
        ...feature,
        points: parseWKTLineString(feature.wkt, aiCenterLat, aiCenterLng, CANVAS_WIDTH, CANVAS_HEIGHT, zoom)
      }))
      .filter(f => f.points.length >= 2);

    // Apply plausibility filter if enabled
    let featuresToRender = featuresWithPoints;
    if (showFiltered) {
      const { plausible, implausibleCount, starburstDetected } = filterPlausibleFeatures(featuresWithPoints);
      featuresToRender = plausible;
      if (implausibleCount > 0) {
        console.log(`[TrainingOverlay] Filtered ${implausibleCount} implausible features${starburstDetected ? ' (starburst detected)' : ''}`);
      }
    }

    // Track label positions for collision detection
    const renderedLabels: LabelBounds[] = [];
    const MIN_LABEL_LENGTH = 5; // Only show labels for features >= 5ft

    featuresToRender.forEach((feature) => {
      const points = feature.points;
      const color = TRACE_COLORS[feature.type] || '#6b7280';

      // Draw lines
      for (let i = 0; i < points.length - 1; i++) {
        const line = new Line(
          [points[i].x, points[i].y, points[i + 1].x, points[i + 1].y],
          { stroke: color, strokeWidth: 3, strokeDashArray: [8, 4], selectable: false, evented: false }
        );
        aiFabricCanvas.add(line);
      }

      // Add endpoint circles - but only for first and last point to reduce clutter
      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];
      [firstPoint, lastPoint].forEach((point) => {
        const circle = new Circle({
          left: point.x - 4, top: point.y - 4, radius: 4,
          fill: color, stroke: '#fff', strokeWidth: 1, selectable: false, evented: false,
        });
        aiFabricCanvas.add(circle);
      });

      // Add length label with collision detection
      if (points.length >= 2 && feature.length_ft >= MIN_LABEL_LENGTH) {
        const midX = (points[0].x + points[points.length - 1].x) / 2;
        const midY = (points[0].y + points[points.length - 1].y) / 2;
        
        // Define label bounds (approximate text size)
        const labelWidth = 40;
        const labelHeight = 16;
        const newLabelBounds: LabelBounds = {
          x: midX - labelWidth / 2,
          y: midY - labelHeight / 2 - 6,
          width: labelWidth,
          height: labelHeight
        };

        // Check for collision with existing labels
        const hasCollision = checkLabelCollision(newLabelBounds, renderedLabels);
        
        if (!hasCollision) {
          const label = new FabricText(`${Math.round(feature.length_ft)}ft`, {
            left: midX, top: midY - 12, fontSize: 11, fill: '#fff', fontFamily: 'sans-serif',
            fontWeight: 'bold', textBackgroundColor: color, selectable: false, evented: false, originX: 'center',
          });
          aiFabricCanvas.add(label);
          renderedLabels.push(newLabelBounds);
        }
      }
    });

    aiFabricCanvas.renderAll();
  }, [aiFabricCanvas, aiImageLoaded, aiLinearFeatures, aiCenterLat, aiCenterLng, zoom, showFiltered]);

  useEffect(() => { renderManualTraces(); }, [renderManualTraces]);
  useEffect(() => { renderAILines(); }, [renderAILines]);

  // Update cursor based on pan mode
  useEffect(() => {
    if (manualFabricCanvas) {
      manualFabricCanvas.defaultCursor = isPanMode ? 'grab' : 'default';
      manualFabricCanvas.hoverCursor = isPanMode ? 'grab' : 'default';
    }
    if (aiFabricCanvas) {
      aiFabricCanvas.defaultCursor = isPanMode ? 'grab' : 'default';
      aiFabricCanvas.hoverCursor = isPanMode ? 'grab' : 'default';
    }
  }, [isPanMode, manualFabricCanvas, aiFabricCanvas]);

  // Setup pan and zoom handlers
  useEffect(() => {
    if (!manualFabricCanvas || !aiFabricCanvas) return;

    const setupCanvasEvents = (canvas: FabricCanvas, otherCanvas: FabricCanvas) => {
      // Mouse down - start drag
      canvas.on('mouse:down', (opt) => {
        if (isPanMode && opt.e) {
          isDraggingRef.current = true;
          canvas.defaultCursor = 'grabbing';
          const e = opt.e as MouseEvent;
          lastPosRef.current = { x: e.clientX, y: e.clientY };
        }
      });

      // Mouse move - pan
      canvas.on('mouse:move', (opt) => {
        if (isDraggingRef.current && opt.e && canvas.viewportTransform) {
          const e = opt.e as MouseEvent;
          const vpt = [...canvas.viewportTransform];
          vpt[4] += e.clientX - lastPosRef.current.x;
          vpt[5] += e.clientY - lastPosRef.current.y;
          canvas.viewportTransform = vpt as typeof canvas.viewportTransform;
          lastPosRef.current = { x: e.clientX, y: e.clientY };
          canvas.requestRenderAll();
          
          if (syncCanvases && otherCanvas.viewportTransform) {
            otherCanvas.viewportTransform = [...vpt] as typeof otherCanvas.viewportTransform;
            otherCanvas.requestRenderAll();
          }
        }
      });

      // Mouse up - stop drag
      canvas.on('mouse:up', () => {
        isDraggingRef.current = false;
        canvas.defaultCursor = isPanMode ? 'grab' : 'default';
      });

      // Mouse wheel - zoom
      canvas.on('mouse:wheel', (opt) => {
        if (!opt.e) return;
        const e = opt.e as WheelEvent;
        const delta = e.deltaY;
        let newZoom = canvas.getZoom() * (1 - delta / 500);
        newZoom = Math.min(Math.max(0.5, newZoom), 5);
        
        const point = new Point(opt.e.offsetX, opt.e.offsetY);
        canvas.zoomToPoint(point, newZoom);
        setZoomLevel(newZoom);
        
        if (syncCanvases) {
          otherCanvas.zoomToPoint(point, newZoom);
        }
        
        opt.e.preventDefault();
        opt.e.stopPropagation();
      });
    };

    setupCanvasEvents(manualFabricCanvas, aiFabricCanvas);
    setupCanvasEvents(aiFabricCanvas, manualFabricCanvas);

    return () => {
      manualFabricCanvas.off('mouse:down');
      manualFabricCanvas.off('mouse:move');
      manualFabricCanvas.off('mouse:up');
      manualFabricCanvas.off('mouse:wheel');
      aiFabricCanvas.off('mouse:down');
      aiFabricCanvas.off('mouse:move');
      aiFabricCanvas.off('mouse:up');
      aiFabricCanvas.off('mouse:wheel');
    };
  }, [manualFabricCanvas, aiFabricCanvas, isPanMode, syncCanvases]);

  // Zoom controls
  const handleZoomIn = () => {
    const newZoom = Math.min(zoomLevel * 1.25, 5);
    setZoomLevel(newZoom);
    const center = new Point(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    manualFabricCanvas?.zoomToPoint(center, newZoom);
    if (syncCanvases) aiFabricCanvas?.zoomToPoint(center, newZoom);
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(zoomLevel / 1.25, 0.5);
    setZoomLevel(newZoom);
    const center = new Point(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    manualFabricCanvas?.zoomToPoint(center, newZoom);
    if (syncCanvases) aiFabricCanvas?.zoomToPoint(center, newZoom);
  };

  const handleResetView = () => {
    setZoomLevel(1);
    if (manualFabricCanvas) {
      manualFabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      manualFabricCanvas.requestRenderAll();
    }
    if (aiFabricCanvas) {
      aiFabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      aiFabricCanvas.requestRenderAll();
    }
  };

  // Calculate totals for summary
  const manualTotals = calculateTotals(manualTraces);
  const aiTotals = calculateAITotals(aiLinearFeatures);
  const allTypes = [...new Set([...Object.keys(manualTotals), ...Object.keys(aiTotals)])];

  const getDifference = (type: string) => {
    const manual = manualTotals[type] || 0;
    const ai = aiTotals[type] || 0;
    if (manual === 0 && ai === 0) return { diff: 0, pct: 0, missing: false };
    if (manual > 0 && ai === 0) return { diff: -manual, pct: -100, missing: true };
    if (manual === 0) return { diff: ai, pct: 100, missing: false };
    const diff = ai - manual;
    const pct = (diff / manual) * 100;
    return { diff, pct, missing: false };
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Columns2 className="h-4 w-4" />
          Side-by-Side Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pan/Zoom Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={isPanMode ? "default" : "outline"}
            size="sm"
            onClick={() => setIsPanMode(!isPanMode)}
          >
            <Hand className="h-4 w-4 mr-1" />
            Pan
          </Button>
          <Button variant="outline" size="sm" onClick={handleZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleResetView}>
            <RotateCcw className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground ml-1">
            {Math.round(zoomLevel * 100)}%
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            <Checkbox 
              id="sync-views"
              checked={syncCanvases} 
              onCheckedChange={(checked) => setSyncCanvases(checked === true)} 
            />
            <label htmlFor="sync-views" className="text-xs cursor-pointer">Sync views</label>
          </div>
          <div className="flex items-center gap-2 ml-3 border-l pl-3">
            <Switch
              id="filter-toggle"
              checked={showFiltered}
              onCheckedChange={setShowFiltered}
            />
            <Label htmlFor="filter-toggle" className="text-xs cursor-pointer flex items-center gap-1">
              {showFiltered ? <Filter className="h-3 w-3" /> : <FilterX className="h-3 w-3" />}
              {showFiltered ? 'Filtered' : 'Raw'}
            </Label>
          </div>
        </div>

        {/* Side-by-side canvases */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Manual Traces */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">Your Measurements</h4>
              <Badge variant="outline" className="text-xs">
                {Math.round(Object.values(manualTotals).reduce((a, b) => a + b, 0))} ft total
              </Badge>
            </div>
            <div 
              className="border rounded-lg overflow-hidden bg-muted/30"
              style={{ 
                position: 'relative',
                width: '100%',
                paddingBottom: `${(CANVAS_HEIGHT / CANVAS_WIDTH) * 100}%`,
              }}
            >
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                overflow: 'hidden',
              }}>
                <canvas 
                  ref={manualCanvasRef} 
                  style={{ 
                    display: 'block',
                    width: '100%',
                    height: '100%',
                  }} 
                />
              </div>
            </div>
          </div>

          {/* AI Lines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">
                {viewMode === 'corrected' ? 'Corrected AI' : 'AI Measurements'}
              </h4>
              <Badge variant={viewMode === 'corrected' ? 'default' : 'secondary'} className={viewMode === 'corrected' ? 'bg-green-500 text-xs' : 'text-xs'}>
                {Math.round(Object.values(aiTotals).reduce((a, b) => a + b, 0))} ft total
              </Badge>
            </div>
            <div 
              className="border rounded-lg overflow-hidden bg-muted/30"
              style={{ 
                position: 'relative',
                width: '100%',
                paddingBottom: `${(CANVAS_HEIGHT / CANVAS_WIDTH) * 100}%`,
              }}
            >
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                overflow: 'hidden',
              }}>
                <canvas 
                  ref={aiCanvasRef} 
                  style={{ 
                    display: 'block',
                    width: '100%',
                    height: '100%',
                  }} 
                />
              </div>
            </div>
          </div>
        </div>

        {/* Comparison Summary Table */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Feature</th>
                <th className="text-right px-3 py-2 font-medium">Your Trace</th>
                <th className="text-right px-3 py-2 font-medium">AI</th>
                <th className="text-right px-3 py-2 font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              {allTypes.map((type) => {
                const manual = manualTotals[type] || 0;
                const ai = aiTotals[type] || 0;
                const { diff, pct, missing } = getDifference(type);
                const color = TRACE_COLORS[type] || '#6b7280';
                
                return (
                  <tr key={type} className="border-t">
                    <td className="px-3 py-2 capitalize flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                      {type}
                    </td>
                    <td className="text-right px-3 py-2">{Math.round(manual)} ft</td>
                    <td className="text-right px-3 py-2">
                      {missing ? (
                        <span className="flex items-center justify-end gap-1 text-red-500">
                          <AlertCircle className="h-3 w-3" />
                          0 ft
                        </span>
                      ) : (
                        `${Math.round(ai)} ft`
                      )}
                    </td>
                    <td className="text-right px-3 py-2">
                      {missing ? (
                        <Badge variant="destructive" className="text-xs">MISSING</Badge>
                      ) : Math.abs(pct) > 15 ? (
                        <span className="text-amber-500 font-medium">
                          {pct > 0 ? '+' : ''}{Math.round(pct)}%
                        </span>
                      ) : Math.abs(pct) > 5 ? (
                        <span className="text-yellow-600">
                          {pct > 0 ? '+' : ''}{Math.round(pct)}%
                        </span>
                      ) : (
                        <span className="text-green-600">✓</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-2">
          <span className="font-medium">Legend:</span>
          {Object.entries(TRACE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1">
              <div className="w-4 h-0.5" style={{ backgroundColor: color }} />
              <span className="capitalize">{type}</span>
            </div>
          ))}
          <span className="ml-2 text-muted-foreground">| Solid = Your traces, Dashed = AI</span>
        </div>
      </CardContent>
    </Card>
  );
}
