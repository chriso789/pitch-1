// Simplified Straight Skeleton Algorithm for Roof Topology Extraction
// Optimized for common residential building shapes (rectangles, L-shapes, T-shapes)

type XY = [number, number]; // [lng, lat]

interface SkeletonEdge {
  start: XY;
  end: XY;
  type: 'ridge' | 'hip' | 'valley';
  boundaryIndices?: number[]; // Which boundary vertices this connects to
}

/**
 * Compute straight skeleton of a polygon and classify edges into ridge/hip/valley
 * @param ring Array of [lng, lat] coordinates (closed polygon, CCW orientation)
 * @returns Array of classified skeleton edges
 */
export function computeStraightSkeleton(ring: XY[]): SkeletonEdge[] {
  // Ensure closed ring
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring = [...ring, ring[0]];
  }

  // Remove duplicate closing vertex for processing
  const vertices = ring.slice(0, -1);
  
  if (vertices.length < 3) {
    return [];
  }

  // Find reflex (concave) vertices
  const reflexIndices = findReflexVertices(vertices);
  
  // Detect building shape
  const shapeType = detectBuildingShape(vertices);
  
  // Generate skeleton based on shape
  let skeleton: SkeletonEdge[] = [];
  
  if (shapeType === 'rectangle') {
    skeleton = generateRectangularSkeleton(vertices);
  } else if (shapeType === 'L-shape' || shapeType === 'T-shape' || shapeType === 'U-shape') {
    skeleton = generateComplexSkeleton(vertices, reflexIndices);
  } else {
    // Complex shape: use simplified medial axis approach
    skeleton = generateMedialAxisSkeleton(vertices, reflexIndices);
  }
  
  // Classify each edge
  return skeleton.map(edge => ({
    ...edge,
    type: classifySkeletonEdge(edge, reflexIndices, vertices)
  }));
}

/**
 * Find reflex (concave) vertices in a CCW polygon
 */
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

/**
 * Check if vertex is reflex (concave) using cross product
 */
function isReflex(prev: XY, curr: XY, next: XY): boolean {
  const ax = prev[0] - curr[0];
  const ay = prev[1] - curr[1];
  const bx = next[0] - curr[0];
  const by = next[1] - curr[1];
  const cross = ax * by - ay * bx;
  return cross < 0; // Negative for reflex in CCW orientation
}

/**
 * Detect building shape type
 */
function detectBuildingShape(vertices: XY[]): 'rectangle' | 'L-shape' | 'T-shape' | 'U-shape' | 'complex' {
  const n = vertices.length;
  
  // Check for rectangle (4 vertices, all ~90° angles)
  if (n === 4) {
    const allRightAngles = vertices.every((_, i) => {
      const prev = vertices[(i - 1 + n) % n];
      const curr = vertices[i];
      const next = vertices[(i + 1) % n];
      const angle = calculateAngle(prev, curr, next);
      return Math.abs(angle - 90) < 10; // ±10° tolerance
    });
    
    if (allRightAngles) return 'rectangle';
  }
  
  // Check for L, T, U shapes (6-12 vertices, mostly 90° angles)
  if (n >= 6 && n <= 12) {
    const rightAngleCount = vertices.filter((_, i) => {
      const prev = vertices[(i - 1 + n) % n];
      const curr = vertices[i];
      const next = vertices[(i + 1) % n];
      const angle = calculateAngle(prev, curr, next);
      return Math.abs(angle - 90) < 10 || Math.abs(angle - 270) < 10;
    }).length;
    
    const rightAngleRatio = rightAngleCount / n;
    
    if (rightAngleRatio > 0.8) {
      if (n === 6) return 'L-shape';
      if (n === 8) return 'T-shape';
      if (n >= 10) return 'U-shape';
    }
  }
  
  return 'complex';
}

/**
 * Calculate interior angle at vertex (in degrees)
 */
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

/**
 * Generate skeleton for rectangular buildings
 */
function generateRectangularSkeleton(vertices: XY[]): SkeletonEdge[] {
  // Find longest edge to determine ridge direction
  let maxLength = 0;
  let longestEdgeIdx = 0;
  
  for (let i = 0; i < 4; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % 4];
    const length = distance(v1, v2);
    if (length > maxLength) {
      maxLength = length;
      longestEdgeIdx = i;
    }
  }
  
  // Ridge runs parallel to longest edge, in the middle
  const edge1 = vertices[longestEdgeIdx];
  const edge2 = vertices[(longestEdgeIdx + 1) % 4];
  const opposite1 = vertices[(longestEdgeIdx + 2) % 4];
  const opposite2 = vertices[(longestEdgeIdx + 3) % 4];
  
  // Calculate midpoints
  const ridgeStart = midpoint(edge1, opposite2);
  const ridgeEnd = midpoint(edge2, opposite1);
  
  // Create ridge
  const ridge: SkeletonEdge = {
    start: ridgeStart,
    end: ridgeEnd,
    type: 'ridge',
    boundaryIndices: []
  };
  
  // Create 4 hips from corners to ridge endpoints
  const hips: SkeletonEdge[] = [
    { start: edge1, end: ridgeStart, type: 'hip', boundaryIndices: [longestEdgeIdx] },
    { start: edge2, end: ridgeEnd, type: 'hip', boundaryIndices: [(longestEdgeIdx + 1) % 4] },
    { start: opposite1, end: ridgeEnd, type: 'hip', boundaryIndices: [(longestEdgeIdx + 2) % 4] },
    { start: opposite2, end: ridgeStart, type: 'hip', boundaryIndices: [(longestEdgeIdx + 3) % 4] }
  ];
  
  return [ridge, ...hips];
}

/**
 * Generate skeleton for L, T, U shapes
 * FIXED: Proper valley detection at concave (reflex) vertices
 * Valleys form where two roof planes meet going DOWNWARD (at inside corners)
 */
function generateComplexSkeleton(vertices: XY[], reflexIndices: Set<number>): SkeletonEdge[] {
  const skeleton: SkeletonEdge[] = [];
  const n = vertices.length;
  
  // Find centroid as approximate interior point
  const centroid = calculateCentroid(vertices);
  
  // Get bounding box for ridge direction
  const bounds = getBounds(vertices);
  const isWiderThanTall = (bounds.maxX - bounds.minX) > (bounds.maxY - bounds.minY);
  
  // IMPROVED: Create valley lines from each reflex (concave) vertex
  // These are where two roof planes meet going DOWNWARD
  const valleyEndpoints: XY[] = [];
  
  reflexIndices.forEach(idx => {
    const vertex = vertices[idx];
    const prev = vertices[(idx - 1 + n) % n];
    const next = vertices[(idx + 1) % n];
    
    // Calculate bisector direction (inward for reflex vertices)
    const bisector = angleBisector(prev, vertex, next);
    const bisectorDir: XY = [bisector[0] - vertex[0], bisector[1] - vertex[1]];
    const bisectorLen = Math.sqrt(bisectorDir[0] ** 2 + bisectorDir[1] ** 2);
    
    if (bisectorLen > 0) {
      // Normalize and extend inward
      const normalizedDir: XY = [bisectorDir[0] / bisectorLen, bisectorDir[1] / bisectorLen];
      
      // Valley extends from reflex vertex toward interior
      // Length should be proportional to distance to centroid
      const distToCentroid = distance(vertex, centroid);
      const valleyLength = distToCentroid * 0.6; // 60% toward centroid
      
      const valleyEnd: XY = [
        vertex[0] + normalizedDir[0] * valleyLength * 0.5,
        vertex[1] + normalizedDir[1] * valleyLength * 0.5
      ];
      
      valleyEndpoints.push(valleyEnd);
      
      skeleton.push({
        start: vertex,
        end: valleyEnd,
        type: 'valley',
        boundaryIndices: [idx]
      });
    }
  });
  
  console.log(`  Complex skeleton: ${reflexIndices.size} valleys from reflex vertices`);
  
  // Create main ridge line(s) based on building shape
  // For L/T/U shapes, ridge typically runs through the main mass
  const ridgeMargin = 0.35; // 35% from edges
  
  let ridgeStart: XY, ridgeEnd: XY;
  
  if (isWiderThanTall) {
    // Horizontal ridge
    ridgeStart = [bounds.minX + (bounds.maxX - bounds.minX) * ridgeMargin, centroid[1]];
    ridgeEnd = [bounds.maxX - (bounds.maxX - bounds.minX) * ridgeMargin, centroid[1]];
  } else {
    // Vertical ridge
    ridgeStart = [centroid[0], bounds.minY + (bounds.maxY - bounds.minY) * ridgeMargin];
    ridgeEnd = [centroid[0], bounds.maxY - (bounds.maxY - bounds.minY) * ridgeMargin];
  }
  
  skeleton.push({
    start: ridgeStart,
    end: ridgeEnd,
    type: 'ridge',
    boundaryIndices: []
  });
  
  // Connect valley endpoints to nearest ridge point if they're close
  valleyEndpoints.forEach(valleyEnd => {
    const ridgePoint = closestPointOnLine(valleyEnd, ridgeStart, ridgeEnd);
    const distToRidge = distance(valleyEnd, ridgePoint);
    
    // If valley end is close to ridge, extend to meet it
    if (distToRidge < distance(ridgeStart, ridgeEnd) * 0.3) {
      // Find the valley edge and extend it
      const valleyEdge = skeleton.find(e => 
        e.type === 'valley' && 
        (distance(e.end, valleyEnd) < 0.0001)
      );
      if (valleyEdge) {
        valleyEdge.end = ridgePoint;
      }
    }
  });
  
  // Create hips from convex corners to nearest ridge point
  for (let i = 0; i < n; i++) {
    if (!reflexIndices.has(i)) {
      const vertex = vertices[i];
      const hipEnd = closestPointOnLine(vertex, ridgeStart, ridgeEnd);
      
      // Only add hip if it's a reasonable length
      const hipLength = distance(vertex, hipEnd);
      const ridgeLength = distance(ridgeStart, ridgeEnd);
      
      if (hipLength > ridgeLength * 0.1 && hipLength < ridgeLength * 2) {
        skeleton.push({
          start: vertex,
          end: hipEnd,
          type: 'hip',
          boundaryIndices: [i]
        });
      }
    }
  }
  
  console.log(`  Generated: ${skeleton.filter(e => e.type === 'ridge').length} ridges, ${skeleton.filter(e => e.type === 'hip').length} hips, ${skeleton.filter(e => e.type === 'valley').length} valleys`);
  
  return skeleton;
}

/**
 * Generate skeleton using medial axis approach (for complex shapes)
 * IMPROVED: Better valley detection and facet generation
 */
function generateMedialAxisSkeleton(vertices: XY[], reflexIndices: Set<number>): SkeletonEdge[] {
  const skeleton: SkeletonEdge[] = [];
  const n = vertices.length;
  const centroid = calculateCentroid(vertices);
  
  // Create a central ridge based on building orientation
  const bounds = getBounds(vertices);
  const isWiderThanTall = (bounds.maxX - bounds.minX) > (bounds.maxY - bounds.minY);
  
  let ridgeStart: XY, ridgeEnd: XY;
  
  if (isWiderThanTall) {
    // Horizontal ridge (building is wider than tall)
    ridgeStart = [bounds.minX + (bounds.maxX - bounds.minX) * 0.25, centroid[1]];
    ridgeEnd = [bounds.maxX - (bounds.maxX - bounds.minX) * 0.25, centroid[1]];
  } else {
    // Vertical ridge (building is taller than wide)
    ridgeStart = [centroid[0], bounds.minY + (bounds.maxY - bounds.minY) * 0.25];
    ridgeEnd = [centroid[0], bounds.maxY - (bounds.maxY - bounds.minY) * 0.25];
  }
  
  skeleton.push({
    start: ridgeStart,
    end: ridgeEnd,
    type: 'ridge',
    boundaryIndices: []
  });
  
  // Connect corners to ridge with proper valley/hip classification
  for (let i = 0; i < n; i++) {
    const vertex = vertices[i];
    const isReflex = reflexIndices.has(i);
    const nearestPoint = closestPointOnLine(vertex, ridgeStart, ridgeEnd);
    
    // Calculate line length - skip very short lines
    const lineLength = distance(vertex, nearestPoint);
    const ridgeLength = distance(ridgeStart, ridgeEnd);
    
    if (lineLength > ridgeLength * 0.05) { // Skip lines shorter than 5% of ridge
      skeleton.push({
        start: vertex,
        end: nearestPoint,
        type: isReflex ? 'valley' : 'hip',
        boundaryIndices: [i]
      });
    }
  }
  
  console.log(`  Medial axis: ${skeleton.filter(e => e.type === 'ridge').length} ridges, ${skeleton.filter(e => e.type === 'hip').length} hips, ${skeleton.filter(e => e.type === 'valley').length} valleys`);
  
  return skeleton;
}

/**
 * Classify skeleton edge based on connectivity and boundary vertices
 */
function classifySkeletonEdge(
  edge: SkeletonEdge,
  reflexIndices: Set<number>,
  vertices: XY[]
): 'ridge' | 'hip' | 'valley' {
  // Already classified during generation
  return edge.type;
}

// ===== Utility Functions =====

function distance(a: XY, b: XY): number {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
}

function midpoint(a: XY, b: XY): XY {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function calculateCentroid(vertices: XY[]): XY {
  const n = vertices.length;
  const sumX = vertices.reduce((s, v) => s + v[0], 0);
  const sumY = vertices.reduce((s, v) => s + v[1], 0);
  return [sumX / n, sumY / n];
}

function angleBisector(prev: XY, curr: XY, next: XY): XY {
  // Normalize vectors
  const v1x = prev[0] - curr[0];
  const v1y = prev[1] - curr[1];
  const len1 = Math.sqrt(v1x ** 2 + v1y ** 2);
  
  const v2x = next[0] - curr[0];
  const v2y = next[1] - curr[1];
  const len2 = Math.sqrt(v2x ** 2 + v2y ** 2);
  
  // Bisector direction
  const bisX = v1x / len1 + v2x / len2;
  const bisY = v1y / len1 + v2y / len2;
  
  return [curr[0] + bisX, curr[1] + bisY];
}

function moveToward(from: XY, to: XY, ratio: number): XY {
  return [
    from[0] + (to[0] - from[0]) * ratio,
    from[1] + (to[1] - from[1]) * ratio
  ];
}

function closestPointOnLine(point: XY, lineStart: XY, lineEnd: XY): XY {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lenSq = dx ** 2 + dy ** 2;
  
  if (lenSq === 0) return lineStart;
  
  const t = Math.max(0, Math.min(1, 
    ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / lenSq
  ));
  
  return [
    lineStart[0] + t * dx,
    lineStart[1] + t * dy
  ];
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
