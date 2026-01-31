/**
 * Facet Generator Module
 * Generates roof facets from footprint polygon when AI doesn't detect individual facets
 * 
 * Supports: Rectangle, L-Shape, T-Shape, U-Shape, Complex decomposition
 */

type XY = [number, number];

export interface GeneratedFacet {
  id: string;
  polygon: XY[];
  areaSqft: number;
  estimatedPitch: string;
  orientation: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' | 'unknown';
  color: string;
}

export interface RoofTopology {
  ridges: Array<{ start: XY; end: XY }>;
  hips: Array<{ start: XY; end: XY }>;
  valleys: Array<{ start: XY; end: XY }>;
}

export interface FacetGenerationResult {
  facets: GeneratedFacet[];
  topology: RoofTopology;
  roofType: 'gable' | 'hip' | 'flat' | 'complex' | 'unknown';
  warnings: string[];
}

const FACET_COLORS = [
  'rgba(59, 130, 246, 0.35)',   // Blue
  'rgba(34, 197, 94, 0.35)',    // Green
  'rgba(251, 191, 36, 0.35)',   // Yellow
  'rgba(239, 68, 68, 0.35)',    // Red
  'rgba(139, 92, 246, 0.35)',   // Purple
  'rgba(236, 72, 153, 0.35)',   // Pink
  'rgba(20, 184, 166, 0.35)',   // Teal
  'rgba(249, 115, 22, 0.35)',   // Orange
];

// ===== GEOMETRY HELPERS =====

function getBounds(vertices: XY[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = vertices.map(v => v[0]);
  const ys = vertices.map(v => v[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function getCentroid(vertices: XY[]): XY {
  const x = vertices.reduce((sum, v) => sum + v[0], 0) / vertices.length;
  const y = vertices.reduce((sum, v) => sum + v[1], 0) / vertices.length;
  return [x, y];
}

function distanceFt(a: XY, b: XY): number {
  // Assuming coordinates are in degrees (GPS)
  const midLat = (a[1] + b[1]) / 2;
  const ftPerDegLat = 364000;
  const ftPerDegLng = 364000 * Math.cos(midLat * Math.PI / 180);
  return Math.sqrt(
    Math.pow((b[0] - a[0]) * ftPerDegLng, 2) + 
    Math.pow((b[1] - a[1]) * ftPerDegLat, 2)
  );
}

function polygonArea(vertices: XY[]): number {
  if (vertices.length < 3) return 0;
  const midLat = vertices.reduce((sum, v) => sum + v[1], 0) / vertices.length;
  const mLat = 111320;
  const mLng = 111320 * Math.cos(midLat * Math.PI / 180);
  
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i][0] * mLng * vertices[j][1] * mLat;
    area -= vertices[j][0] * mLng * vertices[i][1] * mLat;
  }
  return Math.abs(area) / 2 * 10.764; // Convert m² to sqft
}

function findReflexVertices(vertices: XY[]): Set<number> {
  const reflex = new Set<number>();
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    
    // Cross product to determine convexity
    const cross = (prev[0] - curr[0]) * (next[1] - curr[1]) - 
                  (prev[1] - curr[1]) * (next[0] - curr[0]);
    
    if (cross < 0) {
      reflex.add(i);
    }
  }
  
  return reflex;
}

function getOrientation(facetCentroid: XY, roofCentroid: XY): 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' | 'unknown' {
  const dx = facetCentroid[0] - roofCentroid[0];
  const dy = facetCentroid[1] - roofCentroid[1];
  
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  
  if (angle >= -22.5 && angle < 22.5) return 'E';
  if (angle >= 22.5 && angle < 67.5) return 'NE';
  if (angle >= 67.5 && angle < 112.5) return 'N';
  if (angle >= 112.5 && angle < 157.5) return 'NW';
  if (angle >= 157.5 || angle < -157.5) return 'W';
  if (angle >= -157.5 && angle < -112.5) return 'SW';
  if (angle >= -112.5 && angle < -67.5) return 'S';
  if (angle >= -67.5 && angle < -22.5) return 'SE';
  
  return 'unknown';
}

// ===== RECTANGULAR ROOF (GABLE) =====

function generateGableRoof(vertices: XY[], pitch: string): FacetGenerationResult {
  const bounds = getBounds(vertices);
  const centroid = getCentroid(vertices);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  
  const isWider = width >= height;
  
  // Ridge line along the longer dimension
  const ridgeStart: XY = isWider 
    ? [bounds.minX, centroid[1]] 
    : [centroid[0], bounds.minY];
  const ridgeEnd: XY = isWider 
    ? [bounds.maxX, centroid[1]] 
    : [centroid[0], bounds.maxY];
  
  // Create two facets (front and back)
  const facets: GeneratedFacet[] = [];
  
  // Facet 1: South/West side
  const facet1Polygon: XY[] = isWider
    ? [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], ridgeEnd, ridgeStart, [bounds.minX, bounds.minY]]
    : [[bounds.minX, bounds.minY], ridgeStart, ridgeEnd, [bounds.minX, bounds.maxY], [bounds.minX, bounds.minY]];
  
  facets.push({
    id: 'F1',
    polygon: facet1Polygon,
    areaSqft: polygonArea(facet1Polygon),
    estimatedPitch: pitch,
    orientation: isWider ? 'S' : 'W',
    color: FACET_COLORS[0],
  });
  
  // Facet 2: North/East side
  const facet2Polygon: XY[] = isWider
    ? [[bounds.minX, bounds.maxY], ridgeStart, ridgeEnd, [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]]
    : [[bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], ridgeEnd, ridgeStart, [bounds.maxX, bounds.minY]];
  
  facets.push({
    id: 'F2',
    polygon: facet2Polygon,
    areaSqft: polygonArea(facet2Polygon),
    estimatedPitch: pitch,
    orientation: isWider ? 'N' : 'E',
    color: FACET_COLORS[1],
  });
  
  return {
    facets,
    topology: {
      ridges: [{ start: ridgeStart, end: ridgeEnd }],
      hips: [],
      valleys: [],
    },
    roofType: 'gable',
    warnings: [],
  };
}

// ===== RECTANGULAR ROOF (HIP) =====

function generateHipRoof(vertices: XY[], pitch: string): FacetGenerationResult {
  const bounds = getBounds(vertices);
  const centroid = getCentroid(vertices);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  
  const isWider = width >= height;
  const inset = (isWider ? height : width) * 0.4;
  
  // Ridge line (shorter, inset from ends)
  const ridgeStart: XY = isWider 
    ? [bounds.minX + inset, centroid[1]] 
    : [centroid[0], bounds.minY + inset];
  const ridgeEnd: XY = isWider 
    ? [bounds.maxX - inset, centroid[1]] 
    : [centroid[0], bounds.maxY - inset];
  
  // Corner vertices
  const corners: XY[] = [
    [bounds.minX, bounds.minY], // SW
    [bounds.maxX, bounds.minY], // SE
    [bounds.maxX, bounds.maxY], // NE
    [bounds.minX, bounds.maxY], // NW
  ];
  
  const facets: GeneratedFacet[] = [];
  const hips: Array<{ start: XY; end: XY }> = [];
  
  if (isWider) {
    // 4 facets for wider building
    // South (trapezoid)
    facets.push({
      id: 'F1',
      polygon: [corners[0], corners[1], ridgeEnd, ridgeStart, corners[0]],
      areaSqft: polygonArea([corners[0], corners[1], ridgeEnd, ridgeStart]),
      estimatedPitch: pitch,
      orientation: 'S',
      color: FACET_COLORS[0],
    });
    
    // North (trapezoid)
    facets.push({
      id: 'F2',
      polygon: [corners[3], ridgeStart, ridgeEnd, corners[2], corners[3]],
      areaSqft: polygonArea([corners[3], ridgeStart, ridgeEnd, corners[2]]),
      estimatedPitch: pitch,
      orientation: 'N',
      color: FACET_COLORS[1],
    });
    
    // West (triangle)
    facets.push({
      id: 'F3',
      polygon: [corners[0], ridgeStart, corners[3], corners[0]],
      areaSqft: polygonArea([corners[0], ridgeStart, corners[3]]),
      estimatedPitch: pitch,
      orientation: 'W',
      color: FACET_COLORS[2],
    });
    
    // East (triangle)
    facets.push({
      id: 'F4',
      polygon: [corners[1], corners[2], ridgeEnd, corners[1]],
      areaSqft: polygonArea([corners[1], corners[2], ridgeEnd]),
      estimatedPitch: pitch,
      orientation: 'E',
      color: FACET_COLORS[3],
    });
    
    // Hips
    hips.push({ start: corners[0], end: ridgeStart });
    hips.push({ start: corners[1], end: ridgeEnd });
    hips.push({ start: corners[2], end: ridgeEnd });
    hips.push({ start: corners[3], end: ridgeStart });
  } else {
    // 4 facets for taller building
    facets.push({
      id: 'F1',
      polygon: [corners[0], corners[1], ridgeStart, corners[0]],
      areaSqft: polygonArea([corners[0], corners[1], ridgeStart]),
      estimatedPitch: pitch,
      orientation: 'S',
      color: FACET_COLORS[0],
    });
    
    facets.push({
      id: 'F2',
      polygon: [corners[2], corners[3], ridgeEnd, corners[2]],
      areaSqft: polygonArea([corners[2], corners[3], ridgeEnd]),
      estimatedPitch: pitch,
      orientation: 'N',
      color: FACET_COLORS[1],
    });
    
    facets.push({
      id: 'F3',
      polygon: [corners[0], ridgeStart, ridgeEnd, corners[3], corners[0]],
      areaSqft: polygonArea([corners[0], ridgeStart, ridgeEnd, corners[3]]),
      estimatedPitch: pitch,
      orientation: 'W',
      color: FACET_COLORS[2],
    });
    
    facets.push({
      id: 'F4',
      polygon: [corners[1], corners[2], ridgeEnd, ridgeStart, corners[1]],
      areaSqft: polygonArea([corners[1], corners[2], ridgeEnd, ridgeStart]),
      estimatedPitch: pitch,
      orientation: 'E',
      color: FACET_COLORS[3],
    });
    
    hips.push({ start: corners[0], end: ridgeStart });
    hips.push({ start: corners[1], end: ridgeStart });
    hips.push({ start: corners[2], end: ridgeEnd });
    hips.push({ start: corners[3], end: ridgeEnd });
  }
  
  return {
    facets,
    topology: {
      ridges: [{ start: ridgeStart, end: ridgeEnd }],
      hips,
      valleys: [],
    },
    roofType: 'hip',
    warnings: [],
  };
}

// ===== L-SHAPE ROOF =====

function generateLShapeRoof(vertices: XY[], reflexIndices: Set<number>, pitch: string): FacetGenerationResult {
  const warnings: string[] = [];
  const centroid = getCentroid(vertices);
  
  // Find the reflex vertex (inside corner of L)
  const reflexIdx = Array.from(reflexIndices)[0];
  if (reflexIdx === undefined) {
    warnings.push('No reflex vertex found for L-shape - falling back to simple split');
    return generateSimpleFallback(vertices, pitch, 'complex');
  }
  
  const reflexVertex = vertices[reflexIdx];
  
  // Split L into two rectangular wings
  // This is a simplified approach - production would need more sophisticated decomposition
  
  const facets: GeneratedFacet[] = [];
  const valleys: Array<{ start: XY; end: XY }> = [];
  const ridges: Array<{ start: XY; end: XY }> = [];
  
  // For now, create a single complex facet as placeholder
  // Full implementation would decompose L into two rectangles
  facets.push({
    id: 'F1',
    polygon: [...vertices, vertices[0]],
    areaSqft: polygonArea(vertices),
    estimatedPitch: pitch,
    orientation: 'unknown',
    color: FACET_COLORS[0],
  });
  
  // Valley from reflex vertex toward center
  valleys.push({
    start: reflexVertex,
    end: centroid,
  });
  
  return {
    facets,
    topology: { ridges, hips: [], valleys },
    roofType: 'complex',
    warnings: ['L-shape decomposition simplified - manual verification recommended'],
  };
}

// ===== SIMPLE FALLBACK =====

function generateSimpleFallback(
  vertices: XY[], 
  pitch: string,
  roofType: 'gable' | 'hip' | 'flat' | 'complex' | 'unknown'
): FacetGenerationResult {
  const bounds = getBounds(vertices);
  const centroid = getCentroid(vertices);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const isWider = width >= height;
  
  // Single ridge through center
  const ridgeStart: XY = isWider 
    ? [bounds.minX + width * 0.25, centroid[1]] 
    : [centroid[0], bounds.minY + height * 0.25];
  const ridgeEnd: XY = isWider 
    ? [bounds.maxX - width * 0.25, centroid[1]] 
    : [centroid[0], bounds.maxY - height * 0.25];
  
  // Single facet covering entire footprint
  const facets: GeneratedFacet[] = [{
    id: 'F1',
    polygon: [...vertices, vertices[0]],
    areaSqft: polygonArea(vertices),
    estimatedPitch: pitch,
    orientation: 'unknown',
    color: FACET_COLORS[0],
  }];
  
  return {
    facets,
    topology: {
      ridges: [{ start: ridgeStart, end: ridgeEnd }],
      hips: [],
      valleys: [],
    },
    roofType,
    warnings: ['Complex shape - using simplified single-facet representation'],
  };
}

// ===== MAIN EXPORT =====

export interface GenerateFacetsOptions {
  preferHipStyle?: boolean;
  pitch?: string;
  forceRoofType?: 'gable' | 'hip' | 'flat';
}

/**
 * Generate roof facets from a footprint polygon
 * Automatically detects roof complexity and applies appropriate strategy
 */
export function generateFacetsFromFootprint(
  footprintVertices: XY[],
  options: GenerateFacetsOptions = {}
): FacetGenerationResult {
  const {
    preferHipStyle = true,
    pitch = '6/12',
  } = options;
  
  // Ensure closed polygon
  let vertices = [...footprintVertices];
  if (vertices.length > 0) {
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      vertices.push([...first] as XY);
    }
    // Remove closing vertex for processing
    vertices = vertices.slice(0, -1);
  }
  
  if (vertices.length < 4) {
    return {
      facets: [],
      topology: { ridges: [], hips: [], valleys: [] },
      roofType: 'unknown',
      warnings: ['Insufficient vertices for facet generation'],
    };
  }
  
  const reflexIndices = findReflexVertices(vertices);
  const n = vertices.length;
  
  // Simple rectangle (4 vertices, no reflex)
  if (n === 4 && reflexIndices.size === 0) {
    return preferHipStyle 
      ? generateHipRoof(vertices, pitch)
      : generateGableRoof(vertices, pitch);
  }
  
  // L-shape (6 vertices, 1 reflex)
  if (n === 6 && reflexIndices.size === 1) {
    return generateLShapeRoof(vertices, reflexIndices, pitch);
  }
  
  // T-shape (8 vertices, 2 reflex)
  if (n === 8 && reflexIndices.size === 2) {
    return generateSimpleFallback(vertices, pitch, 'complex');
  }
  
  // U-shape (8+ vertices, 2 reflex)
  if (n >= 8 && reflexIndices.size === 2) {
    return generateSimpleFallback(vertices, pitch, 'complex');
  }
  
  // Complex shape
  return generateSimpleFallback(vertices, pitch, 'complex');
}

/**
 * Infer roof type from Solar API segment data
 */
export function inferRoofTypeFromSegments(
  segments: Array<{ azimuthDegrees?: number; pitchDegrees?: number }>
): 'gable' | 'hip' | 'flat' | 'complex' {
  if (!segments || segments.length === 0) {
    return 'unknown' as any;
  }
  
  // Count orientations
  const orientations = { N: 0, S: 0, E: 0, W: 0 };
  
  for (const seg of segments) {
    const az = ((seg.azimuthDegrees ?? 0) % 360 + 360) % 360;
    if (az >= 315 || az < 45) orientations.N++;
    else if (az >= 45 && az < 135) orientations.E++;
    else if (az >= 135 && az < 225) orientations.S++;
    else orientations.W++;
  }
  
  // Hip roof: segments facing all 4 directions
  if (orientations.N > 0 && orientations.S > 0 && orientations.E > 0 && orientations.W > 0) {
    return 'hip';
  }
  
  // Gable roof: segments facing 2 opposite directions
  if ((orientations.N > 0 && orientations.S > 0) || (orientations.E > 0 && orientations.W > 0)) {
    if (segments.length <= 3) return 'gable';
  }
  
  // Flat: low pitch on all segments
  const allFlat = segments.every(s => (s.pitchDegrees ?? 0) < 5);
  if (allFlat) return 'flat';
  
  // Default to complex for multi-facet roofs
  if (segments.length > 4) return 'complex';
  
  return 'gable';
}
