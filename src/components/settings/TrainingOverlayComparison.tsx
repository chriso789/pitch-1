import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas as FabricCanvas, Line, FabricImage, FabricText, Circle } from 'fabric';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Eye, EyeOff, Layers } from 'lucide-react';

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

const CANVAS_WIDTH = 700;
const CANVAS_HEIGHT = 500;

// Color schemes for different trace types
const MANUAL_COLORS: Record<string, string> = {
  ridge: '#22c55e',
  hip: '#8b5cf6',
  valley: '#ef4444',
  eave: '#14b8a6',
  rake: '#06b6d4',
  perimeter: '#f97316',
};

const AI_COLORS: Record<string, string> = {
  ridge: '#86efac',
  hip: '#c4b5fd',
  valley: '#fca5a5',
  eave: '#5eead4',
  rake: '#67e8f9',
  perimeter: '#fdba74',
};

// Parse WKT LINESTRING to canvas points
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

  // Convert lat/lng to canvas pixels
  // At zoom 20, 1 pixel ≈ 0.149 meters
  const metersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);

  return coordPairs.map(coord => {
    const dLat = coord.lat - centerLat;
    const dLng = coord.lng - centerLng;
    
    const dY = dLat * metersPerDegLat / metersPerPixel;
    const dX = dLng * metersPerDegLng / metersPerPixel;

    return {
      x: canvasWidth / 2 + dX,
      y: canvasHeight / 2 - dY, // Y is inverted in canvas
    };
  });
}

export function TrainingOverlayComparison({
  satelliteImageUrl,
  centerLat,
  centerLng,
  zoom = 20,
  manualTraces,
  aiLinearFeatures,
}: TrainingOverlayComparisonProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showManualTraces, setShowManualTraces] = useState(true);
  const [showAILines, setShowAILines] = useState(true);

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

    FabricImage.fromURL(satelliteImageUrl, { crossOrigin: 'anonymous' })
      .then((img) => {
        if (!img) return;

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
      })
      .catch((err) => {
        console.error('Failed to load satellite image:', err);
      });
  }, [fabricCanvas, satelliteImageUrl]);

  // Render overlay
  const renderOverlay = useCallback(() => {
    if (!fabricCanvas || !imageLoaded) return;

    // Clear existing objects
    fabricCanvas.getObjects().forEach((obj) => {
      fabricCanvas.remove(obj);
    });

    // Render manual traces (solid lines)
    if (showManualTraces) {
      manualTraces.forEach((trace) => {
        if (!trace.canvas_points || trace.canvas_points.length < 2) return;

        const color = MANUAL_COLORS[trace.trace_type] || '#6b7280';

        for (let i = 0; i < trace.canvas_points.length - 1; i++) {
          const line = new Line(
            [
              trace.canvas_points[i].x,
              trace.canvas_points[i].y,
              trace.canvas_points[i + 1].x,
              trace.canvas_points[i + 1].y,
            ],
            {
              stroke: color,
              strokeWidth: 3,
              selectable: false,
              evented: false,
            }
          );
          fabricCanvas.add(line);
        }

        // Add endpoint circles
        trace.canvas_points.forEach((point) => {
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

        // Add length label
        if (trace.canvas_points.length >= 2) {
          const firstPt = trace.canvas_points[0];
          const lastPt = trace.canvas_points[trace.canvas_points.length - 1];
          const midX = (firstPt.x + lastPt.x) / 2;
          const midY = (firstPt.y + lastPt.y) / 2;

          const label = new FabricText(`${Math.round(trace.length_ft)}ft`, {
            left: midX,
            top: midY - 12,
            fontSize: 10,
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
    }

    // Render AI lines (dashed lines)
    if (showAILines) {
      aiLinearFeatures.forEach((feature) => {
        const points = parseWKTLineString(
          feature.wkt,
          centerLat,
          centerLng,
          CANVAS_WIDTH,
          CANVAS_HEIGHT,
          zoom
        );

        if (points.length < 2) return;

        const color = AI_COLORS[feature.type] || '#9ca3af';

        for (let i = 0; i < points.length - 1; i++) {
          const line = new Line(
            [points[i].x, points[i].y, points[i + 1].x, points[i + 1].y],
            {
              stroke: color,
              strokeWidth: 2,
              strokeDashArray: [6, 3],
              selectable: false,
              evented: false,
            }
          );
          fabricCanvas.add(line);
        }

        // Add AI label
        if (points.length >= 2) {
          const midX = (points[0].x + points[points.length - 1].x) / 2;
          const midY = (points[0].y + points[points.length - 1].y) / 2;

          const label = new FabricText(`AI: ${Math.round(feature.length_ft)}ft`, {
            left: midX,
            top: midY + 8,
            fontSize: 9,
            fill: color,
            fontFamily: 'sans-serif',
            fontStyle: 'italic',
            selectable: false,
            evented: false,
            originX: 'center',
          });
          fabricCanvas.add(label);
        }
      });
    }

    fabricCanvas.renderAll();
  }, [fabricCanvas, imageLoaded, showManualTraces, showAILines, manualTraces, aiLinearFeatures, centerLat, centerLng, zoom]);

  useEffect(() => {
    renderOverlay();
  }, [renderOverlay]);

  const manualTotal = manualTraces.reduce((sum, t) => sum + t.length_ft, 0);
  const aiTotal = aiLinearFeatures.reduce((sum, f) => sum + f.length_ft, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          Visual Overlay Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Toggle controls */}
        <div className="flex items-center justify-between gap-4 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="show-manual"
                checked={showManualTraces}
                onCheckedChange={setShowManualTraces}
              />
              <Label htmlFor="show-manual" className="flex items-center gap-1.5 cursor-pointer">
                {showManualTraces ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                <span className="text-sm">Your Traces</span>
                <Badge variant="outline" className="text-xs">{Math.round(manualTotal)} ft</Badge>
              </Label>
            </div>
            
            <div className="flex items-center gap-2">
              <Switch
                id="show-ai"
                checked={showAILines}
                onCheckedChange={setShowAILines}
              />
              <Label htmlFor="show-ai" className="flex items-center gap-1.5 cursor-pointer">
                {showAILines ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                <span className="text-sm">AI Lines</span>
                <Badge variant="secondary" className="text-xs">{Math.round(aiTotal)} ft</Badge>
              </Label>
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="border rounded-lg overflow-hidden bg-muted/30">
          <canvas ref={canvasRef} className="w-full" />
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="font-medium">Legend:</span>
          <div className="flex items-center gap-1">
            <div className="w-6 h-0.5 bg-green-500" />
            <span>Ridge</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-0.5 bg-violet-500" />
            <span>Hip</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-0.5 bg-red-500" />
            <span>Valley</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-0.5 bg-teal-500" />
            <span>Eave</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-0.5 bg-cyan-500" />
            <span>Rake</span>
          </div>
          <span className="ml-4 italic">Solid = Your traces, Dashed = AI</span>
        </div>
      </CardContent>
    </Card>
  );
}
