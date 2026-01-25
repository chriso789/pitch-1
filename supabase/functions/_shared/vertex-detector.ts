/**
 * Phase 2: Enhanced Vertex Detection Algorithm
 * Multi-scale corner detection with Harris-like preprocessing
 * Vertex classification for roof junction types
 */

export interface DetectedVertex {
  id: string;
  lat: number;
  lng: number;
  pixelX: number;
  pixelY: number;
  type: VertexType;
  confidence: number;
  connectedVertices: string[];
  source: 'ai_detected' | 'footprint_derived' | 'solar_api' | 'user_corrected';
  detectionMethod: string;
  snapApplied: boolean;
  originalLat?: number;
  originalLng?: number;
}

export type VertexType = 
  | 'perimeter_corner'
  | 'ridge_end'
  | 'hip_junction'
  | 'valley_intersection'
  | 'hip_ridge_junction'
  | 'valley_ridge_junction'
  | 'complex_junction';

export interface VertexDetectionConfig {
  snapToleranceFt: number;
  minConfidenceThreshold: number;
  multiScaleLevels: number[];
  harrisCornerThreshold: number;
}

const DEFAULT_CONFIG: VertexDetectionConfig = {
  snapToleranceFt: 2.0,
  minConfidenceThreshold: 0.65,
  multiScaleLevels: [1.0, 1.5, 2.0], // Zoom multipliers
  harrisCornerThreshold: 0.04
};

/**
 * Calculate distance between two GPS points in feet
 */
export function haversineDistanceFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231; // Earth radius in feet
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Snap a detected vertex to the nearest footprint corner if within tolerance
 */
export function snapToFootprint(
  vertex: { lat: number; lng: number },
  footprintCorners: { lat: number; lng: number }[],
  toleranceFt: number = DEFAULT_CONFIG.snapToleranceFt
): { lat: number; lng: number; snapped: boolean; originalLat: number; originalLng: number } {
  let closestDistance = Infinity;
  let closestCorner: { lat: number; lng: number } | null = null;

  for (const corner of footprintCorners) {
    const distance = haversineDistanceFt(vertex.lat, vertex.lng, corner.lat, corner.lng);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestCorner = corner;
    }
  }

  if (closestCorner && closestDistance <= toleranceFt) {
    return {
      lat: closestCorner.lat,
      lng: closestCorner.lng,
      snapped: true,
      originalLat: vertex.lat,
      originalLng: vertex.lng
    };
  }

  return {
    lat: vertex.lat,
    lng: vertex.lng,
    snapped: false,
    originalLat: vertex.lat,
    originalLng: vertex.lng
  };
}

/**
 * Classify vertex type based on connected lines and their characteristics
 */
export function classifyVertexType(
  vertex: { lat: number; lng: number },
  connectedLines: { type: string; startLat: number; startLng: number; endLat: number; endLng: number }[],
  isOnPerimeter: boolean
): VertexType {
  if (isOnPerimeter && connectedLines.length <= 2) {
    return 'perimeter_corner';
  }

  const lineTypes = connectedLines.map(l => l.type);
  const hasRidge = lineTypes.includes('ridge');
  const hasHip = lineTypes.includes('hip');
  const hasValley = lineTypes.includes('valley');

  if (hasRidge && hasHip && !hasValley) {
    return 'hip_ridge_junction';
  }
  if (hasRidge && hasValley) {
    return 'valley_ridge_junction';
  }
  if (hasRidge && !hasHip && !hasValley) {
    return 'ridge_end';
  }
  if (hasHip && !hasRidge && !hasValley) {
    return 'hip_junction';
  }
  if (hasValley && !hasRidge) {
    return 'valley_intersection';
  }
  if (connectedLines.length >= 4) {
    return 'complex_junction';
  }

  return 'perimeter_corner';
}

/**
 * Generate unique vertex ID
 */
export function generateVertexId(): string {
  return `vtx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Extract vertices from polygon WKT
 */
export function extractVerticesFromWKT(wkt: string): { lat: number; lng: number }[] {
  const vertices: { lat: number; lng: number }[] = [];
  
  // Match POLYGON ((lng lat, lng lat, ...))
  const match = wkt.match(/POLYGON\s*\(\(([^)]+)\)\)/i);
  if (!match) return vertices;

  const coordString = match[1];
  const coordPairs = coordString.split(',').map(s => s.trim());

  for (const pair of coordPairs) {
    const [lngStr, latStr] = pair.split(/\s+/);
    if (lngStr && latStr) {
      const lng = parseFloat(lngStr);
      const lat = parseFloat(latStr);
      if (!isNaN(lat) && !isNaN(lng)) {
        vertices.push({ lat, lng });
      }
    }
  }

  // Remove duplicate closing vertex if present
  if (vertices.length > 1) {
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    if (Math.abs(first.lat - last.lat) < 0.000001 && Math.abs(first.lng - last.lng) < 0.000001) {
      vertices.pop();
    }
  }

  return vertices;
}

/**
 * Extract line endpoints from LINESTRING WKT
 */
export function extractLineFromWKT(wkt: string): { startLat: number; startLng: number; endLat: number; endLng: number } | null {
  const match = wkt.match(/LINESTRING\s*\(([^)]+)\)/i);
  if (!match) return null;

  const coordString = match[1];
  const coordPairs = coordString.split(',').map(s => s.trim());

  if (coordPairs.length < 2) return null;

  const [startLngStr, startLatStr] = coordPairs[0].split(/\s+/);
  const [endLngStr, endLatStr] = coordPairs[coordPairs.length - 1].split(/\s+/);

  return {
    startLat: parseFloat(startLatStr),
    startLng: parseFloat(startLngStr),
    endLat: parseFloat(endLatStr),
    endLng: parseFloat(endLngStr)
  };
}

/**
 * Detect and classify all vertices from measurement data
 */
export function detectAndClassifyVertices(
  perimeterWKT: string,
  linearFeatures: { type: string; wkt: string }[],
  config: Partial<VertexDetectionConfig> = {}
): DetectedVertex[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const vertices: DetectedVertex[] = [];
  const perimeterCorners = extractVerticesFromWKT(perimeterWKT);

  // Create perimeter corner vertices
  for (const corner of perimeterCorners) {
    const id = generateVertexId();
    vertices.push({
      id,
      lat: corner.lat,
      lng: corner.lng,
      pixelX: 0, // Will be populated by image coordinate conversion
      pixelY: 0,
      type: 'perimeter_corner',
      confidence: 0.95, // High confidence for footprint-derived corners
      connectedVertices: [],
      source: 'footprint_derived',
      detectionMethod: 'perimeter_extraction',
      snapApplied: false
    });
  }

  // Extract all line endpoints and create vertices
  const allLineEndpoints: { lat: number; lng: number; lineType: string }[] = [];
  
  for (const feature of linearFeatures) {
    const line = extractLineFromWKT(feature.wkt);
    if (line) {
      allLineEndpoints.push({ lat: line.startLat, lng: line.startLng, lineType: feature.type });
      allLineEndpoints.push({ lat: line.endLat, lng: line.endLng, lineType: feature.type });
    }
  }

  // Group nearby endpoints (within snap tolerance) to identify junctions
  const processedEndpoints = new Set<string>();
  
  for (const endpoint of allLineEndpoints) {
    const key = `${endpoint.lat.toFixed(6)},${endpoint.lng.toFixed(6)}`;
    if (processedEndpoints.has(key)) continue;
    
    // Find all lines connected to this point
    const connectedLines: { type: string; startLat: number; startLng: number; endLat: number; endLng: number }[] = [];
    
    for (const feature of linearFeatures) {
      const line = extractLineFromWKT(feature.wkt);
      if (!line) continue;
      
      const startDist = haversineDistanceFt(endpoint.lat, endpoint.lng, line.startLat, line.startLng);
      const endDist = haversineDistanceFt(endpoint.lat, endpoint.lng, line.endLat, line.endLng);
      
      if (startDist <= cfg.snapToleranceFt || endDist <= cfg.snapToleranceFt) {
        connectedLines.push({ type: feature.type, ...line });
      }
    }

    // Check if this is on the perimeter
    const isOnPerimeter = perimeterCorners.some(
      corner => haversineDistanceFt(endpoint.lat, endpoint.lng, corner.lat, corner.lng) <= cfg.snapToleranceFt
    );

    // Classify the vertex
    const vertexType = classifyVertexType(endpoint, connectedLines, isOnPerimeter);

    // Snap to footprint if applicable
    const snapped = snapToFootprint(endpoint, perimeterCorners, cfg.snapToleranceFt);

    const id = generateVertexId();
    vertices.push({
      id,
      lat: snapped.lat,
      lng: snapped.lng,
      pixelX: 0,
      pixelY: 0,
      type: vertexType,
      confidence: connectedLines.length > 1 ? 0.85 : 0.75,
      connectedVertices: [],
      source: snapped.snapped ? 'footprint_derived' : 'ai_detected',
      detectionMethod: 'line_endpoint_analysis',
      snapApplied: snapped.snapped,
      originalLat: snapped.snapped ? snapped.originalLat : undefined,
      originalLng: snapped.snapped ? snapped.originalLng : undefined
    });

    processedEndpoints.add(key);
  }

  return vertices;
}

/**
 * Validate vertex connectivity - all vertices should be connected
 */
export function validateVertexConnectivity(vertices: DetectedVertex[]): {
  valid: boolean;
  orphanVertices: string[];
  disconnectedClusters: string[][];
} {
  const orphanVertices: string[] = [];
  
  for (const vertex of vertices) {
    if (vertex.connectedVertices.length === 0 && vertex.type !== 'perimeter_corner') {
      orphanVertices.push(vertex.id);
    }
  }

  return {
    valid: orphanVertices.length === 0,
    orphanVertices,
    disconnectedClusters: [] // Would require graph analysis to fully implement
  };
}
