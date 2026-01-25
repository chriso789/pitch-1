/**
 * Complex Footprint Decomposer
 * 
 * Decomposes L-shaped, T-shaped, and U-shaped building footprints into 
 * rectangular sections, enabling multi-ridge generation for accurate roof geometry.
 * 
 * Key capabilities:
 * - Detect reflex (concave) vertices that indicate building wings
 * - Split complex perimeters into main section + extensions
 * - Determine ridge direction per section based on aspect ratio
 * - Identify valley origins at junction points (reflex corners)
 */

type XY = [number, number]; // [lng, lat]

export interface BuildingSection {
  vertices: XY[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  ridgeDirection: 'east-west' | 'north-south';
  areaSqft: number;
  isMain: boolean;
  attachmentSide?: 'N' | 'S' | 'E' | 'W';
}

export interface DecomposedFootprint {
  type: 'rectangular' | 'L-shaped' | 'T-shaped' | 'U-shaped' | 'complex';
  mainSection: BuildingSection;
  extensions: BuildingSection[];
  reflexCorners: XY[];
  valleyOrigins: XY[];
  ridgeJunctions: XY[];
  totalRidgeCount: number;
}

export interface MultiRidgeGeometry {
  ridges: Array<{ id: string; start: XY; end: XY; lengthFt: number; sectionIndex: number }>;
  valleys: Array<{ id: string; start: XY; end: XY; lengthFt: number }>;
  hips: Array<{ id: string; start: XY; end: XY; lengthFt: number; sectionIndex: number }>;
}

/**
 * Decompose complex footprint into rectangular sections
 */
export function decomposeComplexFootprint(perimeter: XY[]): DecomposedFootprint {
  // Ensure closed ring
  const vertices = normalizeRing(perimeter);
  const n = vertices.length;
  
  // Find reflex (concave) vertices - these mark where wings attach
  const reflexCorners: XY[] = [];
  const reflexIndices: number[] = [];
  
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    
    const cross = (next[0] - curr[0]) * (prev[1] - curr[1]) - 
                  (next[1] - curr[1]) * (prev[0] - curr[0]);
    
    if (cross < 0) {
      reflexCorners.push(curr);
      reflexIndices.push(i);
    }
  }
  
  const bounds = getBounds(vertices);
  const footprintType = classifyFootprintShape(vertices, reflexCorners.length);
  
  console.log(`📐 Footprint decomposition: ${footprintType}, ${reflexCorners.length} reflex corners, ${n} vertices`);
  
  // For simple rectangular footprints
  if (footprintType === 'rectangular' || reflexCorners.length === 0) {
    const mainSection = createSection(vertices, bounds, true);
    return {
      type: 'rectangular',
      mainSection,
      extensions: [],
      reflexCorners: [],
      valleyOrigins: [],
      ridgeJunctions: [],
      totalRidgeCount: 1
    };
  }
  
  // For L-shaped footprints (1 reflex corner)
  if (footprintType === 'L-shaped' && reflexCorners.length === 1) {
    const decomposed = decomposeLShape(vertices, reflexIndices[0], bounds);
    return {
      type: 'L-shaped',
      ...decomposed,
      reflexCorners,
      totalRidgeCount: 2
    };
  }
  
  // For T-shaped footprints (2 reflex corners)
  if (footprintType === 'T-shaped' && reflexCorners.length === 2) {
    const decomposed = decomposeTShape(vertices, reflexIndices, bounds);
    return {
      type: 'T-shaped',
      ...decomposed,
      reflexCorners,
      totalRidgeCount: 2
    };
  }
  
  // For U-shaped footprints (2 reflex corners on same side)
  if (footprintType === 'U-shaped' && reflexCorners.length === 2) {
    const decomposed = decomposeUShape(vertices, reflexIndices, bounds);
    return {
      type: 'U-shaped',
      ...decomposed,
      reflexCorners,
      totalRidgeCount: 3
    };
  }
  
  // Complex fallback: treat as main section with valley origins at reflex corners
  const mainSection = createSection(vertices, bounds, true);
  return {
    type: 'complex',
    mainSection,
    extensions: [],
    reflexCorners,
    valleyOrigins: reflexCorners.map(c => c), // Valleys originate from reflex corners
    ridgeJunctions: [],
    totalRidgeCount: Math.max(1, reflexCorners.length)
  };
}

/**
 * Generate multi-ridge geometry from decomposed footprint
 */
export function generateMultiRidgeGeometry(
  decomposed: DecomposedFootprint,
  aiRidgeOverride?: Array<{ start: XY; end: XY; confidence: number }>
): MultiRidgeGeometry {
  const ridges: MultiRidgeGeometry['ridges'] = [];
  const valleys: MultiRidgeGeometry['valleys'] = [];
  const hips: MultiRidgeGeometry['hips'] = [];
  
  // PRIORITY: Use AI-detected ridges if available and multiple
  if (aiRidgeOverride && aiRidgeOverride.length >= 2) {
    console.log(`🎯 Using ${aiRidgeOverride.length} AI-detected ridges for multi-ridge geometry`);
    aiRidgeOverride.forEach((ridge, i) => {
      ridges.push({
        id: `ridge_${i}`,
        start: ridge.start,
        end: ridge.end,
        lengthFt: distanceFt(ridge.start, ridge.end),
        sectionIndex: i
      });
    });
    
    // Generate valleys at ridge junctions
    if (ridges.length >= 2) {
      const junction = findRidgeJunction(ridges[0], ridges[1]);
      if (junction) {
        valleys.push({
          id: 'valley_0',
          start: decomposed.reflexCorners[0] || decomposed.mainSection.vertices[0],
          end: junction,
          lengthFt: distanceFt(decomposed.reflexCorners[0] || decomposed.mainSection.vertices[0], junction)
        });
      }
    }
    
    return { ridges, valleys, hips };
  }
  
  // Generate ridge for main section
  const mainRidge = calculateSectionRidge(decomposed.mainSection, 0);
  ridges.push(mainRidge);
  
  // Generate ridges for each extension
  decomposed.extensions.forEach((ext, i) => {
    const extRidge = calculateSectionRidge(ext, i + 1);
    ridges.push(extRidge);
  });
  
  // Generate valleys at reflex corners (junction points)
  decomposed.valleyOrigins.forEach((origin, i) => {
    // Valley runs from reflex corner toward ridge junction
    const nearestRidgeEnd = findNearestRidgeEndpoint(origin, ridges);
    if (nearestRidgeEnd) {
      valleys.push({
        id: `valley_${i}`,
        start: origin,
        end: nearestRidgeEnd,
        lengthFt: distanceFt(origin, nearestRidgeEnd)
      });
    }
  });
  
  // Generate hips for main section corners
  const mainHips = calculateSectionHips(decomposed.mainSection, mainRidge, 0);
  hips.push(...mainHips);
  
  // Generate hips for extension corners
  decomposed.extensions.forEach((ext, i) => {
    const extHips = calculateSectionHips(ext, ridges[i + 1], i + 1);
    hips.push(...extHips);
  });
  
  console.log(`📐 Multi-ridge geometry: ${ridges.length} ridges, ${valleys.length} valleys, ${hips.length} hips`);
  
  return { ridges, valleys, hips };
}

/**
 * Check if a footprint represents an L-shape from Solar API segment patterns
 */
export function detectLShapeFromSegments(
  facets: Array<{ azimuthDegrees: number; areaSqft: number; direction: string }>
): { isLShape: boolean; hasMultipleRidges: boolean; reason: string } {
  // L-shape indicators:
  // 1. More than 4 facets (typically 6-8 for L-shaped hip)
  // 2. Two pairs of opposing azimuths (N/S AND E/W)
  // 3. Unequal areas between opposing pairs (asymmetric wings)
  
  const hasN = facets.some(f => f.direction === 'N');
  const hasS = facets.some(f => f.direction === 'S');
  const hasE = facets.some(f => f.direction === 'E');
  const hasW = facets.some(f => f.direction === 'W');
  
  const hasNS = hasN && hasS;
  const hasEW = hasE && hasW;
  
  // Check for asymmetric areas (different wing sizes)
  const nArea = facets.filter(f => f.direction === 'N').reduce((s, f) => s + f.areaSqft, 0);
  const sArea = facets.filter(f => f.direction === 'S').reduce((s, f) => s + f.areaSqft, 0);
  const eArea = facets.filter(f => f.direction === 'E').reduce((s, f) => s + f.areaSqft, 0);
  const wArea = facets.filter(f => f.direction === 'W').reduce((s, f) => s + f.areaSqft, 0);
  
  const nsRatio = nArea > 0 && sArea > 0 ? Math.max(nArea, sArea) / Math.min(nArea, sArea) : 1;
  const ewRatio = eArea > 0 && wArea > 0 ? Math.max(eArea, wArea) / Math.min(eArea, wArea) : 1;
  
  // L-shape: Both N/S AND E/W pairs present, with 6+ facets
  if (hasNS && hasEW && facets.length >= 6) {
    return {
      isLShape: true,
      hasMultipleRidges: true,
      reason: `6+ facets with N/S and E/W pairs detected (${facets.length} facets)`
    };
  }
  
  // Cross-hip pattern: significant asymmetry in opposing pairs
  if (hasNS && hasEW && (nsRatio > 1.5 || ewRatio > 1.5)) {
    return {
      isLShape: true,
      hasMultipleRidges: true,
      reason: `Asymmetric opposing pairs (NS ratio: ${nsRatio.toFixed(1)}, EW ratio: ${ewRatio.toFixed(1)})`
    };
  }
  
  return {
    isLShape: false,
    hasMultipleRidges: false,
    reason: 'Standard hip/gable pattern'
  };
}

// ===== Internal Helper Functions =====

function normalizeRing(perimeter: XY[]): XY[] {
  // Remove closing vertex if present
  if (perimeter.length > 3 && 
      perimeter[0][0] === perimeter[perimeter.length - 1][0] &&
      perimeter[0][1] === perimeter[perimeter.length - 1][1]) {
    return perimeter.slice(0, -1);
  }
  return perimeter;
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

function classifyFootprintShape(vertices: XY[], reflexCount: number): DecomposedFootprint['type'] {
  if (vertices.length === 4 && reflexCount === 0) return 'rectangular';
  if (vertices.length === 6 && reflexCount === 1) return 'L-shaped';
  if (vertices.length === 8 && reflexCount === 2) {
    // Distinguish T from U by checking if reflex corners are on same side
    const bounds = getBounds(vertices);
    const centerY = (bounds.minY + bounds.maxY) / 2;
    
    // Find reflex vertices
    const reflexVerts: XY[] = [];
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
      const prev = vertices[(i - 1 + n) % n];
      const curr = vertices[i];
      const next = vertices[(i + 1) % n];
      const cross = (next[0] - curr[0]) * (prev[1] - curr[1]) - (next[1] - curr[1]) * (prev[0] - curr[0]);
      if (cross < 0) reflexVerts.push(curr);
    }
    
    if (reflexVerts.length === 2) {
      const sameHalf = (reflexVerts[0][1] > centerY) === (reflexVerts[1][1] > centerY);
      return sameHalf ? 'U-shaped' : 'T-shaped';
    }
  }
  return 'complex';
}

function createSection(
  vertices: XY[], 
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  isMain: boolean
): BuildingSection {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  
  return {
    vertices,
    bounds,
    ridgeDirection: width > height ? 'east-west' : 'north-south',
    areaSqft: calculatePolygonAreaSqft(vertices),
    isMain
  };
}

function decomposeLShape(
  vertices: XY[],
  reflexIndex: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
): Omit<DecomposedFootprint, 'type' | 'reflexCorners' | 'totalRidgeCount'> {
  const n = vertices.length;
  const reflexVertex = vertices[reflexIndex];
  
  // Find the extent lines through the reflex corner
  // For L-shape, we split at the reflex corner's projection
  
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  
  // Determine which quadrant the reflex corner is in
  const isNorth = reflexVertex[1] > centerY;
  const isEast = reflexVertex[0] > centerX;
  
  // Create main section (larger rectangle)
  const mainWidth = bounds.maxX - bounds.minX;
  const mainHeight = bounds.maxY - bounds.minY;
  
  const mainSection: BuildingSection = {
    vertices: vertices,  // Simplified: use full perimeter for now
    bounds,
    ridgeDirection: mainWidth > mainHeight ? 'east-west' : 'north-south',
    areaSqft: calculatePolygonAreaSqft(vertices) * 0.6,  // Estimate 60% main
    isMain: true
  };
  
  // Create extension section
  const extBounds = {
    minX: isEast ? reflexVertex[0] : bounds.minX,
    maxX: isEast ? bounds.maxX : reflexVertex[0],
    minY: isNorth ? reflexVertex[1] : bounds.minY,
    maxY: isNorth ? bounds.maxY : reflexVertex[1]
  };
  
  const extWidth = extBounds.maxX - extBounds.minX;
  const extHeight = extBounds.maxY - extBounds.minY;
  
  const extension: BuildingSection = {
    vertices: [
      [extBounds.minX, extBounds.minY],
      [extBounds.maxX, extBounds.minY],
      [extBounds.maxX, extBounds.maxY],
      [extBounds.minX, extBounds.maxY]
    ],
    bounds: extBounds,
    ridgeDirection: extWidth > extHeight ? 'east-west' : 'north-south',
    areaSqft: calculatePolygonAreaSqft(vertices) * 0.4,  // Estimate 40% extension
    isMain: false,
    attachmentSide: isNorth ? (isEast ? 'E' : 'W') : (isEast ? 'E' : 'W')
  };
  
  // Valley originates at reflex corner
  const valleyOrigins: XY[] = [reflexVertex];
  
  // Ridge junction is where main and extension ridges meet
  const ridgeJunctions: XY[] = [reflexVertex];  // Simplified
  
  return {
    mainSection,
    extensions: [extension],
    valleyOrigins,
    ridgeJunctions
  };
}

function decomposeTShape(
  vertices: XY[],
  reflexIndices: number[],
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
): Omit<DecomposedFootprint, 'type' | 'reflexCorners' | 'totalRidgeCount'> {
  // T-shape has stem + crossbar
  const mainSection = createSection(vertices, bounds, true);
  
  // For simplicity, create one extension for the stem
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const width = bounds.maxX - bounds.minX;
  
  const extension: BuildingSection = {
    vertices: vertices,
    bounds: {
      minX: centerX - width * 0.2,
      maxX: centerX + width * 0.2,
      minY: bounds.minY,
      maxY: bounds.maxY
    },
    ridgeDirection: 'north-south',
    areaSqft: calculatePolygonAreaSqft(vertices) * 0.3,
    isMain: false,
    attachmentSide: 'S'
  };
  
  const valleyOrigins = reflexIndices.map(i => vertices[i]);
  
  return {
    mainSection,
    extensions: [extension],
    valleyOrigins,
    ridgeJunctions: valleyOrigins
  };
}

function decomposeUShape(
  vertices: XY[],
  reflexIndices: number[],
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
): Omit<DecomposedFootprint, 'type' | 'reflexCorners' | 'totalRidgeCount'> {
  // U-shape has center section + two wings
  const mainSection = createSection(vertices, bounds, true);
  const width = bounds.maxX - bounds.minX;
  
  // Two extensions for the wings
  const leftExtension: BuildingSection = {
    vertices: vertices,
    bounds: {
      minX: bounds.minX,
      maxX: bounds.minX + width * 0.3,
      minY: bounds.minY,
      maxY: bounds.maxY
    },
    ridgeDirection: 'north-south',
    areaSqft: calculatePolygonAreaSqft(vertices) * 0.25,
    isMain: false,
    attachmentSide: 'W'
  };
  
  const rightExtension: BuildingSection = {
    vertices: vertices,
    bounds: {
      minX: bounds.maxX - width * 0.3,
      maxX: bounds.maxX,
      minY: bounds.minY,
      maxY: bounds.maxY
    },
    ridgeDirection: 'north-south',
    areaSqft: calculatePolygonAreaSqft(vertices) * 0.25,
    isMain: false,
    attachmentSide: 'E'
  };
  
  const valleyOrigins = reflexIndices.map(i => vertices[i]);
  
  return {
    mainSection,
    extensions: [leftExtension, rightExtension],
    valleyOrigins,
    ridgeJunctions: valleyOrigins
  };
}

function calculateSectionRidge(
  section: BuildingSection,
  sectionIndex: number
): MultiRidgeGeometry['ridges'][0] {
  const { bounds, ridgeDirection } = section;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  
  // Ridge inset from ends
  const insetFactor = 0.35;
  
  let start: XY, end: XY;
  
  if (ridgeDirection === 'east-west') {
    const shortSide = bounds.maxY - bounds.minY;
    start = [bounds.minX + shortSide * insetFactor, centerY];
    end = [bounds.maxX - shortSide * insetFactor, centerY];
  } else {
    const shortSide = bounds.maxX - bounds.minX;
    start = [centerX, bounds.minY + shortSide * insetFactor];
    end = [centerX, bounds.maxY - shortSide * insetFactor];
  }
  
  return {
    id: `ridge_${sectionIndex}`,
    start,
    end,
    lengthFt: distanceFt(start, end),
    sectionIndex
  };
}

function calculateSectionHips(
  section: BuildingSection,
  ridge: MultiRidgeGeometry['ridges'][0],
  sectionIndex: number
): MultiRidgeGeometry['hips'] {
  const { bounds } = section;
  const corners: XY[] = [
    [bounds.minX, bounds.minY],  // SW
    [bounds.maxX, bounds.minY],  // SE
    [bounds.maxX, bounds.maxY],  // NE
    [bounds.minX, bounds.maxY]   // NW
  ];
  
  const hips: MultiRidgeGeometry['hips'] = [];
  
  // Connect each corner to nearest ridge endpoint
  corners.forEach((corner, i) => {
    const distToStart = distanceFt(corner, ridge.start);
    const distToEnd = distanceFt(corner, ridge.end);
    const nearestRidgeEnd = distToStart < distToEnd ? ridge.start : ridge.end;
    
    hips.push({
      id: `hip_${sectionIndex}_${i}`,
      start: corner,
      end: nearestRidgeEnd,
      lengthFt: Math.min(distToStart, distToEnd),
      sectionIndex
    });
  });
  
  return hips;
}

function findRidgeJunction(
  ridge1: { start: XY; end: XY },
  ridge2: { start: XY; end: XY }
): XY | null {
  // Find closest endpoints between ridges
  const pairs = [
    { p1: ridge1.end, p2: ridge2.start, dist: distanceFt(ridge1.end, ridge2.start) },
    { p1: ridge1.end, p2: ridge2.end, dist: distanceFt(ridge1.end, ridge2.end) },
    { p1: ridge1.start, p2: ridge2.start, dist: distanceFt(ridge1.start, ridge2.start) },
    { p1: ridge1.start, p2: ridge2.end, dist: distanceFt(ridge1.start, ridge2.end) }
  ];
  
  const closest = pairs.reduce((min, p) => p.dist < min.dist ? p : min, pairs[0]);
  
  // Midpoint of closest pair
  return [(closest.p1[0] + closest.p2[0]) / 2, (closest.p1[1] + closest.p2[1]) / 2];
}

function findNearestRidgeEndpoint(
  point: XY,
  ridges: MultiRidgeGeometry['ridges']
): XY | null {
  let nearest: XY | null = null;
  let minDist = Infinity;
  
  ridges.forEach(ridge => {
    const distToStart = distanceFt(point, ridge.start);
    const distToEnd = distanceFt(point, ridge.end);
    
    if (distToStart < minDist) {
      minDist = distToStart;
      nearest = ridge.start;
    }
    if (distToEnd < minDist) {
      minDist = distToEnd;
      nearest = ridge.end;
    }
  });
  
  return nearest;
}

function distanceFt(p1: XY, p2: XY): number {
  const R = 20902231; // Earth's radius in feet
  const dLat = (p2[1] - p1[1]) * Math.PI / 180;
  const dLng = (p2[0] - p1[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + 
            Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) * 
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculatePolygonAreaSqft(vertices: XY[]): number {
  if (vertices.length < 3) return 0;
  
  const centroid: XY = [
    vertices.reduce((s, v) => s + v[0], 0) / vertices.length,
    vertices.reduce((s, v) => s + v[1], 0) / vertices.length
  ];
  
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos(centroid[1] * Math.PI / 180);
  
  const localVertices = vertices.map(v => [
    (v[0] - centroid[0]) * metersPerDegreeLng,
    (v[1] - centroid[1]) * metersPerDegreeLat
  ]);
  
  let area = 0;
  for (let i = 0; i < localVertices.length; i++) {
    const j = (i + 1) % localVertices.length;
    area += localVertices[i][0] * localVertices[j][1];
    area -= localVertices[j][0] * localVertices[i][1];
  }
  
  return Math.abs(area / 2) * 10.764;
}
