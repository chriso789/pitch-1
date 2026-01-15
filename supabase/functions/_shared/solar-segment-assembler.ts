/**
 * Solar Segment Assembler
 * 
 * Uses Google Solar API segment bounding boxes to create accurate facet geometry.
 * Each Solar segment has:
 * - boundingBox.sw and boundingBox.ne (rectangle corners)
 * - center (lat, lng)
 * - azimuthDegrees (facing direction)
 * - pitchDegrees (slope angle)
 * - stats.areaMeters2 (segment area)
 * 
 * This allows us to POSITION each facet correctly instead of guessing.
 * 
 * NEW: Supports structure analysis for proper L/T-shaped roof handling
 * and screen enclosure exclusion.
 */

// StructureAnalysis type inlined to avoid import bundle issues
interface StructureAnalysis {
  houseOrientation: {
    frontFacing: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' | 'unknown';
    drivewayPosition: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' | 'unknown';
    garagePosition: string;
    confidence: number;
  };
  footprintShape: 'rectangular' | 'L-shaped' | 'T-shaped' | 'U-shaped' | 'H-shaped' | 'complex';
  mainStructure: {
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    ridgeDirection: 'east-west' | 'north-south';
    estimatedWidthFt: number;
    estimatedDepthFt: number;
  };
  extensions: Array<{
    type: string;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    attachmentSide: 'N' | 'S' | 'E' | 'W';
    ridgeDirection: 'east-west' | 'north-south';
  }>;
  exclusions: Array<{
    type: string;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    estimatedAreaSqft: number;
  }>;
  ridgeTopology: {
    primaryRidgeCount: number;
    hasMultipleRidgeDirections: boolean;
    junctionPoints: number;
  };
  overallConfidence: 'high' | 'medium' | 'low';
}

type XY = [number, number]; // [lng, lat]

export interface SolarSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaMeters2?: number;
  planeHeightAtCenter?: number;
  boundingBox?: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  center?: { latitude: number; longitude: number };
}

export interface AssembledFacet {
  id: string;
  index: number;
  polygon: XY[];
  areaSqft: number;
  pitch: string;
  azimuthDegrees: number;
  direction: string;
  color: string;
  sourceSegmentIndex: number;
}

export interface AssembledGeometry {
  facets: AssembledFacet[];
  ridges: AssembledLine[];
  hips: AssembledLine[];
  valleys: AssembledLine[];
  eaves: AssembledLine[];
  rakes: AssembledLine[];
  quality: 'excellent' | 'good' | 'fair';
  warnings: string[];
  structureAnalysis?: StructureAnalysis;
}

export interface AssembledLine {
  id: string;
  start: XY;
  end: XY;
  lengthFt: number;
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
 * Main function: Assemble facets from Solar API segment data
 * This uses segment center/boundingBox to position facets accurately
 * 
 * @param perimeter - Array of [lng, lat] coordinates defining the roof perimeter
 * @param solarSegments - Array of Solar API segments with azimuth and area data
 * @param predominantPitch - Default pitch to use (e.g., "6/12")
 * @param structureAnalysis - Optional structure analysis for L/T-shape handling
 */
export function assembleFacetsFromSolarSegments(
  perimeter: XY[],
  solarSegments: SolarSegment[],
  predominantPitch: string = '6/12',
  structureAnalysis?: StructureAnalysis
): AssembledGeometry {
  const warnings: string[] = [];
  
  if (!solarSegments || solarSegments.length === 0) {
    warnings.push('No Solar segments available');
    return createFallbackGeometry(perimeter, predominantPitch, warnings, structureAnalysis);
  }
  
  // Check if segments have positioning data
  const segmentsWithBounds = solarSegments.filter(s => s.boundingBox?.sw && s.boundingBox?.ne);
  const segmentsWithCenter = solarSegments.filter(s => s.center);
  
  console.log(`🛰️ Solar Segment Assembler: ${solarSegments.length} segments, ${segmentsWithBounds.length} with bounds, ${segmentsWithCenter.length} with center`);
  
  // Log structure analysis if available
  if (structureAnalysis) {
    console.log(`📐 Structure analysis: ${structureAnalysis.footprintShape}, front facing ${structureAnalysis.houseOrientation.frontFacing}, ${structureAnalysis.extensions.length} extensions, ${structureAnalysis.exclusions.length} exclusions`);
  }
  
  // Use center positions if available (more accurate than bounding box)
  if (segmentsWithCenter.length >= 2) {
    return assembleFromCenters(perimeter, solarSegments, predominantPitch, warnings, structureAnalysis);
  }
  
  // Fall back to bounding box positioning
  if (segmentsWithBounds.length >= 2) {
    return assembleFromBoundingBoxes(perimeter, solarSegments, predominantPitch, warnings, structureAnalysis);
  }
  
  // Use azimuth clustering as last resort
  if (solarSegments.length >= 2) {
    return assembleFromAzimuths(perimeter, solarSegments, predominantPitch, warnings, structureAnalysis);
  }
  
  warnings.push('Insufficient segment positioning data');
  return createFallbackGeometry(perimeter, predominantPitch, warnings, structureAnalysis);
}

/**
 * Assemble geometry using segment center positions
 * Most accurate method - directly positions facets where segments are located
 */
function assembleFromCenters(
  perimeter: XY[],
  segments: SolarSegment[],
  pitch: string,
  warnings: string[],
  structureAnalysis?: StructureAnalysis
): AssembledGeometry {
  const centroid = getCentroid(perimeter);
  const bounds = getBounds(perimeter);
  
  // Group segments by their position relative to centroid and azimuth
  const facets: AssembledFacet[] = [];
  const processedEdges: Set<string> = new Set();
  
  segments.forEach((segment, index) => {
    if (!segment.center) return;
    
    const segmentCenter: XY = [segment.center.longitude, segment.center.latitude];
    const azimuth = segment.azimuthDegrees || 0;
    const direction = getDirectionFromAzimuth(azimuth);
    
    // Find perimeter vertices that belong to this segment based on:
    // 1. Position relative to segment center
    // 2. Azimuth direction (vertices should be on the "facing" side)
    const facetVertices = findFacetVerticesForSegment(perimeter, segmentCenter, azimuth, centroid);
    
    if (facetVertices.length >= 3) {
      // Create facet polygon by connecting vertices through approximate ridge
      const ridgePoint = estimateRidgePointForSegment(segmentCenter, centroid, azimuth, bounds);
      const facetPolygon = createFacetPolygonWithRidge(facetVertices, ridgePoint);
      
      facets.push({
        id: `facet_${index}`,
        index,
        polygon: facetPolygon,
        areaSqft: (segment.areaMeters2 || 0) * 10.764,
        pitch: degreesToPitch(segment.pitchDegrees || 0) || pitch,
        azimuthDegrees: azimuth,
        direction,
        color: FACET_COLORS[index % FACET_COLORS.length],
        sourceSegmentIndex: index
      });
    }
  });
  
  // Derive linear features from facet adjacencies
  const { ridges, hips, valleys, eaves, rakes } = deriveLinearFeaturesFromFacets(facets, perimeter, centroid, structureAnalysis);
  
  // If facet generation failed, use azimuth-based fallback
  if (facets.length < 2 && segments.length >= 2) {
    console.log('⚠️ Center-based assembly produced few facets, falling back to azimuth clustering');
    return assembleFromAzimuths(perimeter, segments, pitch, warnings, structureAnalysis);
  }
  
  return {
    facets,
    ridges,
    hips,
    valleys,
    eaves,
    rakes,
    quality: facets.length >= segments.length * 0.7 ? 'excellent' : 'good',
    warnings,
    structureAnalysis
  };
}

/**
 * Assemble geometry using segment bounding boxes
 */
function assembleFromBoundingBoxes(
  perimeter: XY[],
  segments: SolarSegment[],
  pitch: string,
  warnings: string[],
  structureAnalysis?: StructureAnalysis
): AssembledGeometry {
  // Convert bounding boxes to center points and proceed with center-based assembly
  const segmentsWithCenters = segments.map(s => {
    if (s.center) return s;
    if (s.boundingBox?.sw && s.boundingBox?.ne) {
      return {
        ...s,
        center: {
          latitude: (s.boundingBox.sw.latitude + s.boundingBox.ne.latitude) / 2,
          longitude: (s.boundingBox.sw.longitude + s.boundingBox.ne.longitude) / 2
        }
      };
    }
    return s;
  });
  
  return assembleFromCenters(perimeter, segmentsWithCenters, pitch, warnings, structureAnalysis);
}

/**
 * Assemble geometry using azimuth clustering (no position data)
 * Groups segments by their facing direction and assigns perimeter edges accordingly
 * 
 * Now uses structure analysis for proper L/T-shaped roof handling
 */
function assembleFromAzimuths(
  perimeter: XY[],
  segments: SolarSegment[],
  pitch: string,
  warnings: string[],
  structureAnalysis?: StructureAnalysis
): AssembledGeometry {
  const centroid = getCentroid(perimeter);
  const bounds = getBounds(perimeter);
  
  // Group segments by cardinal direction (N, S, E, W)
  const groupedByDirection: Map<string, SolarSegment[]> = new Map();
  
  segments.forEach(segment => {
    const direction = getCardinalDirection(segment.azimuthDegrees || 0);
    if (!groupedByDirection.has(direction)) {
      groupedByDirection.set(direction, []);
    }
    groupedByDirection.get(direction)!.push(segment);
  });
  
  console.log(`🧭 Azimuth clustering: ${groupedByDirection.size} direction groups`);
  
  // Assign perimeter edges to facets based on edge orientation
  const facets: AssembledFacet[] = [];
  let facetIndex = 0;
  
  // Determine ridge direction - prefer structure analysis if available
  let isWider = (bounds.maxX - bounds.minX) > (bounds.maxY - bounds.minY);
  if (structureAnalysis?.mainStructure?.ridgeDirection) {
    // Structure analysis overrides auto-detection
    isWider = structureAnalysis.mainStructure.ridgeDirection === 'east-west';
    console.log(`📐 Using structure analysis ridge direction: ${structureAnalysis.mainStructure.ridgeDirection}`);
  }
  
  // Calculate ridge inset based on building proportions
  const shortSide = isWider ? (bounds.maxY - bounds.minY) : (bounds.maxX - bounds.minX);
  const insetFactor = 0.4; // Ridge endpoints inset 40% from short side
  
  const ridgeStart: XY = isWider 
    ? [bounds.minX + shortSide * insetFactor, (bounds.minY + bounds.maxY) / 2]
    : [(bounds.minX + bounds.maxX) / 2, bounds.minY + shortSide * insetFactor];
  const ridgeEnd: XY = isWider
    ? [bounds.maxX - shortSide * insetFactor, (bounds.minY + bounds.maxY) / 2]
    : [(bounds.minX + bounds.maxX) / 2, bounds.maxY - shortSide * insetFactor];
  
  groupedByDirection.forEach((dirSegments, direction) => {
    // Find perimeter edges that face this direction
    const facingEdges = findPerimeterEdgesFacing(perimeter, direction, centroid);
    
    if (facingEdges.length > 0) {
      // Create facet from these edges + ridge connection
      const facetVertices: XY[] = [];
      facingEdges.forEach(edge => {
        facetVertices.push(edge.start);
        facetVertices.push(edge.end);
      });
      
      // Remove duplicates
      const uniqueVertices = removeDuplicateVertices(facetVertices);
      
      // Add ridge connection points
      const nearestRidgePoint = distanceXY(uniqueVertices[0], ridgeStart) < distanceXY(uniqueVertices[0], ridgeEnd)
        ? ridgeStart : ridgeEnd;
      
      const polygon = [...uniqueVertices, nearestRidgePoint, uniqueVertices[0]];
      
      // Sum area from all segments in this direction
      const totalArea = dirSegments.reduce((sum, s) => sum + (s.areaMeters2 || 0), 0) * 10.764;
      const avgPitch = dirSegments.reduce((sum, s) => sum + (s.pitchDegrees || 0), 0) / dirSegments.length;
      const avgAzimuth = dirSegments.reduce((sum, s) => sum + (s.azimuthDegrees || 0), 0) / dirSegments.length;
      
      facets.push({
        id: `facet_${facetIndex}`,
        index: facetIndex,
        polygon,
        areaSqft: totalArea,
        pitch: degreesToPitch(avgPitch) || pitch,
        azimuthDegrees: avgAzimuth,
        direction,
        color: FACET_COLORS[facetIndex % FACET_COLORS.length],
        sourceSegmentIndex: facetIndex
      });
      
      facetIndex++;
    }
  });
  
  // Create ridge line
  const ridges: AssembledLine[] = [{
    id: 'ridge_0',
    start: ridgeStart,
    end: ridgeEnd,
    lengthFt: distanceFt(ridgeStart, ridgeEnd)
  }];
  
  // Create hip lines from corners to ridge endpoints based on orientation (not distance)
  const hips: AssembledLine[] = [];
  
  // Find corners by position (SW, SE, NE, NW)
  const sw = perimeter.reduce((best, v) => 
    (v[1] + v[0] < best[1] + best[0]) ? v : best, perimeter[0]);
  const ne = perimeter.reduce((best, v) => 
    (v[1] + v[0] > best[1] + best[0]) ? v : best, perimeter[0]);
  const se = perimeter.reduce((best, v) => 
    (v[0] - v[1] > best[0] - best[1]) ? v : best, perimeter[0]);
  const nw = perimeter.reduce((best, v) => 
    (v[1] - v[0] > best[1] - best[0]) ? v : best, perimeter[0]);
  
  // Connect corners to ridge endpoints based on orientation
  if (isWider) {
    // Horizontal ridge: west corners → ridgeStart, east corners → ridgeEnd
    hips.push({ id: 'hip_0', start: sw, end: ridgeStart, lengthFt: distanceFt(sw, ridgeStart) });
    hips.push({ id: 'hip_1', start: nw, end: ridgeStart, lengthFt: distanceFt(nw, ridgeStart) });
    hips.push({ id: 'hip_2', start: se, end: ridgeEnd, lengthFt: distanceFt(se, ridgeEnd) });
    hips.push({ id: 'hip_3', start: ne, end: ridgeEnd, lengthFt: distanceFt(ne, ridgeEnd) });
  } else {
    // Vertical ridge: south corners → ridgeStart, north corners → ridgeEnd
    hips.push({ id: 'hip_0', start: sw, end: ridgeStart, lengthFt: distanceFt(sw, ridgeStart) });
    hips.push({ id: 'hip_1', start: se, end: ridgeStart, lengthFt: distanceFt(se, ridgeStart) });
    hips.push({ id: 'hip_2', start: nw, end: ridgeEnd, lengthFt: distanceFt(nw, ridgeEnd) });
    hips.push({ id: 'hip_3', start: ne, end: ridgeEnd, lengthFt: distanceFt(ne, ridgeEnd) });
  }
  
  // Classify perimeter edges as eaves or rakes
  const eaves: AssembledLine[] = [];
  const rakes: AssembledLine[] = [];
  classifyPerimeterEdges(perimeter, isWider, eaves, rakes);
  
  return {
    facets,
    ridges,
    hips,
    valleys: [],
    eaves,
    rakes,
    quality: facets.length >= 2 ? 'good' : 'fair',
    warnings: [...warnings, 'Used azimuth clustering - positions may be approximate'],
    structureAnalysis
  };
}

/**
 * Create fallback geometry when no Solar segment data is usable
 */
function createFallbackGeometry(
  perimeter: XY[],
  pitch: string,
  warnings: string[],
  structureAnalysis?: StructureAnalysis
): AssembledGeometry {
  const centroid = getCentroid(perimeter);
  const bounds = getBounds(perimeter);
  
  // Use structure analysis for ridge direction if available
  let isWider = (bounds.maxX - bounds.minX) > (bounds.maxY - bounds.minY);
  if (structureAnalysis?.mainStructure?.ridgeDirection) {
    isWider = structureAnalysis.mainStructure.ridgeDirection === 'east-west';
  }
  
  // Single ridge through center
  const ridgeStart: XY = isWider 
    ? [bounds.minX + (bounds.maxX - bounds.minX) * 0.25, (bounds.minY + bounds.maxY) / 2]
    : [(bounds.minX + bounds.maxX) / 2, bounds.minY + (bounds.maxY - bounds.minY) * 0.25];
  const ridgeEnd: XY = isWider
    ? [bounds.maxX - (bounds.maxX - bounds.minX) * 0.25, (bounds.minY + bounds.maxY) / 2]
    : [(bounds.minX + bounds.maxX) / 2, bounds.maxY - (bounds.maxY - bounds.minY) * 0.25];
  
  // Single facet = entire perimeter
  const facets: AssembledFacet[] = [{
    id: 'facet_0',
    index: 0,
    polygon: [...perimeter, perimeter[0]],
    areaSqft: calculatePolygonAreaSqft(perimeter),
    pitch,
    azimuthDegrees: 0,
    direction: 'Mixed',
    color: FACET_COLORS[0],
    sourceSegmentIndex: -1
  }];
  
  // Classify perimeter edges as eaves/rakes for fallback
  // Note: isWider is already declared above, reuse it
  const eaves: AssembledLine[] = [];
  const rakes: AssembledLine[] = [];
  classifyPerimeterEdges(perimeter, isWider, eaves, rakes);
  
  return {
    facets,
    ridges: [{ id: 'ridge_0', start: ridgeStart, end: ridgeEnd, lengthFt: distanceFt(ridgeStart, ridgeEnd) }],
    hips: [],
    valleys: [],
    eaves,
    rakes,
    quality: 'fair',
    warnings: [...warnings, 'Using perimeter-only fallback'],
    structureAnalysis
  };
}

// ===== Helper Functions =====

function getCentroid(vertices: XY[]): XY {
  const sumX = vertices.reduce((sum, v) => sum + v[0], 0);
  const sumY = vertices.reduce((sum, v) => sum + v[1], 0);
  return [sumX / vertices.length, sumY / vertices.length];
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

function getDirectionFromAzimuth(azimuth: number): string {
  const normalized = ((azimuth % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return 'N';
  if (normalized >= 22.5 && normalized < 67.5) return 'NE';
  if (normalized >= 67.5 && normalized < 112.5) return 'E';
  if (normalized >= 112.5 && normalized < 157.5) return 'SE';
  if (normalized >= 157.5 && normalized < 202.5) return 'S';
  if (normalized >= 202.5 && normalized < 247.5) return 'SW';
  if (normalized >= 247.5 && normalized < 292.5) return 'W';
  return 'NW';
}

function getCardinalDirection(azimuth: number): string {
  const normalized = ((azimuth % 360) + 360) % 360;
  if (normalized >= 315 || normalized < 45) return 'N';
  if (normalized >= 45 && normalized < 135) return 'E';
  if (normalized >= 135 && normalized < 225) return 'S';
  return 'W';
}

function degreesToPitch(degrees: number): string {
  if (!degrees || degrees <= 0) return '';
  const rise = Math.round(Math.tan(degrees * Math.PI / 180) * 12);
  return `${rise}/12`;
}

function distanceXY(p1: XY, p2: XY): number {
  return Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));
}

function distanceFt(p1: XY, p2: XY): number {
  // Approximate using haversine for small distances
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
  
  // Convert to local meters then calculate area
  const centroid = getCentroid(vertices);
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos(centroid[1] * Math.PI / 180);
  
  const localVertices = vertices.map(v => [
    (v[0] - centroid[0]) * metersPerDegreeLng,
    (v[1] - centroid[1]) * metersPerDegreeLat
  ]);
  
  // Shoelace formula
  let area = 0;
  for (let i = 0; i < localVertices.length; i++) {
    const j = (i + 1) % localVertices.length;
    area += localVertices[i][0] * localVertices[j][1];
    area -= localVertices[j][0] * localVertices[i][1];
  }
  
  return Math.abs(area / 2) * 10.764; // Convert to sqft
}

function findFacetVerticesForSegment(
  perimeter: XY[],
  segmentCenter: XY,
  azimuth: number,
  centroid: XY
): XY[] {
  // Determine which side of the roof this segment is on based on azimuth
  const normalizedAzimuth = ((azimuth % 360) + 360) % 360;
  
  // For each perimeter vertex, check if it's on the correct side for this azimuth
  return perimeter.filter(vertex => {
    // Calculate angle from centroid to vertex
    const dx = vertex[0] - centroid[0];
    const dy = vertex[1] - centroid[1];
    const angleToVertex = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    
    // Azimuth points outward from roof surface, so vertices facing that direction
    // should be within 90 degrees of the azimuth
    const angleDiff = Math.abs(angleToVertex - normalizedAzimuth);
    const normalizedDiff = angleDiff > 180 ? 360 - angleDiff : angleDiff;
    
    return normalizedDiff < 90;
  });
}

function estimateRidgePointForSegment(
  segmentCenter: XY,
  centroid: XY,
  azimuth: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
): XY {
  // Ridge is typically at the center, opposite to the azimuth direction
  // Move from segment center toward centroid
  const dx = centroid[0] - segmentCenter[0];
  const dy = centroid[1] - segmentCenter[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  if (dist < 0.00001) return centroid;
  
  // Place ridge point between segment center and centroid
  return [
    segmentCenter[0] + dx * 0.7,
    segmentCenter[1] + dy * 0.7
  ];
}

function createFacetPolygonWithRidge(vertices: XY[], ridgePoint: XY): XY[] {
  if (vertices.length === 0) return [];
  
  // Sort vertices by angle around ridge point
  const sorted = [...vertices].sort((a, b) => {
    const angleA = Math.atan2(a[1] - ridgePoint[1], a[0] - ridgePoint[0]);
    const angleB = Math.atan2(b[1] - ridgePoint[1], b[0] - ridgePoint[0]);
    return angleA - angleB;
  });
  
  // Create closed polygon
  return [...sorted, ridgePoint, sorted[0]];
}

/**
 * Derive linear features (ridges, hips, valleys) from facets.
 * 
 * Proper geometry: 
 * - Ridge runs through center as a spine
 * - Hips connect perimeter corners to ridge endpoints based on orientation
 *   (not just distance-based)
 */
function deriveLinearFeaturesFromFacets(
  facets: AssembledFacet[],
  perimeter: XY[],
  centroid: XY,
  structureAnalysis?: StructureAnalysis
): { ridges: AssembledLine[]; hips: AssembledLine[]; valleys: AssembledLine[]; eaves: AssembledLine[]; rakes: AssembledLine[] } {
  const ridges: AssembledLine[] = [];
  const hips: AssembledLine[] = [];
  const valleys: AssembledLine[] = [];
  const eaves: AssembledLine[] = [];
  const rakes: AssembledLine[] = [];
  
  if (facets.length >= 2) {
    const bounds = getBounds(perimeter);
    
    // Use structure analysis for ridge direction if available
    let isWider = (bounds.maxX - bounds.minX) > (bounds.maxY - bounds.minY);
    if (structureAnalysis?.mainStructure?.ridgeDirection) {
      isWider = structureAnalysis.mainStructure.ridgeDirection === 'east-west';
    }
    
    const inset = isWider 
      ? (bounds.maxY - bounds.minY) * 0.4
      : (bounds.maxX - bounds.minX) * 0.4;
    
    let ridgeStart: XY, ridgeEnd: XY;
    if (isWider) {
      // Horizontal ridge: ridgeStart is west, ridgeEnd is east
      ridgeStart = [bounds.minX + inset, (bounds.minY + bounds.maxY) / 2];
      ridgeEnd = [bounds.maxX - inset, (bounds.minY + bounds.maxY) / 2];
    } else {
      // Vertical ridge: ridgeStart is south, ridgeEnd is north
      ridgeStart = [(bounds.minX + bounds.maxX) / 2, bounds.minY + inset];
      ridgeEnd = [(bounds.minX + bounds.maxX) / 2, bounds.maxY - inset];
    }
    
    ridges.push({
      id: 'ridge_0',
      start: ridgeStart,
      end: ridgeEnd,
      lengthFt: distanceFt(ridgeStart, ridgeEnd)
    });
    
    // Find corners by position (SW, SE, NE, NW)
    const sw = perimeter.reduce((best, v) => 
      (v[1] + v[0] < best[1] + best[0]) ? v : best, perimeter[0]);
    const ne = perimeter.reduce((best, v) => 
      (v[1] + v[0] > best[1] + best[0]) ? v : best, perimeter[0]);
    const se = perimeter.reduce((best, v) => 
      (v[0] - v[1] > best[0] - best[1]) ? v : best, perimeter[0]);
    const nw = perimeter.reduce((best, v) => 
      (v[1] - v[0] > best[1] - best[0]) ? v : best, perimeter[0]);
    
    // Connect corners to ridge endpoints based on orientation
    if (isWider) {
      // Horizontal ridge: west corners → ridgeStart, east corners → ridgeEnd
      hips.push({ id: 'hip_0', start: sw, end: ridgeStart, lengthFt: distanceFt(sw, ridgeStart) });
      hips.push({ id: 'hip_1', start: nw, end: ridgeStart, lengthFt: distanceFt(nw, ridgeStart) });
      hips.push({ id: 'hip_2', start: se, end: ridgeEnd, lengthFt: distanceFt(se, ridgeEnd) });
      hips.push({ id: 'hip_3', start: ne, end: ridgeEnd, lengthFt: distanceFt(ne, ridgeEnd) });
    } else {
      // Vertical ridge: south corners → ridgeStart, north corners → ridgeEnd
      hips.push({ id: 'hip_0', start: sw, end: ridgeStart, lengthFt: distanceFt(sw, ridgeStart) });
      hips.push({ id: 'hip_1', start: se, end: ridgeStart, lengthFt: distanceFt(se, ridgeStart) });
      hips.push({ id: 'hip_2', start: nw, end: ridgeEnd, lengthFt: distanceFt(nw, ridgeEnd) });
      hips.push({ id: 'hip_3', start: ne, end: ridgeEnd, lengthFt: distanceFt(ne, ridgeEnd) });
    }
    
    // Classify perimeter edges as eaves or rakes based on ridge orientation
    classifyPerimeterEdges(perimeter, isWider, eaves, rakes);
  }
  
  return { ridges, hips, valleys, eaves, rakes };
}

/**
 * Classify perimeter edges as eaves or rakes based on ridge orientation
 * - Eaves: horizontal edges (parallel to ridge for horizontal ridge, perpendicular for vertical)
 * - Rakes: sloped edges on gable ends
 * 
 * For hip roofs, most perimeter edges are eaves
 */
function classifyPerimeterEdges(
  perimeter: XY[],
  isHorizontalRidge: boolean,
  eaves: AssembledLine[],
  rakes: AssembledLine[]
): void {
  const n = perimeter.length;
  
  for (let i = 0; i < n; i++) {
    const start = perimeter[i];
    const end = perimeter[(i + 1) % n];
    
    // Skip very short edges
    const length = distanceFt(start, end);
    if (length < 2) continue;
    
    // Calculate edge angle (0° = east, 90° = north)
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
    
    // Normalize to 0-90 range
    const normalizedAngle = angle > 90 ? 180 - angle : angle;
    
    // For hip roofs, all perimeter edges are typically eaves
    // For gable roofs:
    // - Horizontal ridge: North/South edges are eaves, East/West edges are rakes
    // - Vertical ridge: East/West edges are eaves, North/South edges are rakes
    
    // Classify based on edge orientation relative to ridge
    // If ridge is horizontal (E-W), then N-S edges are eaves (angles near 90°)
    // If ridge is vertical (N-S), then E-W edges are eaves (angles near 0°)
    
    const isEave = isHorizontalRidge 
      ? normalizedAngle > 45  // Edge runs more N-S = eave for horizontal ridge
      : normalizedAngle <= 45; // Edge runs more E-W = eave for vertical ridge
    
    if (isEave) {
      eaves.push({
        id: `eave_${eaves.length}`,
        start,
        end,
        lengthFt: length
      });
    } else {
      rakes.push({
        id: `rake_${rakes.length}`,
        start,
        end,
        lengthFt: length
      });
    }
  }
  
  console.log(`📐 Classified perimeter: ${eaves.length} eaves (${eaves.reduce((s, e) => s + e.lengthFt, 0).toFixed(0)} ft), ${rakes.length} rakes (${rakes.reduce((s, r) => s + r.lengthFt, 0).toFixed(0)} ft)`);
}

function findPerimeterEdgesFacing(
  perimeter: XY[],
  direction: string,
  centroid: XY
): { start: XY; end: XY }[] {
  const edges: { start: XY; end: XY }[] = [];
  
  // Map direction to angle range
  const directionAngles: Record<string, [number, number]> = {
    'N': [315, 45],
    'E': [45, 135],
    'S': [135, 225],
    'W': [225, 315]
  };
  
  const [minAngle, maxAngle] = directionAngles[direction] || [0, 360];
  
  for (let i = 0; i < perimeter.length; i++) {
    const start = perimeter[i];
    const end = perimeter[(i + 1) % perimeter.length];
    
    // Calculate edge midpoint and its angle from centroid
    const midX = (start[0] + end[0]) / 2;
    const midY = (start[1] + end[1]) / 2;
    const dx = midX - centroid[0];
    const dy = midY - centroid[1];
    const angle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
    
    // Check if edge faces the target direction
    let isInRange = false;
    if (minAngle > maxAngle) {
      // Wraps around 360 (e.g., N: 315-45)
      isInRange = angle >= minAngle || angle < maxAngle;
    } else {
      isInRange = angle >= minAngle && angle < maxAngle;
    }
    
    if (isInRange) {
      edges.push({ start, end });
    }
  }
  
  return edges;
}

function removeDuplicateVertices(vertices: XY[]): XY[] {
  const unique: XY[] = [];
  const threshold = 0.000001;
  
  vertices.forEach(v => {
    const isDuplicate = unique.some(u => 
      Math.abs(u[0] - v[0]) < threshold && Math.abs(u[1] - v[1]) < threshold
    );
    if (!isDuplicate) {
      unique.push(v);
    }
  });
  
  return unique;
}

function findCorners(perimeter: XY[]): XY[] {
  if (perimeter.length < 4) return [...perimeter];
  
  // Find vertices with significant angle changes (corners)
  const corners: XY[] = [];
  const n = perimeter.length;
  
  for (let i = 0; i < n; i++) {
    const prev = perimeter[(i - 1 + n) % n];
    const curr = perimeter[i];
    const next = perimeter[(i + 1) % n];
    
    // Calculate angle change
    const v1x = curr[0] - prev[0];
    const v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0];
    const v2y = next[1] - curr[1];
    
    const cross = v1x * v2y - v1y * v2x;
    const dot = v1x * v2x + v1y * v2y;
    const angle = Math.abs(Math.atan2(cross, dot) * 180 / Math.PI);
    
    // Significant angle change = corner
    if (angle > 30) {
      corners.push(curr);
    }
  }
  
  // If too few corners found, return bounds corners
  if (corners.length < 4) {
    const bounds = getBounds(perimeter);
    return [
      [bounds.minX, bounds.minY],
      [bounds.maxX, bounds.minY],
      [bounds.maxX, bounds.maxY],
      [bounds.minX, bounds.maxY]
    ];
  }
  
  return corners;
}
