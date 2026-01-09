import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas as FabricCanvas, Line, FabricImage, FabricText, Circle } from 'fabric';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Columns2, AlertCircle } from 'lucide-react';

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
  const match = wkt.match(/LINESTRING\s*\(([^)]+)\)/i);
  if (!match) return [];

  const coordPairs = match[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return { lat, lng };
  });

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

  return coordPairs.map(coord => {
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
}

// Calculate totals by type
function calculateTotals(traces: { trace_type: string; length_ft: number }[]): Record<string, number> {
  const totals: Record<string, number> = {};
  traces.forEach(t => {
    const type = t.trace_type.toLowerCase();
    totals[type] = (totals[type] || 0) + t.length_ft;
  });
  return totals;
}

function calculateAITotals(features: { type: string; length_ft: number }[]): Record<string, number> {
  const totals: Record<string, number> = {};
  features.forEach(f => {
    const type = f.type.toLowerCase();
    totals[type] = (totals[type] || 0) + f.length_ft;
  });
  return totals;
}

export function TrainingOverlayComparison({
  satelliteImageUrl,
  centerLat,
  centerLng,
  zoom = 20,
  manualTraces,
  aiLinearFeatures,
}: TrainingOverlayComparisonProps) {
  const manualCanvasRef = useRef<HTMLCanvasElement>(null);
  const aiCanvasRef = useRef<HTMLCanvasElement>(null);
  const [manualFabricCanvas, setManualFabricCanvas] = useState<FabricCanvas | null>(null);
  const [aiFabricCanvas, setAiFabricCanvas] = useState<FabricCanvas | null>(null);
  const [manualImageLoaded, setManualImageLoaded] = useState(false);
  const [aiImageLoaded, setAiImageLoaded] = useState(false);

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

    manualTraces.forEach((trace) => {
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

  // Render AI lines
  const renderAILines = useCallback(() => {
    if (!aiFabricCanvas || !aiImageLoaded) return;
    aiFabricCanvas.getObjects().forEach((obj) => aiFabricCanvas.remove(obj));

    aiLinearFeatures.forEach((feature) => {
      const points = parseWKTLineString(feature.wkt, centerLat, centerLng, CANVAS_WIDTH, CANVAS_HEIGHT, zoom);
      if (points.length < 2) return;
      const color = TRACE_COLORS[feature.type] || '#6b7280';

      for (let i = 0; i < points.length - 1; i++) {
        const line = new Line(
          [points[i].x, points[i].y, points[i + 1].x, points[i + 1].y],
          { stroke: color, strokeWidth: 3, strokeDashArray: [8, 4], selectable: false, evented: false }
        );
        aiFabricCanvas.add(line);
      }

      // Add endpoint circles
      points.forEach((point) => {
        const circle = new Circle({
          left: point.x - 4, top: point.y - 4, radius: 4,
          fill: color, stroke: '#fff', strokeWidth: 1, selectable: false, evented: false,
        });
        aiFabricCanvas.add(circle);
      });

      // Add length label
      if (points.length >= 2) {
        const midX = (points[0].x + points[points.length - 1].x) / 2;
        const midY = (points[0].y + points[points.length - 1].y) / 2;
        const label = new FabricText(`${Math.round(feature.length_ft)}ft`, {
          left: midX, top: midY - 12, fontSize: 11, fill: '#fff', fontFamily: 'sans-serif',
          fontWeight: 'bold', textBackgroundColor: color, selectable: false, evented: false, originX: 'center',
        });
        aiFabricCanvas.add(label);
      }
    });

    aiFabricCanvas.renderAll();
  }, [aiFabricCanvas, aiImageLoaded, aiLinearFeatures, centerLat, centerLng, zoom]);

  useEffect(() => { renderManualTraces(); }, [renderManualTraces]);
  useEffect(() => { renderAILines(); }, [renderAILines]);

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
            <div className="border rounded-lg overflow-hidden bg-muted/30">
              <canvas ref={manualCanvasRef} style={{ width: '100%', height: 'auto', aspectRatio: `${CANVAS_WIDTH}/${CANVAS_HEIGHT}` }} />
            </div>
          </div>

          {/* AI Lines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">AI Measurements</h4>
              <Badge variant="secondary" className="text-xs">
                {Math.round(Object.values(aiTotals).reduce((a, b) => a + b, 0))} ft total
              </Badge>
            </div>
            <div className="border rounded-lg overflow-hidden bg-muted/30">
              <canvas ref={aiCanvasRef} style={{ width: '100%', height: 'auto', aspectRatio: `${CANVAS_WIDTH}/${CANVAS_HEIGHT}` }} />
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
