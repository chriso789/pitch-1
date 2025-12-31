// Gable Detection and Eave/Rake Classification
// IMPROVED: Classification based on RIDGE DIRECTION
// - EAVE: Perimeter edges roughly PARALLEL to the ridge (water flows off these)
// - RAKE: Perimeter edges roughly PERPENDICULAR to the ridge (gable ends)
// - HIP ROOFS: All perimeter edges are eaves (ridges don't reach perimeter)
// - GABLE ROOFS: Eaves parallel to ridge + rakes perpendicular at gable peaks

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
 * PRIMARY: Classify boundary edges using RIDGE DIRECTION as reference
 * - EAVE: Edge is roughly PARALLEL to ridge direction (dot product > 0.5)
 * - RAKE: Edge is roughly PERPENDICULAR to ridge direction (dot product < 0.5)
 * 
 * This is the geometrically correct approach because:
 * - Water flows DOWN from the ridge
 * - Eaves catch water at the low edge (run parallel to ridge)
 * - Rakes are the angled sides at gable ends (run perpendicular to ridge)
 * 
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
  
  console.log(`Classifying ${n} boundary edges using ridge direction method`);
  console.log(`  Found ${ridges.length} ridges, ${hips.length} hips`);
  
  // If no ridges exist, this is likely a pure hip roof - all edges are eaves
  if (ridges.length === 0) {
    console.log('  No ridges found - all edges classified as eaves (hip roof)');
    return {
      eaveEdges: getAllBoundaryEdges(vertices),
      rakeEdges: []
    };
  }
  
  // Get the PRIMARY ridge direction from the longest ridge
  const mainRidge = ridges.reduce((longest, r) => {
    const len = distance(r.start, r.end);
    return len > distance(longest.start, longest.end) ? r : longest;
  }, ridges[0]);
  
  // Calculate normalized ridge direction vector
  const ridgeVec: XY = [
    mainRidge.end[0] - mainRidge.start[0],
    mainRidge.end[1] - mainRidge.start[1]
  ];
  const ridgeLen = Math.sqrt(ridgeVec[0] ** 2 + ridgeVec[1] ** 2);
  const ridgeDir: XY = ridgeLen > 0 
    ? [ridgeVec[0] / ridgeLen, ridgeVec[1] / ridgeLen]
    : [1, 0]; // Default to horizontal if degenerate
  
  console.log(`  Main ridge direction: [${ridgeDir[0].toFixed(4)}, ${ridgeDir[1].toFixed(4)}]`);
  
  const eaveEdges: Array<[XY, XY]> = [];
  const rakeEdges: Array<[XY, XY]> = [];
  
  // For each perimeter edge, check alignment with ridge direction
  for (let i = 0; i < n; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % n];
    
    // Calculate edge direction vector (normalized)
    const edgeVec: XY = [v2[0] - v1[0], v2[1] - v1[1]];
    const edgeLen = Math.sqrt(edgeVec[0] ** 2 + edgeVec[1] ** 2);
    
    if (edgeLen < 0.000001) {
      // Degenerate edge, skip
      continue;
    }
    
    const edgeDir: XY = [edgeVec[0] / edgeLen, edgeVec[1] / edgeLen];
    
    // Dot product of edge direction with ridge direction
    // |dot| = 1 means parallel, |dot| = 0 means perpendicular
    const dot = Math.abs(edgeDir[0] * ridgeDir[0] + edgeDir[1] * ridgeDir[1]);
    
    // Check if any hip terminates at either endpoint of this edge
    // If a hip ends here, it's definitely an eave corner (hip roof behavior)
    const hipTerminatesHere = hips.some(hip => 
      pointNearVertex(hip.end, v1) || pointNearVertex(hip.end, v2) ||
      pointNearVertex(hip.start, v1) || pointNearVertex(hip.start, v2)
    );
    
    // Classification logic:
    // - EAVE: edge is parallel to ridge (dot > 0.5) OR hip terminates here
    // - RAKE: edge is perpendicular to ridge (dot < 0.5) AND no hip terminates
    if (dot > 0.5 || hipTerminatesHere) {
      eaveEdges.push([v1, v2]);
      console.log(`  Edge ${i}: EAVE (dot=${dot.toFixed(3)}, hipTerminates=${hipTerminatesHere})`);
    } else {
      rakeEdges.push([v1, v2]);
      console.log(`  Edge ${i}: RAKE (dot=${dot.toFixed(3)}, perpendicular to ridge)`);
    }
  }
  
  console.log(`Classification result: ${eaveEdges.length} eaves, ${rakeEdges.length} rakes`);
  
  return { eaveEdges, rakeEdges };
}

/**
 * Check if a point is near a vertex (within threshold)
 */
function pointNearVertex(point: XY, vertex: XY, threshold = 0.00005): boolean {
  return distance(point, vertex) < threshold;
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
