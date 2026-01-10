// Gable Detection and Eave/Rake Classification
// IMPROVED: Classification based on RIDGE DIRECTION
// - EAVE: Perimeter edges roughly PARALLEL to the ridge (water flows off these)
// - RAKE: Perimeter edges roughly PERPENDICULAR to the ridge (gable ends)
// - HIP ROOFS: All perimeter edges are eaves (ridges don't reach perimeter)
// - GABLE ROOFS: Eaves parallel to ridge + rakes perpendicular at gable peaks
// 
// NEW: Supports ridge override from manual traces for accurate calibration

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
  ridgeDirection?: XY; // Normalized direction vector used for classification
}

export interface RidgeOverride {
  start: XY; // [lng, lat]
  end: XY;   // [lng, lat]
}

/**
 * PRIMARY: Classify boundary edges using RIDGE DIRECTION as reference
 * - EAVE: Edge is roughly PARALLEL to ridge direction (dot product > 0.5)
 * - RAKE: Edge is roughly PERPENDICULAR to ridge direction (dot product < 0.5)
 * 
 * @param ring Closed polygon (CCW orientation)
 * @param skeleton Straight skeleton edges (ridges, hips, valleys) - IGNORED if ridgeOverride provided
 * @param ridgeOverride Optional manually traced ridge line (takes priority over skeleton)
 * @returns Classification of boundary edges
 */
export function classifyBoundaryEdges(
  ring: XY[],
  skeleton: SkeletonEdge[],
  ridgeOverride?: RidgeOverride
): BoundaryClassification {
  // Ensure closed ring
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring = [...ring, ring[0]];
  }

  const vertices = ring.slice(0, -1);
  const n = vertices.length;
  
  // PRIORITY: Use ridge override if provided (from manual trace)
  let ridgeDir: XY;
  let usingOverride = false;
  
  if (ridgeOverride) {
    // Calculate direction from manual ridge trace
    const ridgeVec: XY = [
      ridgeOverride.end[0] - ridgeOverride.start[0],
      ridgeOverride.end[1] - ridgeOverride.start[1]
    ];
    const ridgeLen = Math.sqrt(ridgeVec[0] ** 2 + ridgeVec[1] ** 2);
    
    if (ridgeLen > 0.0000001) {
      ridgeDir = [ridgeVec[0] / ridgeLen, ridgeVec[1] / ridgeLen];
      usingOverride = true;
      console.log(`🎯 Using MANUAL RIDGE override for classification`);
      console.log(`  Ridge direction: [${ridgeDir[0].toFixed(4)}, ${ridgeDir[1].toFixed(4)}]`);
    } else {
      console.warn(`  Ridge override too short, falling back to skeleton`);
      ridgeDir = getRidgeDirectionFromSkeleton(skeleton);
    }
  } else {
    ridgeDir = getRidgeDirectionFromSkeleton(skeleton);
  }
  
  const ridges = skeleton.filter(e => e.type === 'ridge');
  const hips = skeleton.filter(e => e.type === 'hip');
  
  console.log(`Classifying ${n} boundary edges using ${usingOverride ? 'MANUAL RIDGE' : 'skeleton-derived'} direction`);
  console.log(`  Found ${ridges.length} ridges, ${hips.length} hips in skeleton`);
  
  // If no ridge direction available, treat as hip roof - all edges are eaves
  if (ridgeDir[0] === 0 && ridgeDir[1] === 0) {
    console.log('  No valid ridge direction - all edges classified as eaves (hip roof)');
    return {
      eaveEdges: getAllBoundaryEdges(vertices),
      rakeEdges: [],
      ridgeDirection: ridgeDir
    };
  }
  
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
    
    // Only check hip termination if NOT using manual override
    // (manual override should be trusted completely)
    let hipTerminatesHere = false;
    if (!usingOverride) {
      hipTerminatesHere = hips.some(hip => 
        pointNearVertex(hip.end, v1) || pointNearVertex(hip.end, v2) ||
        pointNearVertex(hip.start, v1) || pointNearVertex(hip.start, v2)
      );
    }
    
    // Classification logic:
    // - EAVE: edge is parallel to ridge (dot > 0.5) OR hip terminates here (skeleton mode only)
    // - RAKE: edge is perpendicular to ridge (dot < 0.5) AND no hip terminates (skeleton mode only)
    if (dot > 0.5 || hipTerminatesHere) {
      eaveEdges.push([v1, v2]);
      console.log(`  Edge ${i}: EAVE (dot=${dot.toFixed(3)}${hipTerminatesHere ? ', hipTerminates' : ''})`);
    } else {
      rakeEdges.push([v1, v2]);
      console.log(`  Edge ${i}: RAKE (dot=${dot.toFixed(3)}, perpendicular to ridge)`);
    }
  }
  
  console.log(`Classification result: ${eaveEdges.length} eaves, ${rakeEdges.length} rakes`);
  
  return { eaveEdges, rakeEdges, ridgeDirection: ridgeDir };
}

/**
 * Extract ridge direction from skeleton (fallback when no override)
 */
function getRidgeDirectionFromSkeleton(skeleton: SkeletonEdge[]): XY {
  const ridges = skeleton.filter(e => e.type === 'ridge');
  
  // If no ridges, return zero vector (will be treated as hip roof)
  if (ridges.length === 0) {
    return [0, 0];
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
  
  if (ridgeLen < 0.0000001) {
    return [1, 0]; // Default to horizontal if degenerate
  }
  
  return [ridgeVec[0] / ridgeLen, ridgeVec[1] / ridgeLen];
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
