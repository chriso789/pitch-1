/**
 * Roof Geometry Reconstructor
 * 
 * Creates proper, connected roof geometry from:
 * 1. AI-detected perimeter polygon (from satellite imagery)
 * 2. Google Solar API segment metadata (pitch, azimuth, area)
 * 
 * This replaces the complex straight skeleton algorithm with a simpler,
 * more reliable approach that produces clean, connected diagrams.
 * 
 * OUTPUT: Clean, topologically correct roof geometry with:
 * - Single ridge line (or connected ridge segments for complex roofs)
 * - 4 hip lines connecting corners to ridge endpoints
 * - Valleys at reflex vertices
 * - Proper facet polygons that fill the entire roof area
 */

type XY = [number, number]; // [lng, lat]

export interface ReconstructedRoof {
  ridges: RoofLine[];
  hips: RoofLine[];
  valleys: RoofLine[];
  facets: ReconstructedFacet[];
  diagramQuality: 'excellent' | 'good' | 'fair' | 'simplified';
  warnings: string[];
}

export interface RoofLine {
  id: string;
  start: XY;
  end: XY;
  lengthFt: number;
  connectedTo: string[]; // IDs of lines that share a vertex
}

export interface ReconstructedFacet {
  id: string;
  index: number;
  polygon: XY[];
  areaSqft: number;
  pitch: string;
  azimuthDegrees: number;
  direction: string;
  color: string;
}

interface SolarSegmentInfo {
  pitchDegrees?: number;
  azimuthDegrees?: number;
  areaSqft?: number;
}

// Facet colors
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

/**
 * Main reconstruction function
 * Creates clean roof geometry from perimeter vertices
 */
export function reconstructRoofGeometry(
  perimeterVertices: XY[],
  solarSegments: SolarSegmentInfo[] = [],
  predominantPitch: string = '6/12'
): ReconstructedRoof {
  const warnings: string[] = [];
  
  // Ensure closed polygon
  let vertices = [...perimeterVertices];
  if (vertices.length > 0 && 
      (vertices[0][0] !== vertices[vertices.length - 1][0] || 
       vertices[0][1] !== vertices[vertices.length - 1][1])) {
    vertices = [...vertices, vertices[0]];
  }
  
  // Remove closing vertex for processing
  vertices = vertices.slice(0, -1);
  
  if (vertices.length < 4) {
    warnings.push('Too few vertices for reconstruction');
    return createSimplifiedResult(vertices, warnings);
  }
  
  // Detect building shape
  const reflexIndices = findReflexVertices(vertices);
  const shapeType = detectShape(vertices, reflexIndices);
  console.log(`🏗️ Reconstructing ${shapeType} roof with ${vertices.length} vertices, ${reflexIndices.size} reflex corners`);
  
  // Generate skeleton based on shape complexity
  let result: ReconstructedRoof;
  
  if (shapeType === 'rectangle') {
    result = reconstructRectangularRoof(vertices, solarSegments, predominantPitch);
  } else if (shapeType === 'L-shape' || shapeType === 'T-shape' || shapeType === 'U-shape') {
    result = reconstructMultiWingRoof(vertices, reflexIndices, solarSegments, predominantPitch, shapeType);
  } else {
    // Complex shapes: use simplified approach
    result = reconstructComplexRoof(vertices, reflexIndices, solarSegments, predominantPitch);
  }
  
  result.warnings.push(...warnings);
  return result;
}

/**
 * Reconstruct a simple rectangular roof (hip roof)
 * Creates: 1 ridge, 4 hips, 4 facets
 */
function reconstructRectangularRoof(
  vertices: XY[],
  solarSegments: SolarSegmentInfo[],
  pitch: string
): ReconstructedRoof {
  const bounds = getBounds(vertices);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  
  // Determine ridge direction (parallel to longest side)
  const isWider = width >= height;
  
  // Sort vertices by position to identify corners
  const sortedByX = [...vertices].sort((a, b) => a[0] - b[0]);
  const sortedByY = [...vertices].sort((a, b) => a[1] - b[1]);
  
  // Find corner vertices
  const corners = identifyCorners(vertices);
  
  // Calculate ridge endpoints (inset from shorter edges)
  const inset = (isWider ? height : width) * 0.4;
  
  let ridgeStart: XY, ridgeEnd: XY;
  if (isWider) {
    ridgeStart = [bounds.minX + inset, (bounds.minY + bounds.maxY) / 2];
    ridgeEnd = [bounds.maxX - inset, (bounds.minY + bounds.maxY) / 2];
  } else {
    ridgeStart = [(bounds.minX + bounds.maxX) / 2, bounds.minY + inset];
    ridgeEnd = [(bounds.minX + bounds.maxX) / 2, bounds.maxY - inset];
  }
  
  // Create ridge
  const ridge: RoofLine = {
    id: 'ridge_0',
    start: ridgeStart,
    end: ridgeEnd,
    lengthFt: distanceFt(ridgeStart, ridgeEnd),
    connectedTo: ['hip_0', 'hip_1', 'hip_2', 'hip_3']
  };
  
  // Create 4 hips from corners to NEAREST ridge endpoint
  const hips: RoofLine[] = [];
  corners.forEach((corner, i) => {
    // Connect each corner to the geometrically nearest ridge endpoint
    const distToStart = distance(corner, ridgeStart);
    const distToEnd = distance(corner, ridgeEnd);
    const targetEndpoint = distToStart <= distToEnd ? ridgeStart : ridgeEnd;
    
    hips.push({
      id: `hip_${i}`,
      start: corner,
      end: targetEndpoint,
      lengthFt: distanceFt(corner, targetEndpoint),
      connectedTo: ['ridge_0']
    });
  });
  
  // Create 4 facets (triangular at ends, trapezoidal on sides)
  const facets = createRectangularFacets(corners, ridgeStart, ridgeEnd, isWider, pitch, solarSegments);
  
  return {
    ridges: [ridge],
    hips,
    valleys: [],
    facets,
    diagramQuality: 'excellent',
    warnings: []
  };
}

/**
 * Reconstruct L, T, or U shaped roofs with multiple wings
 */
function reconstructMultiWingRoof(
  vertices: XY[],
  reflexIndices: Set<number>,
  solarSegments: SolarSegmentInfo[],
  pitch: string,
  shapeType: string
): ReconstructedRoof {
  const ridges: RoofLine[] = [];
  const hips: RoofLine[] = [];
  const valleys: RoofLine[] = [];
  const facets: ReconstructedFacet[] = [];
  const warnings: string[] = [];
  
  // Detect building wings
  const wings = detectWings(vertices, reflexIndices);
  
  if (wings.length < 2) {
    warnings.push('Could not detect multiple wings, using simplified approach');
    return reconstructComplexRoof(vertices, reflexIndices, solarSegments, pitch);
  }
  
  console.log(`  Detected ${wings.length} wings for ${shapeType}`);
  
  // Create ridge for each wing
  wings.forEach((wing, wingIdx) => {
    const bounds = getBounds(wing.vertices);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const isWider = width >= height;
    const inset = (isWider ? height : width) * 0.35;
    
    let ridgeStart: XY, ridgeEnd: XY;
    if (isWider) {
      ridgeStart = [bounds.minX + inset, (bounds.minY + bounds.maxY) / 2];
      ridgeEnd = [bounds.maxX - inset, (bounds.minY + bounds.maxY) / 2];
    } else {
      ridgeStart = [(bounds.minX + bounds.maxX) / 2, bounds.minY + inset];
      ridgeEnd = [(bounds.minX + bounds.maxX) / 2, bounds.maxY - inset];
    }
    
    ridges.push({
      id: `ridge_${wingIdx}`,
      start: ridgeStart,
      end: ridgeEnd,
      lengthFt: distanceFt(ridgeStart, ridgeEnd),
      connectedTo: []
    });
  });
  
  // Connect adjacent wing ridges
  for (let i = 0; i < ridges.length - 1; i++) {
    const dist = distance(ridges[i].end, ridges[i + 1].start);
    if (dist > 0.00001) {
      // Add connecting ridge segment
      ridges.push({
        id: `ridge_connector_${i}`,
        start: ridges[i].end,
        end: ridges[i + 1].start,
        lengthFt: distanceFt(ridges[i].end, ridges[i + 1].start),
        connectedTo: [`ridge_${i}`, `ridge_${i + 1}`]
      });
    }
    ridges[i].connectedTo.push(`ridge_${i + 1}`);
    ridges[i + 1].connectedTo.push(`ridge_${i}`);
  }
  
  // Create hips from non-reflex corners to nearest ridge endpoint
  const n = vertices.length;
  let hipIdx = 0;
  for (let i = 0; i < n; i++) {
    if (reflexIndices.has(i)) continue;
    
    const vertex = vertices[i];
    const nearestEndpoint = findNearestRidgeEndpoint(vertex, ridges);
    
    hips.push({
      id: `hip_${hipIdx}`,
      start: vertex,
      end: nearestEndpoint.point,
      lengthFt: distanceFt(vertex, nearestEndpoint.point),
      connectedTo: [nearestEndpoint.ridgeId]
    });
    hipIdx++;
  }
  
  // Create valleys from reflex corners
  let valleyIdx = 0;
  reflexIndices.forEach(idx => {
    const vertex = vertices[idx];
    const nearestEndpoint = findNearestRidgeEndpoint(vertex, ridges);
    
    valleys.push({
      id: `valley_${valleyIdx}`,
      start: vertex,
      end: nearestEndpoint.point,
      lengthFt: distanceFt(vertex, nearestEndpoint.point),
      connectedTo: [nearestEndpoint.ridgeId]
    });
    valleyIdx++;
  });
  
  // Create facets (simplified: one per wing + connector areas)
  wings.forEach((wing, wingIdx) => {
    const wingRidge = ridges.find(r => r.id === `ridge_${wingIdx}`);
    if (!wingRidge) return;
    
    const facetPolygon = [...wing.vertices, wing.vertices[0]];
    facets.push({
      id: `facet_${wingIdx}`,
      index: wingIdx,
      polygon: facetPolygon,
      areaSqft: calculatePolygonAreaSqft(wing.vertices),
      pitch,
      azimuthDegrees: 0,
      direction: wingIdx % 2 === 0 ? 'N/S' : 'E/W',
      color: FACET_COLORS[wingIdx % FACET_COLORS.length]
    });
  });
  
  return {
    ridges,
    hips,
    valleys,
    facets,
    diagramQuality: valleys.length > 0 ? 'good' : 'excellent',
    warnings
  };
}

/**
 * Simplified reconstruction for complex roofs
 * Creates a basic skeleton with central ridge and hip connections
 */
function reconstructComplexRoof(
  vertices: XY[],
  reflexIndices: Set<number>,
  solarSegments: SolarSegmentInfo[],
  pitch: string
): ReconstructedRoof {
  const ridges: RoofLine[] = [];
  const hips: RoofLine[] = [];
  const valleys: RoofLine[] = [];
  
  const bounds = getBounds(vertices);
  const centroid = getCentroid(vertices);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  
  // Create main ridge through centroid
  const isWider = width >= height;
  const inset = (isWider ? width : height) * 0.25;
  
  let ridgeStart: XY, ridgeEnd: XY;
  if (isWider) {
    ridgeStart = [bounds.minX + inset, centroid[1]];
    ridgeEnd = [bounds.maxX - inset, centroid[1]];
  } else {
    ridgeStart = [centroid[0], bounds.minY + inset];
    ridgeEnd = [centroid[0], bounds.maxY - inset];
  }
  
  ridges.push({
    id: 'ridge_0',
    start: ridgeStart,
    end: ridgeEnd,
    lengthFt: distanceFt(ridgeStart, ridgeEnd),
    connectedTo: []
  });
  
  // Connect all corners to nearest ridge endpoint
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const vertex = vertices[i];
    const isReflex = reflexIndices.has(i);
    
    const distToStart = distance(vertex, ridgeStart);
    const distToEnd = distance(vertex, ridgeEnd);
    const endpoint = distToStart < distToEnd ? ridgeStart : ridgeEnd;
    
    const line: RoofLine = {
      id: `${isReflex ? 'valley' : 'hip'}_${i}`,
      start: vertex,
      end: endpoint,
      lengthFt: distanceFt(vertex, endpoint),
      connectedTo: ['ridge_0']
    };
    
    if (isReflex) {
      valleys.push(line);
    } else {
      hips.push(line);
    }
  }
  
  ridges[0].connectedTo = [...hips.map(h => h.id), ...valleys.map(v => v.id)];
  
  // Single facet covering entire roof
  const facets: ReconstructedFacet[] = [{
    id: 'facet_0',
    index: 0,
    polygon: [...vertices, vertices[0]],
    areaSqft: calculatePolygonAreaSqft(vertices),
    pitch,
    azimuthDegrees: 0,
    direction: 'Mixed',
    color: FACET_COLORS[0]
  }];
  
  return {
    ridges,
    hips,
    valleys,
    facets,
    diagramQuality: 'fair',
    warnings: ['Complex roof shape - using simplified geometry']
  };
}

/**
 * Create fallback result for invalid inputs
 */
function createSimplifiedResult(vertices: XY[], warnings: string[]): ReconstructedRoof {
  return {
    ridges: [],
    hips: [],
    valleys: [],
    facets: vertices.length >= 3 ? [{
      id: 'facet_0',
      index: 0,
      polygon: [...vertices, vertices[0]],
      areaSqft: calculatePolygonAreaSqft(vertices),
      pitch: '0/12',
      azimuthDegrees: 0,
      direction: 'Unknown',
      color: FACET_COLORS[0]
    }] : [],
    diagramQuality: 'simplified',
    warnings
  };
}

// ===== Utility Functions =====

function findReflexVertices(vertices: XY[]): Set<number> {
  const reflex = new Set<number>();
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    
    // Cross product to determine if reflex (concave)
    const ax = prev[0] - curr[0];
    const ay = prev[1] - curr[1];
    const bx = next[0] - curr[0];
    const by = next[1] - curr[1];
    const cross = ax * by - ay * bx;
    
    if (cross < 0) {
      reflex.add(i);
    }
  }
  
  return reflex;
}

function detectShape(vertices: XY[], reflexIndices: Set<number>): string {
  const n = vertices.length;
  
  if (n === 4 && reflexIndices.size === 0) {
    return 'rectangle';
  }
  
  if (n >= 6 && n <= 12) {
    if (reflexIndices.size === 1) return 'L-shape';
    if (reflexIndices.size === 2) return 'T-shape';
    if (reflexIndices.size >= 3) return 'U-shape';
  }
  
  return 'complex';
}

interface Wing {
  vertices: XY[];
  indices: number[];
}

function detectWings(vertices: XY[], reflexIndices: Set<number>): Wing[] {
  const wings: Wing[] = [];
  const n = vertices.length;
  
  if (reflexIndices.size === 0) {
    return [{ vertices, indices: Array.from({ length: n }, (_, i) => i) }];
  }
  
  const reflexArray = Array.from(reflexIndices).sort((a, b) => a - b);
  
  // Split at reflex vertices
  for (let r = 0; r < reflexArray.length; r++) {
    const start = reflexArray[r];
    const end = reflexArray[(r + 1) % reflexArray.length];
    
    const wingIndices: number[] = [];
    let current = start;
    
    // Safety limit
    for (let safety = 0; safety <= n; safety++) {
      wingIndices.push(current);
      if (current === end) break;
      current = (current + 1) % n;
    }
    
    if (wingIndices.length >= 3) {
      wings.push({
        vertices: wingIndices.map(i => vertices[i]),
        indices: wingIndices
      });
    }
  }
  
  return wings;
}

function identifyCorners(vertices: XY[]): XY[] {
  // For a 4-vertex shape, just return sorted corners
  if (vertices.length === 4) {
    // Sort to ensure consistent ordering: SW, SE, NE, NW
    const sorted = [...vertices].sort((a, b) => {
      const latDiff = a[1] - b[1];
      return latDiff !== 0 ? latDiff : a[0] - b[0];
    });
    return [sorted[0], sorted[1], sorted[3], sorted[2]];
  }
  
  // For other shapes, return extrema corners
  const bounds = getBounds(vertices);
  return [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY]
  ];
}

function createRectangularFacets(
  corners: XY[],
  ridgeStart: XY,
  ridgeEnd: XY,
  isWider: boolean,
  pitch: string,
  solarSegments: SolarSegmentInfo[]
): ReconstructedFacet[] {
  const facets: ReconstructedFacet[] = [];
  
  // Create 4 triangular/trapezoidal facets
  // Front/back (triangular at ridge ends)
  // Left/right (trapezoidal along ridge)
  
  if (corners.length >= 4) {
    // Facet 0: Front (toward ridgeStart)
    const f0 = [corners[0], corners[3], ridgeStart, corners[0]];
    facets.push({
      id: 'facet_0',
      index: 0,
      polygon: f0,
      areaSqft: calculatePolygonAreaSqft(f0.slice(0, -1)),
      pitch,
      azimuthDegrees: 270,
      direction: 'W',
      color: FACET_COLORS[0]
    });
    
    // Facet 1: Back (toward ridgeEnd)
    const f1 = [corners[1], ridgeEnd, corners[2], corners[1]];
    facets.push({
      id: 'facet_1',
      index: 1,
      polygon: f1,
      areaSqft: calculatePolygonAreaSqft(f1.slice(0, -1)),
      pitch,
      azimuthDegrees: 90,
      direction: 'E',
      color: FACET_COLORS[1]
    });
    
    // Facet 2: South side
    const f2 = [corners[0], ridgeStart, ridgeEnd, corners[1], corners[0]];
    facets.push({
      id: 'facet_2',
      index: 2,
      polygon: f2,
      areaSqft: calculatePolygonAreaSqft(f2.slice(0, -1)),
      pitch,
      azimuthDegrees: 180,
      direction: 'S',
      color: FACET_COLORS[2]
    });
    
    // Facet 3: North side
    const f3 = [corners[3], corners[2], ridgeEnd, ridgeStart, corners[3]];
    facets.push({
      id: 'facet_3',
      index: 3,
      polygon: f3,
      areaSqft: calculatePolygonAreaSqft(f3.slice(0, -1)),
      pitch,
      azimuthDegrees: 0,
      direction: 'N',
      color: FACET_COLORS[3]
    });
  }
  
  return facets;
}

function findNearestRidgeEndpoint(point: XY, ridges: RoofLine[]): { point: XY; ridgeId: string } {
  let nearest = { point: ridges[0].start, ridgeId: ridges[0].id };
  let minDist = Infinity;
  
  for (const ridge of ridges) {
    const distToStart = distance(point, ridge.start);
    const distToEnd = distance(point, ridge.end);
    
    if (distToStart < minDist) {
      minDist = distToStart;
      nearest = { point: ridge.start, ridgeId: ridge.id };
    }
    if (distToEnd < minDist) {
      minDist = distToEnd;
      nearest = { point: ridge.end, ridgeId: ridge.id };
    }
  }
  
  return nearest;
}

function getBounds(vertices: XY[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = vertices.map(v => v[0]);
  const ys = vertices.map(v => v[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

function getCentroid(vertices: XY[]): XY {
  const n = vertices.length;
  const sumX = vertices.reduce((s, v) => s + v[0], 0);
  const sumY = vertices.reduce((s, v) => s + v[1], 0);
  return [sumX / n, sumY / n];
}

function distance(a: XY, b: XY): number {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
}

function distanceFt(a: XY, b: XY): number {
  // Approximate conversion from degrees to feet
  // At typical US latitudes, 1 degree lat ≈ 364,000 ft, 1 degree lng varies
  const midLat = (a[1] + b[1]) / 2;
  const ftPerDegLat = 364000;
  const ftPerDegLng = 364000 * Math.cos(midLat * Math.PI / 180);
  
  const dx = (b[0] - a[0]) * ftPerDegLng;
  const dy = (b[1] - a[1]) * ftPerDegLat;
  
  return Math.sqrt(dx * dx + dy * dy);
}

function calculatePolygonAreaSqft(vertices: XY[]): number {
  if (vertices.length < 3) return 0;
  
  // Shoelace formula in GPS coordinates
  const midLat = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  
  let area = 0;
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = vertices[i][0] * metersPerDegLng;
    const yi = vertices[i][1] * metersPerDegLat;
    const xj = vertices[j][0] * metersPerDegLng;
    const yj = vertices[j][1] * metersPerDegLat;
    
    area += xi * yj - xj * yi;
  }
  
  const sqMeters = Math.abs(area) / 2;
  return sqMeters * 10.764; // Convert to sq ft
}

/**
 * Convert reconstructed roof to WKT linear features for database storage
 */
export function roofToLinearFeaturesWKT(roof: ReconstructedRoof): Array<{
  type: string;
  wkt: string;
  length_ft: number;
}> {
  const features: Array<{ type: string; wkt: string; length_ft: number }> = [];
  
  // Add ridges
  for (const ridge of roof.ridges) {
    features.push({
      type: 'ridge',
      wkt: `LINESTRING(${ridge.start[0]} ${ridge.start[1]}, ${ridge.end[0]} ${ridge.end[1]})`,
      length_ft: ridge.lengthFt
    });
  }
  
  // Add hips
  for (const hip of roof.hips) {
    features.push({
      type: 'hip',
      wkt: `LINESTRING(${hip.start[0]} ${hip.start[1]}, ${hip.end[0]} ${hip.end[1]})`,
      length_ft: hip.lengthFt
    });
  }
  
  // Add valleys
  for (const valley of roof.valleys) {
    features.push({
      type: 'valley',
      wkt: `LINESTRING(${valley.start[0]} ${valley.start[1]}, ${valley.end[0]} ${valley.end[1]})`,
      length_ft: valley.lengthFt
    });
  }
  
  return features;
}
