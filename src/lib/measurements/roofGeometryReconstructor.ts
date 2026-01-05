/**
 * Client-side Roof Geometry Reconstructor
 * 
 * Creates proper, connected roof geometry from perimeter coordinates.
 * This is used by SchematicRoofDiagram to render clean roof diagrams
 * when the database doesn't have pre-generated linear features.
 */

interface GPSCoord {
  lat: number;
  lng: number;
}

interface ReconstructedRoof {
  ridges: RoofLine[];
  hips: RoofLine[];
  valleys: RoofLine[];
  facets: ReconstructedFacet[];
  diagramQuality: 'excellent' | 'good' | 'fair' | 'simplified';
  warnings: string[];
}

interface RoofLine {
  id: string;
  start: GPSCoord;
  end: GPSCoord;
  lengthFt: number;
  connectedTo: string[];
}

interface ReconstructedFacet {
  id: string;
  index: number;
  polygon: GPSCoord[];
  areaSqft: number;
  pitch: string;
  azimuthDegrees: number;
  direction: string;
  color: string;
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
 * Reconstruct roof geometry from perimeter GPS coordinates
 */
export function reconstructRoofFromPerimeter(
  perimeterCoords: GPSCoord[],
  pitch: string = '6/12'
): ReconstructedRoof {
  const warnings: string[] = [];
  
  if (!perimeterCoords || perimeterCoords.length < 3) {
    return createEmptyResult(['Insufficient perimeter coordinates']);
  }
  
  // Ensure we don't have duplicate closing point
  let vertices = [...perimeterCoords];
  if (vertices.length > 1 && 
      vertices[0].lat === vertices[vertices.length - 1].lat &&
      vertices[0].lng === vertices[vertices.length - 1].lng) {
    vertices = vertices.slice(0, -1);
  }
  
  if (vertices.length < 3) {
    return createEmptyResult(['Insufficient unique vertices']);
  }
  
  // Detect reflex vertices
  const reflexIndices = findReflexVertices(vertices);
  const shapeType = detectShape(vertices, reflexIndices);
  
  console.log(`🏗️ Client reconstructing ${shapeType} roof: ${vertices.length} vertices, ${reflexIndices.size} reflex`);
  
  // Generate clean geometry based on shape
  if (shapeType === 'rectangle') {
    return reconstructRectangularRoof(vertices, pitch);
  } else if (['L-shape', 'T-shape', 'U-shape', 'H-shape', 'multi-wing'].includes(shapeType)) {
    return reconstructMultiWingRoof(vertices, reflexIndices, pitch, shapeType);
  } else {
    return reconstructComplexRoof(vertices, reflexIndices, pitch);
  }
}

function createEmptyResult(warnings: string[]): ReconstructedRoof {
  return {
    ridges: [],
    hips: [],
    valleys: [],
    facets: [],
    diagramQuality: 'simplified',
    warnings
  };
}

/**
 * Reconstruct a rectangular (hip) roof
 */
function reconstructRectangularRoof(vertices: GPSCoord[], pitch: string): ReconstructedRoof {
  const bounds = getBounds(vertices);
  const width = bounds.maxLng - bounds.minLng;
  const height = bounds.maxLat - bounds.minLat;
  const isWider = width >= height;
  
  // Sort to find corners
  const corners = [...vertices].sort((a, b) => {
    const latDiff = a.lat - b.lat;
    return latDiff !== 0 ? latDiff : a.lng - b.lng;
  });
  
  // Calculate ridge endpoints (inset from edges)
  const inset = (isWider ? height : width) * 0.4;
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;
  
  let ridgeStart: GPSCoord, ridgeEnd: GPSCoord;
  if (isWider) {
    ridgeStart = { lat: centerLat, lng: bounds.minLng + inset };
    ridgeEnd = { lat: centerLat, lng: bounds.maxLng - inset };
  } else {
    ridgeStart = { lat: bounds.minLat + inset, lng: centerLng };
    ridgeEnd = { lat: bounds.maxLat - inset, lng: centerLng };
  }
  
  // Create ridge
  const ridge: RoofLine = {
    id: 'ridge_0',
    start: ridgeStart,
    end: ridgeEnd,
    lengthFt: distanceFt(ridgeStart, ridgeEnd),
    connectedTo: ['hip_0', 'hip_1', 'hip_2', 'hip_3']
  };
  
  // Create 4 hips from corners to ridge endpoints
  const hips: RoofLine[] = [];
  
  // SW, SE, NE, NW corners
  const orderedCorners = [
    corners[0], // SW
    corners[1], // SE (or second lowest)
    corners[3], // NE (highest)
    corners[2], // NW
  ];
  
  orderedCorners.forEach((corner, i) => {
    // First two corners connect to ridge start, last two to ridge end
    const targetEndpoint = i < 2 ? ridgeStart : ridgeEnd;
    hips.push({
      id: `hip_${i}`,
      start: corner,
      end: targetEndpoint,
      lengthFt: distanceFt(corner, targetEndpoint),
      connectedTo: ['ridge_0']
    });
  });
  
  // Create 4 facets
  const facets = createRectangularFacets(orderedCorners, ridgeStart, ridgeEnd, pitch);
  
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
 * Reconstruct L/T/U shaped roofs
 */
function reconstructMultiWingRoof(
  vertices: GPSCoord[],
  reflexIndices: Set<number>,
  pitch: string,
  shapeType: string
): ReconstructedRoof {
  const ridges: RoofLine[] = [];
  const hips: RoofLine[] = [];
  const valleys: RoofLine[] = [];
  const warnings: string[] = [];
  
  const n = vertices.length;
  const reflexArray = Array.from(reflexIndices);
  
  // If too many reflex vertices (>4), use simplified perimeter-only mode
  if (reflexArray.length > 4) {
    console.log(`  ⚠️ ${reflexArray.length} reflex vertices - using perimeter-only mode`);
    return {
      ridges: [],
      hips: [],
      valleys: [],
      facets: [{
        id: 'facet_0',
        index: 0,
        polygon: [...vertices, vertices[0]],
        areaSqft: calculatePolygonAreaSqft(vertices),
        pitch,
        azimuthDegrees: 0,
        direction: 'Mixed',
        color: FACET_COLORS[0]
      }],
      diagramQuality: 'simplified',
      warnings: ['Complex roof - showing perimeter only']
    };
  }
  
  // Detect wings
  const wings = detectWings(vertices, reflexIndices);
  
  if (wings.length < 2) {
    return reconstructComplexRoof(vertices, reflexIndices, pitch);
  }
  
  // Create ridge for each wing - store endpoints for junction finding
  const wingRidgeEndpoints: GPSCoord[][] = [];
  
  wings.forEach((wing, wingIdx) => {
    const bounds = getBounds(wing);
    const width = bounds.maxLng - bounds.minLng;
    const height = bounds.maxLat - bounds.minLat;
    const isWider = width >= height;
    const shortSide = isWider ? height : width;
    const inset = shortSide * 0.4;
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const centerLng = (bounds.minLng + bounds.maxLng) / 2;
    
    let ridgeStart: GPSCoord, ridgeEnd: GPSCoord;
    if (isWider) {
      ridgeStart = { lat: centerLat, lng: bounds.minLng + inset };
      ridgeEnd = { lat: centerLat, lng: bounds.maxLng - inset };
    } else {
      ridgeStart = { lat: bounds.minLat + inset, lng: centerLng };
      ridgeEnd = { lat: bounds.maxLat - inset, lng: centerLng };
    }
    
    wingRidgeEndpoints.push([ridgeStart, ridgeEnd]);
    
    ridges.push({
      id: `ridge_${wingIdx}`,
      start: ridgeStart,
      end: ridgeEnd,
      lengthFt: distanceFt(ridgeStart, ridgeEnd),
      connectedTo: []
    });
  });
  
  // Find junction points where wing ridges should connect
  const junctionPoints: GPSCoord[] = [];
  
  for (let i = 0; i < wings.length; i++) {
    for (let j = i + 1; j < wings.length; j++) {
      const [startI, endI] = wingRidgeEndpoints[i];
      const [startJ, endJ] = wingRidgeEndpoints[j];
      
      const pairs = [
        { p1: endI, p2: startJ, dist: distance(endI, startJ) },
        { p1: startI, p2: endJ, dist: distance(startI, endJ) },
        { p1: endI, p2: endJ, dist: distance(endI, endJ) },
        { p1: startI, p2: startJ, dist: distance(startI, startJ) },
      ];
      
      const closest = pairs.sort((a, b) => a.dist - b.dist)[0];
      
      if (closest.dist < 0.001) {
        const junction: GPSCoord = {
          lat: (closest.p1.lat + closest.p2.lat) / 2,
          lng: (closest.p1.lng + closest.p2.lng) / 2
        };
        junctionPoints.push(junction);
      }
    }
  }
  
  // Create hips from non-reflex corners to their wing's ridge endpoints
  let hipIdx = 0;
  for (let i = 0; i < n; i++) {
    if (reflexIndices.has(i)) continue;
    
    const vertex = vertices[i];
    
    // Find which wing this corner belongs to
    let bestWingIdx = 0;
    let bestDist = Infinity;
    
    wings.forEach((wing, wIdx) => {
      const wingBounds = getBounds(wing);
      const withinLng = vertex.lng >= wingBounds.minLng - 0.0001 && vertex.lng <= wingBounds.maxLng + 0.0001;
      const withinLat = vertex.lat >= wingBounds.minLat - 0.0001 && vertex.lat <= wingBounds.maxLat + 0.0001;
      
      if (withinLng && withinLat) {
        const dist = Math.min(...wing.map(v => distance(vertex, v)));
        if (dist < bestDist) {
          bestDist = dist;
          bestWingIdx = wIdx;
        }
      }
    });
    
    // Connect to THIS wing's ridge only
    const wingRidge = ridges.find(r => r.id === `ridge_${bestWingIdx}`);
    if (wingRidge) {
      const distToStart = distance(vertex, wingRidge.start);
      const distToEnd = distance(vertex, wingRidge.end);
      const targetEndpoint = distToStart <= distToEnd ? wingRidge.start : wingRidge.end;
      
      hips.push({
        id: `hip_${hipIdx}`,
        start: vertex,
        end: targetEndpoint,
        lengthFt: distanceFt(vertex, targetEndpoint),
        connectedTo: [wingRidge.id]
      });
      hipIdx++;
    }
  }
  
  // Create valleys from reflex corners to junction points
  let valleyIdx = 0;
  reflexIndices.forEach(idx => {
    const vertex = vertices[idx];
    
    let target: GPSCoord;
    if (junctionPoints.length > 0) {
      target = junctionPoints.reduce((nearest, jp) => 
        distance(vertex, jp) < distance(vertex, nearest) ? jp : nearest
      , junctionPoints[0]);
    } else {
      const nearest = findNearestRidgeEndpoint(vertex, ridges);
      target = nearest.point;
    }
    
    valleys.push({
      id: `valley_${valleyIdx}`,
      start: vertex,
      end: target,
      lengthFt: distanceFt(vertex, target),
      connectedTo: []
    });
    valleyIdx++;
  });
  
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
    diagramQuality: 'good',
    warnings
  };
}

/**
 * Simplified reconstruction for complex roofs
 */
function reconstructComplexRoof(
  vertices: GPSCoord[],
  reflexIndices: Set<number>,
  pitch: string
): ReconstructedRoof {
  const bounds = getBounds(vertices);
  const centroid = getCentroid(vertices);
  const width = bounds.maxLng - bounds.minLng;
  const height = bounds.maxLat - bounds.minLat;
  const isWider = width >= height;
  const inset = (isWider ? width : height) * 0.25;
  
  // Single ridge through center
  let ridgeStart: GPSCoord, ridgeEnd: GPSCoord;
  if (isWider) {
    ridgeStart = { lat: centroid.lat, lng: bounds.minLng + inset };
    ridgeEnd = { lat: centroid.lat, lng: bounds.maxLng - inset };
  } else {
    ridgeStart = { lat: bounds.minLat + inset, lng: centroid.lng };
    ridgeEnd = { lat: bounds.maxLat - inset, lng: centroid.lng };
  }
  
  const ridges: RoofLine[] = [{
    id: 'ridge_0',
    start: ridgeStart,
    end: ridgeEnd,
    lengthFt: distanceFt(ridgeStart, ridgeEnd),
    connectedTo: []
  }];
  
  const hips: RoofLine[] = [];
  const valleys: RoofLine[] = [];
  
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
    warnings: ['Complex roof - using simplified geometry']
  };
}

// ===== Utility Functions =====

function findReflexVertices(vertices: GPSCoord[]): Set<number> {
  const reflex = new Set<number>();
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    
    const ax = prev.lng - curr.lng;
    const ay = prev.lat - curr.lat;
    const bx = next.lng - curr.lng;
    const by = next.lat - curr.lat;
    const cross = ax * by - ay * bx;
    
    if (cross < 0) {
      reflex.add(i);
    }
  }
  
  return reflex;
}

function detectShape(vertices: GPSCoord[], reflexIndices: Set<number>): string {
  const n = vertices.length;
  const reflexCount = reflexIndices.size;
  
  if (n === 4 && reflexCount === 0) {
    return 'rectangle';
  }
  
  // L-shape: 6-8 vertices, 1 reflex
  if (n >= 6 && n <= 8 && reflexCount === 1) return 'L-shape';
  
  // T-shape: 8-10 vertices, 2 reflex
  if (n >= 6 && n <= 10 && reflexCount === 2) return 'T-shape';
  
  // U-shape: 8-12 vertices, 3-4 reflex
  if (n >= 8 && n <= 12 && reflexCount >= 3 && reflexCount <= 4) return 'U-shape';
  
  // H-shape: 10-16 vertices, 4+ reflex  
  if (n >= 10 && n <= 16 && reflexCount >= 4) return 'H-shape';
  
  // Multi-wing complex: 12-24 vertices, many reflex vertices
  if (n >= 12 && n <= 24 && reflexCount >= 5) return 'multi-wing';
  
  return 'complex';
}

function detectWings(vertices: GPSCoord[], reflexIndices: Set<number>): GPSCoord[][] {
  const wings: GPSCoord[][] = [];
  const n = vertices.length;
  
  if (reflexIndices.size === 0) {
    return [vertices];
  }
  
  const reflexArray = Array.from(reflexIndices).sort((a, b) => a - b);
  
  for (let r = 0; r < reflexArray.length; r++) {
    const start = reflexArray[r];
    const end = reflexArray[(r + 1) % reflexArray.length];
    
    const wingVertices: GPSCoord[] = [];
    let current = start;
    
    for (let safety = 0; safety <= n; safety++) {
      wingVertices.push(vertices[current]);
      if (current === end) break;
      current = (current + 1) % n;
    }
    
    if (wingVertices.length >= 3) {
      wings.push(wingVertices);
    }
  }
  
  return wings;
}

function createRectangularFacets(
  corners: GPSCoord[],
  ridgeStart: GPSCoord,
  ridgeEnd: GPSCoord,
  pitch: string
): ReconstructedFacet[] {
  const facets: ReconstructedFacet[] = [];
  
  if (corners.length >= 4) {
    // Facet 0: Front
    facets.push({
      id: 'facet_0',
      index: 0,
      polygon: [corners[0], corners[3], ridgeStart, corners[0]],
      areaSqft: 0,
      pitch,
      azimuthDegrees: 270,
      direction: 'W',
      color: FACET_COLORS[0]
    });
    
    // Facet 1: Back
    facets.push({
      id: 'facet_1',
      index: 1,
      polygon: [corners[1], ridgeEnd, corners[2], corners[1]],
      areaSqft: 0,
      pitch,
      azimuthDegrees: 90,
      direction: 'E',
      color: FACET_COLORS[1]
    });
    
    // Facet 2: South
    facets.push({
      id: 'facet_2',
      index: 2,
      polygon: [corners[0], ridgeStart, ridgeEnd, corners[1], corners[0]],
      areaSqft: 0,
      pitch,
      azimuthDegrees: 180,
      direction: 'S',
      color: FACET_COLORS[2]
    });
    
    // Facet 3: North
    facets.push({
      id: 'facet_3',
      index: 3,
      polygon: [corners[3], corners[2], ridgeEnd, ridgeStart, corners[3]],
      areaSqft: 0,
      pitch,
      azimuthDegrees: 0,
      direction: 'N',
      color: FACET_COLORS[3]
    });
  }
  
  return facets;
}

function findNearestRidgeEndpoint(point: GPSCoord, ridges: RoofLine[]): { point: GPSCoord; ridgeId: string } {
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

function getBounds(vertices: GPSCoord[]): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const lats = vertices.map(v => v.lat);
  const lngs = vertices.map(v => v.lng);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs)
  };
}

function getCentroid(vertices: GPSCoord[]): GPSCoord {
  const n = vertices.length;
  const sumLat = vertices.reduce((s, v) => s + v.lat, 0);
  const sumLng = vertices.reduce((s, v) => s + v.lng, 0);
  return { lat: sumLat / n, lng: sumLng / n };
}

function distance(a: GPSCoord, b: GPSCoord): number {
  return Math.sqrt((b.lng - a.lng) ** 2 + (b.lat - a.lat) ** 2);
}

function distanceFt(a: GPSCoord, b: GPSCoord): number {
  const midLat = (a.lat + b.lat) / 2;
  const ftPerDegLat = 364000;
  const ftPerDegLng = 364000 * Math.cos(midLat * Math.PI / 180);
  
  const dx = (b.lng - a.lng) * ftPerDegLng;
  const dy = (b.lat - a.lat) * ftPerDegLat;
  
  return Math.sqrt(dx * dx + dy * dy);
}

function calculatePolygonAreaSqft(vertices: GPSCoord[]): number {
  if (vertices.length < 3) return 0;
  
  const midLat = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  
  let area = 0;
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = vertices[i].lng * metersPerDegLng;
    const yi = vertices[i].lat * metersPerDegLat;
    const xj = vertices[j].lng * metersPerDegLng;
    const yj = vertices[j].lat * metersPerDegLat;
    
    area += xi * yj - xj * yi;
  }
  
  const sqMeters = Math.abs(area) / 2;
  return sqMeters * 10.764;
}

export type { GPSCoord, ReconstructedRoof, RoofLine, ReconstructedFacet };
