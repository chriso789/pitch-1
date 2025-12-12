// Gable Detection and Eave/Rake Classification
// FIXED: Classification based on INTERSECTING FEATURES (not vertex types)
// - RAKE: Perimeter edge where a RIDGE terminates/intersects (gable ends)
// - EAVE: Perimeter edge where only VALLEYS or HIPS intersect (no ridges)
// - HIP ROOFS: ALL perimeter edges are eaves (ridges don't reach perimeter)
// - GABLE ROOFS: Eaves + rakes at gable peaks where ridge terminates

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
 * Classify boundary edges into eaves and rakes based on INTERSECTING FEATURES
 * - RAKE: Perimeter edge where a RIDGE terminates (gable ends)
 * - EAVE: Perimeter edge where only valleys/hips intersect (no ridges)
 * @param ring Closed polygon (CCW orientation)
 * @param skeleton Straight skeleton edges (ridges, hips, valleys)
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
  
  const ridges = skeleton.filter(e => e.type === 'ridge');
  const hips = skeleton.filter(e => e.type === 'hip');
  const valleys = skeleton.filter(e => e.type === 'valley');
  
  console.log(`Classifying ${n} boundary edges against ${ridges.length} ridges, ${hips.length} hips, ${valleys.length} valleys`);
  
  // If no ridges, all edges are eaves
  if (ridges.length === 0) {
    return {
      eaveEdges: getAllBoundaryEdges(vertices),
      rakeEdges: []
    };
  }
  
  const eaveEdges: Array<[XY, XY]> = [];
  const rakeEdges: Array<[XY, XY]> = [];
  
  // For each perimeter edge, check what features intersect it
  for (let i = 0; i < n; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % n];
    
    // Check if any RIDGE terminates at either endpoint of this edge
    const ridgeIntersects = ridges.some(ridge => 
      pointNearEdgeEndpoint(ridge.start, v1, v2) || 
      pointNearEdgeEndpoint(ridge.end, v1, v2)
    );
    
    // Check if any HIP terminates at either endpoint
    const hipIntersects = hips.some(hip => 
      pointNearEdgeEndpoint(hip.start, v1, v2) || 
      pointNearEdgeEndpoint(hip.end, v1, v2)
    );
    
    // RAKE: Ridge terminates here AND no hip terminates here
    // (If hip also terminates, it's a hip corner = eave)
    if (ridgeIntersects && !hipIntersects) {
      rakeEdges.push([v1, v2]);
      console.log(`  Edge ${i}: RAKE (ridge terminates)`);
    } else {
      eaveEdges.push([v1, v2]);
      console.log(`  Edge ${i}: EAVE (ridge=${ridgeIntersects}, hip=${hipIntersects})`);
    }
  }
  
  console.log(`Classification result: ${eaveEdges.length} eaves, ${rakeEdges.length} rakes`);
  
  return { eaveEdges, rakeEdges };
}

/**
 * Check if a point is near either endpoint of an edge
 */
function pointNearEdgeEndpoint(point: XY, v1: XY, v2: XY, threshold = 0.00005): boolean {
  // threshold is ~5 meters in lat/lng degrees
  const distToV1 = distance(point, v1);
  const distToV2 = distance(point, v2);
  return distToV1 < threshold || distToV2 < threshold;
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
