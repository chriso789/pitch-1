// Gable Detection and Eave/Rake Classification
// FIXED: Proper classification based on actual roof geometry
// - EAVES: Horizontal bottom edges where gutters attach (parallel to ground)
// - RAKES: ONLY sloped edges at GABLE ENDS where roof pitch meets vertical wall
// - HIP ROOFS: ALL perimeter edges are eaves (no gable ends = no rakes)
// - GABLE ROOFS: Eaves (parallel to ridge) + rakes (at gable peaks)

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
 * CRITICAL FIX: Hip roofs have NO rakes, only gable roofs have rakes
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
  
  // Count ridge and hip edges to determine roof type
  const ridges = skeleton.filter(e => e.type === 'ridge');
  const hips = skeleton.filter(e => e.type === 'hip');
  
  // ROOF TYPE DETECTION:
  // - Hip roof: Has 4+ hip lines connecting ridge to perimeter corners
  // - Gable roof: Has 0-2 hip lines, ridge terminates at gable peaks
  // - Complex: Mix of both
  const isHipRoof = hips.length >= 4 && ridges.length > 0;
  const isGableRoof = hips.length <= 2 && ridges.length > 0;
  
  console.log(`Roof type detection: ${hips.length} hips, ${ridges.length} ridges → ${isHipRoof ? 'HIP' : isGableRoof ? 'GABLE' : 'COMPLEX'}`);
  
  if (isHipRoof) {
    // HIP ROOF: ALL perimeter edges are EAVES
    // No gable ends means no rakes
    return {
      eaveEdges: getAllBoundaryEdges(vertices),
      rakeEdges: []
    };
  }
  
  if (ridges.length === 0) {
    // Flat roof or no ridges found - treat all as eaves
    return {
      eaveEdges: getAllBoundaryEdges(vertices),
      rakeEdges: []
    };
  }
  
  const dominantRidge = findLongestRidge(ridges);
  
  // For GABLE roofs: classify by perpendicularity to ridge
  if (dominantRidge && isGableRoof) {
    return classifyGableBuilding(vertices, dominantRidge);
  }
  
  // For COMPLEX shapes: use heuristic based on ridge direction
  if (dominantRidge) {
    return classifyComplexBuilding(vertices, dominantRidge, ridges, hips);
  }
  
  // Fallback: all eaves (conservative)
  return {
    eaveEdges: getAllBoundaryEdges(vertices),
    rakeEdges: []
  };
}

/**
 * Classify edges for GABLE building (has true gable ends with rakes)
 * Eaves run parallel to ridge, rakes are perpendicular at gable peaks
 */
function classifyGableBuilding(
  vertices: XY[],
  dominantRidge: SkeletonEdge
): BoundaryClassification {
  const ridgeVector = normalizeVector([
    dominantRidge.end[0] - dominantRidge.start[0],
    dominantRidge.end[1] - dominantRidge.start[1]
  ]);
  
  const eaveEdges: Array<[XY, XY]> = [];
  const rakeEdges: Array<[XY, XY]> = [];
  const n = vertices.length;
  
  // For rectangular buildings (4 vertices)
  if (n === 4) {
    for (let i = 0; i < 4; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % 4];
      
      const edgeVector = normalizeVector([v2[0] - v1[0], v2[1] - v1[1]]);
      const dotProduct = Math.abs(
        ridgeVector[0] * edgeVector[0] + ridgeVector[1] * edgeVector[1]
      );
      
      // Parallel to ridge (dot ~1) = EAVE
      // Perpendicular to ridge (dot ~0) = RAKE
      if (dotProduct > 0.7) {
        eaveEdges.push([v1, v2]);
      } else {
        rakeEdges.push([v1, v2]);
      }
    }
    
    // Validate: gable should have 2 eaves and 2 rakes
    if (eaveEdges.length === 2 && rakeEdges.length === 2) {
      return { eaveEdges, rakeEdges };
    }
  }
  
  // For non-rectangular gable buildings: find edges near ridge endpoints
  const ridgeEndpoints = [dominantRidge.start, dominantRidge.end];
  
  for (let i = 0; i < n; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % n];
    const edgeMidpoint = midpoint(v1, v2);
    
    // Check if edge is near a ridge endpoint (gable peak)
    const minDistToRidgeEnd = Math.min(
      ...ridgeEndpoints.map(pt => distance(edgeMidpoint, pt))
    );
    
    const edgeLength = distance(v1, v2);
    const avgEdgeLength = getAllBoundaryEdges(vertices)
      .reduce((sum, e) => sum + distance(e[0], e[1]), 0) / n;
    
    // RAKE: Near ridge endpoint AND shorter than average (typical gable edge)
    if (minDistToRidgeEnd < avgEdgeLength * 0.4 && edgeLength < avgEdgeLength * 0.9) {
      rakeEdges.push([v1, v2]);
    } else {
      eaveEdges.push([v1, v2]);
    }
  }
  
  return { eaveEdges, rakeEdges };
}

/**
 * Classify edges for complex building (L, T, U shapes, or mixed hip/gable)
 * Uses hip count to determine if sections have rakes
 */
function classifyComplexBuilding(
  vertices: XY[],
  dominantRidge: SkeletonEdge,
  allRidges: SkeletonEdge[],
  allHips: SkeletonEdge[]
): BoundaryClassification {
  const eaveEdges: Array<[XY, XY]> = [];
  const rakeEdges: Array<[XY, XY]> = [];
  const n = vertices.length;
  
  // Get all hip endpoints (where hips meet perimeter)
  const hipEndpoints = allHips.flatMap(h => [h.start, h.end]);
  
  // Get all ridge endpoints (where ridges terminate)
  const ridgeEndpoints = allRidges.flatMap(r => [r.start, r.end]);
  
  for (let i = 0; i < n; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % n];
    const edgeMidpoint = midpoint(v1, v2);
    
    // Check if edge is near a hip endpoint
    const minDistToHip = hipEndpoints.length > 0
      ? Math.min(...hipEndpoints.map(pt => distance(edgeMidpoint, pt)))
      : Infinity;
    
    // Check if edge is near a ridge endpoint (potential gable end)
    const minDistToRidge = ridgeEndpoints.length > 0
      ? Math.min(...ridgeEndpoints.map(pt => distance(edgeMidpoint, pt)))
      : Infinity;
    
    const edgeLength = distance(v1, v2);
    const avgEdgeLength = getAllBoundaryEdges(vertices)
      .reduce((sum, e) => sum + distance(e[0], e[1]), 0) / n;
    
    // EAVE: Near hip endpoint OR long edge (hip roofs have long eaves)
    // RAKE: Near ridge endpoint AND not near hip AND short
    const isNearHip = minDistToHip < avgEdgeLength * 0.4;
    const isNearRidge = minDistToRidge < avgEdgeLength * 0.3;
    const isShortEdge = edgeLength < avgEdgeLength * 0.8;
    
    if (isNearRidge && !isNearHip && isShortEdge) {
      rakeEdges.push([v1, v2]);
    } else {
      eaveEdges.push([v1, v2]);
    }
  }
  
  console.log(`Complex building classification: ${eaveEdges.length} eaves, ${rakeEdges.length} rakes`);
  
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
