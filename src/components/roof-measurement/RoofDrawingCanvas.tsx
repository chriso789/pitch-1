import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas as FabricCanvas, Image as FabricImage, Polygon, Line, Circle, Point } from 'fabric';
import type { DrawingTool } from './MeasurementToolbar';
import type { DetailedMeasurements } from './RoofComponentLineItems';

interface RoofDrawingCanvasProps {
  imageUrl: string;
  activeTool: DrawingTool;
  lat: number;
  lng: number;
  onMeasurementsChange: (measurements: DetailedMeasurements) => void;
  onCanUndoChange: (canUndo: boolean) => void;
}

// Zoom level 20: approximately 0.6 feet per pixel
const FEET_PER_PIXEL = 0.6;

// Feature colors
const COLORS: Record<string, string> = {
  roof: '#3b82f6',        // Blue
  ridge: '#22c55e',       // Green
  hip: '#a855f7',         // Purple
  valley: '#ef4444',      // Red
  eave: '#06b6d4',        // Cyan
  rake: '#f97316',        // Orange
  step_flashing: '#eab308', // Yellow
  drip_edge: '#14b8a6',   // Teal
  penetration: '#ec4899', // Pink
  point: '#ffffff',       // White
};

interface DrawnObject {
  id: string;
  type: DrawingTool;
  fabricObject: any;
  lengthFt?: number;
  areaSqFt?: number;
  points?: { x: number; y: number }[];
}

export function RoofDrawingCanvas({
  imageUrl,
  activeTool,
  lat,
  lng,
  onMeasurementsChange,
  onCanUndoChange,
}: RoofDrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const [drawnObjects, setDrawnObjects] = useState<DrawnObject[]>([]);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const tempLineRef = useRef<Line | null>(null);
  const tempPointsRef = useRef<Circle[]>([]);

  // Initialize canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 800,
      height: 800,
      selection: activeTool === 'select',
      backgroundColor: '#1a1a1a',
    });

    fabricRef.current = canvas;

    // Load background image
    FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' }).then((img) => {
      img.scaleToWidth(800);
      img.scaleToHeight(800);
      canvas.backgroundImage = img;
      canvas.renderAll();
    });

    return () => {
      canvas.dispose();
    };
  }, [imageUrl]);

  // Update canvas selection mode
  useEffect(() => {
    if (!fabricRef.current) return;
    fabricRef.current.selection = activeTool === 'select';
    fabricRef.current.forEachObject((obj) => {
      obj.selectable = activeTool === 'select';
    });
    fabricRef.current.renderAll();
  }, [activeTool]);

  // Handle canvas clicks
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;

    const handleMouseDown = (e: any) => {
      if (activeTool === 'select') return;

      const pointer = canvas.getPointer(e.e);
      const point = new Point(pointer.x, pointer.y);

      if (activeTool === 'roof') {
        handleRoofClick(point);
      } else if (activeTool === 'penetration') {
        handlePenetrationClick(point);
      } else if (['ridge', 'hip', 'valley', 'eave', 'rake', 'step_flashing', 'drip_edge'].includes(activeTool)) {
        handleLineClick(point);
      }
    };

    const handleMouseMove = (e: any) => {
      if (!isDrawing || activeTool === 'select') return;
      const pointer = canvas.getPointer(e.e);
      
      // Update temp line for line tools
      if (tempLineRef.current && currentPoints.length === 1) {
        tempLineRef.current.set({
          x2: pointer.x,
          y2: pointer.y,
        });
        canvas.renderAll();
      }
    };

    const handleDblClick = () => {
      if (activeTool === 'roof' && currentPoints.length >= 3) {
        finishPolygon();
      }
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:dblclick', handleDblClick);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:dblclick', handleDblClick);
    };
  }, [activeTool, currentPoints, isDrawing]);

  // Handle roof outline clicks
  const handleRoofClick = (point: Point) => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    setIsDrawing(true);
    setCurrentPoints(prev => [...prev, point]);

    // Add visual point marker
    const circle = new Circle({
      left: point.x - 5,
      top: point.y - 5,
      radius: 5,
      fill: COLORS.point,
      stroke: COLORS.roof,
      strokeWidth: 2,
      selectable: false,
      evented: false,
    });
    canvas.add(circle);
    tempPointsRef.current.push(circle);

    // Draw line to previous point
    if (currentPoints.length > 0) {
      const prevPoint = currentPoints[currentPoints.length - 1];
      const line = new Line([prevPoint.x, prevPoint.y, point.x, point.y], {
        stroke: COLORS.roof,
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
      canvas.add(line);
    }

    canvas.renderAll();
  };

  // Handle penetration clicks (single point)
  const handlePenetrationClick = (point: Point) => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const circle = new Circle({
      left: point.x - 10,
      top: point.y - 10,
      radius: 10,
      fill: `${COLORS.penetration}66`,
      stroke: COLORS.penetration,
      strokeWidth: 3,
      selectable: activeTool === 'select',
    });
    canvas.add(circle);

    const newObject: DrawnObject = {
      id: `penetration-${Date.now()}`,
      type: 'penetration',
      fabricObject: circle,
      points: [{ x: point.x, y: point.y }],
    };

    setDrawnObjects(prev => {
      const updated = [...prev, newObject];
      updateMeasurements(updated);
      return updated;
    });

    canvas.renderAll();
  };

  // Handle line tool clicks (ridge, hip, valley, eave, rake, step_flashing, drip_edge)
  const handleLineClick = (point: Point) => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const toolColor = COLORS[activeTool] || COLORS.ridge;

    if (currentPoints.length === 0) {
      // First point
      setCurrentPoints([point]);
      setIsDrawing(true);

      const circle = new Circle({
        left: point.x - 4,
        top: point.y - 4,
        radius: 4,
        fill: toolColor,
        selectable: false,
        evented: false,
      });
      canvas.add(circle);
      tempPointsRef.current.push(circle);

      // Create temp line
      const tempLine = new Line([point.x, point.y, point.x, point.y], {
        stroke: toolColor,
        strokeWidth: 2,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
      });
      canvas.add(tempLine);
      tempLineRef.current = tempLine;
    } else {
      // Second point - complete the line
      const startPoint = currentPoints[0];
      finishLine(startPoint, point);
    }

    canvas.renderAll();
  };

  // Finish polygon drawing
  const finishPolygon = () => {
    const canvas = fabricRef.current;
    if (!canvas || currentPoints.length < 3) return;

    // Remove temp markers
    tempPointsRef.current.forEach(obj => canvas.remove(obj));
    tempPointsRef.current = [];

    // Create polygon
    const polyPoints = currentPoints.map(p => ({ x: p.x, y: p.y }));
    const polygon = new Polygon(polyPoints, {
      fill: `${COLORS.roof}33`,
      stroke: COLORS.roof,
      strokeWidth: 2,
      selectable: activeTool === 'select',
    });

    canvas.add(polygon);

    // Calculate area
    const areaSqFt = calculatePolygonArea(polyPoints);

    const newObject: DrawnObject = {
      id: `roof-${Date.now()}`,
      type: 'roof',
      fabricObject: polygon,
      areaSqFt,
      points: polyPoints,
    };

    setDrawnObjects(prev => {
      const updated = [...prev, newObject];
      updateMeasurements(updated);
      return updated;
    });
    setCurrentPoints([]);
    setIsDrawing(false);

    canvas.renderAll();
  };

  // Finish line drawing
  const finishLine = (start: Point, end: Point) => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const toolColor = COLORS[activeTool] || COLORS.ridge;

    // Remove temp objects
    if (tempLineRef.current) {
      canvas.remove(tempLineRef.current);
      tempLineRef.current = null;
    }
    tempPointsRef.current.forEach(obj => canvas.remove(obj));
    tempPointsRef.current = [];

    // Create permanent line
    const line = new Line([start.x, start.y, end.x, end.y], {
      stroke: toolColor,
      strokeWidth: 3,
      selectable: activeTool === 'select',
    });

    canvas.add(line);

    // Calculate length
    const lengthFt = calculateLineLength(start, end);

    const newObject: DrawnObject = {
      id: `${activeTool}-${Date.now()}`,
      type: activeTool,
      fabricObject: line,
      lengthFt,
      points: [{ x: start.x, y: start.y }, { x: end.x, y: end.y }],
    };

    setDrawnObjects(prev => {
      const updated = [...prev, newObject];
      updateMeasurements(updated);
      return updated;
    });
    setCurrentPoints([]);
    setIsDrawing(false);

    canvas.renderAll();
  };

  // Calculate polygon area in sq ft
  const calculatePolygonArea = (points: { x: number; y: number }[]): number => {
    if (points.length < 3) return 0;

    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    area = Math.abs(area) / 2;

    // Convert pixels to sq ft
    return area * FEET_PER_PIXEL * FEET_PER_PIXEL;
  };

  // Calculate line length in ft
  const calculateLineLength = (start: Point, end: Point): number => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return Math.sqrt(dx * dx + dy * dy) * FEET_PER_PIXEL;
  };

  // Update measurements based on drawn objects
  const updateMeasurements = (objects: DrawnObject[]) => {
    const measurements: DetailedMeasurements = {
      facets: objects
        .filter(o => o.type === 'roof')
        .map(o => ({ id: o.id, areaSqFt: o.areaSqFt || 0, points: o.points || [] })),
      ridges: objects
        .filter(o => o.type === 'ridge')
        .map(o => ({ id: o.id, lengthFt: o.lengthFt || 0, points: o.points || [] })),
      hips: objects
        .filter(o => o.type === 'hip')
        .map(o => ({ id: o.id, lengthFt: o.lengthFt || 0, points: o.points || [] })),
      valleys: objects
        .filter(o => o.type === 'valley')
        .map(o => ({ id: o.id, lengthFt: o.lengthFt || 0, points: o.points || [] })),
      eaves: objects
        .filter(o => o.type === 'eave')
        .map(o => ({ id: o.id, lengthFt: o.lengthFt || 0, points: o.points || [] })),
      rakes: objects
        .filter(o => o.type === 'rake')
        .map(o => ({ id: o.id, lengthFt: o.lengthFt || 0, points: o.points || [] })),
      stepFlashing: objects
        .filter(o => o.type === 'step_flashing')
        .map(o => ({ id: o.id, lengthFt: o.lengthFt || 0, points: o.points || [] })),
      dripEdge: objects
        .filter(o => o.type === 'drip_edge')
        .map(o => ({ id: o.id, lengthFt: o.lengthFt || 0, points: o.points || [] })),
      penetrations: objects
        .filter(o => o.type === 'penetration')
        .map(o => ({ id: o.id, type: 'vent', count: 1 })),
    };

    onMeasurementsChange(measurements);
    onCanUndoChange(objects.length > 0);
  };

  return (
    <div className="relative">
      <canvas ref={canvasRef} className="max-w-full cursor-crosshair rounded-lg" />
      
      {/* Drawing indicator */}
      {isDrawing && (
        <div className="absolute top-2 left-2 bg-background/90 text-foreground px-3 py-1.5 rounded-md text-sm border shadow-sm">
          {activeTool === 'roof' 
            ? `${currentPoints.length} points — double-click to close polygon`
            : 'Click end point to complete line'}
        </div>
      )}

      {/* Color legend */}
      <div className="absolute bottom-2 left-2 bg-background/90 p-2 rounded-md text-xs border shadow-sm">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {Object.entries(COLORS).filter(([key]) => key !== 'point').map(([key, color]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
              <span className="capitalize text-muted-foreground">{key.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
