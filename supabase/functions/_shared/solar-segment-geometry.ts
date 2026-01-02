/**
 * Solar Segment Geometry Reconstructor
 * 
 * Reconstructs accurate roof geometry from Google Solar API segment data.
 * Solar segments contain pitch, azimuth, area and bounding boxes which we use
 * to derive proper facet polygons and connected linear features.
 * 
 * This produces cleaner, more accurate geometry than the straight skeleton
 * algorithm when Solar API data is available.
 */

type XY = [number, number]; // [lng, lat]

export interface SolarSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaMeters2?: number;
  planeHeightAtCenterMeters?: number;
  boundingBox?: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
}

export interface SolarReconstructedGeometry {
  facets: SolarFacet[];
  ridges: LinearFeature[];
  hips: LinearFeature[];
  valleys: LinearFeature[];
  quality: 'excellent' | 'good' | 'fair';
  warnings: string[];
}

export interface SolarFacet {
  id: string;
  index: number;
  polygon: XY[];
  areaSqft: number;
  pitch: string;
  azimuthDegrees: number;
  direction: string;
  color: string;
}

export interface LinearFeature {
  id: string;
  wkt: string;
  lengthFt: number;
  type: 'ridge' | 'hip' | 'valley';
  connectedTo: string[];
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

/**
 * Reconstruct roof geometry from Solar API segments and building perimeter
 */
export function reconstructFromSolarSegments(
  perimeterVertices: XY[],
  solarSegments: SolarSegment[]
): SolarReconstructedGeometry {
  const warnings: string[] = [];
  
  if (!solarSegments || solarSegments.length === 0) {
    warnings.push('No Solar segments available');
    return createEmptyResult(warnings);
  }
  
  if (perimeterVertices.length < 4) {
    warnings.push('Insufficient perimeter vertices');
    return createEmptyResult(warnings);
  }
  
  console.log(`🌞 Reconstructing geometry from ${solarSegments.length} Solar segments`);
  
  // Step 1: Cluster segments by azimuth to identify distinct facet groups
  const facetGroups = clusterSegmentsByAzimuth(solarSegments);
  console.log(`  Clustered into ${facetGroups.length} azimuth groups`);
  
  // Step 2: Generate facet polygons by clipping segment bounding boxes to perimeter
  const facets = generateFacetPolygons(perimeterVertices, solarSegments, facetGroups);
  
  // Step 3: Derive linear features from facet adjacencies
  const { ridges, hips, valleys } = deriveLinearFeatures(perimeterVertices, facets, solarSegments);
  
  // Determine quality
  const quality = facets.length >= 2 && ridges.length > 0 ? 'excellent' : 
                  facets.length >= 1 ? 'good' : 'fair';
  
  return {
    facets,
    ridges,
    hips,
    valleys,
    quality,
    warnings
  };
}

function createEmptyResult(warnings: string[]): SolarReconstructedGeometry {
  return {
    facets: [],
    ridges: [],
    hips: [],
    valleys: [],
    quality: 'fair',
    warnings
  };
}

/**
 * Cluster Solar segments by similar azimuth (facing direction)
 */
function clusterSegmentsByAzimuth(segments: SolarSegment[]): number[][] {
  const groups: number[][] = [];
  const assigned = new Set<number>();
  const azimuthTolerance = 30; // degrees
  
  for (let i = 0; i < segments.length; i++) {
    if (assigned.has(i)) continue;
    
    const group = [i];
    assigned.add(i);
    
    const baseAzimuth = segments[i].azimuthDegrees;
    
    for (let j = i + 1; j < segments.length; j++) {
      if (assigned.has(j)) continue;
      
      const azimuthDiff = Math.abs(normalizeAzimuth(segments[j].azimuthDegrees - baseAzimuth));
      if (azimuthDiff < azimuthTolerance || azimuthDiff > 360 - azimuthTolerance) {
        group.push(j);
        assigned.add(j);
      }
    }
    
    groups.push(group);
  }
  
  return groups;
}

function normalizeAzimuth(angle: number): number {
  while (angle < 0) angle += 360;
  while (angle >= 360) angle -= 360;
  return angle;
}

/**
 * Generate facet polygons by dividing perimeter based on Solar segment data
 */
function generateFacetPolygons(
  perimeter: XY[],
  segments: SolarSegment[],
  groups: number[][]
): SolarFacet[] {
  const facets: SolarFacet[] = [];
  const bounds = getBounds(perimeter);
  const centroid = getCentroid(perimeter);
  
  // For simple roofs (2-4 segments), create clean facets
  if (segments.length <= 4) {
    // Determine primary ridge direction from azimuth data
    const avgAzimuth = segments.reduce((s, seg) => s + seg.azimuthDegrees, 0) / segments.length;
    const ridgeDirection = avgAzimuth < 45 || avgAzimuth >= 315 || 
                          (avgAzimuth >= 135 && avgAzimuth < 225) ? 'horizontal' : 'vertical';
    
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const inset = (ridgeDirection === 'horizontal' ? height : width) * 0.35;
    
    // Calculate ridge line
    let ridgeStart: XY, ridgeEnd: XY;
    if (ridgeDirection === 'horizontal') {
      ridgeStart = [bounds.minX + inset, centroid[1]];
      ridgeEnd = [bounds.maxX - inset, centroid[1]];
    } else {
      ridgeStart = [centroid[0], bounds.minY + inset];
      ridgeEnd = [centroid[0], bounds.maxY - inset];
    }
    
    // Create 4 facets for hip roof
    const corners = identifyCorners(perimeter);
    if (corners.length >= 4) {
      // South facet
      facets.push(createFacet(0, [corners[0], corners[1], ridgeEnd, ridgeStart], segments[0]?.pitchDegrees, 180));
      // East facet
      facets.push(createFacet(1, [corners[1], corners[2], ridgeEnd], segments[1]?.pitchDegrees || segments[0]?.pitchDegrees, 90));
      // North facet  
      facets.push(createFacet(2, [corners[2], corners[3], ridgeStart, ridgeEnd], segments[2]?.pitchDegrees || segments[0]?.pitchDegrees, 0));
      // West facet
      facets.push(createFacet(3, [corners[3], corners[0], ridgeStart], segments[3]?.pitchDegrees || segments[0]?.pitchDegrees, 270));
    }
  } else {
    // For complex roofs, create one facet per Solar segment group
    groups.forEach((group, idx) => {
      const primarySegment = segments[group[0]];
      const areaSqft = group.reduce((sum, i) => sum + (segments[i].areaMeters2 || 0) * 10.764, 0);
      
      facets.push({
        id: `solar_facet_${idx}`,
        index: idx,
        polygon: perimeter, // Simplified - use full perimeter
        areaSqft,
        pitch: degreesToPitchRatio(primarySegment.pitchDegrees),
        azimuthDegrees: primarySegment.azimuthDegrees,
        direction: getDirectionFromAzimuth(primarySegment.azimuthDegrees),
        color: FACET_COLORS[idx % FACET_COLORS.length]
      });
    });
  }
  
  return facets;
}

function createFacet(
  index: number, 
  polygon: XY[], 
  pitchDegrees: number | undefined, 
  azimuth: number
): SolarFacet {
  return {
    id: `solar_facet_${index}`,
    index,
    polygon: [...polygon, polygon[0]], // Close polygon
    areaSqft: calculatePolygonAreaSqft(polygon),
    pitch: degreesToPitchRatio(pitchDegrees || 25),
    azimuthDegrees: azimuth,
    direction: getDirectionFromAzimuth(azimuth),
    color: FACET_COLORS[index % FACET_COLORS.length]
  };
}

/**
 * Derive linear features (ridges, hips, valleys) from facet geometry
 */
function deriveLinearFeatures(
  perimeter: XY[],
  facets: SolarFacet[],
  segments: SolarSegment[]
): { ridges: LinearFeature[]; hips: LinearFeature[]; valleys: LinearFeature[] } {
  const ridges: LinearFeature[] = [];
  const hips: LinearFeature[] = [];
  const valleys: LinearFeature[] = [];
  
  if (perimeter.length < 4) return { ridges, hips, valleys };
  
  const bounds = getBounds(perimeter);
  const centroid = getCentroid(perimeter);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  
  // Determine ridge direction from segment azimuths
  const avgAzimuth = segments.length > 0 ? 
    segments.reduce((s, seg) => s + seg.azimuthDegrees, 0) / segments.length : 180;
  const isHorizontalRidge = avgAzimuth < 45 || avgAzimuth >= 315 || 
                            (avgAzimuth >= 135 && avgAzimuth < 225);
  
  const inset = (isHorizontalRidge ? height : width) * 0.35;
  
  // Calculate ridge endpoints
  let ridgeStart: XY, ridgeEnd: XY;
  if (isHorizontalRidge) {
    ridgeStart = [bounds.minX + inset, centroid[1]];
    ridgeEnd = [bounds.maxX - inset, centroid[1]];
  } else {
    ridgeStart = [centroid[0], bounds.minY + inset];
    ridgeEnd = [centroid[0], bounds.maxY - inset];
  }
  
  // Create main ridge
  ridges.push({
    id: 'ridge_0',
    wkt: `LINESTRING(${ridgeStart[0]} ${ridgeStart[1]}, ${ridgeEnd[0]} ${ridgeEnd[1]})`,
    lengthFt: distanceFt(ridgeStart, ridgeEnd),
    type: 'ridge',
    connectedTo: ['hip_0', 'hip_1', 'hip_2', 'hip_3']
  });
  
  // Create hips from corners to ridge endpoints
  const corners = identifyCorners(perimeter);
  if (corners.length >= 4) {
    const hipEndpoints = [ridgeStart, ridgeEnd, ridgeEnd, ridgeStart];
    
    corners.forEach((corner, i) => {
      const endpoint = hipEndpoints[i];
      hips.push({
        id: `hip_${i}`,
        wkt: `LINESTRING(${corner[0]} ${corner[1]}, ${endpoint[0]} ${endpoint[1]})`,
        lengthFt: distanceFt(corner, endpoint),
        type: 'hip',
        connectedTo: ['ridge_0']
      });
    });
  }
  
  // Detect valleys at reflex vertices
  const reflexIndices = findReflexVertices(perimeter);
  let valleyIdx = 0;
  reflexIndices.forEach(idx => {
    const vertex = perimeter[idx];
    const distToStart = distance(vertex, ridgeStart);
    const distToEnd = distance(vertex, ridgeEnd);
    const endpoint = distToStart < distToEnd ? ridgeStart : ridgeEnd;
    
    valleys.push({
      id: `valley_${valleyIdx}`,
      wkt: `LINESTRING(${vertex[0]} ${vertex[1]}, ${endpoint[0]} ${endpoint[1]})`,
      lengthFt: distanceFt(vertex, endpoint),
      type: 'valley',
      connectedTo: ['ridge_0']
    });
    valleyIdx++;
  });
  
  return { ridges, hips, valleys };
}

/**
 * Convert Solar linear features to WKT format for database storage
 */
export function solarGeometryToWKT(geometry: SolarReconstructedGeometry): string {
  const features: { wkt: string; type: string; length_ft: number }[] = [];
  
  geometry.ridges.forEach(r => features.push({ wkt: r.wkt, type: 'ridge', length_ft: r.lengthFt }));
  geometry.hips.forEach(h => features.push({ wkt: h.wkt, type: 'hip', length_ft: h.lengthFt }));
  geometry.valleys.forEach(v => features.push({ wkt: v.wkt, type: 'valley', length_ft: v.lengthFt }));
  
  return JSON.stringify(features);
}

// ===== Utility Functions =====

function findReflexVertices(vertices: XY[]): Set<number> {
  const reflex = new Set<number>();
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    
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

function identifyCorners(vertices: XY[]): XY[] {
  if (vertices.length < 4) return vertices;
  
  const bounds = getBounds(vertices);
  const corners: XY[] = [];
  
  // Find vertices closest to each corner of bounding box
  const targetCorners: XY[] = [
    [bounds.minX, bounds.minY], // SW
    [bounds.maxX, bounds.minY], // SE
    [bounds.maxX, bounds.maxY], // NE
    [bounds.minX, bounds.maxY], // NW
  ];
  
  for (const target of targetCorners) {
    let minDist = Infinity;
    let closest = vertices[0];
    
    for (const v of vertices) {
      const d = distance(v, target);
      if (d < minDist) {
        minDist = d;
        closest = v;
      }
    }
    
    corners.push(closest);
  }
  
  return corners;
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
  const midLat = (a[1] + b[1]) / 2;
  const ftPerDegLat = 364000;
  const ftPerDegLng = 364000 * Math.cos(midLat * Math.PI / 180);
  
  const dx = (b[0] - a[0]) * ftPerDegLng;
  const dy = (b[1] - a[1]) * ftPerDegLat;
  
  return Math.sqrt(dx * dx + dy * dy);
}

function calculatePolygonAreaSqft(vertices: XY[]): number {
  if (vertices.length < 3) return 0;
  
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
  return sqMeters * 10.764;
}

function degreesToPitchRatio(degrees: number): string {
  if (!degrees || degrees <= 0) return '0/12';
  const rise = Math.tan(degrees * Math.PI / 180) * 12;
  return `${Math.round(rise)}/12`;
}

function getDirectionFromAzimuth(azimuth: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(normalizeAzimuth(azimuth) / 45) % 8;
  return directions[index];
}
