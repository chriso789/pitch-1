/**
 * Segment Geometry Parser
 * 
 * Parses Google Solar API roof segments with bounding boxes to create:
 * 1. Accurate facet polygons from segment bounding boxes
 * 2. Linear features derived from segment adjacencies (ridges, hips, valleys)
 * 3. Perimeter edges classified as eaves and rakes
 */

export interface SolarSegment {
  pitchDegrees?: number;
  azimuthDegrees?: number;
  areaMeters2?: number;
  planeHeightAtCenter?: number;
  boundingBox?: {
    sw?: { latitude: number; longitude: number };
    ne?: { latitude: number; longitude: number };
  };
}

export interface GPSCoord {
  lat: number;
  lng: number;
}

export interface SegmentPolygon {
  id: string;
  segmentIndex: number;
  polygon: GPSCoord[];
  centroid: GPSCoord;
  areaSqft: number;
  pitchDegrees: number;
  azimuthDegrees: number;
  planeHeight: number;
}

export interface DetectedEdge {
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  start: GPSCoord;
  end: GPSCoord;
  lengthFt: number;
  confidence: number;
  segmentIndices: number[];
}

export interface ParsedRoofGeometry {
  segments: SegmentPolygon[];
  edges: DetectedEdge[];
  boundingBox: { sw: GPSCoord; ne: GPSCoord };
  totalAreaSqft: number;
}

/**
 * Parse Solar API segments into polygon geometry
 */
export function parseSolarSegments(
  solarSegments: SolarSegment[],
  buildingCenter?: GPSCoord
): ParsedRoofGeometry {
  if (!solarSegments || solarSegments.length === 0) {
    return {
      segments: [],
      edges: [],
      boundingBox: { 
        sw: { lat: 0, lng: 0 }, 
        ne: { lat: 0, lng: 0 } 
      },
      totalAreaSqft: 0
    };
  }

  // Convert segments to polygons
  const segmentPolygons = solarSegments
    .map((seg, index) => segmentToPolygon(seg, index))
    .filter((p): p is SegmentPolygon => p !== null);

  if (segmentPolygons.length === 0) {
    return {
      segments: [],
      edges: [],
      boundingBox: { sw: { lat: 0, lng: 0 }, ne: { lat: 0, lng: 0 } },
      totalAreaSqft: 0
    };
  }

  // Calculate overall bounding box
  const allCoords = segmentPolygons.flatMap(s => s.polygon);
  const boundingBox = {
    sw: {
      lat: Math.min(...allCoords.map(c => c.lat)),
      lng: Math.min(...allCoords.map(c => c.lng))
    },
    ne: {
      lat: Math.max(...allCoords.map(c => c.lat)),
      lng: Math.max(...allCoords.map(c => c.lng))
    }
  };

  // Detect edges from segment adjacencies
  const edges = detectEdgesFromSegments(segmentPolygons, boundingBox);

  // Calculate total area
  const totalAreaSqft = segmentPolygons.reduce((sum, s) => sum + s.areaSqft, 0);

  return {
    segments: segmentPolygons,
    edges,
    boundingBox,
    totalAreaSqft
  };
}

/**
 * Convert a Solar API segment bounding box to a polygon
 */
function segmentToPolygon(segment: SolarSegment, index: number): SegmentPolygon | null {
  const bbox = segment.boundingBox;
  if (!bbox?.sw || !bbox?.ne) {
    return null;
  }

  const sw = { lat: bbox.sw.latitude, lng: bbox.sw.longitude };
  const ne = { lat: bbox.ne.latitude, lng: bbox.ne.longitude };
  
  // Create 4-corner polygon from bounding box (clockwise from SW)
  const polygon: GPSCoord[] = [
    sw,                           // SW corner
    { lat: sw.lat, lng: ne.lng }, // SE corner
    ne,                           // NE corner  
    { lat: ne.lat, lng: sw.lng }, // NW corner
    sw                            // Close polygon
  ];

  // Calculate centroid
  const centroid = {
    lat: (sw.lat + ne.lat) / 2,
    lng: (sw.lng + ne.lng) / 2
  };

  // Calculate area in sq ft from bounding box dimensions
  const widthM = haversineDistance(sw, { lat: sw.lat, lng: ne.lng });
  const heightM = haversineDistance(sw, { lat: ne.lat, lng: sw.lng });
  const areaSqft = (widthM * heightM) * 10.764; // m² to ft²

  return {
    id: `segment-${index}`,
    segmentIndex: index,
    polygon,
    centroid,
    areaSqft,
    pitchDegrees: segment.pitchDegrees || 0,
    azimuthDegrees: segment.azimuthDegrees || 0,
    planeHeight: segment.planeHeightAtCenter || 0
  };
}

/**
 * Detect edges by analyzing segment adjacencies
 */
function detectEdgesFromSegments(
  segments: SegmentPolygon[],
  boundingBox: { sw: GPSCoord; ne: GPSCoord }
): DetectedEdge[] {
  const edges: DetectedEdge[] = [];
  const ADJACENCY_THRESHOLD_M = 3; // 3 meters tolerance for shared edges

  // Check each pair of segments for shared edges
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const sharedEdge = findSharedEdge(segments[i], segments[j], ADJACENCY_THRESHOLD_M);
      if (sharedEdge) {
        // Classify edge type based on segment properties
        const edgeType = classifySharedEdge(segments[i], segments[j], sharedEdge);
        edges.push({
          ...sharedEdge,
          type: edgeType,
          segmentIndices: [i, j]
        });
      }
    }
  }

  // Classify perimeter edges (edges not shared with other segments)
  const perimeterEdges = detectPerimeterEdges(segments, edges, boundingBox);
  edges.push(...perimeterEdges);

  return edges;
}

/**
 * Find if two segments share an edge (within tolerance)
 */
function findSharedEdge(
  segA: SegmentPolygon,
  segB: SegmentPolygon,
  toleranceM: number
): { start: GPSCoord; end: GPSCoord; lengthFt: number; confidence: number } | null {
  // Get polygon edges for each segment (skip closing edge)
  const edgesA = getPolygonEdges(segA.polygon);
  const edgesB = getPolygonEdges(segB.polygon);

  // Find overlapping/adjacent edges
  for (const edgeA of edgesA) {
    for (const edgeB of edgesB) {
      const overlap = findEdgeOverlap(edgeA, edgeB, toleranceM);
      if (overlap) {
        const lengthFt = haversineDistance(overlap.start, overlap.end) * 3.28084;
        if (lengthFt > 3) { // Minimum 3ft to be significant
          return {
            start: overlap.start,
            end: overlap.end,
            lengthFt,
            confidence: overlap.confidence
          };
        }
      }
    }
  }

  return null;
}

/**
 * Get edges from polygon vertices
 */
function getPolygonEdges(polygon: GPSCoord[]): Array<{ start: GPSCoord; end: GPSCoord }> {
  const edges: Array<{ start: GPSCoord; end: GPSCoord }> = [];
  for (let i = 0; i < polygon.length - 1; i++) {
    edges.push({ start: polygon[i], end: polygon[i + 1] });
  }
  return edges;
}

/**
 * Find overlap between two edges
 */
function findEdgeOverlap(
  edgeA: { start: GPSCoord; end: GPSCoord },
  edgeB: { start: GPSCoord; end: GPSCoord },
  toleranceM: number
): { start: GPSCoord; end: GPSCoord; confidence: number } | null {
  // Check if edges are parallel and close
  const distStartA_B = haversineDistance(edgeA.start, edgeB.start);
  const distEndA_B = haversineDistance(edgeA.end, edgeB.end);
  const distStartA_EndB = haversineDistance(edgeA.start, edgeB.end);
  const distEndA_StartB = haversineDistance(edgeA.end, edgeB.start);

  // Check for matching/reversed edges
  if (distStartA_B < toleranceM && distEndA_B < toleranceM) {
    return {
      start: midpoint(edgeA.start, edgeB.start),
      end: midpoint(edgeA.end, edgeB.end),
      confidence: 1 - (distStartA_B + distEndA_B) / (2 * toleranceM)
    };
  }
  
  if (distStartA_EndB < toleranceM && distEndA_StartB < toleranceM) {
    return {
      start: midpoint(edgeA.start, edgeB.end),
      end: midpoint(edgeA.end, edgeB.start),
      confidence: 1 - (distStartA_EndB + distEndA_StartB) / (2 * toleranceM)
    };
  }

  return null;
}

/**
 * Classify a shared edge as ridge, hip, or valley
 */
function classifySharedEdge(
  segA: SegmentPolygon,
  segB: SegmentPolygon,
  edge: { start: GPSCoord; end: GPSCoord }
): 'ridge' | 'hip' | 'valley' {
  // Calculate edge direction
  const edgeAzimuth = calculateAzimuth(edge.start, edge.end);
  
  // Get segment azimuths (facing direction)
  const azimuthA = segA.azimuthDegrees;
  const azimuthB = segB.azimuthDegrees;
  
  // Calculate relative angles
  const angleDiffAB = Math.abs(normalizeAngle(azimuthA - azimuthB));
  
  // If segments face opposite directions (±180°), it's likely a ridge
  if (angleDiffAB > 150 && angleDiffAB < 210) {
    return 'ridge';
  }
  
  // If segments face similar directions with different heights, it's a hip or valley
  const heightDiff = Math.abs(segA.planeHeight - segB.planeHeight);
  
  // Check if edge runs roughly perpendicular to both segments' facing directions
  const perpToA = Math.abs(normalizeAngle(edgeAzimuth - azimuthA - 90));
  const perpToB = Math.abs(normalizeAngle(edgeAzimuth - azimuthB - 90));
  
  if (perpToA < 45 && perpToB < 45) {
    // Edge runs along the slope direction - likely a hip
    // Higher plane toward ridge = hip, lower = valley
    const avgAzimuthToEdge = (normalizeAngle(azimuthA - edgeAzimuth) + normalizeAngle(azimuthB - edgeAzimuth)) / 2;
    return avgAzimuthToEdge > 0 ? 'hip' : 'valley';
  }
  
  // Default to hip if unclear
  return 'hip';
}

/**
 * Detect perimeter edges (eaves and rakes)
 */
function detectPerimeterEdges(
  segments: SegmentPolygon[],
  sharedEdges: DetectedEdge[],
  boundingBox: { sw: GPSCoord; ne: GPSCoord }
): DetectedEdge[] {
  const perimeterEdges: DetectedEdge[] = [];
  const TOLERANCE_M = 2;

  for (let segIndex = 0; segIndex < segments.length; segIndex++) {
    const segment = segments[segIndex];
    const polyEdges = getPolygonEdges(segment.polygon);

    for (const edge of polyEdges) {
      // Check if this edge is already a shared edge
      const isShared = sharedEdges.some(se => 
        (haversineDistance(se.start, edge.start) < TOLERANCE_M && 
         haversineDistance(se.end, edge.end) < TOLERANCE_M) ||
        (haversineDistance(se.start, edge.end) < TOLERANCE_M && 
         haversineDistance(se.end, edge.start) < TOLERANCE_M)
      );

      if (!isShared) {
        // This is a perimeter edge - classify as eave or rake
        const edgeType = classifyPerimeterEdge(edge, segment, boundingBox);
        const lengthFt = haversineDistance(edge.start, edge.end) * 3.28084;
        
        if (lengthFt > 2) { // Minimum 2ft
          perimeterEdges.push({
            type: edgeType,
            start: edge.start,
            end: edge.end,
            lengthFt,
            confidence: 0.8,
            segmentIndices: [segIndex]
          });
        }
      }
    }
  }

  return perimeterEdges;
}

/**
 * Classify a perimeter edge as eave or rake based on position and segment properties
 */
function classifyPerimeterEdge(
  edge: { start: GPSCoord; end: GPSCoord },
  segment: SegmentPolygon,
  boundingBox: { sw: GPSCoord; ne: GPSCoord }
): 'eave' | 'rake' {
  // Calculate edge direction
  const edgeAzimuth = calculateAzimuth(edge.start, edge.end);
  const segmentAzimuth = segment.azimuthDegrees;
  
  // If edge runs perpendicular to segment facing direction, it's an eave
  // If edge runs parallel to segment facing direction, it's a rake
  const angleToSegment = Math.abs(normalizeAngle(edgeAzimuth - segmentAzimuth));
  
  // Within 45° of perpendicular = eave
  if ((angleToSegment > 45 && angleToSegment < 135) || 
      (angleToSegment > 225 && angleToSegment < 315)) {
    return 'eave';
  }
  
  return 'rake';
}

// =====================
// Utility Functions
// =====================

/**
 * Haversine distance in meters
 */
function haversineDistance(p1: GPSCoord, p2: GPSCoord): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + 
            Math.cos(p1.lat * Math.PI / 180) * 
            Math.cos(p2.lat * Math.PI / 180) * 
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate azimuth angle between two points (0 = North, 90 = East)
 */
function calculateAzimuth(from: GPSCoord, to: GPSCoord): number {
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - 
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  
  let azimuth = Math.atan2(y, x) * 180 / Math.PI;
  return (azimuth + 360) % 360;
}

/**
 * Normalize angle to 0-360 range
 */
function normalizeAngle(angle: number): number {
  while (angle < 0) angle += 360;
  while (angle >= 360) angle -= 360;
  return angle;
}

/**
 * Calculate midpoint between two coordinates
 */
function midpoint(p1: GPSCoord, p2: GPSCoord): GPSCoord {
  return {
    lat: (p1.lat + p2.lat) / 2,
    lng: (p1.lng + p2.lng) / 2
  };
}

/**
 * Convert parsed geometry to WKT format for storage
 */
export function segmentPolygonToWKT(segment: SegmentPolygon): string {
  const coords = segment.polygon.map(p => `${p.lng} ${p.lat}`).join(', ');
  return `POLYGON((${coords}))`;
}

/**
 * Convert detected edge to WKT format
 */
export function edgeToWKT(edge: DetectedEdge): { type: string; wkt: string; length_ft: number } {
  return {
    type: edge.type,
    wkt: `LINESTRING(${edge.start.lng} ${edge.start.lat}, ${edge.end.lng} ${edge.end.lat})`,
    length_ft: edge.lengthFt
  };
}
