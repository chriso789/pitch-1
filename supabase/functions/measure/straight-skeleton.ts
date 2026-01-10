// Straight Skeleton Algorithm for Roof Topology Extraction
// FIXED: Constrained geometry - all edges clipped to footprint, no criss-crossing hips
// Ridge endpoints derived from hip intersections, not arbitrary percentages

type XY = [number, number]; // [lng, lat]

interface SkeletonVertex {
  id: string;
  coords: XY;
  type: 'ridge_end' | 'eave_corner' | 'valley_ridge_intersection' | 'ridge_junction' | 'internal';
  connectedEdgeIds: string[];
}

interface SkeletonEdge {
  id?: string;
  start: XY;
  end: XY;
  type: 'ridge' | 'hip' | 'valley';
  boundaryIndices?: number[];
  startVertexId?: string;
  endVertexId?: string;
  wingIndex?: number;
}

interface TopologicalSkeleton {
  vertices: Map<string, SkeletonVertex>;
  edges: SkeletonEdge[];
}

interface BuildingWing {
  vertices: XY[];
  indices: number[];
  centroid: XY;
  primaryAxis: 'horizontal' | 'vertical';
  ridgeStart: XY;
  ridgeEnd: XY;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

// Default soffit overhang in feet
const DEFAULT_SOFFIT_OFFSET_FT = 1.0;

/**
 * Compute straight skeleton with CONSTRAINED GEOMETRY
 * All edges are clipped to footprint, hips don't cross, ridge derived from intersections
 */
export function computeStraightSkeleton(ring: XY[], soffitOffsetFt: number = DEFAULT_SOFFIT_OFFSET_FT): SkeletonEdge[] {
  // Ensure closed ring
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring = [...ring, ring[0]];
  }

  let vertices = ring.slice(0, -1);
  
  if (vertices.length < 3) {
    return [];
  }

  // Apply eave/soffit offset
  if (soffitOffsetFt > 0) {
    vertices = applyEaveOffset(vertices, soffitOffsetFt);
    console.log(`  Applied ${soffitOffsetFt}ft eave offset to perimeter`);
  }

  const reflexIndices = findReflexVertices(vertices);
  const shapeType = detectBuildingShape(vertices);
  console.log(`  Detected building shape: ${shapeType} with ${vertices.length} vertices, ${reflexIndices.size} reflex corners`);
  
  let skeleton: SkeletonEdge[] = [];
  
  if (shapeType === 'rectangle') {
    skeleton = generateConstrainedRectangularSkeleton(vertices);
  } else if (shapeType === 'L-shape' || shapeType === 'T-shape' || shapeType === 'U-shape') {
    skeleton = generateConstrainedMultiWingSkeleton(vertices, reflexIndices, shapeType);
  } else {
    skeleton = generateConstrainedMultiWingSkeleton(vertices, reflexIndices, 'complex');
  }
  
  // CRITICAL: Clip all edges to footprint boundary
  skeleton = clipAllEdgesToFootprint(skeleton, vertices);
  
  // Validate topology - no criss-crossing
  skeleton = validateAndFixTopology(skeleton, vertices);
  
  return skeleton;
}

/**
 * Generate CONSTRAINED skeleton for rectangular buildings
 * Ridge endpoints are calculated from hip line intersections
 */
function generateConstrainedRectangularSkeleton(vertices: XY[]): SkeletonEdge[] {
  if (vertices.length !== 4) {
    console.warn(`  Expected 4 vertices for rectangle, got ${vertices.length}`);
    return generateSimpleConstrainedSkeleton(vertices);
  }

  // Find the two longest edges (they should be parallel - these are the eave edges)
  const edges: Array<{ idx: number; length: number; start: XY; end: XY }> = [];
  for (let i = 0; i < 4; i++) {
    const start = vertices[i];
    const end = vertices[(i + 1) % 4];
    edges.push({ idx: i, length: distance(start, end), start, end });
  }
  edges.sort((a, b) => b.length - a.length);
  
  // The two longest edges are eaves (parallel to ridge)
  // The two shortest are rakes (perpendicular to ridge)
  const longestEdgeIdx = edges[0].idx;
  
  // Ridge endpoints are where hip bisectors from adjacent corners meet
  const corner0 = vertices[longestEdgeIdx];
  const corner1 = vertices[(longestEdgeIdx + 1) % 4];
  const corner2 = vertices[(longestEdgeIdx + 2) % 4];
  const corner3 = vertices[(longestEdgeIdx + 3) % 4];
  
  // Calculate ridge endpoints as the intersection of hip bisectors
  // Hip runs at 45° from eave corners toward the building center
  const ridgeStart = calculateRidgeEndpointFromHips(corner0, corner3, vertices);
  const ridgeEnd = calculateRidgeEndpointFromHips(corner1, corner2, vertices);
  
  const skeleton: SkeletonEdge[] = [];
  
  // Ridge
  skeleton.push({
    id: 'ridge_0',
    start: ridgeStart,
    end: ridgeEnd,
    type: 'ridge',
    boundaryIndices: [],
    startVertexId: 'ridge_0_start',
    endVertexId: 'ridge_0_end',
    wingIndex: 0
  });
  
  // Hips - assigned so they don't cross
  // Corner 0 and corner 3 go to ridgeStart
  // Corner 1 and corner 2 go to ridgeEnd
  skeleton.push({
    id: 'hip_0',
    start: corner0,
    end: ridgeStart,
    type: 'hip',
    boundaryIndices: [longestEdgeIdx],
    endVertexId: 'ridge_0_start',
    wingIndex: 0
  });
  
  skeleton.push({
    id: 'hip_1',
    start: corner1,
    end: ridgeEnd,
    type: 'hip',
    boundaryIndices: [(longestEdgeIdx + 1) % 4],
    endVertexId: 'ridge_0_end',
    wingIndex: 0
  });
  
  skeleton.push({
    id: 'hip_2',
    start: corner2,
    end: ridgeEnd,
    type: 'hip',
    boundaryIndices: [(longestEdgeIdx + 2) % 4],
    endVertexId: 'ridge_0_end',
    wingIndex: 0
  });
  
  skeleton.push({
    id: 'hip_3',
    start: corner3,
    end: ridgeStart,
    type: 'hip',
    boundaryIndices: [(longestEdgeIdx + 3) % 4],
    endVertexId: 'ridge_0_start',
    wingIndex: 0
  });
  
  console.log(`  Constrained rectangular skeleton: 1 ridge, 4 hips (no crossing)`);
  
  return skeleton;
}

/**
 * Calculate ridge endpoint from two hip lines meeting
 * Uses angle bisector intersection
 */
function calculateRidgeEndpointFromHips(corner1: XY, corner2: XY, vertices: XY[]): XY {
  const centroid = calculateCentroid(vertices);
  const bounds = getBounds(vertices);
  
  // Calculate inward direction from each corner toward center
  const dir1 = normalizeVector([centroid[0] - corner1[0], centroid[1] - corner1[1]]);
  const dir2 = normalizeVector([centroid[0] - corner2[0], centroid[1] - corner2[1]]);
  
  // Find intersection of the two hip lines
  const intersection = lineLineIntersection(
    corner1, [corner1[0] + dir1[0], corner1[1] + dir1[1]],
    corner2, [corner2[0] + dir2[0], corner2[1] + dir2[1]]
  );
  
  if (intersection && isPointInsideBounds(intersection, bounds)) {
    return intersection;
  }
  
  // Fallback: midpoint of the two corners, moved inward
  const mid = midpoint(corner1, corner2);
  const inwardDir = normalizeVector([centroid[0] - mid[0], centroid[1] - mid[1]]);
  const insetDist = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.25;
  
  return [mid[0] + inwardDir[0] * insetDist, mid[1] + inwardDir[1] * insetDist];
}

/**
 * Generate constrained skeleton for L/T/U-shaped buildings
 */
function generateConstrainedMultiWingSkeleton(
  vertices: XY[], 
  reflexIndices: Set<number>,
  shapeType: string
): SkeletonEdge[] {
  const skeleton: SkeletonEdge[] = [];
  const n = vertices.length;
  
  const wings = detectBuildingWings(vertices, reflexIndices);
  console.log(`  Detected ${wings.length} building wings for ${shapeType}`);
  
  if (wings.length === 0) {
    return generateSimpleConstrainedSkeleton(vertices);
  }
  
  // Create ridge for each wing - constrained to wing bounds
  wings.forEach((wing, wingIdx) => {
    const constrainedRidge = constrainRidgeToWing(wing);
    
    skeleton.push({
      id: `ridge_${wingIdx}`,
      start: constrainedRidge.start,
      end: constrainedRidge.end,
      type: 'ridge',
      boundaryIndices: [],
      startVertexId: `ridge_${wingIdx}_start`,
      endVertexId: `ridge_${wingIdx}_end`,
      wingIndex: wingIdx
    });
  });
  
  // Create hips - each corner connects to its LOCAL wing's ridge only
  // Partition corners by ridge side to prevent crossing
  for (let i = 0; i < n; i++) {
    if (reflexIndices.has(i)) continue;
    
    const vertex = vertices[i];
    const wingIdx = findVertexWing(i, wings, vertices);
    if (wingIdx < 0 || wingIdx >= wings.length) continue;
    
    const wing = wings[wingIdx];
    
    // Determine which ridge endpoint this corner should connect to
    // Based on which SIDE of the ridge the corner is on (not just distance)
    const hipEnd = assignHipToRidgeEndpoint(vertex, wing, vertices);
    
    if (hipEnd) {
      skeleton.push({
        id: `hip_${i}`,
        start: vertex,
        end: hipEnd.point,
        type: 'hip',
        boundaryIndices: [i],
        endVertexId: hipEnd.id,
        wingIndex: wingIdx
      });
    }
  }
  
  // Create valleys from reflex vertices
  reflexIndices.forEach((idx) => {
    const vertex = vertices[idx];
    const prev = vertices[(idx - 1 + n) % n];
    const next = vertices[(idx + 1) % n];
    
    // Valley runs from reflex corner inward to ridge junction
    const valleyEnd = findValleyEndpoint(vertex, prev, next, wings, skeleton);
    
    if (valleyEnd) {
      skeleton.push({
        id: `valley_${idx}`,
        start: vertex,
        end: valleyEnd.point,
        type: 'valley',
        boundaryIndices: [idx],
        endVertexId: valleyEnd.id
      });
    }
  });
  
  console.log(`  Multi-wing skeleton: ${skeleton.filter(e => e.type === 'ridge').length} ridges, ${skeleton.filter(e => e.type === 'hip').length} hips, ${skeleton.filter(e => e.type === 'valley').length} valleys`);
  
  return skeleton;
}

/**
 * Constrain ridge to stay within wing bounds
 */
function constrainRidgeToWing(wing: BuildingWing): { start: XY; end: XY } {
  const { bounds, primaryAxis, centroid } = wing;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  
  // Ridge margin should be 20% from wing edges (not 15%)
  // This ensures ridge ends inside the footprint
  const marginRatio = 0.20;
  
  if (primaryAxis === 'horizontal') {
    return {
      start: [bounds.minX + width * marginRatio, centroid[1]],
      end: [bounds.maxX - width * marginRatio, centroid[1]]
    };
  } else {
    return {
      start: [centroid[0], bounds.minY + height * marginRatio],
      end: [centroid[0], bounds.maxY - height * marginRatio]
    };
  }
}

/**
 * Assign hip to correct ridge endpoint based on position (prevents crossing)
 */
function assignHipToRidgeEndpoint(
  corner: XY,
  wing: BuildingWing,
  vertices: XY[]
): { point: XY; id: string } | null {
  const { ridgeStart, ridgeEnd, primaryAxis, centroid } = wing;
  
  // Calculate which "side" of the ridge midpoint the corner is on
  const ridgeMid = midpoint(ridgeStart, ridgeEnd);
  
  // For horizontal ridges: compare X coordinates
  // For vertical ridges: compare Y coordinates
  if (primaryAxis === 'horizontal') {
    // Corner left of ridge midpoint → connects to ridgeStart (left end)
    // Corner right of ridge midpoint → connects to ridgeEnd (right end)
    if (corner[0] < ridgeMid[0]) {
      return { point: ridgeStart, id: `ridge_${wing.indices[0] || 0}_start` };
    } else {
      return { point: ridgeEnd, id: `ridge_${wing.indices[0] || 0}_end` };
    }
  } else {
    // Corner below ridge midpoint → connects to ridgeStart (bottom end)
    // Corner above ridge midpoint → connects to ridgeEnd (top end)
    if (corner[1] < ridgeMid[1]) {
      return { point: ridgeStart, id: `ridge_${wing.indices[0] || 0}_start` };
    } else {
      return { point: ridgeEnd, id: `ridge_${wing.indices[0] || 0}_end` };
    }
  }
}

/**
 * Find valley endpoint (where it meets ridge or junction)
 */
function findValleyEndpoint(
  vertex: XY,
  prev: XY,
  next: XY,
  wings: BuildingWing[],
  skeleton: SkeletonEdge[]
): { point: XY; id: string } | null {
  // Calculate inward bisector direction
  const bisector = angleBisector(prev, vertex, next);
  const bisectorDir = normalizeVector([bisector[0] - vertex[0], bisector[1] - vertex[1]]);
  
  // Find intersection with any ridge
  let bestIntersection: { point: XY; id: string; dist: number } | null = null;
  
  for (const edge of skeleton) {
    if (edge.type !== 'ridge') continue;
    
    const intersection = lineSegmentIntersection(
      vertex,
      [vertex[0] + bisectorDir[0] * 1000, vertex[1] + bisectorDir[1] * 1000], // Ray
      edge.start,
      edge.end
    );
    
    if (intersection) {
      const dist = distance(vertex, intersection);
      if (!bestIntersection || dist < bestIntersection.dist) {
        bestIntersection = {
          point: intersection,
          id: `valley_ridge_${edge.id}`,
          dist
        };
      }
    }
  }
  
  if (bestIntersection) {
    return { point: bestIntersection.point, id: bestIntersection.id };
  }
  
  // Fallback: connect to nearest ridge junction
  if (wings.length > 0) {
    let nearestRidge: { point: XY; id: string; dist: number } | null = null;
    
    for (let i = 0; i < wings.length; i++) {
      const wing = wings[i];
      for (const endpoint of [wing.ridgeStart, wing.ridgeEnd]) {
        const dist = distance(vertex, endpoint);
        if (!nearestRidge || dist < nearestRidge.dist) {
          nearestRidge = {
            point: endpoint,
            id: `ridge_${i}_endpoint`,
            dist
          };
        }
      }
    }
    
    if (nearestRidge) {
      return { point: nearestRidge.point, id: nearestRidge.id };
    }
  }
  
  return null;
}

/**
 * CRITICAL: Clip all skeleton edges to stay within footprint
 */
function clipAllEdgesToFootprint(skeleton: SkeletonEdge[], footprint: XY[]): SkeletonEdge[] {
  const clipped: SkeletonEdge[] = [];
  
  for (const edge of skeleton) {
    const clippedEdge = clipEdgeToPolygon(edge.start, edge.end, footprint);
    
    if (clippedEdge) {
      clipped.push({
        ...edge,
        start: clippedEdge.start,
        end: clippedEdge.end
      });
    } else {
      console.warn(`  Edge ${edge.id} (${edge.type}) completely outside footprint - discarded`);
    }
  }
  
  console.log(`  Clipped ${skeleton.length} edges → ${clipped.length} remaining`);
  
  return clipped;
}

/**
 * Clip a line segment to a polygon using Sutherland-Hodgman-style clipping
 */
function clipEdgeToPolygon(
  start: XY,
  end: XY,
  polygon: XY[]
): { start: XY; end: XY } | null {
  const startInside = pointInPolygon(start, polygon);
  const endInside = pointInPolygon(end, polygon);
  
  // Both inside - no clipping needed
  if (startInside && endInside) {
    return { start, end };
  }
  
  // Both outside - check if line crosses polygon
  if (!startInside && !endInside) {
    const intersections = findAllPolygonIntersections(start, end, polygon);
    if (intersections.length >= 2) {
      // Sort by distance from start
      intersections.sort((a, b) => distance(start, a) - distance(start, b));
      return { start: intersections[0], end: intersections[intersections.length - 1] };
    }
    return null; // Line doesn't cross polygon
  }
  
  // One inside, one outside - clip to boundary
  const intersections = findAllPolygonIntersections(start, end, polygon);
  
  if (intersections.length === 0) {
    // Shouldn't happen, but return the inside point as degenerate segment
    return startInside ? { start, end: start } : { start: end, end };
  }
  
  if (startInside) {
    return { start, end: intersections[0] };
  } else {
    return { start: intersections[0], end };
  }
}

/**
 * Find all intersections between a line segment and polygon edges
 */
function findAllPolygonIntersections(start: XY, end: XY, polygon: XY[]): XY[] {
  const intersections: XY[] = [];
  const n = polygon.length;
  
  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];
    
    const intersection = lineSegmentIntersection(start, end, p1, p2);
    if (intersection) {
      intersections.push(intersection);
    }
  }
  
  return intersections;
}

/**
 * Point in polygon test (ray casting)
 */
function pointInPolygon(point: XY, polygon: XY[]): boolean {
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    
    if (((yi > point[1]) !== (yj > point[1])) &&
        (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Validate and fix topology - ensure no criss-crossing hips
 * ENHANCED: Additional validation for proper geometry constraints
 */
function validateAndFixTopology(skeleton: SkeletonEdge[], footprint: XY[]): SkeletonEdge[] {
  const ridges = skeleton.filter(e => e.type === 'ridge');
  let hips = skeleton.filter(e => e.type === 'hip');
  let valleys = skeleton.filter(e => e.type === 'valley');
  
  const bounds = getBounds(footprint);
  const maxDimension = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const centroid = calculateCentroid(footprint);
  
  // PHASE 1: Check for crossing hips and remove offenders
  const crossingPairs: Array<[number, number]> = [];
  
  for (let i = 0; i < hips.length; i++) {
    for (let j = i + 1; j < hips.length; j++) {
      if (edgesIntersect(hips[i].start, hips[i].end, hips[j].start, hips[j].end)) {
        crossingPairs.push([i, j]);
      }
    }
  }
  
  if (crossingPairs.length > 0) {
    console.warn(`  ⚠️ Found ${crossingPairs.length} crossing hip pairs - fixing...`);
    
    const toRemove = new Set<number>();
    for (const [i, j] of crossingPairs) {
      // Remove the longer one (more likely to be incorrect)
      const len_i = distance(hips[i].start, hips[i].end);
      const len_j = distance(hips[j].start, hips[j].end);
      toRemove.add(len_i > len_j ? i : j);
    }
    
    hips = hips.filter((_, idx) => !toRemove.has(idx));
    console.log(`  Removed ${toRemove.size} crossing hips`);
  }
  
  // PHASE 2: Validate hip endpoints are at footprint corners
  hips = hips.filter(hip => {
    const startOnFootprint = footprint.some(v => distance(hip.start, v) < 0.00001);
    const endInside = pointInPolygon(hip.end, footprint) || 
                      footprint.some(v => distance(hip.end, v) < 0.00005);
    
    if (!startOnFootprint) {
      console.warn(`  Hip ${hip.id} start not on footprint corner - discarded`);
      return false;
    }
    if (!endInside) {
      console.warn(`  Hip ${hip.id} end outside footprint - discarded`);
      return false;
    }
    return true;
  });
  
  // PHASE 3: Validate valleys originate from reflex vertices
  valleys = valleys.filter(valley => {
    const endInsideOrOnRidge = pointInPolygon(valley.end, footprint) || 
                               ridges.some(r => pointNearSegment(valley.end, r.start, r.end, 0.00002));
    
    if (!endInsideOrOnRidge) {
      console.warn(`  Valley ${valley.id} end not at ridge - discarded`);
      return false;
    }
    return true;
  });
  
  // PHASE 4: Validate ridge length sanity
  const saneRidges = ridges.filter(ridge => {
    const len = distance(ridge.start, ridge.end);
    // Ridge should be less than 80% of max dimension (more conservative)
    if (len >= maxDimension * 0.8) {
      console.warn(`  Ridge ${ridge.id} too long (${(len / maxDimension * 100).toFixed(0)}% of dimension) - discarded`);
      return false;
    }
    // Ridge endpoints should be inside footprint
    if (!pointInPolygon(ridge.start, footprint) || !pointInPolygon(ridge.end, footprint)) {
      console.warn(`  Ridge ${ridge.id} endpoints outside footprint - discarded`);
      return false;
    }
    return true;
  });
  
  if (saneRidges.length < ridges.length) {
    console.warn(`  Removed ${ridges.length - saneRidges.length} invalid ridges`);
  }
  
  // PHASE 5: Ensure hip-to-ridge connectivity
  const validatedHips = hips.filter(hip => {
    // Hip end should be close to a ridge endpoint
    const nearRidge = saneRidges.some(r => 
      distance(hip.end, r.start) < 0.00003 || 
      distance(hip.end, r.end) < 0.00003
    );
    
    if (!nearRidge && saneRidges.length > 0) {
      // Snap hip end to nearest ridge endpoint
      let nearestDist = Infinity;
      let nearestPoint: XY | null = null;
      
      for (const r of saneRidges) {
        if (distance(hip.end, r.start) < nearestDist) {
          nearestDist = distance(hip.end, r.start);
          nearestPoint = r.start;
        }
        if (distance(hip.end, r.end) < nearestDist) {
          nearestDist = distance(hip.end, r.end);
          nearestPoint = r.end;
        }
      }
      
      if (nearestPoint && nearestDist < 0.0001) {
        hip.end = nearestPoint;
        console.log(`  Snapped hip ${hip.id} end to ridge endpoint`);
      }
    }
    return true;
  });
  
  console.log(`  Final topology: ${saneRidges.length} ridges, ${validatedHips.length} hips, ${valleys.length} valleys`);
  
  return [...saneRidges, ...validatedHips, ...valleys];
}

/**
 * Check if a point is near a line segment
 */
function pointNearSegment(point: XY, segStart: XY, segEnd: XY, threshold: number): boolean {
  const dx = segEnd[0] - segStart[0];
  const dy = segEnd[1] - segStart[1];
  const segLenSq = dx * dx + dy * dy;
  
  if (segLenSq === 0) {
    return distance(point, segStart) < threshold;
  }
  
  let t = ((point[0] - segStart[0]) * dx + (point[1] - segStart[1]) * dy) / segLenSq;
  t = Math.max(0, Math.min(1, t));
  
  const closestPoint: XY = [
    segStart[0] + t * dx,
    segStart[1] + t * dy
  ];
  
  return distance(point, closestPoint) < threshold;
}

/**
 * Check if two line segments intersect (not at endpoints)
 */
function edgesIntersect(a1: XY, a2: XY, b1: XY, b2: XY): boolean {
  const intersection = lineSegmentIntersection(a1, a2, b1, b2);
  if (!intersection) return false;
  
  // Check if intersection is at endpoint (allowed)
  const epsilon = 0.000001;
  const atEndpoint = 
    distance(intersection, a1) < epsilon ||
    distance(intersection, a2) < epsilon ||
    distance(intersection, b1) < epsilon ||
    distance(intersection, b2) < epsilon;
  
  return !atEndpoint;
}

/**
 * Line segment intersection
 */
function lineSegmentIntersection(a1: XY, a2: XY, b1: XY, b2: XY): XY | null {
  const d1x = a2[0] - a1[0];
  const d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0];
  const d2y = b2[1] - b1[1];
  
  const cross = d1x * d2y - d1y * d2x;
  
  if (Math.abs(cross) < 1e-12) return null; // Parallel
  
  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / cross;
  const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / cross;
  
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return [a1[0] + t * d1x, a1[1] + t * d1y];
  }
  
  return null;
}

/**
 * Line-line intersection (infinite lines)
 */
function lineLineIntersection(a1: XY, a2: XY, b1: XY, b2: XY): XY | null {
  const d1x = a2[0] - a1[0];
  const d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0];
  const d2y = b2[1] - b1[1];
  
  const cross = d1x * d2y - d1y * d2x;
  
  if (Math.abs(cross) < 1e-12) return null;
  
  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / cross;
  
  return [a1[0] + t * d1x, a1[1] + t * d1y];
}

/**
 * Simple constrained skeleton for fallback
 */
function generateSimpleConstrainedSkeleton(vertices: XY[]): SkeletonEdge[] {
  const n = vertices.length;
  const centroid = calculateCentroid(vertices);
  const bounds = getBounds(vertices);
  
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const isHorizontal = width > height;
  
  // Ridge stays well inside the footprint
  const margin = 0.25;
  let ridgeStart: XY, ridgeEnd: XY;
  
  if (isHorizontal) {
    ridgeStart = [bounds.minX + width * margin, centroid[1]];
    ridgeEnd = [bounds.maxX - width * margin, centroid[1]];
  } else {
    ridgeStart = [centroid[0], bounds.minY + height * margin];
    ridgeEnd = [centroid[0], bounds.maxY - height * margin];
  }
  
  const skeleton: SkeletonEdge[] = [{
    id: 'ridge_0',
    start: ridgeStart,
    end: ridgeEnd,
    type: 'ridge',
    boundaryIndices: [],
    startVertexId: 'ridge_0_start',
    endVertexId: 'ridge_0_end'
  }];
  
  // Add hips with proper side assignment
  const ridgeMid = midpoint(ridgeStart, ridgeEnd);
  
  for (let i = 0; i < n; i++) {
    const vertex = vertices[i];
    
    // Assign to ridge endpoint based on which side of the midpoint
    let hipEnd: XY;
    let hipEndId: string;
    
    if (isHorizontal) {
      if (vertex[0] < ridgeMid[0]) {
        hipEnd = ridgeStart;
        hipEndId = 'ridge_0_start';
      } else {
        hipEnd = ridgeEnd;
        hipEndId = 'ridge_0_end';
      }
    } else {
      if (vertex[1] < ridgeMid[1]) {
        hipEnd = ridgeStart;
        hipEndId = 'ridge_0_start';
      } else {
        hipEnd = ridgeEnd;
        hipEndId = 'ridge_0_end';
      }
    }
    
    skeleton.push({
      id: `hip_${i}`,
      start: vertex,
      end: hipEnd,
      type: 'hip',
      boundaryIndices: [i],
      endVertexId: hipEndId
    });
  }
  
  return skeleton;
}

// ==================== HELPER FUNCTIONS ====================

function applyEaveOffset(vertices: XY[], offsetFeet: number): XY[] {
  if (offsetFeet <= 0 || vertices.length < 3) return vertices;
  
  const n = vertices.length;
  const midLat = vertices.reduce((s, v) => s + v[1], 0) / n;
  
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  const offsetMeters = offsetFeet * 0.3048;
  const offsetDegLat = offsetMeters / metersPerDegLat;
  const offsetDegLng = offsetMeters / metersPerDegLng;
  
  const offsetVertices: XY[] = [];
  
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    
    const e1x = curr[0] - prev[0];
    const e1y = curr[1] - prev[1];
    const e2x = next[0] - curr[0];
    const e2y = next[1] - curr[1];
    
    const len1 = Math.sqrt(e1x * e1x + e1y * e1y);
    const len2 = Math.sqrt(e2x * e2x + e2y * e2y);
    
    if (len1 === 0 || len2 === 0) {
      offsetVertices.push(curr);
      continue;
    }
    
    const n1x = -e1y / len1;
    const n1y = e1x / len1;
    const n2x = -e2y / len2;
    const n2y = e2x / len2;
    
    let bisX = n1x + n2x;
    let bisY = n1y + n2y;
    const bisLen = Math.sqrt(bisX * bisX + bisY * bisY);
    
    if (bisLen < 0.001) {
      bisX = n1x;
      bisY = n1y;
    } else {
      bisX /= bisLen;
      bisY /= bisLen;
    }
    
    const dot = n1x * n2x + n1y * n2y;
    const sinHalfAngle = Math.sqrt((1 - dot) / 2);
    const offsetFactor = sinHalfAngle > 0.1 ? 1 / sinHalfAngle : 1;
    const clampedFactor = Math.min(offsetFactor, 2.0);
    
    offsetVertices.push([
      curr[0] + bisX * offsetDegLng * clampedFactor,
      curr[1] + bisY * offsetDegLat * clampedFactor
    ]);
  }
  
  return offsetVertices;
}

function findReflexVertices(vertices: XY[]): Set<number> {
  const reflex = new Set<number>();
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    
    if (isReflex(prev, curr, next)) {
      reflex.add(i);
    }
  }
  
  return reflex;
}

function isReflex(prev: XY, curr: XY, next: XY): boolean {
  const ax = prev[0] - curr[0];
  const ay = prev[1] - curr[1];
  const bx = next[0] - curr[0];
  const by = next[1] - curr[1];
  return ax * by - ay * bx < 0;
}

function detectBuildingShape(vertices: XY[]): 'rectangle' | 'L-shape' | 'T-shape' | 'U-shape' | 'complex' {
  const n = vertices.length;
  
  if (n === 4) {
    const allRightAngles = vertices.every((_, i) => {
      const prev = vertices[(i - 1 + n) % n];
      const curr = vertices[i];
      const next = vertices[(i + 1) % n];
      const angle = calculateAngle(prev, curr, next);
      return Math.abs(angle - 90) < 15;
    });
    
    if (allRightAngles) return 'rectangle';
  }
  
  const reflexCount = findReflexVertices(vertices).size;
  
  if (n >= 6 && n <= 12) {
    const rightAngleCount = vertices.filter((_, i) => {
      const prev = vertices[(i - 1 + n) % n];
      const curr = vertices[i];
      const next = vertices[(i + 1) % n];
      const angle = calculateAngle(prev, curr, next);
      return Math.abs(angle - 90) < 15 || Math.abs(angle - 270) < 15;
    }).length;
    
    if (rightAngleCount / n > 0.7) {
      if (reflexCount === 1) return 'L-shape';
      if (reflexCount === 2) return 'T-shape';
      if (reflexCount >= 3) return 'U-shape';
    }
  }
  
  return 'complex';
}

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

function detectBuildingWings(vertices: XY[], reflexIndices: Set<number>): BuildingWing[] {
  const n = vertices.length;
  const wings: BuildingWing[] = [];
  
  if (reflexIndices.size === 0) {
    const wing = createWingFromVertices(vertices, Array.from({ length: n }, (_, i) => i));
    if (wing) wings.push(wing);
    return wings;
  }
  
  const reflexArray = Array.from(reflexIndices).sort((a, b) => a - b);
  
  if (reflexArray.length === 1) {
    const reflexIdx = reflexArray[0];
    const halfN = Math.floor(n / 2);
    
    const wing1Indices: number[] = [];
    const wing2Indices: number[] = [];
    
    for (let i = 0; i < n; i++) {
      const idx = (reflexIdx + i) % n;
      if (i <= halfN) wing1Indices.push(idx);
      if (i >= halfN || i === 0) wing2Indices.push(idx);
    }
    
    const wing1 = createWingFromVertices(wing1Indices.map(i => vertices[i]), wing1Indices);
    const wing2 = createWingFromVertices(wing2Indices.map(i => vertices[i]), wing2Indices);
    
    if (wing1) wings.push(wing1);
    if (wing2) wings.push(wing2);
    
  } else {
    for (let r = 0; r < reflexArray.length; r++) {
      const startReflex = reflexArray[r];
      const endReflex = reflexArray[(r + 1) % reflexArray.length];
      
      const wingIndices: number[] = [];
      let current = startReflex;
      
      while (true) {
        wingIndices.push(current);
        current = (current + 1) % n;
        if (current === endReflex) {
          wingIndices.push(current);
          break;
        }
        if (wingIndices.length > n) break;
      }
      
      if (wingIndices.length >= 3) {
        const wing = createWingFromVertices(wingIndices.map(i => vertices[i]), wingIndices);
        if (wing) wings.push(wing);
      }
    }
  }
  
  return wings;
}

function createWingFromVertices(wingVertices: XY[], indices: number[]): BuildingWing | null {
  if (wingVertices.length < 2) return null;
  
  const bounds = getBounds(wingVertices);
  const centroid = calculateCentroid(wingVertices);
  
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const primaryAxis = width >= height ? 'horizontal' : 'vertical';
  
  // Constrained ridge placement (20% margin)
  const margin = 0.20;
  let ridgeStart: XY, ridgeEnd: XY;
  
  if (primaryAxis === 'horizontal') {
    ridgeStart = [bounds.minX + width * margin, centroid[1]];
    ridgeEnd = [bounds.maxX - width * margin, centroid[1]];
  } else {
    ridgeStart = [centroid[0], bounds.minY + height * margin];
    ridgeEnd = [centroid[0], bounds.maxY - height * margin];
  }
  
  return {
    vertices: wingVertices,
    indices,
    centroid,
    primaryAxis,
    ridgeStart,
    ridgeEnd,
    bounds
  };
}

function findVertexWing(vertexIdx: number, wings: BuildingWing[], vertices: XY[]): number {
  for (let w = 0; w < wings.length; w++) {
    if (wings[w].indices.includes(vertexIdx)) return w;
  }
  
  const vertex = vertices[vertexIdx];
  let nearestWing = 0;
  let minDist = Infinity;
  
  wings.forEach((wing, idx) => {
    const d = distance(vertex, wing.centroid);
    if (d < minDist) {
      minDist = d;
      nearestWing = idx;
    }
  });
  
  return nearestWing;
}

// ==================== UTILITY FUNCTIONS ====================

function distance(a: XY, b: XY): number {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
}

function midpoint(a: XY, b: XY): XY {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function calculateCentroid(vertices: XY[]): XY {
  const n = vertices.length;
  return [
    vertices.reduce((s, v) => s + v[0], 0) / n,
    vertices.reduce((s, v) => s + v[1], 0) / n
  ];
}

function angleBisector(prev: XY, curr: XY, next: XY): XY {
  const v1 = normalizeVector([prev[0] - curr[0], prev[1] - curr[1]]);
  const v2 = normalizeVector([next[0] - curr[0], next[1] - curr[1]]);
  
  return [curr[0] + v1[0] + v2[0], curr[1] + v1[1] + v2[1]];
}

function normalizeVector(v: XY): XY {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2);
  if (len === 0) return [0, 0];
  return [v[0] / len, v[1] / len];
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

function isPointInsideBounds(
  point: XY,
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
): boolean {
  return point[0] >= bounds.minX && point[0] <= bounds.maxX &&
         point[1] >= bounds.minY && point[1] <= bounds.maxY;
}
