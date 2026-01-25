/**
 * Phase 23: Edge Continuity Validation System
 * Ensures all detected edges form continuous, connected paths without gaps.
 * Includes auto-repair functionality for small gaps.
 */

export interface EdgeEndpoint {
  id: string;
  lat: number;
  lng: number;
  edgeId: string;
  isStart: boolean;
  connectedTo?: string[];
}

export interface LinearFeature {
  id: string;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  lengthFt: number;
}

export interface Gap {
  endpoint1: EdgeEndpoint;
  endpoint2: EdgeEndpoint;
  distanceFt: number;
  repairSuggestion?: 'extend' | 'connect' | 'merge';
}

export interface ContinuityValidationResult {
  isValid: boolean;
  continuityScore: number;
  gaps: Gap[];
  orphanEdges: string[];
  crossingEdges: { edge1: string; edge2: string; intersectionPoint: { lat: number; lng: number } }[];
  hipConnections: { valid: boolean; issues: string[] };
  valleyConnections: { valid: boolean; issues: string[] };
  repairs: RepairAction[];
}

export interface RepairAction {
  type: 'extend' | 'connect' | 'remove' | 'merge';
  targetEdgeId: string;
  details: string;
  newGeometry?: { startLat: number; startLng: number; endLat: number; endLng: number };
}

const EARTH_RADIUS_FT = 20902231;

function haversineDistanceFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 + 
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  return 2 * EARTH_RADIUS_FT * Math.asin(Math.sqrt(a));
}

/**
 * Extract all endpoints from linear features
 */
function extractEndpoints(features: LinearFeature[]): EdgeEndpoint[] {
  const endpoints: EdgeEndpoint[] = [];
  
  for (const feature of features) {
    endpoints.push({
      id: `${feature.id}_start`,
      lat: feature.startLat,
      lng: feature.startLng,
      edgeId: feature.id,
      isStart: true,
      connectedTo: []
    });
    endpoints.push({
      id: `${feature.id}_end`,
      lat: feature.endLat,
      lng: feature.endLng,
      edgeId: feature.id,
      isStart: false,
      connectedTo: []
    });
  }
  
  return endpoints;
}

/**
 * Cluster nearby endpoints that should be connected
 */
export function clusterNearbyEndpoints(
  endpoints: EdgeEndpoint[],
  clusterRadiusFt: number = 2.0
): Map<string, EdgeEndpoint[]> {
  const clusters = new Map<string, EdgeEndpoint[]>();
  const processed = new Set<string>();
  
  for (let i = 0; i < endpoints.length; i++) {
    if (processed.has(endpoints[i].id)) continue;
    
    const cluster: EdgeEndpoint[] = [endpoints[i]];
    processed.add(endpoints[i].id);
    
    for (let j = i + 1; j < endpoints.length; j++) {
      if (processed.has(endpoints[j].id)) continue;
      
      const distance = haversineDistanceFt(
        endpoints[i].lat, endpoints[i].lng,
        endpoints[j].lat, endpoints[j].lng
      );
      
      if (distance <= clusterRadiusFt) {
        cluster.push(endpoints[j]);
        processed.add(endpoints[j].id);
      }
    }
    
    clusters.set(`cluster_${i}`, cluster);
  }
  
  return clusters;
}

/**
 * Detect gaps in geometry where edges should connect but don't
 */
export function detectGapsInGeometry(
  features: LinearFeature[],
  toleranceFt: number = 3.0
): Gap[] {
  const gaps: Gap[] = [];
  const endpoints = extractEndpoints(features);
  
  // Find endpoints that are close but not connected
  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      // Skip endpoints from same edge
      if (endpoints[i].edgeId === endpoints[j].edgeId) continue;
      
      const distance = haversineDistanceFt(
        endpoints[i].lat, endpoints[i].lng,
        endpoints[j].lat, endpoints[j].lng
      );
      
      // Gap detected: close but not at same point
      if (distance > 0.5 && distance <= toleranceFt) {
        gaps.push({
          endpoint1: endpoints[i],
          endpoint2: endpoints[j],
          distanceFt: distance,
          repairSuggestion: distance < 1.5 ? 'merge' : 'extend'
        });
      }
    }
  }
  
  return gaps;
}

/**
 * Detect crossing edges that shouldn't intersect
 */
function detectCrossingEdges(
  features: LinearFeature[]
): { edge1: string; edge2: string; intersectionPoint: { lat: number; lng: number } }[] {
  const crossings: { edge1: string; edge2: string; intersectionPoint: { lat: number; lng: number } }[] = [];
  
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const intersection = lineIntersection(
        features[i].startLat, features[i].startLng,
        features[i].endLat, features[i].endLng,
        features[j].startLat, features[j].startLng,
        features[j].endLat, features[j].endLng
      );
      
      if (intersection && intersection.onBothSegments) {
        // Check if intersection is NOT at endpoints (valid junction)
        const isAtEndpoint = isPointAtEndpoint(intersection, features[i]) || 
                            isPointAtEndpoint(intersection, features[j]);
        
        if (!isAtEndpoint) {
          crossings.push({
            edge1: features[i].id,
            edge2: features[j].id,
            intersectionPoint: intersection
          });
        }
      }
    }
  }
  
  return crossings;
}

/**
 * Check if a point is at the endpoint of a feature
 */
function isPointAtEndpoint(
  point: { lat: number; lng: number },
  feature: LinearFeature,
  toleranceFt: number = 1.0
): boolean {
  const distToStart = haversineDistanceFt(point.lat, point.lng, feature.startLat, feature.startLng);
  const distToEnd = haversineDistanceFt(point.lat, point.lng, feature.endLat, feature.endLng);
  return distToStart <= toleranceFt || distToEnd <= toleranceFt;
}

/**
 * Calculate line intersection point
 */
function lineIntersection(
  lat1: number, lng1: number, lat2: number, lng2: number,
  lat3: number, lng3: number, lat4: number, lng4: number
): { lat: number; lng: number; onBothSegments: boolean } | null {
  const denom = (lat4 - lat3) * (lng2 - lng1) - (lng4 - lng3) * (lat2 - lat1);
  if (Math.abs(denom) < 1e-10) return null; // Parallel lines
  
  const ua = ((lng4 - lng3) * (lat1 - lat3) - (lat4 - lat3) * (lng1 - lng3)) / denom;
  const ub = ((lng2 - lng1) * (lat1 - lat3) - (lat2 - lat1) * (lng1 - lng3)) / denom;
  
  const lat = lat1 + ua * (lat2 - lat1);
  const lng = lng1 + ua * (lng2 - lng1);
  
  const onBothSegments = ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
  
  return { lat, lng, onBothSegments };
}

/**
 * Validate hip connections (all hips must connect to perimeter corner and ridge endpoint)
 */
export function validateHipConnections(
  hips: LinearFeature[],
  perimeterCorners: { lat: number; lng: number }[],
  ridgeEndpoints: { lat: number; lng: number }[],
  toleranceFt: number = 2.0
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  for (const hip of hips) {
    // Check if start connects to perimeter corner
    const startNearPerimeter = perimeterCorners.some(corner =>
      haversineDistanceFt(hip.startLat, hip.startLng, corner.lat, corner.lng) <= toleranceFt
    );
    
    // Check if end connects to ridge
    const endNearRidge = ridgeEndpoints.some(endpoint =>
      haversineDistanceFt(hip.endLat, hip.endLng, endpoint.lat, endpoint.lng) <= toleranceFt
    );
    
    // Or vice versa
    const startNearRidge = ridgeEndpoints.some(endpoint =>
      haversineDistanceFt(hip.startLat, hip.startLng, endpoint.lat, endpoint.lng) <= toleranceFt
    );
    
    const endNearPerimeter = perimeterCorners.some(corner =>
      haversineDistanceFt(hip.endLat, hip.endLng, corner.lat, corner.lng) <= toleranceFt
    );
    
    const validConnection = (startNearPerimeter && endNearRidge) || (startNearRidge && endNearPerimeter);
    
    if (!validConnection) {
      issues.push(`Hip ${hip.id} does not properly connect perimeter corner to ridge endpoint`);
    }
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Validate valley connections
 */
export function validateValleyConnections(
  valleys: LinearFeature[],
  reflexCorners: { lat: number; lng: number }[],
  ridgeHipJunctions: { lat: number; lng: number }[],
  toleranceFt: number = 2.0
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  for (const valley of valleys) {
    // Valley should connect reflex corner to ridge/hip junction
    const startNearReflex = reflexCorners.some(corner =>
      haversineDistanceFt(valley.startLat, valley.startLng, corner.lat, corner.lng) <= toleranceFt
    );
    
    const endNearJunction = ridgeHipJunctions.some(junction =>
      haversineDistanceFt(valley.endLat, valley.endLng, junction.lat, junction.lng) <= toleranceFt
    );
    
    const startNearJunction = ridgeHipJunctions.some(junction =>
      haversineDistanceFt(valley.startLat, valley.startLng, junction.lat, junction.lng) <= toleranceFt
    );
    
    const endNearReflex = reflexCorners.some(corner =>
      haversineDistanceFt(valley.endLat, valley.endLng, corner.lat, corner.lng) <= toleranceFt
    );
    
    const validConnection = (startNearReflex && endNearJunction) || (startNearJunction && endNearReflex);
    
    if (!validConnection) {
      issues.push(`Valley ${valley.id} does not properly connect reflex corner to junction`);
    }
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Repair gaps by extending edges to intersection
 */
export function repairGapsByExtension(gaps: Gap[]): RepairAction[] {
  const repairs: RepairAction[] = [];
  
  for (const gap of gaps) {
    if (gap.distanceFt < 1.5) {
      // Small gap - merge endpoints
      const midLat = (gap.endpoint1.lat + gap.endpoint2.lat) / 2;
      const midLng = (gap.endpoint1.lng + gap.endpoint2.lng) / 2;
      
      repairs.push({
        type: 'merge',
        targetEdgeId: gap.endpoint1.edgeId,
        details: `Merge endpoint with ${gap.endpoint2.edgeId} at gap of ${gap.distanceFt.toFixed(2)}ft`,
        newGeometry: gap.endpoint1.isStart 
          ? { startLat: midLat, startLng: midLng, endLat: 0, endLng: 0 }
          : { startLat: 0, startLng: 0, endLat: midLat, endLng: midLng }
      });
    } else {
      // Larger gap - extend edge
      repairs.push({
        type: 'extend',
        targetEdgeId: gap.endpoint1.edgeId,
        details: `Extend edge to close ${gap.distanceFt.toFixed(2)}ft gap with ${gap.endpoint2.edgeId}`,
        newGeometry: gap.endpoint1.isStart
          ? { startLat: gap.endpoint2.lat, startLng: gap.endpoint2.lng, endLat: 0, endLng: 0 }
          : { startLat: 0, startLng: 0, endLat: gap.endpoint2.lat, endLng: gap.endpoint2.lng }
      });
    }
  }
  
  return repairs;
}

/**
 * Find orphan edges (edges not connected to anything)
 */
function findOrphanEdges(
  features: LinearFeature[],
  connectionToleranceFt: number = 2.0
): string[] {
  const orphans: string[] = [];
  const endpoints = extractEndpoints(features);
  
  for (const feature of features) {
    const featureEndpoints = endpoints.filter(e => e.edgeId === feature.id);
    let connectedEndpoints = 0;
    
    for (const ep of featureEndpoints) {
      // Check if this endpoint connects to any other edge
      const connected = endpoints.some(other => 
        other.edgeId !== feature.id &&
        haversineDistanceFt(ep.lat, ep.lng, other.lat, other.lng) <= connectionToleranceFt
      );
      
      if (connected) connectedEndpoints++;
    }
    
    // Orphan if neither endpoint connects to anything
    if (connectedEndpoints === 0) {
      orphans.push(feature.id);
    }
  }
  
  return orphans;
}

/**
 * Main validation function
 */
export function validateEdgeContinuity(
  features: LinearFeature[],
  perimeterCorners: { lat: number; lng: number }[],
  toleranceFt: number = 3.0
): ContinuityValidationResult {
  // Separate features by type
  const hips = features.filter(f => f.type === 'hip');
  const valleys = features.filter(f => f.type === 'valley');
  const ridges = features.filter(f => f.type === 'ridge');
  
  // Get ridge endpoints
  const ridgeEndpoints = ridges.flatMap(r => [
    { lat: r.startLat, lng: r.startLng },
    { lat: r.endLat, lng: r.endLng }
  ]);
  
  // Detect gaps
  const gaps = detectGapsInGeometry(features, toleranceFt);
  
  // Detect crossings
  const crossings = detectCrossingEdges(features);
  
  // Find orphans
  const orphans = findOrphanEdges(features, toleranceFt);
  
  // Validate hip connections
  const hipValidation = validateHipConnections(hips, perimeterCorners, ridgeEndpoints, toleranceFt);
  
  // Validate valley connections (using perimeter corners as reflex candidates)
  const valleyValidation = validateValleyConnections(valleys, perimeterCorners, ridgeEndpoints, toleranceFt);
  
  // Generate repairs
  const repairs = repairGapsByExtension(gaps.filter(g => g.distanceFt < 2.0));
  
  // Calculate continuity score
  const totalIssues = gaps.length + crossings.length + orphans.length + 
                      hipValidation.issues.length + valleyValidation.issues.length;
  const maxIssues = features.length * 2; // Rough estimate
  const continuityScore = Math.max(0, 100 - (totalIssues / maxIssues) * 100);
  
  return {
    isValid: gaps.length === 0 && crossings.length === 0 && orphans.length === 0,
    continuityScore,
    gaps,
    orphanEdges: orphans,
    crossingEdges: crossings,
    hipConnections: hipValidation,
    valleyConnections: valleyValidation,
    repairs
  };
}
