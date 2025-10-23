// Gable Detection and Eave/Rake Classification
// Determines which boundary edges are eaves (horizontal) vs rakes (gable ends)

type XY = [number, number]; // [lng, lat]

interface SkeletonEdge {
  start: XY;
  end: XY;
  type: 'ridge' | 'hip' | 'valley';
  boundaryIndices?: number[];
}

export interface BoundaryClassification {
  eaveEdges: Array<[XY, XY]>;
  rakeEdges: Array<[XY, XY]>;
}

/**
 * Classify boundary edges into eaves and rakes based on building shape and skeleton
 * @param ring Closed polygon (CCW orientation)
 * @param skeleton Straight skeleton edges
 * @returns Classification of boundary edges
 */
export function classifyBoundaryEdges(
  ring: XY[],
  skeleton: SkeletonEdge[]
): BoundaryClassification {
  // Ensure closed ring
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring = [...ring, ring[0]];
  }

  const vertices = ring.slice(0, -1);
  const n = vertices.length;
  
  // Find dominant ridge (longest ridge edge)
  const ridges = skeleton.filter(e => e.type === 'ridge');
  
  if (ridges.length === 0) {
    // No ridges found, treat all as eaves (conservative)
    return {
      eaveEdges: getAllBoundaryEdges(vertices),
      rakeEdges: []
    };
  }
  
  const dominantRidge = findLongestRidge(ridges);
  
  // Check if building is rectangular
  const isRectangular = checkRectangular(vertices);
  
  if (isRectangular && dominantRidge) {
    // For rectangular buildings, classify by perpendicularity to ridge
    return classifyRectangularBuilding(vertices, dominantRidge);
  } else if (dominantRidge) {
    // For complex shapes, use heuristic based on ridge direction
    return classifyComplexBuilding(vertices, dominantRidge, ridges);
  }
  
  // Fallback: all eaves
  return {
    eaveEdges: getAllBoundaryEdges(vertices),
    rakeEdges: []
  };
}

/**
 * Check if building is approximately rectangular
 */
function checkRectangular(vertices: XY[]): boolean {
  const n = vertices.length;
  
  // Must be 4 vertices
  if (n !== 4) return false;
  
  // Check if all angles are approximately 90°
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    
    const angle = calculateAngle(prev, curr, next);
    
    // Allow ±10° tolerance
    if (Math.abs(angle - 90) > 10) {
      return false;
    }
  }
  
  // Check aspect ratio (one pair of sides should be longer)
  const side1 = distance(vertices[0], vertices[1]);
  const side2 = distance(vertices[1], vertices[2]);
  const aspectRatio = Math.max(side1, side2) / Math.min(side1, side2);
  
  return aspectRatio >= 1.25; // Gable buildings are typically elongated
}

/**
 * Classify edges for rectangular building
 */
function classifyRectangularBuilding(
  vertices: XY[],
  dominantRidge: SkeletonEdge
): BoundaryClassification {
  const ridgeVector = normalizeVector([
    dominantRidge.end[0] - dominantRidge.start[0],
    dominantRidge.end[1] - dominantRidge.start[1]
  ]);
  
  const eaveEdges: Array<[XY, XY]> = [];
  const rakeEdges: Array<[XY, XY]> = [];
  
  // For each edge, check if parallel or perpendicular to ridge
  for (let i = 0; i < 4; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % 4];
    
    const edgeVector = normalizeVector([v2[0] - v1[0], v2[1] - v1[1]]);
    
    // Calculate dot product to determine angle
    const dotProduct = Math.abs(
      ridgeVector[0] * edgeVector[0] + ridgeVector[1] * edgeVector[1]
    );
    
    // If dot product close to 1, vectors are parallel (edge parallel to ridge = eave)
    // If dot product close to 0, vectors are perpendicular (edge perpendicular to ridge = rake)
    if (dotProduct > 0.7) {
      // Parallel to ridge → eave (runs along ridge)
      eaveEdges.push([v1, v2]);
    } else {
      // Perpendicular to ridge → rake (gable end)
      rakeEdges.push([v1, v2]);
    }
  }
  
  // Validate: should have 2 eaves and 2 rakes
  if (eaveEdges.length === 2 && rakeEdges.length === 2) {
    return { eaveEdges, rakeEdges };
  }
  
  // Fallback: all eaves if classification unclear
  return {
    eaveEdges: getAllBoundaryEdges(vertices),
    rakeEdges: []
  };
}

/**
 * Classify edges for complex building (L, T, U shapes)
 */
function classifyComplexBuilding(
  vertices: XY[],
  dominantRidge: SkeletonEdge,
  allRidges: SkeletonEdge[]
): BoundaryClassification {
  const eaveEdges: Array<[XY, XY]> = [];
  const rakeEdges: Array<[XY, XY]> = [];
  const n = vertices.length;
  
  // For complex shapes, use proximity to ridge endpoints as heuristic
  // Edges near where ridge terminates → likely rakes
  // Other edges → likely eaves
  
  const ridgeEndpoints = allRidges.flatMap(r => [r.start, r.end]);
  
  for (let i = 0; i < n; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % n];
    const edgeMidpoint = midpoint(v1, v2);
    
    // Check if edge midpoint is close to any ridge endpoint
    const minDistToRidgeEnd = Math.min(
      ...ridgeEndpoints.map(pt => distance(edgeMidpoint, pt))
    );
    
    const edgeLength = distance(v1, v2);
    const avgEdgeLength = getAllBoundaryEdges(vertices)
      .reduce((sum, e) => sum + distance(e[0], e[1]), 0) / n;
    
    // Classify as rake if:
    // 1. Close to ridge endpoint (within 30% of average edge length)
    // 2. And edge is shorter than average (typical for gable ends)
    if (minDistToRidgeEnd < avgEdgeLength * 0.3 && edgeLength < avgEdgeLength * 1.2) {
      rakeEdges.push([v1, v2]);
    } else {
      eaveEdges.push([v1, v2]);
    }
  }
  
  return { eaveEdges, rakeEdges };
}

/**
 * Find longest ridge edge
 */
function findLongestRidge(ridges: SkeletonEdge[]): SkeletonEdge | null {
  if (ridges.length === 0) return null;
  
  let maxLength = 0;
  let longest = ridges[0];
  
  for (const ridge of ridges) {
    const len = distance(ridge.start, ridge.end);
    if (len > maxLength) {
      maxLength = len;
      longest = ridge;
    }
  }
  
  return longest;
}

/**
 * Get all boundary edges as array
 */
function getAllBoundaryEdges(vertices: XY[]): Array<[XY, XY]> {
  const edges: Array<[XY, XY]> = [];
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    edges.push([vertices[i], vertices[(i + 1) % n]]);
  }
  
  return edges;
}

// ===== Utility Functions =====

function calculateAngle(prev: XY, curr: XY, next: XY): number {
  const v1x = prev[0] - curr[0];
  const v1y = prev[1] - curr[1];
  const v2x = next[0] - curr[0];
  const v2y = next[1] - curr[1];
  
  const dot = v1x * v2x + v1y * v2y;
  const cross = v1x * v2y - v1y * v2x;
  
  let angle = Math.atan2(cross, dot) * 180 / Math.PI;
  if (angle < 0) angle += 360;
  
  return angle;
}

function distance(a: XY, b: XY): number {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
}

function midpoint(a: XY, b: XY): XY {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function normalizeVector(v: [number, number]): [number, number] {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2);
  return len === 0 ? [0, 0] : [v[0] / len, v[1] / len];
}
