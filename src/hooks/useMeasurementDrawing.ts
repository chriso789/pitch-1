import { useState, useCallback, useRef } from 'react';
import { Point, Polygon, calculatePolygonArea, calculatePolygonPerimeter, getPolygonColor } from '@/utils/measurementGeometry';

interface UseMeasurementDrawingOptions {
  pixelsPerFoot?: number;
  snapThreshold?: number;
  onPolygonComplete?: (polygon: Polygon) => void;
}

export function useMeasurementDrawing(options: UseMeasurementDrawingOptions = {}) {
  const { pixelsPerFoot = 1, snapThreshold = 10, onPolygonComplete } = options;
  
  const [polygons, setPolygons] = useState<Polygon[]>([]);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  
  const undoStack = useRef<Polygon[][]>([]);
  const redoStack = useRef<Polygon[][]>([]);

  const saveToUndoStack = useCallback(() => {
    undoStack.current.push(JSON.parse(JSON.stringify(polygons)));
    redoStack.current = [];
  }, [polygons]);

  const startDrawing = useCallback(() => {
    saveToUndoStack();
    setIsDrawing(true);
    setCurrentPoints([]);
  }, [saveToUndoStack]);

  const addPoint = useCallback((point: Point) => {
    if (!isDrawing) return;

    // Check if clicking near first point to close polygon
    if (currentPoints.length >= 3) {
      const firstPoint = currentPoints[0];
      const dx = point.x - firstPoint.x;
      const dy = point.y - firstPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < snapThreshold) {
        // Close polygon
        const newPolygon: Polygon = {
          id: `polygon-${Date.now()}`,
          points: [...currentPoints],
          closed: true,
          color: getPolygonColor(polygons.length),
          label: `Facet ${polygons.length + 1}`,
        };
        
        setPolygons(prev => [...prev, newPolygon]);
        setCurrentPoints([]);
        setIsDrawing(false);
        onPolygonComplete?.(newPolygon);
        return;
      }
    }

    setCurrentPoints(prev => [...prev, point]);
  }, [isDrawing, currentPoints, snapThreshold, polygons.length, onPolygonComplete]);

  const completePolygon = useCallback(() => {
    if (currentPoints.length >= 3) {
      const newPolygon: Polygon = {
        id: `polygon-${Date.now()}`,
        points: [...currentPoints],
        closed: true,
        color: getPolygonColor(polygons.length),
        label: `Facet ${polygons.length + 1}`,
      };
      
      setPolygons(prev => [...prev, newPolygon]);
      setCurrentPoints([]);
      setIsDrawing(false);
      onPolygonComplete?.(newPolygon);
    }
  }, [currentPoints, polygons.length, onPolygonComplete]);

  const cancelDrawing = useCallback(() => {
    setIsDrawing(false);
    setCurrentPoints([]);
  }, []);

  const movePoint = useCallback((polygonId: string, pointIndex: number, newPosition: Point) => {
    saveToUndoStack();
    setPolygons(prev => prev.map(polygon => {
      if (polygon.id === polygonId) {
        const newPoints = [...polygon.points];
        newPoints[pointIndex] = newPosition;
        return { ...polygon, points: newPoints };
      }
      return polygon;
    }));
  }, [saveToUndoStack]);

  const deletePoint = useCallback((polygonId: string, pointIndex: number) => {
    saveToUndoStack();
    setPolygons(prev => prev.map(polygon => {
      if (polygon.id === polygonId) {
        const newPoints = polygon.points.filter((_, i) => i !== pointIndex);
        if (newPoints.length < 3) {
          return null;
        }
        return { ...polygon, points: newPoints };
      }
      return polygon;
    }).filter(Boolean) as Polygon[]);
  }, [saveToUndoStack]);

  const deletePolygon = useCallback((polygonId: string) => {
    saveToUndoStack();
    setPolygons(prev => prev.filter(p => p.id !== polygonId));
  }, [saveToUndoStack]);

  const addPointToEdge = useCallback((polygonId: string, edgeIndex: number, point: Point) => {
    saveToUndoStack();
    setPolygons(prev => prev.map(polygon => {
      if (polygon.id === polygonId) {
        const newPoints = [...polygon.points];
        newPoints.splice(edgeIndex + 1, 0, point);
        return { ...polygon, points: newPoints };
      }
      return polygon;
    }));
  }, [saveToUndoStack]);

  const undo = useCallback(() => {
    if (undoStack.current.length > 0) {
      redoStack.current.push(JSON.parse(JSON.stringify(polygons)));
      const previousState = undoStack.current.pop()!;
      setPolygons(previousState);
    }
  }, [polygons]);

  const redo = useCallback(() => {
    if (redoStack.current.length > 0) {
      undoStack.current.push(JSON.parse(JSON.stringify(polygons)));
      const nextState = redoStack.current.pop()!;
      setPolygons(nextState);
    }
  }, [polygons]);

  const clear = useCallback(() => {
    saveToUndoStack();
    setPolygons([]);
    setCurrentPoints([]);
    setIsDrawing(false);
  }, [saveToUndoStack]);

  const getCurrentArea = useCallback(() => {
    if (currentPoints.length < 3) return 0;
    return calculatePolygonArea(currentPoints, pixelsPerFoot);
  }, [currentPoints, pixelsPerFoot]);

  const getCurrentPerimeter = useCallback(() => {
    if (currentPoints.length < 2) return 0;
    return calculatePolygonPerimeter(currentPoints, pixelsPerFoot);
  }, [currentPoints, pixelsPerFoot]);

  const getTotalArea = useCallback(() => {
    return polygons.reduce((total, polygon) => {
      return total + calculatePolygonArea(polygon.points, pixelsPerFoot);
    }, 0);
  }, [polygons, pixelsPerFoot]);

  const importBuildingOutline = useCallback((points: Point[]) => {
    saveToUndoStack();
    const newPolygon: Polygon = {
      id: `polygon-${Date.now()}`,
      points,
      closed: true,
      color: getPolygonColor(polygons.length),
      label: `Building Outline`,
    };
    setPolygons(prev => [...prev, newPolygon]);
    onPolygonComplete?.(newPolygon);
  }, [polygons.length, saveToUndoStack, onPolygonComplete]);

  return {
    // State
    polygons,
    currentPoints,
    isDrawing,
    selectedPolygonId,
    selectedPointIndex,
    hoveredPointIndex,
    
    // Actions
    startDrawing,
    addPoint,
    completePolygon,
    cancelDrawing,
    movePoint,
    deletePoint,
    deletePolygon,
    addPointToEdge,
    undo,
    redo,
    clear,
    importBuildingOutline,
    
    // Setters
    setSelectedPolygonId,
    setSelectedPointIndex,
    setHoveredPointIndex,
    
    // Calculations
    getCurrentArea,
    getCurrentPerimeter,
    getTotalArea,
    
    // Undo/Redo state
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}
