import { useEffect, useRef, useState } from 'react';
import { Canvas as FabricCanvas, FabricImage, Polygon, Circle, Line } from 'fabric';
import { lngLatToPixel, pixelToLngLat, calculatePolygonAreaSqft } from '@/utils/geoCoordinates';
import { Button } from '@/components/ui/button';
import { RotateCcw, Lock, Unlock, Ruler } from 'lucide-react';

interface PolygonEditorProps {
  satelliteImageUrl: string;
  buildingPolygon: [number, number][]; // [lng, lat] pairs
  centerLng: number;
  centerLat: number;
  zoom: number;
  onPolygonChange: (coords: [number, number][], areaSqft: number) => void;
  canvasWidth?: number;
  canvasHeight?: number;
}

export function PolygonEditor({
  satelliteImageUrl,
  buildingPolygon,
  centerLng,
  centerLat,
  zoom,
  onPolygonChange,
  canvasWidth = 640,
  canvasHeight = 480
}: PolygonEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [originalPolygon] = useState(buildingPolygon);
  
  const polygonRef = useRef<Polygon | null>(null);
  const vertexCirclesRef = useRef<Circle[]>([]);
  const measurementLinesRef = useRef<Line[]>([]);

  // Initialize canvas and load satellite image
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: canvasWidth,
      height: canvasHeight,
      selection: false,
      backgroundColor: '#f0f0f0'
    });

    // Load satellite image
    FabricImage.fromURL(satelliteImageUrl).then((img) => {
      const scale = Math.min(canvasWidth / img.width!, canvasHeight / img.height!);
      img.scale(scale);
      img.set({
        left: (canvasWidth - img.width! * scale) / 2,
        top: (canvasHeight - img.height! * scale) / 2,
        selectable: false,
        evented: false
      });
      canvas.backgroundImage = img;
      canvas.renderAll();
    }).catch((err) => {
      console.error('Failed to load satellite image:', err);
    });

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [satelliteImageUrl, canvasWidth, canvasHeight]);

  // Draw polygon and vertices
  useEffect(() => {
    if (!fabricCanvas || buildingPolygon.length < 3) return;

    // Clear existing objects
    if (polygonRef.current) fabricCanvas.remove(polygonRef.current);
    vertexCirclesRef.current.forEach(circle => fabricCanvas.remove(circle));
    measurementLinesRef.current.forEach(line => fabricCanvas.remove(line));
    vertexCirclesRef.current = [];
    measurementLinesRef.current = [];

    // Convert building polygon to pixel coordinates
    const pixelCoords = buildingPolygon.map(([lng, lat]) =>
      lngLatToPixel(lng, lat, centerLng, centerLat, zoom, canvasWidth, canvasHeight)
    );

    // Create polygon
    const polygon = new Polygon(pixelCoords, {
      fill: 'rgba(59, 130, 246, 0.15)',
      stroke: '#3b82f6',
      strokeWidth: 2,
      selectable: false,
      evented: false,
      objectCaching: false
    });
    fabricCanvas.add(polygon);
    polygonRef.current = polygon;

    // Add vertex control points
    pixelCoords.forEach((coord, index) => {
      const circle = new Circle({
        left: coord.x,
        top: coord.y,
        radius: 6,
        fill: '#3b82f6',
        stroke: '#ffffff',
        strokeWidth: 2,
        originX: 'center',
        originY: 'center',
        hasControls: false,
        hasBorders: false,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        hoverCursor: isLocked ? 'default' : 'move',
        selectable: !isLocked,
        evented: !isLocked
      });

      circle.on('moving', () => {
        updatePolygon(index, circle.left!, circle.top!);
      });

      circle.on('mouseup', () => {
        recalculateMeasurements();
      });

      fabricCanvas.add(circle);
      vertexCirclesRef.current.push(circle);
    });

    // Draw measurement lines if enabled
    if (showMeasurements) {
      drawMeasurementLines(pixelCoords);
    }

    fabricCanvas.renderAll();
  }, [fabricCanvas, buildingPolygon, isLocked, showMeasurements, centerLng, centerLat, zoom, canvasWidth, canvasHeight]);

  const updatePolygon = (vertexIndex: number, x: number, y: number) => {
    if (!fabricCanvas || !polygonRef.current) return;

    const points = polygonRef.current.points!;
    points[vertexIndex].x = x;
    points[vertexIndex].y = y;

    polygonRef.current.set({ points });
    fabricCanvas.renderAll();
  };

  const recalculateMeasurements = () => {
    if (!fabricCanvas || !polygonRef.current) return;

    // Convert pixel coordinates back to lng/lat
    const points = polygonRef.current.points!;
    const lngLatCoords: [number, number][] = points.map(point =>
      Object.values(pixelToLngLat(
        point.x,
        point.y,
        centerLng,
        centerLat,
        zoom,
        canvasWidth,
        canvasHeight
      )) as [number, number]
    );

    // Close the polygon if not already closed
    if (lngLatCoords.length > 0) {
      const first = lngLatCoords[0];
      const last = lngLatCoords[lngLatCoords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        lngLatCoords.push([first[0], first[1]]);
      }
    }

    // Calculate area
    const areaSqft = calculatePolygonAreaSqft(lngLatCoords);

    // Notify parent component
    onPolygonChange(lngLatCoords, areaSqft);
  };

  const drawMeasurementLines = (coords: { x: number; y: number }[]) => {
    if (!fabricCanvas) return;

    for (let i = 0; i < coords.length; i++) {
      const start = coords[i];
      const end = coords[(i + 1) % coords.length];

      const line = new Line([start.x, start.y, end.x, end.y], {
        stroke: '#10b981',
        strokeWidth: 1,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false
      });

      fabricCanvas.add(line);
      measurementLinesRef.current.push(line);
    }
  };

  const handleReset = () => {
    if (!fabricCanvas) return;

    // Reset to original polygon
    const pixelCoords = originalPolygon.map(([lng, lat]) =>
      lngLatToPixel(lng, lat, centerLng, centerLat, zoom, canvasWidth, canvasHeight)
    );

    if (polygonRef.current) {
      polygonRef.current.set({ points: pixelCoords });
    }

    vertexCirclesRef.current.forEach((circle, i) => {
      circle.set({
        left: pixelCoords[i].x,
        top: pixelCoords[i].y
      });
    });

    fabricCanvas.renderAll();
    recalculateMeasurements();
  };

  const toggleLock = () => {
    setIsLocked(!isLocked);
    vertexCirclesRef.current.forEach(circle => {
      circle.set({
        selectable: isLocked,
        evented: isLocked,
        hoverCursor: isLocked ? 'move' : 'default'
      });
    });
    fabricCanvas?.renderAll();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Adjust Building Outline</h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMeasurements(!showMeasurements)}
            title="Toggle measurements"
          >
            <Ruler className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleLock}
            title={isLocked ? 'Unlock editing' : 'Lock editing'}
          >
            {isLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            title="Reset to original"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden bg-muted">
        <canvas ref={canvasRef} />
      </div>

      <p className="text-xs text-muted-foreground">
        {isLocked 
          ? '🔒 Editing locked. Click the lock icon to enable adjustments.'
          : '💡 Drag the blue circles to adjust the building outline. Changes update measurements in real-time.'}
      </p>
    </div>
  );
}
