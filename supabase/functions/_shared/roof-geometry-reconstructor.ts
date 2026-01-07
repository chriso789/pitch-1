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
 * Check if Solar segments indicate a cross-hip roof (4 cardinal directions)
 */
function detectCrossHipFromSegments(solarSegments: SolarSegmentInfo[]): boolean {
  if (!solarSegments || solarSegments.length < 4) return false;
  
  // Group segments by cardinal direction
  const cardinalCounts = { N: 0, S: 0, E: 0, W: 0 };
  
  solarSegments.forEach(seg => {
    const azimuth = seg.azimuthDegrees ?? 0;
    const normalized = ((azimuth % 360) + 360) % 360;
    
    if (normalized >= 315 || normalized < 45) cardinalCounts.N++;
    else if (normalized >= 45 && normalized < 135) cardinalCounts.E++;
    else if (normalized >= 135 && normalized < 225) cardinalCounts.S++;
    else cardinalCounts.W++;
  });
  
  // Cross-hip = at least one segment facing each cardinal direction
  const hasFourDirections = cardinalCounts.N > 0 && cardinalCounts.S > 0 && 
                            cardinalCounts.E > 0 && cardinalCounts.W > 0;
  
  console.log(`🔍 Cross-hip detection: N=${cardinalCounts.N} S=${cardinalCounts.S} E=${cardinalCounts.E} W=${cardinalCounts.W} → ${hasFourDirections ? 'CROSS-HIP' : 'standard'}`);
  
  return hasFourDirections;
}

/**
 * Reconstruct a cross-hip roof (TWO perpendicular ridges meeting at center)
 * Creates: 2 ridges (E-W and N-S), 4 hips from corners to center junction, 4 triangular facets
 */
function reconstructCrossHipRoof(
  vertices: XY[],
  solarSegments: SolarSegmentInfo[],
  pitch: string
): ReconstructedRoof {
  const bounds = getBounds(vertices);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const center: XY = [centerX, centerY];
  
  // Calculate ridge insets (40% of respective dimension)
  const insetX = width * 0.4;
  const insetY = height * 0.4;
  
  // E-W ridge (horizontal)
  const ridgeEW_start: XY = [bounds.minX + insetX, centerY];
  const ridgeEW_end: XY = [bounds.maxX - insetX, centerY];
  
  // N-S ridge (vertical)
  const ridgeNS_start: XY = [centerX, bounds.minY + insetY];
  const ridgeNS_end: XY = [centerX, bounds.maxY - insetY];
  
  console.log(`🏠 Cross-hip roof: center junction at [${centerX.toFixed(6)}, ${centerY.toFixed(6)}]`);
  
  // Create two ridges
  const ridges: RoofLine[] = [
    {
      id: 'ridge_ew',
      start: ridgeEW_start,
      end: ridgeEW_end,
      lengthFt: distanceFt(ridgeEW_start, ridgeEW_end),
      connectedTo: ['ridge_ns', 'hip_0', 'hip_1', 'hip_2', 'hip_3']
    },
    {
      id: 'ridge_ns',
      start: ridgeNS_start,
      end: ridgeNS_end,
      lengthFt: distanceFt(ridgeNS_start, ridgeNS_end),
      connectedTo: ['ridge_ew', 'hip_0', 'hip_1', 'hip_2', 'hip_3']
    }
  ];
  
  // Find corner vertices (SW, SE, NE, NW)
  const corners = identifyCorners(vertices);
  const sw = corners.reduce((best, v) => (v[1] + v[0] < best[1] + best[0]) ? v : best, corners[0]);
  const ne = corners.reduce((best, v) => (v[1] + v[0] > best[1] + best[0]) ? v : best, corners[0]);
  const se = corners.reduce((best, v) => (v[0] - v[1] > best[0] - best[1]) ? v : best, corners[0]);
  const nw = corners.reduce((best, v) => (v[1] - v[0] > best[1] - best[0]) ? v : best, corners[0]);
  
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
      areaSqft: calculateTriangleArea(sw, se, center),
      pitch,
      azimuthDegrees: 180,
      direction: 'S',
      color: FACET_COLORS[0]
    },
    {
      id: 'facet_east',
      index: 1,
      polygon: [se, ne, center, se],
      areaSqft: calculateTriangleArea(se, ne, center),
      pitch,
      azimuthDegrees: 90,
      direction: 'E',
      color: FACET_COLORS[1]
    },
    {
      id: 'facet_north',
      index: 2,
      polygon: [ne, nw, center, ne],
      areaSqft: calculateTriangleArea(ne, nw, center),
      pitch,
      azimuthDegrees: 0,
      direction: 'N',
      color: FACET_COLORS[2]
    },
    {
      id: 'facet_west',
      index: 3,
      polygon: [nw, sw, center, nw],
      areaSqft: calculateTriangleArea(nw, sw, center),
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

// Helper to calculate triangle area
function calculateTriangleArea(a: XY, b: XY, c: XY): number {
  const dx1 = b[0] - a[0], dy1 = b[1] - a[1];
  const dx2 = c[0] - a[0], dy2 = c[1] - a[1];
  const crossProduct = Math.abs(dx1 * dy2 - dx2 * dy1) / 2;
  // Rough conversion: 1 degree ≈ 364,000 ft at equator, adjust for latitude
  const ftPerDeg = 364000;
  return crossProduct * ftPerDeg * ftPerDeg;
}

/**
 * Reconstruct a simple rectangular roof (hip roof)
 * Creates: 1 ridge, 4 hips, 4 facets
 * 
 * NOW: Detects cross-hip roofs (4 cardinal-facing segments) and generates two perpendicular ridges
 */
function reconstructRectangularRoof(
  vertices: XY[],
  solarSegments: SolarSegmentInfo[],
  pitch: string
): ReconstructedRoof {
  // Check for cross-hip roof (two perpendicular ridges meeting at center)
  if (detectCrossHipFromSegments(solarSegments)) {
    return reconstructCrossHipRoof(vertices, solarSegments, pitch);
  }
  
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
  
  const n = vertices.length;
  const reflexArray = Array.from(reflexIndices).sort((a, b) => a - b);
  
  // If too many reflex vertices (>2), use simplified approach to avoid starburst
  // Lowered from >4 to >2 to catch L/T/U shapes that still produce starburst patterns
  if (reflexArray.length > 2) {
    console.log(`  ⚠️ ${reflexArray.length} reflex vertices - using perimeter-only mode to avoid starburst`);
    warnings.push('Complex roof with multiple reflex corners - showing perimeter only');
    
    // Only create eave lines along the perimeter, no interior lines
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
      warnings
    };
  }
  
  // Detect building wings using improved algorithm
  const wings = detectWingsImproved(vertices, reflexIndices);
  
  if (wings.length < 2) {
    warnings.push('Could not detect multiple wings, using simplified approach');
    return reconstructComplexRoof(vertices, reflexIndices, solarSegments, pitch);
  }
  
  console.log(`  Detected ${wings.length} wings for ${shapeType}`);
  
  // Create ridge for each wing - INSET from wing bounds, not overall bounds
  const wingRidgeEndpoints: XY[][] = []; // Store [start, end] for each wing
  
  wings.forEach((wing, wingIdx) => {
    const bounds = getBounds(wing.vertices);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const isWider = width >= height;
    
    // Use proportional inset based on wing size (not a fixed percentage)
    const shortSide = isWider ? height : width;
    const inset = shortSide * 0.4;
    
    let ridgeStart: XY, ridgeEnd: XY;
    if (isWider) {
      ridgeStart = [bounds.minX + inset, (bounds.minY + bounds.maxY) / 2];
      ridgeEnd = [bounds.maxX - inset, (bounds.minY + bounds.maxY) / 2];
    } else {
      ridgeStart = [(bounds.minX + bounds.maxX) / 2, bounds.minY + inset];
      ridgeEnd = [(bounds.minX + bounds.maxX) / 2, bounds.maxY - inset];
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
  // These are the points where valleys terminate
  const junctionPoints: XY[] = [];
  
  // For each pair of adjacent wings, find where their ridges should meet
  for (let i = 0; i < wings.length; i++) {
    for (let j = i + 1; j < wings.length; j++) {
      const [startI, endI] = wingRidgeEndpoints[i];
      const [startJ, endJ] = wingRidgeEndpoints[j];
      
      // Find closest pair of endpoints between the two ridges
      const pairs = [
        { p1: endI, p2: startJ, dist: distance(endI, startJ) },
        { p1: startI, p2: endJ, dist: distance(startI, endJ) },
        { p1: endI, p2: endJ, dist: distance(endI, endJ) },
        { p1: startI, p2: startJ, dist: distance(startI, startJ) },
      ];
      
      const closest = pairs.sort((a, b) => a.dist - b.dist)[0];
      
      // If ridges are close, create a junction point at their midpoint
      if (closest.dist < 0.001) { // Within ~300 feet
        const junction: XY = [
          (closest.p1[0] + closest.p2[0]) / 2,
          (closest.p1[1] + closest.p2[1]) / 2
        ];
        junctionPoints.push(junction);
        
        // Connect ridges to junction
        ridges.push({
          id: `ridge_connector_${i}_${j}`,
          start: closest.p1,
          end: junction,
          lengthFt: distanceFt(closest.p1, junction),
          connectedTo: [`ridge_${i}`]
        });
        
        if (closest.dist > 0.00001) {
          ridges.push({
            id: `ridge_connector_${j}_${i}`,
            start: junction,
            end: closest.p2,
            lengthFt: distanceFt(junction, closest.p2),
            connectedTo: [`ridge_${j}`]
          });
        }
      }
    }
  }
  
  // Create hips from NON-reflex corners to their wing's ridge endpoints
  // NOT to the nearest endpoint globally (which causes starburst)
  let hipIdx = 0;
  for (let i = 0; i < n; i++) {
    if (reflexIndices.has(i)) continue;
    
    const vertex = vertices[i];
    
    // Find which wing this corner belongs to
    let bestWingIdx = 0;
    let bestDist = Infinity;
    
    wings.forEach((wing, wIdx) => {
      const wingBounds = getBounds(wing.vertices);
      // Check if vertex is within or near this wing's bounds
      const withinX = vertex[0] >= wingBounds.minX - 0.0001 && vertex[0] <= wingBounds.maxX + 0.0001;
      const withinY = vertex[1] >= wingBounds.minY - 0.0001 && vertex[1] <= wingBounds.maxY + 0.0001;
      
      if (withinX && withinY) {
        const dist = distanceToWing(vertex, wing.vertices);
        if (dist < bestDist) {
          bestDist = dist;
          bestWingIdx = wIdx;
        }
      }
    });
    
    // Connect to the nearest endpoint of THIS wing's ridge only
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
  
  // Create valleys from reflex corners to JUNCTION POINTS (not ridge endpoints)
  let valleyIdx = 0;
  reflexIndices.forEach(idx => {
    const vertex = vertices[idx];
    
    // Find nearest junction point, or if no junctions, use nearest ridge endpoint
    let target: XY;
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
  
  // Create single facet covering entire roof
  facets.push({
    id: 'facet_0',
    index: 0,
    polygon: [...vertices, vertices[0]],
    areaSqft: calculatePolygonAreaSqft(vertices),
    pitch,
    azimuthDegrees: 0,
    direction: 'Mixed',
    color: FACET_COLORS[0]
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

// Improved wing detection that handles L/T/U shapes better
function detectWingsImproved(vertices: XY[], reflexIndices: Set<number>): Wing[] {
  const wings: Wing[] = [];
  const n = vertices.length;
  
  if (reflexIndices.size === 0) {
    return [{ vertices, indices: Array.from({ length: n }, (_, i) => i) }];
  }
  
  const reflexArray = Array.from(reflexIndices).sort((a, b) => a - b);
  
  // For L-shape (1 reflex): create 2 wings
  // For T-shape (2 reflex): create 2-3 wings
  // For U-shape (3-4 reflex): create 2-3 wings
  
  // Group consecutive non-reflex vertices into wings
  let currentWing: number[] = [];
  let wingStart = -1;
  
  for (let i = 0; i < n; i++) {
    if (reflexIndices.has(i)) {
      // End current wing if it exists
      if (currentWing.length >= 2) {
        wings.push({
          vertices: currentWing.map(idx => vertices[idx]),
          indices: [...currentWing]
        });
      }
      currentWing = [i]; // Start new wing with reflex vertex
      wingStart = i;
    } else {
      currentWing.push(i);
    }
  }
  
  // Handle wrap-around (connect last wing to first if needed)
  if (currentWing.length >= 2) {
    // Check if first vertex was reflex
    if (reflexIndices.has(0) && wings.length > 0) {
      // Merge with first wing
      wings[0].indices = [...currentWing, ...wings[0].indices];
      wings[0].vertices = wings[0].indices.map(idx => vertices[idx]);
    } else {
      wings.push({
        vertices: currentWing.map(idx => vertices[idx]),
        indices: [...currentWing]
      });
    }
  }
  
  // Merge small wings (< 3 vertices) with adjacent wings
  const validWings = wings.filter(w => w.vertices.length >= 3);
  
  return validWings.length > 0 ? validWings : [{ vertices, indices: Array.from({ length: n }, (_, i) => i) }];
}

// Calculate minimum distance from a point to any vertex in a wing
function distanceToWing(point: XY, wingVertices: XY[]): number {
  return Math.min(...wingVertices.map(v => distance(point, v)));
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
