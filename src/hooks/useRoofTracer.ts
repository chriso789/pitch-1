import { useState, useCallback, useMemo } from 'react';

export type TracerTool = 'select' | 'perimeter' | 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';

export interface TracedLine {
  id: string;
  type: TracerTool;
  points: { x: number; y: number }[];
  lengthFt: number;
}

interface UseRoofTracerOptions {
  centerLat: number;
  centerLng: number;
  canvasWidth: number;
  canvasHeight: number;
  zoom?: number;
  initialLines?: TracedLine[];
}

/**
 * Hook for managing roof tracing state and coordinate conversions
 */
export function useRoofTracer(options: UseRoofTracerOptions) {
  const { centerLat, centerLng, canvasWidth, canvasHeight, zoom = 20, initialLines = [] } = options;
  
  const [activeTool, setActiveTool] = useState<TracerTool>('ridge');
  const [tracedLines, setTracedLines] = useState<TracedLine[]>(initialLines);
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  
  // Meters per pixel at zoom level
  const metersPerPixel = useMemo(() => {
    return (156543.03392 * Math.cos(centerLat * Math.PI / 180)) / Math.pow(2, zoom);
  }, [centerLat, zoom]);
  
  // Convert canvas point to lat/lng
  const canvasToGeo = useCallback((x: number, y: number): { lat: number; lng: number } => {
    const offsetX = x - canvasWidth / 2;
    const offsetY = y - canvasHeight / 2;
    
    const metersX = offsetX * metersPerPixel;
    const metersY = -offsetY * metersPerPixel; // Invert Y
    
    const lat = centerLat + (metersY / 111320);
    const lng = centerLng + (metersX / (111320 * Math.cos(centerLat * Math.PI / 180)));
    
    return { lat, lng };
  }, [centerLat, centerLng, canvasWidth, canvasHeight, metersPerPixel]);
  
  // Calculate distance between two canvas points in feet
  const calculateLengthFt = useCallback((points: { x: number; y: number }[]): number => {
    if (points.length < 2) return 0;
    
    let totalFt = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      const distPixels = Math.sqrt(dx * dx + dy * dy);
      const distMeters = distPixels * metersPerPixel;
      totalFt += distMeters * 3.28084; // meters to feet
    }
    
    return Math.round(totalFt * 10) / 10; // Round to 1 decimal
  }, [metersPerPixel]);
  
  // Generate WKT LINESTRING from canvas points
  const generateWKT = useCallback((points: { x: number; y: number }[]): string => {
    if (points.length < 2) return '';
    
    const coords = points.map(p => {
      const { lat, lng } = canvasToGeo(p.x, p.y);
      return `${lng} ${lat}`;
    }).join(', ');
    
    return `LINESTRING(${coords})`;
  }, [canvasToGeo]);
  
  // Start drawing a new line
  const startLine = useCallback((point: { x: number; y: number }) => {
    if (activeTool === 'select') return;
    setIsDrawing(true);
    setCurrentPoints([point]);
  }, [activeTool]);
  
  // Complete the current line
  const completeLine = useCallback((endPoint: { x: number; y: number }) => {
    if (!isDrawing || currentPoints.length === 0) return;
    
    const finalPoints = [...currentPoints, endPoint];
    const lengthFt = calculateLengthFt(finalPoints);
    
    const newLine: TracedLine = {
      id: `${activeTool}-${Date.now()}`,
      type: activeTool,
      points: finalPoints,
      lengthFt,
    };
    
    setTracedLines(prev => [...prev, newLine]);
    setCurrentPoints([]);
    setIsDrawing(false);
    
    return newLine;
  }, [isDrawing, currentPoints, activeTool, calculateLengthFt]);
  
  // Cancel current drawing
  const cancelLine = useCallback(() => {
    setCurrentPoints([]);
    setIsDrawing(false);
  }, []);
  
  // Delete a traced line
  const deleteLine = useCallback((lineId: string) => {
    setTracedLines(prev => prev.filter(l => l.id !== lineId));
  }, []);
  
  // Clear all traced lines
  const clearAll = useCallback(() => {
    setTracedLines([]);
    setCurrentPoints([]);
    setIsDrawing(false);
  }, []);
  
  // Undo last line
  const undoLast = useCallback(() => {
    setTracedLines(prev => prev.slice(0, -1));
  }, []);
  
  // Get totals by type
  const totals = useMemo(() => {
    const result = {
      ridge: 0,
      hip: 0,
      valley: 0,
      perimeter: 0,
      eave: 0,
      rake: 0,
      ridgeCount: 0,
      hipCount: 0,
      valleyCount: 0,
      eaveCount: 0,
      rakeCount: 0,
    };
    
    tracedLines.forEach(line => {
      if (line.type === 'ridge') {
        result.ridge += line.lengthFt;
        result.ridgeCount++;
      } else if (line.type === 'hip') {
        result.hip += line.lengthFt;
        result.hipCount++;
      } else if (line.type === 'valley') {
        result.valley += line.lengthFt;
        result.valleyCount++;
      } else if (line.type === 'perimeter') {
        result.perimeter += line.lengthFt;
      } else if (line.type === 'eave') {
        result.eave += line.lengthFt;
        result.eaveCount++;
      } else if (line.type === 'rake') {
        result.rake += line.lengthFt;
        result.rakeCount++;
      }
    });
    
    return result;
  }, [tracedLines]);
  
  // Generate linear_features_wkt array for database
  const generateLinearFeaturesWKT = useCallback((): { type: string; wkt: string; length_ft: number }[] => {
    return tracedLines.map(line => ({
      type: line.type,
      wkt: generateWKT(line.points),
      length_ft: line.lengthFt,
    }));
  }, [tracedLines, generateWKT]);
  
  // Get color for a tool type
  const getToolColor = useCallback((tool: TracerTool): string => {
    switch (tool) {
      case 'ridge': return '#22c55e'; // Green
      case 'hip': return '#8b5cf6'; // Purple
      case 'valley': return '#ef4444'; // Red
      case 'perimeter': return '#f97316'; // Orange
      case 'eave': return '#14b8a6'; // Teal
      case 'rake': return '#06b6d4'; // Cyan
      default: return '#6b7280'; // Gray
    }
  }, []);
  
  // Get feet per pixel for scale bar
  const feetPerPixel = useMemo(() => {
    return metersPerPixel * 3.28084;
  }, [metersPerPixel]);
  
  return {
    // State
    activeTool,
    tracedLines,
    currentPoints,
    isDrawing,
    totals,
    feetPerPixel,
    
    // Actions
    setActiveTool,
    setTracedLines,
    startLine,
    completeLine,
    cancelLine,
    deleteLine,
    clearAll,
    undoLast,
    
    // Utilities
    calculateLengthFt,
    generateWKT,
    generateLinearFeaturesWKT,
    getToolColor,
    canvasToGeo,
  };
}
