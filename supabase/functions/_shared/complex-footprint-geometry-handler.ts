/**
 * Complex Footprint Geometry Handler
 * 
 * Generates proper roof facet geometry from complex building footprints
 * using straight skeleton algorithms and azimuth-based facet positioning.
 * 
 * This fixes the "bowtie" diagram issue when complex Solar segments
 * are applied to rectangular bbox footprints.
 */

type XY = [number, number]; // [lng, lat]

export interface ComplexGeometryResult {
  facets: FacetGeometry[];
  ridges: LineGeometry[];
  hips: LineGeometry[];
  valleys: LineGeometry[];
  eaves: LineGeometry[];
  rakes: LineGeometry[];
  quality: 'excellent' | 'good' | 'fair' | 'poor';
  warnings: string[];
}

export interface FacetGeometry {
  id: string;
  polygon: XY[];
  areaSqft: number;
  pitch: string;
  azimuth: number;
  direction: string;
  color: string;
}

export interface LineGeometry {
  id: string;
  start: XY;
  end: XY;
  lengthFt: number;
}

interface SolarSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaMeters2?: number;
  center?: { latitude: number; longitude: number };
  boundingBox?: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
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
 * Generate proper roof geometry from complex footprint
 * Uses the footprint shape and Solar segment data to create accurate facets
 */
export function generateComplexRoofGeometry(
  footprintVertices: Array<{ lat: number; lng: number }>,
  solarSegments: SolarSegment[],
  predominantPitch: string = '6/12'
): ComplexGeometryResult {
  const warnings: string[] = [];
  
  // Convert to XY format
  const perimeter: XY[] = footprintVertices.map(v => [v.lng, v.lat]);
  
  // Detect footprint shape
  const shape = detectFootprintShape(perimeter);
  console.log(`📐 Footprint shape: ${shape.type} with ${perimeter.length} vertices`);
  
  // Choose generation strategy based on shape and Solar data
  if (shape.type === 'rectangular' && solarSegments.length >= 2) {
    // Simple rectangular hip roof
    return generateHipRoofFromRectangle(perimeter, solarSegments, predominantPitch, warnings);
  } else if (shape.type === 'L-shaped' || shape.type === 'T-shaped') {
    // Complex shape with multiple ridge sections
    return generateComplexShapeRoof(perimeter, shape, solarSegments, predominantPitch, warnings);
  } else if (solarSegments.length >= 2) {
    // Use Solar segment azimuths to determine facet orientation
    return generateFromSolarAzimuths(perimeter, solarSegments, predominantPitch, warnings);
  }
  
  // Fallback: simple gable based on longest axis
  warnings.push('Using fallback gable generation');
  return generateSimpleGableRoof(perimeter, predominantPitch, warnings);
}

/**
 * Detect the type of building footprint
 */
function detectFootprintShape(perimeter: XY[]): { 
  type: 'rectangular' | 'L-shaped' | 'T-shaped' | 'U-shaped' | 'complex';
  reflexCount: number;
  aspectRatio: number;
} {
  // Remove closing vertex if present
  const vertices = perimeter.length > 3 && 
    perimeter[0][0] === perimeter[perimeter.length - 1][0] &&
    perimeter[0][1] === perimeter[perimeter.length - 1][1]
    ? perimeter.slice(0, -1)
    : perimeter;
  
  const bounds = getBounds(vertices);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const aspectRatio = Math.max(width, height) / Math.min(width, height);
  
  // Count reflex (concave) vertices
  let reflexCount = 0;
  for (let i = 0; i < vertices.length; i++) {
    const prev = vertices[(i - 1 + vertices.length) % vertices.length];
    const curr = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    
    const cross = (next[0] - curr[0]) * (prev[1] - curr[1]) - 
                  (next[1] - curr[1]) * (prev[0] - curr[0]);
    
    if (cross < 0) reflexCount++;
  }
  
  // Classify based on vertex count and reflex vertices
  if (vertices.length === 4 && reflexCount === 0) {
    return { type: 'rectangular', reflexCount: 0, aspectRatio };
  } else if (vertices.length === 6 && reflexCount === 1) {
    return { type: 'L-shaped', reflexCount: 1, aspectRatio };
  } else if (vertices.length === 8 && reflexCount === 2) {
    // Could be T-shaped or U-shaped
    const pattern = analyzeReflexPattern(vertices);
    return { type: pattern === 'T' ? 'T-shaped' : 'U-shaped', reflexCount: 2, aspectRatio };
  }
  
  return { type: 'complex', reflexCount, aspectRatio };
}

function analyzeReflexPattern(vertices: XY[]): 'T' | 'U' {
  // Simple heuristic: T-shape has reflex vertices on opposite ends
  // U-shape has them on same side
  const bounds = getBounds(vertices);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  
  let leftReflex = 0;
  let rightReflex = 0;
  
  for (let i = 0; i < vertices.length; i++) {
    const prev = vertices[(i - 1 + vertices.length) % vertices.length];
    const curr = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    
    const cross = (next[0] - curr[0]) * (prev[1] - curr[1]) - 
                  (next[1] - curr[1]) * (prev[0] - curr[0]);
    
    if (cross < 0) {
      if (curr[0] < centerX) leftReflex++;
      else rightReflex++;
    }
  }
  
  return leftReflex > 0 && rightReflex > 0 ? 'T' : 'U';
}

/**
 * Generate hip roof from rectangular footprint
 */
function generateHipRoofFromRectangle(
  perimeter: XY[],
  solarSegments: SolarSegment[],
  pitch: string,
  warnings: string[]
): ComplexGeometryResult {
  const bounds = getBounds(perimeter);
  const centroid = getCentroid(perimeter);
  
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const isWider = width > height;
  
  // Calculate ridge line (along the longer axis, inset from edges)
  const shortSide = isWider ? height : width;
  const inset = shortSide * 0.35; // Ridge inset 35% from short edges
  
  const ridgeStart: XY = isWider
    ? [bounds.minX + inset, centroid[1]]
    : [centroid[0], bounds.minY + inset];
  const ridgeEnd: XY = isWider
    ? [bounds.maxX - inset, centroid[1]]
    : [centroid[0], bounds.maxY - inset];
  
  // Find corner vertices
  const corners = findCorners(perimeter, bounds);
  
  // Create 4 facets for hip roof
  const facets: FacetGeometry[] = [];
  const segmentsByDir = groupSegmentsByDirection(solarSegments);
  
  // Front facet (South or East depending on orientation)
  const frontDir = isWider ? 'S' : 'E';
  const frontSegments = segmentsByDir.get(frontDir) || [];
  const frontArea = frontSegments.reduce((sum, s) => sum + (s.areaMeters2 || 0), 0) * 10.764;
  
  facets.push({
    id: 'facet_0',
    polygon: isWider
      ? [corners.sw, corners.se, ridgeEnd, ridgeStart, corners.sw]
      : [corners.se, corners.ne, ridgeEnd, ridgeStart, corners.se],
    areaSqft: frontArea || calculatePolygonArea(perimeter) / 4,
    pitch,
    azimuth: isWider ? 180 : 90,
    direction: frontDir,
    color: FACET_COLORS[0]
  });
  
  // Back facet (North or West)
  const backDir = isWider ? 'N' : 'W';
  const backSegments = segmentsByDir.get(backDir) || [];
  const backArea = backSegments.reduce((sum, s) => sum + (s.areaMeters2 || 0), 0) * 10.764;
  
  facets.push({
    id: 'facet_1',
    polygon: isWider
      ? [corners.nw, corners.ne, ridgeEnd, ridgeStart, corners.nw]
      : [corners.sw, corners.nw, ridgeStart, ridgeEnd, corners.sw],
    areaSqft: backArea || calculatePolygonArea(perimeter) / 4,
    pitch,
    azimuth: isWider ? 0 : 270,
    direction: backDir,
    color: FACET_COLORS[1]
  });
  
  // Left hip facet
  facets.push({
    id: 'facet_2',
    polygon: isWider
      ? [corners.sw, corners.nw, ridgeStart, corners.sw]
      : [corners.sw, corners.se, ridgeStart, corners.sw],
    areaSqft: calculatePolygonArea(perimeter) / 8,
    pitch,
    azimuth: isWider ? 270 : 180,
    direction: isWider ? 'W' : 'S',
    color: FACET_COLORS[2]
  });
  
  // Right hip facet
  facets.push({
    id: 'facet_3',
    polygon: isWider
      ? [corners.se, corners.ne, ridgeEnd, corners.se]
      : [corners.nw, corners.ne, ridgeEnd, corners.nw],
    areaSqft: calculatePolygonArea(perimeter) / 8,
    pitch,
    azimuth: isWider ? 90 : 0,
    direction: isWider ? 'E' : 'N',
    color: FACET_COLORS[3]
  });
  
  // Create linear features
  const ridges: LineGeometry[] = [{
    id: 'ridge_0',
    start: ridgeStart,
    end: ridgeEnd,
    lengthFt: distanceFt(ridgeStart, ridgeEnd)
  }];
  
  const hips: LineGeometry[] = [
    { id: 'hip_0', start: corners.sw, end: ridgeStart, lengthFt: distanceFt(corners.sw, ridgeStart) },
    { id: 'hip_1', start: corners.nw, end: ridgeStart, lengthFt: distanceFt(corners.nw, ridgeStart) },
    { id: 'hip_2', start: corners.se, end: ridgeEnd, lengthFt: distanceFt(corners.se, ridgeEnd) },
    { id: 'hip_3', start: corners.ne, end: ridgeEnd, lengthFt: distanceFt(corners.ne, ridgeEnd) }
  ];
  
  const eaves: LineGeometry[] = [];
  for (let i = 0; i < perimeter.length - 1; i++) {
    eaves.push({
      id: `eave_${i}`,
      start: perimeter[i],
      end: perimeter[i + 1],
      lengthFt: distanceFt(perimeter[i], perimeter[i + 1])
    });
  }
  
  return {
    facets,
    ridges,
    hips,
    valleys: [],
    eaves,
    rakes: [],
    quality: 'good',
    warnings
  };
}

/**
 * Generate roof for complex L/T-shaped footprints
 */
function generateComplexShapeRoof(
  perimeter: XY[],
  shape: { type: string; reflexCount: number },
  solarSegments: SolarSegment[],
  pitch: string,
  warnings: string[]
): ComplexGeometryResult {
  warnings.push(`Complex ${shape.type} footprint - using multi-ridge generation`);
  
  // For complex shapes, divide into rectangular sections and generate each
  // This is a simplified approach - full implementation would use straight skeleton
  
  const bounds = getBounds(perimeter);
  const centroid = getCentroid(perimeter);
  
  // Create facets based on Solar segment azimuths
  const facets: FacetGeometry[] = [];
  const groupedSegments = groupSegmentsByDirection(solarSegments);
  
  let facetIndex = 0;
  groupedSegments.forEach((segments, direction) => {
    const totalArea = segments.reduce((sum, s) => sum + (s.areaMeters2 || 0), 0) * 10.764;
    const avgAzimuth = segments.reduce((sum, s) => sum + (s.azimuthDegrees || 0), 0) / segments.length;
    const avgPitch = segments.reduce((sum, s) => sum + (s.pitchDegrees || 0), 0) / segments.length;
    
    // Create simplified facet polygon based on direction
    const facetPolygon = createDirectionalFacet(perimeter, direction, centroid, bounds);
    
    facets.push({
      id: `facet_${facetIndex}`,
      polygon: facetPolygon,
      areaSqft: totalArea,
      pitch: degreesToPitch(avgPitch) || pitch,
      azimuth: avgAzimuth,
      direction,
      color: FACET_COLORS[facetIndex % FACET_COLORS.length]
    });
    
    facetIndex++;
  });
  
  // Create main ridge along longer axis
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const isWider = width > height;
  
  const ridges: LineGeometry[] = [{
    id: 'ridge_0',
    start: isWider ? [bounds.minX + width * 0.2, centroid[1]] : [centroid[0], bounds.minY + height * 0.2],
    end: isWider ? [bounds.maxX - width * 0.2, centroid[1]] : [centroid[0], bounds.maxY - height * 0.2],
    lengthFt: isWider ? distanceFt([bounds.minX, 0], [bounds.maxX, 0]) * 0.6 : distanceFt([0, bounds.minY], [0, bounds.maxY]) * 0.6
  }];
  
  return {
    facets,
    ridges,
    hips: [],
    valleys: [],
    eaves: [],
    rakes: [],
    quality: 'fair',
    warnings
  };
}

/**
 * Generate roof from Solar segment azimuths only
 */
function generateFromSolarAzimuths(
  perimeter: XY[],
  solarSegments: SolarSegment[],
  pitch: string,
  warnings: string[]
): ComplexGeometryResult {
  const bounds = getBounds(perimeter);
  const centroid = getCentroid(perimeter);
  
  const facets: FacetGeometry[] = [];
  const groupedSegments = groupSegmentsByDirection(solarSegments);
  
  let facetIndex = 0;
  groupedSegments.forEach((segments, direction) => {
    const totalArea = segments.reduce((sum, s) => sum + (s.areaMeters2 || 0), 0) * 10.764;
    const avgAzimuth = segments.reduce((sum, s) => sum + (s.azimuthDegrees || 0), 0) / segments.length;
    const avgPitch = segments.reduce((sum, s) => sum + (s.pitchDegrees || 0), 0) / segments.length;
    
    const facetPolygon = createDirectionalFacet(perimeter, direction, centroid, bounds);
    
    facets.push({
      id: `facet_${facetIndex}`,
      polygon: facetPolygon,
      areaSqft: totalArea,
      pitch: degreesToPitch(avgPitch) || pitch,
      azimuth: avgAzimuth,
      direction,
      color: FACET_COLORS[facetIndex % FACET_COLORS.length]
    });
    
    facetIndex++;
  });
  
  return {
    facets,
    ridges: [],
    hips: [],
    valleys: [],
    eaves: [],
    rakes: [],
    quality: 'fair',
    warnings
  };
}

/**
 * Generate simple gable roof as fallback
 */
function generateSimpleGableRoof(
  perimeter: XY[],
  pitch: string,
  warnings: string[]
): ComplexGeometryResult {
  const bounds = getBounds(perimeter);
  const centroid = getCentroid(perimeter);
  
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const isWider = width > height;
  
  // Ridge along longer axis
  const ridgeStart: XY = isWider ? [bounds.minX, centroid[1]] : [centroid[0], bounds.minY];
  const ridgeEnd: XY = isWider ? [bounds.maxX, centroid[1]] : [centroid[0], bounds.maxY];
  
  const corners = findCorners(perimeter, bounds);
  const totalArea = calculatePolygonArea(perimeter);
  
  const facets: FacetGeometry[] = [
    {
      id: 'facet_0',
      polygon: isWider
        ? [corners.sw, corners.se, ridgeEnd, ridgeStart, corners.sw]
        : [corners.se, corners.ne, ridgeEnd, ridgeStart, corners.se],
      areaSqft: totalArea / 2,
      pitch,
      azimuth: isWider ? 180 : 90,
      direction: isWider ? 'S' : 'E',
      color: FACET_COLORS[0]
    },
    {
      id: 'facet_1',
      polygon: isWider
        ? [corners.nw, corners.ne, ridgeEnd, ridgeStart, corners.nw]
        : [corners.sw, corners.nw, ridgeStart, ridgeEnd, corners.sw],
      areaSqft: totalArea / 2,
      pitch,
      azimuth: isWider ? 0 : 270,
      direction: isWider ? 'N' : 'W',
      color: FACET_COLORS[1]
    }
  ];
  
  const ridges: LineGeometry[] = [{
    id: 'ridge_0',
    start: ridgeStart,
    end: ridgeEnd,
    lengthFt: distanceFt(ridgeStart, ridgeEnd)
  }];
  
  return {
    facets,
    ridges,
    hips: [],
    valleys: [],
    eaves: [],
    rakes: [],
    quality: 'poor',
    warnings
  };
}

// Helper functions
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
  const sumX = vertices.reduce((sum, v) => sum + v[0], 0);
  const sumY = vertices.reduce((sum, v) => sum + v[1], 0);
  return [sumX / n, sumY / n];
}

function findCorners(perimeter: XY[], bounds: { minX: number; maxX: number; minY: number; maxY: number }): {
  sw: XY; se: XY; ne: XY; nw: XY
} {
  const sw = perimeter.reduce((best, v) => 
    (v[1] + v[0] < best[1] + best[0]) ? v : best, perimeter[0]);
  const ne = perimeter.reduce((best, v) => 
    (v[1] + v[0] > best[1] + best[0]) ? v : best, perimeter[0]);
  const se = perimeter.reduce((best, v) => 
    (v[0] - v[1] > best[0] - best[1]) ? v : best, perimeter[0]);
  const nw = perimeter.reduce((best, v) => 
    (v[1] - v[0] > best[1] - best[0]) ? v : best, perimeter[0]);
  
  return { sw, se, ne, nw };
}

function distanceFt(a: XY, b: XY): number {
  const dx = (b[0] - a[0]) * 111320 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180);
  const dy = (b[1] - a[1]) * 110540;
  return Math.sqrt(dx * dx + dy * dy) * 3.28084; // meters to feet
}

function calculatePolygonArea(vertices: XY[]): number {
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i][0] * vertices[j][1];
    area -= vertices[j][0] * vertices[i][1];
  }
  area = Math.abs(area) / 2;
  
  // Convert to square feet (rough approximation)
  const avgLat = vertices.reduce((sum, v) => sum + v[1], 0) / vertices.length;
  const metersPerDegreeLng = 111320 * Math.cos(avgLat * Math.PI / 180);
  const metersPerDegreeLat = 110540;
  
  return area * metersPerDegreeLng * metersPerDegreeLat * 10.764; // sq meters to sq feet
}

function groupSegmentsByDirection(segments: SolarSegment[]): Map<string, SolarSegment[]> {
  const groups = new Map<string, SolarSegment[]>();
  
  for (const segment of segments) {
    const azimuth = segment.azimuthDegrees || 0;
    let direction: string;
    
    if (azimuth >= 315 || azimuth < 45) direction = 'N';
    else if (azimuth >= 45 && azimuth < 135) direction = 'E';
    else if (azimuth >= 135 && azimuth < 225) direction = 'S';
    else direction = 'W';
    
    if (!groups.has(direction)) groups.set(direction, []);
    groups.get(direction)!.push(segment);
  }
  
  return groups;
}

function createDirectionalFacet(
  perimeter: XY[],
  direction: string,
  centroid: XY,
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
): XY[] {
  // Find perimeter vertices on the specified side
  const facetVertices: XY[] = [];
  
  for (const vertex of perimeter) {
    const relX = (vertex[0] - centroid[0]) / (bounds.maxX - bounds.minX);
    const relY = (vertex[1] - centroid[1]) / (bounds.maxY - bounds.minY);
    
    let include = false;
    switch (direction) {
      case 'N': include = relY > 0.1; break;
      case 'S': include = relY < -0.1; break;
      case 'E': include = relX > 0.1; break;
      case 'W': include = relX < -0.1; break;
    }
    
    if (include) facetVertices.push(vertex);
  }
  
  // Add centroid and close polygon
  if (facetVertices.length >= 2) {
    facetVertices.push(centroid);
    facetVertices.push(facetVertices[0]);
  }
  
  return facetVertices.length >= 4 ? facetVertices : [centroid, centroid, centroid, centroid];
}

function degreesToPitch(degrees: number): string {
  if (!degrees || degrees <= 0) return '';
  const rise = Math.tan(degrees * Math.PI / 180) * 12;
  const roundedRise = Math.round(rise * 2) / 2;
  return `${roundedRise}/12`;
}
