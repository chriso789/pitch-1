/**
 * USE VERTEX EDITING HOOK - Phase 9
 * 
 * Provides vertex editing capabilities for manual measurement correction:
 * - Draggable vertex handles with angle snapping
 * - Undo/redo history stack
 * - Real-time measurement recalculation
 * - AI geometry pre-loading
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// ============= Types =============

export interface Vertex {
  id: string;
  lat: number;
  lng: number;
  type: 'perimeter' | 'interior' | 'ridge-end' | 'hip-junction' | 'valley-junction';
  isDraggable: boolean;
  isAIDetected: boolean;
  snapped?: boolean;
  label?: string;
}

export interface InteriorLine {
  id: string;
  type: 'ridge' | 'hip' | 'valley';
  startVertexId: string;
  endVertexId: string;
  lengthFt: number;
  isAIDetected: boolean;
}

export interface EditState {
  vertices: Vertex[];
  interiorLines: InteriorLine[];
  timestamp: number;
}

export interface SnapOptions {
  enableSnap: boolean;
  snapThreshold: number; // degrees
  snapAngles: number[]; // [0, 45, 90, 135, 180]
  snapToGrid?: boolean;
  gridSizeFt?: number;
}

export interface VertexEditingState {
  vertices: Vertex[];
  interiorLines: InteriorLine[];
  selectedVertexId: string | null;
  selectedLineId: string | null;
  isLoading: boolean;
  hasUnsavedChanges: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface VertexEditingActions {
  loadAIGeometry: (measurementId: string) => Promise<void>;
  moveVertex: (vertexId: string, newLat: number, newLng: number, snapOptions?: SnapOptions) => void;
  addVertex: (lat: number, lng: number, afterVertexId?: string) => string;
  removeVertex: (vertexId: string) => void;
  addLine: (type: InteriorLine['type'], startLat: number, startLng: number, endLat: number, endLng: number) => string;
  removeLine: (lineId: string) => void;
  selectVertex: (vertexId: string | null) => void;
  selectLine: (lineId: string | null) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  getCalculatedMeasurements: () => CalculatedMeasurements;
  saveToDatabase: (measurementId: string) => Promise<boolean>;
}

export interface CalculatedMeasurements {
  perimeterFt: number;
  areaSqft: number;
  ridgeFt: number;
  hipFt: number;
  valleyFt: number;
  vertexCount: number;
  lineCount: number;
}

// ============= Constants =============

const DEFAULT_SNAP_OPTIONS: SnapOptions = {
  enableSnap: true,
  snapThreshold: 10,
  snapAngles: [0, 45, 90, 135, 180, -45, -90, -135, -180],
  snapToGrid: false,
  gridSizeFt: 5,
};

// ============= Hook =============

export function useVertexEditing(initialVertices: Vertex[] = [], initialLines: InteriorLine[] = []): [VertexEditingState, VertexEditingActions] {
  // State
  const [vertices, setVertices] = useState<Vertex[]>(initialVertices);
  const [interiorLines, setInteriorLines] = useState<InteriorLine[]>(initialLines);
  const [selectedVertexId, setSelectedVertexId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // History stacks
  const historyRef = useRef<EditState[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const initialStateRef = useRef<EditState | null>(null);
  
  // ============= History Management =============
  
  const pushHistory = useCallback(() => {
    const newState: EditState = {
      vertices: JSON.parse(JSON.stringify(vertices)),
      interiorLines: JSON.parse(JSON.stringify(interiorLines)),
      timestamp: Date.now(),
    };
    
    // Remove any future states if we're not at the end
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(newState);
    historyIndexRef.current = historyRef.current.length - 1;
    
    setHasUnsavedChanges(true);
  }, [vertices, interiorLines]);
  
  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;
  
  // ============= Load AI Geometry =============
  
  const loadAIGeometry = useCallback(async (measurementId: string) => {
    setIsLoading(true);
    try {
      // Use select with type cast to avoid TypeScript errors with dynamic columns
      const { data, error } = await supabase
        .from('roof_measurements')
        .select('perimeter_wkt, linear_features_wkt, facets_json, footprint_vertices_geo')
        .eq('id', measurementId)
        .single() as { data: any; error: any };
      
      if (error) throw error;
      
      // Parse perimeter vertices from footprint_vertices_geo (if available) or perimeter_wkt
      let loadedVertices: Vertex[] = [];
      
      // Try footprint_vertices_geo first, then perimeter_wkt
      if (data?.footprint_vertices_geo && Array.isArray(data.footprint_vertices_geo)) {
        loadedVertices = data.footprint_vertices_geo.map((v: any, i: number) => ({
          id: `V${i + 1}`,
          lat: v.lat,
          lng: v.lng,
          type: 'perimeter' as const,
          isDraggable: true,
          isAIDetected: true,
          label: `P${i + 1}`,
        }));
      } else if (data?.perimeter_wkt) {
        // Parse WKT POLYGON
        const wkt = data.perimeter_wkt as string;
        const match = wkt.match(/POLYGON\(\(([^)]+)\)\)/);
        if (match) {
          const coords = match[1].split(',').map((pair: string) => {
            const [lng, lat] = pair.trim().split(' ').map(Number);
            return { lat, lng };
          });
          loadedVertices = coords.map((v: any, i: number) => ({
            id: `V${i + 1}`,
            lat: v.lat,
            lng: v.lng,
            type: 'perimeter' as const,
            isDraggable: true,
            isAIDetected: true,
            label: `P${i + 1}`,
          }));
        }
      }
      
      // Parse linear features
      let loadedLines: InteriorLine[] = [];
      
      if (data?.linear_features_wkt && Array.isArray(data.linear_features_wkt)) {
        loadedLines = data.linear_features_wkt
          .filter((f: any) => ['ridge', 'hip', 'valley'].includes(f.type?.toLowerCase()))
          .map((f: any, i: number) => {
            // Parse WKT LINESTRING
            const match = f.wkt?.match(/LINESTRING\(([^)]+)\)/);
            if (!match) return null;
            
            const coords = match[1].split(',').map((pair: string) => {
              const [lng, lat] = pair.trim().split(' ').map(Number);
              return { lat, lng };
            });
            
            if (coords.length < 2) return null;
            
            return {
              id: `L${i + 1}`,
              type: f.type.toLowerCase() as InteriorLine['type'],
              startVertexId: `L${i + 1}_start`,
              endVertexId: `L${i + 1}_end`,
              lengthFt: f.length_ft || 0,
              isAIDetected: true,
              // Store actual coordinates
              _startCoord: coords[0],
              _endCoord: coords[coords.length - 1],
            };
          })
          .filter(Boolean) as InteriorLine[];
      }
      
      setVertices(loadedVertices);
      setInteriorLines(loadedLines);
      
      // Save initial state
      initialStateRef.current = {
        vertices: JSON.parse(JSON.stringify(loadedVertices)),
        interiorLines: JSON.parse(JSON.stringify(loadedLines)),
        timestamp: Date.now(),
      };
      
      // Initialize history
      historyRef.current = [initialStateRef.current];
      historyIndexRef.current = 0;
      setHasUnsavedChanges(false);
      
      console.log(`✅ Loaded ${loadedVertices.length} vertices and ${loadedLines.length} lines from AI measurement`);
    } catch (err) {
      console.error('Failed to load AI geometry:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // ============= Vertex Operations =============
  
  const moveVertex = useCallback((vertexId: string, newLat: number, newLng: number, snapOptions: SnapOptions = DEFAULT_SNAP_OPTIONS) => {
    pushHistory();
    
    setVertices(prev => {
      const vertexIndex = prev.findIndex(v => v.id === vertexId);
      if (vertexIndex === -1) return prev;
      
      let finalLat = newLat;
      let finalLng = newLng;
      let wasSnapped = false;
      
      // Apply angle snapping
      if (snapOptions.enableSnap) {
        const prevVertex = prev[(vertexIndex - 1 + prev.length) % prev.length];
        const nextVertex = prev[(vertexIndex + 1) % prev.length];
        
        // Calculate angle from previous vertex
        const angle = Math.atan2(newLat - prevVertex.lat, newLng - prevVertex.lng) * 180 / Math.PI;
        
        // Find closest snap angle
        let closestSnap = snapOptions.snapAngles[0];
        let minDiff = Math.abs(((angle - closestSnap + 180) % 360) - 180);
        
        for (const snapAngle of snapOptions.snapAngles) {
          const diff = Math.abs(((angle - snapAngle + 180) % 360) - 180);
          if (diff < minDiff) {
            minDiff = diff;
            closestSnap = snapAngle;
          }
        }
        
        // Apply snap if within threshold
        if (minDiff <= snapOptions.snapThreshold) {
          const distance = Math.sqrt(
            (newLat - prevVertex.lat) ** 2 + 
            (newLng - prevVertex.lng) ** 2
          );
          const snapAngleRad = closestSnap * Math.PI / 180;
          
          finalLat = prevVertex.lat + distance * Math.sin(snapAngleRad);
          finalLng = prevVertex.lng + distance * Math.cos(snapAngleRad);
          wasSnapped = true;
        }
      }
      
      return prev.map(v => 
        v.id === vertexId 
          ? { ...v, lat: finalLat, lng: finalLng, snapped: wasSnapped }
          : v
      );
    });
  }, [pushHistory]);
  
  const addVertex = useCallback((lat: number, lng: number, afterVertexId?: string): string => {
    pushHistory();
    
    const newId = `V${Date.now()}`;
    const newVertex: Vertex = {
      id: newId,
      lat,
      lng,
      type: 'perimeter',
      isDraggable: true,
      isAIDetected: false,
    };
    
    setVertices(prev => {
      if (afterVertexId) {
        const index = prev.findIndex(v => v.id === afterVertexId);
        if (index !== -1) {
          const result = [...prev];
          result.splice(index + 1, 0, newVertex);
          return result;
        }
      }
      return [...prev, newVertex];
    });
    
    return newId;
  }, [pushHistory]);
  
  const removeVertex = useCallback((vertexId: string) => {
    pushHistory();
    setVertices(prev => prev.filter(v => v.id !== vertexId));
  }, [pushHistory]);
  
  // ============= Line Operations =============
  
  const addLine = useCallback((type: InteriorLine['type'], startLat: number, startLng: number, endLat: number, endLng: number): string => {
    pushHistory();
    
    const newId = `L${Date.now()}`;
    const lengthFt = calculateDistanceFt(startLat, startLng, endLat, endLng);
    
    const newLine: InteriorLine = {
      id: newId,
      type,
      startVertexId: `${newId}_start`,
      endVertexId: `${newId}_end`,
      lengthFt,
      isAIDetected: false,
    };
    
    setInteriorLines(prev => [...prev, newLine]);
    return newId;
  }, [pushHistory]);
  
  const removeLine = useCallback((lineId: string) => {
    pushHistory();
    setInteriorLines(prev => prev.filter(l => l.id !== lineId));
  }, [pushHistory]);
  
  // ============= Selection =============
  
  const selectVertex = useCallback((vertexId: string | null) => {
    setSelectedVertexId(vertexId);
    if (vertexId) setSelectedLineId(null);
  }, []);
  
  const selectLine = useCallback((lineId: string | null) => {
    setSelectedLineId(lineId);
    if (lineId) setSelectedVertexId(null);
  }, []);
  
  // ============= Undo/Redo =============
  
  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      const prevState = historyRef.current[historyIndexRef.current];
      setVertices(JSON.parse(JSON.stringify(prevState.vertices)));
      setInteriorLines(JSON.parse(JSON.stringify(prevState.interiorLines)));
    }
  }, []);
  
  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      const nextState = historyRef.current[historyIndexRef.current];
      setVertices(JSON.parse(JSON.stringify(nextState.vertices)));
      setInteriorLines(JSON.parse(JSON.stringify(nextState.interiorLines)));
    }
  }, []);
  
  const reset = useCallback(() => {
    if (initialStateRef.current) {
      setVertices(JSON.parse(JSON.stringify(initialStateRef.current.vertices)));
      setInteriorLines(JSON.parse(JSON.stringify(initialStateRef.current.interiorLines)));
      historyRef.current = [initialStateRef.current];
      historyIndexRef.current = 0;
      setHasUnsavedChanges(false);
    }
  }, []);
  
  // ============= Calculations =============
  
  const getCalculatedMeasurements = useCallback((): CalculatedMeasurements => {
    // Calculate perimeter
    let perimeterFt = 0;
    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      perimeterFt += calculateDistanceFt(v1.lat, v1.lng, v2.lat, v2.lng);
    }
    
    // Calculate area using shoelace formula
    let areaSqft = 0;
    if (vertices.length >= 3) {
      // Convert to feet first for accurate area
      const feetPerDegLat = 364000;
      const feetPerDegLng = 364000 * Math.cos((vertices[0]?.lat || 0) * Math.PI / 180);
      
      for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        const xi = vertices[i].lng * feetPerDegLng;
        const yi = vertices[i].lat * feetPerDegLat;
        const xj = vertices[j].lng * feetPerDegLng;
        const yj = vertices[j].lat * feetPerDegLat;
        areaSqft += xi * yj - xj * yi;
      }
      areaSqft = Math.abs(areaSqft) / 2;
    }
    
    // Sum linear features by type
    const ridgeFt = interiorLines.filter(l => l.type === 'ridge').reduce((sum, l) => sum + l.lengthFt, 0);
    const hipFt = interiorLines.filter(l => l.type === 'hip').reduce((sum, l) => sum + l.lengthFt, 0);
    const valleyFt = interiorLines.filter(l => l.type === 'valley').reduce((sum, l) => sum + l.lengthFt, 0);
    
    return {
      perimeterFt,
      areaSqft,
      ridgeFt,
      hipFt,
      valleyFt,
      vertexCount: vertices.length,
      lineCount: interiorLines.length,
    };
  }, [vertices, interiorLines]);
  
  // ============= Save to Database =============
  
  const saveToDatabase = useCallback(async (measurementId: string): Promise<boolean> => {
    try {
      // Convert vertices to WKT POLYGON
      const coords = vertices.map(v => `${v.lng} ${v.lat}`).join(', ');
      const perimeterWkt = `POLYGON((${coords}, ${vertices[0]?.lng} ${vertices[0]?.lat}))`;
      
      // Convert to perimeter_vertices array
      const perimeterVertices = vertices.map(v => ({
        lat: v.lat,
        lng: v.lng,
        type: v.type,
      }));
      
      const { error } = await supabase
        .from('roof_measurements')
        .update({
          perimeter_wkt: perimeterWkt,
          perimeter_vertices: perimeterVertices,
          // TODO: Update linear_features_wkt with interior lines
          updated_at: new Date().toISOString(),
        })
        .eq('id', measurementId);
      
      if (error) throw error;
      
      setHasUnsavedChanges(false);
      return true;
    } catch (err) {
      console.error('Failed to save to database:', err);
      return false;
    }
  }, [vertices]);
  
  // ============= Keyboard Shortcuts =============
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
        } else if (e.key === 'y') {
          e.preventDefault();
          redo();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedVertexId && vertices.length > 3) {
          e.preventDefault();
          removeVertex(selectedVertexId);
          setSelectedVertexId(null);
        } else if (selectedLineId) {
          e.preventDefault();
          removeLine(selectedLineId);
          setSelectedLineId(null);
        }
      } else if (e.key === 'Escape') {
        setSelectedVertexId(null);
        setSelectedLineId(null);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedVertexId, selectedLineId, vertices.length, undo, redo, removeVertex, removeLine]);
  
  // ============= Return State & Actions =============
  
  const state: VertexEditingState = {
    vertices,
    interiorLines,
    selectedVertexId,
    selectedLineId,
    isLoading,
    hasUnsavedChanges,
    canUndo,
    canRedo,
  };
  
  const actions: VertexEditingActions = {
    loadAIGeometry,
    moveVertex,
    addVertex,
    removeVertex,
    addLine,
    removeLine,
    selectVertex,
    selectLine,
    undo,
    redo,
    reset,
    getCalculatedMeasurements,
    saveToDatabase,
  };
  
  return [state, actions];
}

// ============= Helper Functions =============

function calculateDistanceFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231; // Earth's radius in feet
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + 
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default useVertexEditing;
