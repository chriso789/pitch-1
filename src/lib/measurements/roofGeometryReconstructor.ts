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
 * Check if this looks like a cross-hip roof based on aspect ratio
 * A cross-hip roof typically has a nearly square footprint (aspect ratio close to 1)
 */
function detectCrossHipFromAspectRatio(vertices: GPSCoord[]): boolean {
  const bounds = getBounds(vertices);
  const width = bounds.maxLng - bounds.minLng;
  const height = bounds.maxLat - bounds.minLat;
  
  // Aspect ratio close to 1.0 suggests cross-hip
  const aspectRatio = Math.max(width, height) / Math.min(width, height);
  const isCrossHip = aspectRatio < 1.3; // Within 30% of square
  
  console.log(`🔍 Cross-hip detection (client): aspect ratio ${aspectRatio.toFixed(2)} → ${isCrossHip ? 'CROSS-HIP' : 'standard'}`);
  
  return isCrossHip;
}

/**
 * Reconstruct a cross-hip roof with TWO perpendicular ridges meeting at center
 * Creates: 2 ridges (E-W and N-S), 4 hips from corners to center junction, 4 triangular facets
 */
function reconstructCrossHipRoof(vertices: GPSCoord[], pitch: string): ReconstructedRoof {
  const bounds = getBounds(vertices);
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;
  const center: GPSCoord = { lat: centerLat, lng: centerLng };
  
  const width = bounds.maxLng - bounds.minLng;
  const height = bounds.maxLat - bounds.minLat;
  
  // Calculate ridge insets (40% of respective dimension)
  const insetLng = width * 0.4;
  const insetLat = height * 0.4;
  
  // E-W ridge (horizontal)
  const ridgeEW_start: GPSCoord = { lat: centerLat, lng: bounds.minLng + insetLng };
  const ridgeEW_end: GPSCoord = { lat: centerLat, lng: bounds.maxLng - insetLng };
  
  // N-S ridge (vertical)
  const ridgeNS_start: GPSCoord = { lat: bounds.minLat + insetLat, lng: centerLng };
  const ridgeNS_end: GPSCoord = { lat: bounds.maxLat - insetLat, lng: centerLng };
  
  console.log(`🏠 Cross-hip roof (client): center junction at [${centerLat.toFixed(6)}, ${centerLng.toFixed(6)}]`);
  
  // Create two perpendicular ridges
  const ridges: RoofLine[] = [
    {
      id: 'ridge_ew',
      start: ridgeEW_start,
      end: ridgeEW_end,
      lengthFt: distanceFt(ridgeEW_start, ridgeEW_end),
      connectedTo: ['ridge_ns', 'hip_sw', 'hip_se', 'hip_ne', 'hip_nw']
    },
    {
      id: 'ridge_ns',
      start: ridgeNS_start,
      end: ridgeNS_end,
      lengthFt: distanceFt(ridgeNS_start, ridgeNS_end),
      connectedTo: ['ridge_ew', 'hip_sw', 'hip_se', 'hip_ne', 'hip_nw']
    }
  ];
  
  // Find corner vertices (SW, SE, NE, NW)
  const sw = vertices.reduce((best, v) => 
    (v.lat + v.lng < best.lat + best.lng) ? v : best, vertices[0]);
  const ne = vertices.reduce((best, v) => 
    (v.lat + v.lng > best.lat + best.lng) ? v : best, vertices[0]);
  const se = vertices.reduce((best, v) => 
    (v.lng - v.lat > best.lng - best.lat) ? v : best, vertices[0]);
  const nw = vertices.reduce((best, v) => 
    (v.lat - v.lng > best.lat - best.lng) ? v : best, vertices[0]);
  
  // Create 4 hips from corners to CENTER (where ridges intersect)
  const hips: RoofLine[] = [
    { id: 'hip_sw', start: sw, end: center, lengthFt: distanceFt(sw, center), connectedTo: ['ridge_ew', 'ridge_ns'] },
    { id: 'hip_se', start: se, end: center, lengthFt: distanceFt(se, center), connectedTo: ['ridge_ew', 'ridge_ns'] },
    { id: 'hip_ne', start: ne, end: center, lengthFt: distanceFt(ne, center), connectedTo: ['ridge_ew', 'ridge_ns'] },
    { id: 'hip_nw', start: nw, end: center, lengthFt: distanceFt(nw, center), connectedTo: ['ridge_ew', 'ridge_ns'] }
  ];
  
  // Create 4 triangular facets (one per cardinal direction)
  const facets: ReconstructedFacet[] = [
    {
      id: 'facet_south',
      index: 0,
      polygon: [sw, se, center, sw],
      areaSqft: calculateTriangleAreaGPS(sw, se, center),
      pitch,
      azimuthDegrees: 180,
      direction: 'S',
      color: FACET_COLORS[0]
    },
    {
      id: 'facet_east',
      index: 1,
      polygon: [se, ne, center, se],
      areaSqft: calculateTriangleAreaGPS(se, ne, center),
      pitch,
      azimuthDegrees: 90,
      direction: 'E',
      color: FACET_COLORS[1]
    },
    {
      id: 'facet_north',
      index: 2,
      polygon: [ne, nw, center, ne],
      areaSqft: calculateTriangleAreaGPS(ne, nw, center),
      pitch,
      azimuthDegrees: 0,
      direction: 'N',
      color: FACET_COLORS[2]
    },
    {
      id: 'facet_west',
      index: 3,
      polygon: [nw, sw, center, nw],
      areaSqft: calculateTriangleAreaGPS(nw, sw, center),
      pitch,
      azimuthDegrees: 270,
      direction: 'W',
      color: FACET_COLORS[3]
    }
  ];
  
  return {
    ridges,
    hips,
    valleys: [],
    facets,
    diagramQuality: 'excellent',
    warnings: []
  };
}

// Helper to calculate triangle area from GPS coords
function calculateTriangleAreaGPS(a: GPSCoord, b: GPSCoord, c: GPSCoord): number {
  const dx1 = b.lng - a.lng, dy1 = b.lat - a.lat;
  const dx2 = c.lng - a.lng, dy2 = c.lat - a.lat;
  const crossProduct = Math.abs(dx1 * dy2 - dx2 * dy1) / 2;
  // Rough conversion: 1 degree ≈ 364,000 ft at equator
  const ftPerDeg = 364000;
  return crossProduct * ftPerDeg * ftPerDeg;
}

/**
 * Reconstruct a rectangular (hip) roof
 * 
 * Proper geometry: perimeter first, then ridge as spine, hips connect corners to ridge endpoints.
 * For a horizontal ridge (wider building):
 *   - Ridge runs E-W through center
 *   - SW & NW corners connect to ridgeStart (west endpoint)
 *   - SE & NE corners connect to ridgeEnd (east endpoint)
 *   - West & East facets are triangular gables
 *   - North & South facets are trapezoidal slopes
 * 
 * NOW: Detects cross-hip roofs (nearly square footprint) and generates two perpendicular ridges
 */
function reconstructRectangularRoof(vertices: GPSCoord[], pitch: string): ReconstructedRoof {
  // Check for cross-hip roof (two perpendicular ridges meeting at center)
  if (detectCrossHipFromAspectRatio(vertices)) {
    return reconstructCrossHipRoof(vertices, pitch);
  }
  
  const bounds = getBounds(vertices);
  const width = bounds.maxLng - bounds.minLng;
  const height = bounds.maxLat - bounds.minLat;
  const isWider = width >= height;
  
  // Identify corners by their actual position (SW, SE, NE, NW)
  const sw = vertices.reduce((best, v) => 
    (v.lat + v.lng < best.lat + best.lng) ? v : best, vertices[0]);
  const ne = vertices.reduce((best, v) => 
    (v.lat + v.lng > best.lat + best.lng) ? v : best, vertices[0]);
  const se = vertices.reduce((best, v) => 
    (v.lng - v.lat > best.lng - best.lat) ? v : best, vertices[0]);
  const nw = vertices.reduce((best, v) => 
    (v.lat - v.lng > best.lat - best.lng) ? v : best, vertices[0]);
  
  // Calculate ridge endpoints (inset from short sides)
  const inset = (isWider ? height : width) * 0.4;
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;
  
  let ridgeStart: GPSCoord, ridgeEnd: GPSCoord;
  if (isWider) {
    // Horizontal ridge (E-W): ridgeStart is west, ridgeEnd is east
    ridgeStart = { lat: centerLat, lng: bounds.minLng + inset };
    ridgeEnd = { lat: centerLat, lng: bounds.maxLng - inset };
  } else {
    // Vertical ridge (N-S): ridgeStart is south, ridgeEnd is north
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
  
  // Create 4 hips: connect corners to CORRECT ridge endpoints based on orientation
  const hips: RoofLine[] = [];
  
  if (isWider) {
    // Horizontal ridge: west corners → ridgeStart, east corners → ridgeEnd
    // Hip 0: SW → ridgeStart (west)
    hips.push({
      id: 'hip_0',
      start: sw,
      end: ridgeStart,
      lengthFt: distanceFt(sw, ridgeStart),
      connectedTo: ['ridge_0']
    });
    // Hip 1: NW → ridgeStart (west)
    hips.push({
      id: 'hip_1',
      start: nw,
      end: ridgeStart,
      lengthFt: distanceFt(nw, ridgeStart),
      connectedTo: ['ridge_0']
    });
    // Hip 2: SE → ridgeEnd (east)
    hips.push({
      id: 'hip_2',
      start: se,
      end: ridgeEnd,
      lengthFt: distanceFt(se, ridgeEnd),
      connectedTo: ['ridge_0']
    });
    // Hip 3: NE → ridgeEnd (east)
    hips.push({
      id: 'hip_3',
      start: ne,
      end: ridgeEnd,
      lengthFt: distanceFt(ne, ridgeEnd),
      connectedTo: ['ridge_0']
    });
  } else {
    // Vertical ridge: south corners → ridgeStart, north corners → ridgeEnd
    // Hip 0: SW → ridgeStart (south)
    hips.push({
      id: 'hip_0',
      start: sw,
      end: ridgeStart,
      lengthFt: distanceFt(sw, ridgeStart),
      connectedTo: ['ridge_0']
    });
    // Hip 1: SE → ridgeStart (south)
    hips.push({
      id: 'hip_1',
      start: se,
      end: ridgeStart,
      lengthFt: distanceFt(se, ridgeStart),
      connectedTo: ['ridge_0']
    });
    // Hip 2: NW → ridgeEnd (north)
    hips.push({
      id: 'hip_2',
      start: nw,
      end: ridgeEnd,
      lengthFt: distanceFt(nw, ridgeEnd),
      connectedTo: ['ridge_0']
    });
    // Hip 3: NE → ridgeEnd (north)
    hips.push({
      id: 'hip_3',
      start: ne,
      end: ridgeEnd,
      lengthFt: distanceFt(ne, ridgeEnd),
      connectedTo: ['ridge_0']
    });
  }
  
  // Create 4 facets with proper polygon shapes
  const facets = createRectangularFacets(sw, se, ne, nw, ridgeStart, ridgeEnd, pitch, isWider);
  
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

/**
 * Create 4 facets for a rectangular hip roof:
 * - 2 triangular gable-end facets (on the short sides)
 * - 2 trapezoidal slope facets (on the long sides)
 * 
 * For horizontal ridge (isWider=true):
 *   - West facet (triangle): SW → NW → ridgeStart
 *   - East facet (triangle): SE → ridgeEnd → NE
 *   - South facet (trapezoid): SW → ridgeStart → ridgeEnd → SE
 *   - North facet (trapezoid): NW → NE → ridgeEnd → ridgeStart
 */
function createRectangularFacets(
  sw: GPSCoord,
  se: GPSCoord,
  ne: GPSCoord,
  nw: GPSCoord,
  ridgeStart: GPSCoord,
  ridgeEnd: GPSCoord,
  pitch: string,
  isWider: boolean
): ReconstructedFacet[] {
  const facets: ReconstructedFacet[] = [];
  
  if (isWider) {
    // Horizontal ridge (E-W)
    
    // West gable (triangle): SW → NW → ridgeStart → SW
    facets.push({
      id: 'facet_0',
      index: 0,
      polygon: [sw, nw, ridgeStart, sw],
      areaSqft: 0,
      pitch,
      azimuthDegrees: 270,
      direction: 'W',
      color: FACET_COLORS[0]
    });
    
    // East gable (triangle): SE → ridgeEnd → NE → SE
    facets.push({
      id: 'facet_1',
      index: 1,
      polygon: [se, ridgeEnd, ne, se],
      areaSqft: 0,
      pitch,
      azimuthDegrees: 90,
      direction: 'E',
      color: FACET_COLORS[1]
    });
    
    // South slope (trapezoid): SW → ridgeStart → ridgeEnd → SE → SW
    facets.push({
      id: 'facet_2',
      index: 2,
      polygon: [sw, ridgeStart, ridgeEnd, se, sw],
      areaSqft: 0,
      pitch,
      azimuthDegrees: 180,
      direction: 'S',
      color: FACET_COLORS[2]
    });
    
    // North slope (trapezoid): NW → NE → ridgeEnd → ridgeStart → NW
    facets.push({
      id: 'facet_3',
      index: 3,
      polygon: [nw, ne, ridgeEnd, ridgeStart, nw],
      areaSqft: 0,
      pitch,
      azimuthDegrees: 0,
      direction: 'N',
      color: FACET_COLORS[3]
    });
  } else {
    // Vertical ridge (N-S)
    
    // South gable (triangle): SW → SE → ridgeStart → SW
    facets.push({
      id: 'facet_0',
      index: 0,
      polygon: [sw, se, ridgeStart, sw],
      areaSqft: 0,
      pitch,
      azimuthDegrees: 180,
      direction: 'S',
      color: FACET_COLORS[0]
    });
    
    // North gable (triangle): NW → ridgeEnd → NE → NW
    facets.push({
      id: 'facet_1',
      index: 1,
      polygon: [nw, ridgeEnd, ne, nw],
      areaSqft: 0,
      pitch,
      azimuthDegrees: 0,
      direction: 'N',
      color: FACET_COLORS[1]
    });
    
    // West slope (trapezoid): SW → ridgeStart → ridgeEnd → NW → SW
    facets.push({
      id: 'facet_2',
      index: 2,
      polygon: [sw, ridgeStart, ridgeEnd, nw, sw],
      areaSqft: 0,
      pitch,
      azimuthDegrees: 270,
      direction: 'W',
      color: FACET_COLORS[2]
    });
    
    // East slope (trapezoid): SE → NE → ridgeEnd → ridgeStart → SE
    facets.push({
      id: 'facet_3',
      index: 3,
      polygon: [se, ne, ridgeEnd, ridgeStart, se],
      areaSqft: 0,
      pitch,
      azimuthDegrees: 90,
      direction: 'E',
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
