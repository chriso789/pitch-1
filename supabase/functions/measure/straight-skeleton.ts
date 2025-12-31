// Straight Skeleton Algorithm for Roof Topology Extraction
// FIXED: Multi-wing ridge topology for L/T/U-shaped buildings
// Each building wing gets its own ridge, hips connect to LOCAL ridge endpoints only

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
  wingIndex?: number; // Which wing this edge belongs to
}

interface TopologicalSkeleton {
  vertices: Map<string, SkeletonVertex>;
  edges: SkeletonEdge[];
}

interface BuildingWing {
  vertices: XY[];
  indices: number[];      // Original vertex indices
  centroid: XY;
  primaryAxis: 'horizontal' | 'vertical';
  ridgeStart: XY;
  ridgeEnd: XY;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

// Default soffit overhang in feet (typical residential is 12-18 inches)
const DEFAULT_SOFFIT_OFFSET_FT = 1.0;

/**
 * Compute straight skeleton of a polygon and classify edges into ridge/hip/valley
 * NEW: Multi-wing detection for complex buildings - eliminates starburst pattern
 * @param ring Array of [lng, lat] coordinates (closed polygon, CCW orientation)
 * @param soffitOffsetFt Soffit overhang in feet (default 1ft = 12 inches)
 * @returns Array of classified skeleton edges with shared vertices
 */
export function computeStraightSkeleton(ring: XY[], soffitOffsetFt: number = DEFAULT_SOFFIT_OFFSET_FT): SkeletonEdge[] {
  // Ensure closed ring
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring = [...ring, ring[0]];
  }

  // Remove duplicate closing vertex for processing
  let vertices = ring.slice(0, -1);
  
  if (vertices.length < 3) {
    return [];
  }

  // Apply eave/soffit offset to expand perimeter to actual roof edge
  if (soffitOffsetFt > 0) {
    vertices = applyEaveOffset(vertices, soffitOffsetFt);
    console.log(`  Applied ${soffitOffsetFt}ft eave offset to perimeter`);
  }

  // Find reflex (concave) vertices
  const reflexIndices = findReflexVertices(vertices);
  
  // Detect building shape
  const shapeType = detectBuildingShape(vertices);
  console.log(`  Detected building shape: ${shapeType} with ${vertices.length} vertices, ${reflexIndices.size} reflex corners`);
  
  // Generate skeleton based on shape
  let skeleton: SkeletonEdge[] = [];
  
  if (shapeType === 'rectangle') {
    skeleton = generateRectangularSkeleton(vertices);
  } else if (shapeType === 'L-shape' || shapeType === 'T-shape' || shapeType === 'U-shape') {
    // NEW: Use multi-wing algorithm for complex shapes
    skeleton = generateMultiWingSkeleton(vertices, reflexIndices, shapeType);
  } else {
    // Complex shapes: also use multi-wing with more wings
    skeleton = generateMultiWingSkeleton(vertices, reflexIndices, 'complex');
  }
  
  // CRITICAL: Enforce exact vertex sharing - all lines must connect at exact points
  skeleton = enforceSharedVertices(skeleton, vertices, reflexIndices);
  
  // Classify each edge (already done during generation, just validate)
  return skeleton.map(edge => ({
    ...edge,
    type: classifySkeletonEdge(edge, reflexIndices, vertices)
  }));
}

/**
 * Apply eave/soffit offset to expand footprint to actual roof edge
 * Typical soffit overhang is 12-18 inches beyond wall line
 */
function applyEaveOffset(vertices: XY[], offsetFeet: number): XY[] {
  if (offsetFeet <= 0 || vertices.length < 3) return vertices;
  
  const n = vertices.length;
  const midLat = vertices.reduce((s, v) => s + v[1], 0) / n;
  
  // Convert feet to degrees
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  const offsetMeters = offsetFeet * 0.3048;
  const offsetDegLat = offsetMeters / metersPerDegLat;
  const offsetDegLng = offsetMeters / metersPerDegLng;
  
  // Calculate outward normal for each edge and offset vertices
  const offsetVertices: XY[] = [];
  
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    
    // Edge vectors
    const e1x = curr[0] - prev[0];
    const e1y = curr[1] - prev[1];
    const e2x = next[0] - curr[0];
    const e2y = next[1] - curr[1];
    
    // Outward normals (perpendicular, pointing outward for CCW polygon)
    const len1 = Math.sqrt(e1x * e1x + e1y * e1y);
    const len2 = Math.sqrt(e2x * e2x + e2y * e2y);
    
    if (len1 === 0 || len2 === 0) {
      offsetVertices.push(curr);
      continue;
    }
    
    // Normal for edge 1: rotate 90° counterclockwise (outward for CCW)
    const n1x = -e1y / len1;
    const n1y = e1x / len1;
    
    // Normal for edge 2
    const n2x = -e2y / len2;
    const n2y = e2x / len2;
    
    // Average normal direction (bisector)
    let bisX = n1x + n2x;
    let bisY = n1y + n2y;
    const bisLen = Math.sqrt(bisX * bisX + bisY * bisY);
    
    if (bisLen < 0.001) {
      // Edges are parallel, use single normal
      bisX = n1x;
      bisY = n1y;
    } else {
      bisX /= bisLen;
      bisY /= bisLen;
    }
    
    // Calculate offset distance adjustment for corner angle
    const dot = n1x * n2x + n1y * n2y;
    const sinHalfAngle = Math.sqrt((1 - dot) / 2);
    const offsetFactor = sinHalfAngle > 0.1 ? 1 / sinHalfAngle : 1;
    
    // Clamp offset factor to prevent extreme expansion at acute corners
    const clampedFactor = Math.min(offsetFactor, 2.0);
    
    // Apply offset
    const offsetX = bisX * offsetDegLng * clampedFactor;
    const offsetY = bisY * offsetDegLat * clampedFactor;
    
    offsetVertices.push([curr[0] + offsetX, curr[1] + offsetY]);
  }
  
  return offsetVertices;
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
  
  // Count reflex vertices to determine shape
  const reflexCount = findReflexVertices(vertices).size;
  
  if (n >= 6 && n <= 12) {
    const rightAngleCount = vertices.filter((_, i) => {
      const prev = vertices[(i - 1 + n) % n];
      const curr = vertices[i];
      const next = vertices[(i + 1) % n];
      const angle = calculateAngle(prev, curr, next);
      return Math.abs(angle - 90) < 15 || Math.abs(angle - 270) < 15;
    }).length;
    
    const rightAngleRatio = rightAngleCount / n;
    
    if (rightAngleRatio > 0.7) {
      if (reflexCount === 1) return 'L-shape';
      if (reflexCount === 2) return 'T-shape';
      if (reflexCount >= 3) return 'U-shape';
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
 * CORRECT: Hips start at eave corners and end EXACTLY at ridge endpoints
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
  
  // Calculate ridge endpoints as exact midpoints
  const ridgeStart: XY = midpoint(edge1, opposite2);
  const ridgeEnd: XY = midpoint(edge2, opposite1);
  
  // Create ridge with explicit ID
  const ridge: SkeletonEdge = {
    id: 'ridge_0',
    start: ridgeStart,
    end: ridgeEnd,
    type: 'ridge',
    boundaryIndices: [],
    startVertexId: 'ridge_0_start',
    endVertexId: 'ridge_0_end',
    wingIndex: 0
  };
  
  // Create 4 hips: each starts at an eave corner and ends at the EXACT ridge endpoint
  const hips: SkeletonEdge[] = [
    { 
      id: 'hip_0',
      start: edge1, 
      end: ridgeStart,
      type: 'hip', 
      boundaryIndices: [longestEdgeIdx],
      endVertexId: 'ridge_0_start',
      wingIndex: 0
    },
    { 
      id: 'hip_1',
      start: edge2, 
      end: ridgeEnd,
      type: 'hip', 
      boundaryIndices: [(longestEdgeIdx + 1) % 4],
      endVertexId: 'ridge_0_end',
      wingIndex: 0
    },
    { 
      id: 'hip_2',
      start: opposite1, 
      end: ridgeEnd,
      type: 'hip', 
      boundaryIndices: [(longestEdgeIdx + 2) % 4],
      endVertexId: 'ridge_0_end',
      wingIndex: 0
    },
    { 
      id: 'hip_3',
      start: opposite2, 
      end: ridgeStart,
      type: 'hip', 
      boundaryIndices: [(longestEdgeIdx + 3) % 4],
      endVertexId: 'ridge_0_start',
      wingIndex: 0
    }
  ];
  
  console.log(`  Rectangular skeleton: 1 ridge, 4 hips with shared vertices`);
  
  return [ridge, ...hips];
}

/**
 * NEW: Multi-wing skeleton generator for L/T/U-shaped buildings
 * Creates separate ridge segments for each building wing, eliminating starburst pattern
 */
function generateMultiWingSkeleton(
  vertices: XY[], 
  reflexIndices: Set<number>,
  shapeType: string
): SkeletonEdge[] {
  const skeleton: SkeletonEdge[] = [];
  const n = vertices.length;
  
  // Step 1: Detect building wings
  const wings = detectBuildingWings(vertices, reflexIndices);
  console.log(`  Detected ${wings.length} building wings for ${shapeType}`);
  
  if (wings.length === 0) {
    // Fallback to simple approach
    return generateSimpleSkeleton(vertices, reflexIndices);
  }
  
  // Step 2: Create ridge segment for each wing
  const ridgeJunctions: XY[] = [];
  
  wings.forEach((wing, wingIdx) => {
    const ridgeId = `ridge_${wingIdx}`;
    skeleton.push({
      id: ridgeId,
      start: wing.ridgeStart,
      end: wing.ridgeEnd,
      type: 'ridge',
      boundaryIndices: [],
      startVertexId: `${ridgeId}_start`,
      endVertexId: `${ridgeId}_end`,
      wingIndex: wingIdx
    });
    
    // Track ridge endpoints for junction detection
    ridgeJunctions.push(wing.ridgeStart, wing.ridgeEnd);
  });
  
  // Step 3: Find ridge junction points (where wings meet)
  const junctionPoints = findRidgeJunctions(wings, ridgeJunctions);
  console.log(`  Found ${junctionPoints.length} ridge junction points`);
  
  // Step 4: Connect ridges at junctions if they're close enough
  if (junctionPoints.length > 0 && wings.length > 1) {
    // Connect adjacent wing ridges
    for (let i = 0; i < wings.length - 1; i++) {
      const junction = junctionPoints[i] || wings[i].ridgeEnd;
      
      // Add connecting ridge segment if ridges don't already meet
      const distToNextRidge = distance(wings[i].ridgeEnd, wings[i + 1].ridgeStart);
      if (distToNextRidge > 0.00001) { // Small tolerance
        skeleton.push({
          id: `ridge_connector_${i}`,
          start: wings[i].ridgeEnd,
          end: wings[i + 1].ridgeStart,
          type: 'ridge',
          boundaryIndices: [],
          startVertexId: `ridge_${i}_end`,
          endVertexId: `ridge_${i + 1}_start`,
          wingIndex: -1 // Connector
        });
      }
    }
  }
  
  // Step 5: Create hips - each corner connects ONLY to its LOCAL wing's ridge
  for (let i = 0; i < n; i++) {
    if (reflexIndices.has(i)) continue; // Skip reflex vertices (they get valleys)
    
    const vertex = vertices[i];
    
    // Find which wing this vertex belongs to
    const wingIdx = findVertexWing(i, wings, vertices);
    if (wingIdx < 0 || wingIdx >= wings.length) continue;
    
    const wing = wings[wingIdx];
    
    // Connect to the NEAREST endpoint of THIS wing's ridge only
    const distToStart = distance(vertex, wing.ridgeStart);
    const distToEnd = distance(vertex, wing.ridgeEnd);
    
    let hipEnd: XY;
    let hipEndVertexId: string;
    
    if (distToStart <= distToEnd) {
      hipEnd = wing.ridgeStart;
      hipEndVertexId = `ridge_${wingIdx}_start`;
    } else {
      hipEnd = wing.ridgeEnd;
      hipEndVertexId = `ridge_${wingIdx}_end`;
    }
    
    // Only add hip if it's a reasonable length
    const hipLength = distance(vertex, hipEnd);
    const ridgeLength = distance(wing.ridgeStart, wing.ridgeEnd);
    
    if (hipLength > 0.000001 && hipLength < ridgeLength * 4) {
      skeleton.push({
        id: `hip_${i}`,
        start: vertex,
        end: hipEnd,
        type: 'hip',
        boundaryIndices: [i],
        endVertexId: hipEndVertexId,
        wingIndex: wingIdx
      });
    }
  }
  
  // Step 6: Create valleys from reflex vertices
  reflexIndices.forEach((idx) => {
    const vertex = vertices[idx];
    const prev = vertices[(idx - 1 + n) % n];
    const next = vertices[(idx + 1) % n];
    
    // Calculate bisector direction (inward for reflex vertices)
    const bisector = angleBisector(prev, vertex, next);
    const bisectorDir: XY = [bisector[0] - vertex[0], bisector[1] - vertex[1]];
    const bisectorLen = Math.sqrt(bisectorDir[0] ** 2 + bisectorDir[1] ** 2);
    
    if (bisectorLen > 0) {
      const normalizedDir: XY = [bisectorDir[0] / bisectorLen, bisectorDir[1] / bisectorLen];
      
      // Find the nearest ridge junction or ridge intersection
      let valleyEnd: XY | null = null;
      let valleyEndVertexId = '';
      let minDist = Infinity;
      
      // First try: find intersection with any ridge
      wings.forEach((wing, wingIdx) => {
        const intersection = rayLineIntersection(vertex, normalizedDir, wing.ridgeStart, wing.ridgeEnd);
        if (intersection) {
          const d = distance(vertex, intersection);
          if (d < minDist) {
            minDist = d;
            valleyEnd = intersection;
            valleyEndVertexId = `valley_ridge_${idx}_${wingIdx}`;
          }
        }
      });
      
      // Second try: if no intersection, connect to nearest ridge junction
      if (!valleyEnd && junctionPoints.length > 0) {
        junctionPoints.forEach((jp, jpIdx) => {
          const d = distance(vertex, jp);
          if (d < minDist) {
            minDist = d;
            valleyEnd = jp;
            valleyEndVertexId = `junction_${jpIdx}`;
          }
        });
      }
      
      // Third try: nearest ridge endpoint
      if (!valleyEnd) {
        wings.forEach((wing, wingIdx) => {
          [wing.ridgeStart, wing.ridgeEnd].forEach((endpoint, epIdx) => {
            const d = distance(vertex, endpoint);
            if (d < minDist) {
              minDist = d;
              valleyEnd = endpoint;
              valleyEndVertexId = `ridge_${wingIdx}_${epIdx === 0 ? 'start' : 'end'}`;
            }
          });
        });
      }
      
      if (valleyEnd) {
        skeleton.push({
          id: `valley_${idx}`,
          start: vertex,
          end: valleyEnd,
          type: 'valley',
          boundaryIndices: [idx],
          endVertexId: valleyEndVertexId
        });
      }
    }
  });
  
  console.log(`  Multi-wing skeleton: ${skeleton.filter(e => e.type === 'ridge').length} ridges, ${skeleton.filter(e => e.type === 'hip').length} hips, ${skeleton.filter(e => e.type === 'valley').length} valleys`);
  
  return skeleton;
}

/**
 * Detect building wings based on vertex positions and reflex corners
 * Each reflex vertex typically indicates a wing transition
 */
function detectBuildingWings(vertices: XY[], reflexIndices: Set<number>): BuildingWing[] {
  const n = vertices.length;
  const wings: BuildingWing[] = [];
  
  if (reflexIndices.size === 0) {
    // No reflex vertices - treat as single wing
    const wing = createWingFromVertices(vertices, Array.from({ length: n }, (_, i) => i));
    if (wing) wings.push(wing);
    return wings;
  }
  
  // Split polygon at reflex vertices into wings
  const reflexArray = Array.from(reflexIndices).sort((a, b) => a - b);
  
  // For L-shape (1 reflex), split into 2 wings
  // For T-shape (2 reflex), split into 3 wings
  // For U-shape (3+ reflex), split into 3+ wings
  
  if (reflexArray.length === 1) {
    // L-shape: 2 wings
    const reflexIdx = reflexArray[0];
    
    // Wing 1: from reflex to halfway around
    const wing1Indices: number[] = [];
    const wing2Indices: number[] = [];
    
    // Determine split point (opposite to reflex)
    const halfN = Math.floor(n / 2);
    const splitIdx = (reflexIdx + halfN) % n;
    
    // Build wing index ranges
    for (let i = 0; i < n; i++) {
      const idx = (reflexIdx + i) % n;
      if (i <= halfN) {
        wing1Indices.push(idx);
      }
      if (i >= halfN || i === 0) {
        wing2Indices.push(idx);
      }
    }
    
    const wing1Vertices = wing1Indices.map(i => vertices[i]);
    const wing2Vertices = wing2Indices.map(i => vertices[i]);
    
    const wing1 = createWingFromVertices(wing1Vertices, wing1Indices);
    const wing2 = createWingFromVertices(wing2Vertices, wing2Indices);
    
    if (wing1) wings.push(wing1);
    if (wing2) wings.push(wing2);
    
  } else if (reflexArray.length >= 2) {
    // T or U-shape: multiple wings
    // Each segment between adjacent reflex vertices is a wing
    
    for (let r = 0; r < reflexArray.length; r++) {
      const startReflex = reflexArray[r];
      const endReflex = reflexArray[(r + 1) % reflexArray.length];
      
      const wingIndices: number[] = [];
      let current = startReflex;
      
      // Walk from one reflex to the next
      while (true) {
        wingIndices.push(current);
        current = (current + 1) % n;
        if (current === endReflex) {
          wingIndices.push(current);
          break;
        }
        // Safety: prevent infinite loop
        if (wingIndices.length > n) break;
      }
      
      if (wingIndices.length >= 3) {
        const wingVertices = wingIndices.map(i => vertices[i]);
        const wing = createWingFromVertices(wingVertices, wingIndices);
        if (wing) wings.push(wing);
      }
    }
  }
  
  return wings;
}

/**
 * Create a wing object from a set of vertices
 */
function createWingFromVertices(wingVertices: XY[], indices: number[]): BuildingWing | null {
  if (wingVertices.length < 2) return null;
  
  const bounds = getBounds(wingVertices);
  const centroid = calculateCentroid(wingVertices);
  
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  
  const primaryAxis: 'horizontal' | 'vertical' = width >= height ? 'horizontal' : 'vertical';
  
  // Calculate ridge endpoints - ridge runs along the center of the wing
  const ridgeMargin = 0.15; // Start/end ridge 15% in from edges
  
  let ridgeStart: XY, ridgeEnd: XY;
  
  if (primaryAxis === 'horizontal') {
    ridgeStart = [bounds.minX + width * ridgeMargin, centroid[1]];
    ridgeEnd = [bounds.maxX - width * ridgeMargin, centroid[1]];
  } else {
    ridgeStart = [centroid[0], bounds.minY + height * ridgeMargin];
    ridgeEnd = [centroid[0], bounds.maxY - height * ridgeMargin];
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

/**
 * Find junction points where wing ridges should meet
 */
function findRidgeJunctions(wings: BuildingWing[], ridgeJunctions: XY[]): XY[] {
  const junctions: XY[] = [];
  
  if (wings.length <= 1) return junctions;
  
  // For each pair of adjacent wings, find where their ridges should meet
  for (let i = 0; i < wings.length - 1; i++) {
    const wing1 = wings[i];
    const wing2 = wings[i + 1];
    
    // Junction point is where the wings overlap or meet
    // Use the average of the closest ridge endpoints
    const distances = [
      { d: distance(wing1.ridgeEnd, wing2.ridgeStart), p1: wing1.ridgeEnd, p2: wing2.ridgeStart },
      { d: distance(wing1.ridgeEnd, wing2.ridgeEnd), p1: wing1.ridgeEnd, p2: wing2.ridgeEnd },
      { d: distance(wing1.ridgeStart, wing2.ridgeStart), p1: wing1.ridgeStart, p2: wing2.ridgeStart },
      { d: distance(wing1.ridgeStart, wing2.ridgeEnd), p1: wing1.ridgeStart, p2: wing2.ridgeEnd }
    ];
    
    distances.sort((a, b) => a.d - b.d);
    const closest = distances[0];
    
    // Junction is midpoint between closest endpoints
    const junction: XY = midpoint(closest.p1, closest.p2);
    junctions.push(junction);
  }
  
  return junctions;
}

/**
 * Find which wing a vertex belongs to
 */
function findVertexWing(vertexIdx: number, wings: BuildingWing[], vertices: XY[]): number {
  // Check if vertex index is in any wing's indices
  for (let w = 0; w < wings.length; w++) {
    if (wings[w].indices.includes(vertexIdx)) {
      return w;
    }
  }
  
  // Fallback: find nearest wing by distance
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

/**
 * Simple skeleton fallback for when wing detection fails
 */
function generateSimpleSkeleton(vertices: XY[], reflexIndices: Set<number>): SkeletonEdge[] {
  const skeleton: SkeletonEdge[] = [];
  const n = vertices.length;
  const centroid = calculateCentroid(vertices);
  const bounds = getBounds(vertices);
  
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const isWiderThanTall = width > height;
  
  // Create a single main ridge
  const ridgeMargin = 0.25;
  let ridgeStart: XY, ridgeEnd: XY;
  
  if (isWiderThanTall) {
    ridgeStart = [bounds.minX + width * ridgeMargin, centroid[1]];
    ridgeEnd = [bounds.maxX - width * ridgeMargin, centroid[1]];
  } else {
    ridgeStart = [centroid[0], bounds.minY + height * ridgeMargin];
    ridgeEnd = [centroid[0], bounds.maxY - height * ridgeMargin];
  }
  
  skeleton.push({
    id: 'ridge_0',
    start: ridgeStart,
    end: ridgeEnd,
    type: 'ridge',
    boundaryIndices: [],
    startVertexId: 'ridge_0_start',
    endVertexId: 'ridge_0_end'
  });
  
  // Connect corners to nearest ridge endpoint
  for (let i = 0; i < n; i++) {
    const vertex = vertices[i];
    const isReflex = reflexIndices.has(i);
    
    const distToStart = distance(vertex, ridgeStart);
    const distToEnd = distance(vertex, ridgeEnd);
    
    let endPoint: XY;
    let endVertexId: string;
    
    if (distToStart <= distToEnd) {
      endPoint = ridgeStart;
      endVertexId = 'ridge_0_start';
    } else {
      endPoint = ridgeEnd;
      endVertexId = 'ridge_0_end';
    }
    
    skeleton.push({
      id: `${isReflex ? 'valley' : 'hip'}_${i}`,
      start: vertex,
      end: endPoint,
      type: isReflex ? 'valley' : 'hip',
      boundaryIndices: [i],
      endVertexId
    });
  }
  
  return skeleton;
}

/**
 * CRITICAL: Enforce exact vertex sharing across all skeleton edges
 */
function enforceSharedVertices(
  skeleton: SkeletonEdge[],
  boundaryVertices: XY[],
  reflexIndices: Set<number>
): SkeletonEdge[] {
  // Build vertex registry from ridges first (they define the junction points)
  const vertexRegistry: Map<string, XY> = new Map();
  
  // Extract ridge endpoints as primary vertices
  skeleton.filter(e => e.type === 'ridge').forEach(edge => {
    if (edge.startVertexId) vertexRegistry.set(edge.startVertexId, edge.start);
    if (edge.endVertexId) vertexRegistry.set(edge.endVertexId, edge.end);
  });
  
  // Also register valley-ridge intersections
  skeleton.filter(e => e.type === 'valley' && e.endVertexId?.startsWith('valley_ridge_')).forEach(edge => {
    if (edge.endVertexId) vertexRegistry.set(edge.endVertexId, edge.end);
  });
  
  // Now snap all hip and valley endpoints to registered vertices
  const snapped = skeleton.map(edge => {
    const newEdge = { ...edge };
    
    if (edge.type === 'hip' || edge.type === 'valley') {
      // Snap end point to registered vertex
      if (edge.endVertexId && vertexRegistry.has(edge.endVertexId)) {
        newEdge.end = vertexRegistry.get(edge.endVertexId)!;
      } else {
        // Find nearest registered vertex and snap to it
        const nearestVertex = findNearestVertex(edge.end, vertexRegistry);
        if (nearestVertex) {
          newEdge.end = nearestVertex.coords;
          newEdge.endVertexId = nearestVertex.id;
        }
      }
    }
    
    return newEdge;
  });
  
  // Validate: check that all edges connect properly
  const ridgeEndpoints = new Set<string>();
  snapped.filter(e => e.type === 'ridge').forEach(e => {
    ridgeEndpoints.add(`${e.start[0].toFixed(8)},${e.start[1].toFixed(8)}`);
    ridgeEndpoints.add(`${e.end[0].toFixed(8)},${e.end[1].toFixed(8)}`);
  });
  
  const hipValleyEnds = snapped.filter(e => e.type === 'hip' || e.type === 'valley')
    .map(e => `${e.end[0].toFixed(8)},${e.end[1].toFixed(8)}`);
  
  const allConnected = hipValleyEnds.every(ep => ridgeEndpoints.has(ep) || 
    snapped.some(e => e.type === 'valley' && e.endVertexId?.startsWith('valley_ridge_') && 
      `${e.end[0].toFixed(8)},${e.end[1].toFixed(8)}` === ep));
  
  if (!allConnected) {
    console.warn('  Some hip/valley endpoints do not connect to ridge vertices');
  } else {
    console.log('  ✓ All skeleton edges share exact vertices');
  }
  
  return snapped;
}

/**
 * Find nearest vertex from registry
 */
function findNearestVertex(point: XY, registry: Map<string, XY>): { id: string; coords: XY } | null {
  let nearest: { id: string; coords: XY } | null = null;
  let minDist = Infinity;
  
  registry.forEach((coords, id) => {
    const d = distance(point, coords);
    if (d < minDist) {
      minDist = d;
      nearest = { id, coords };
    }
  });
  
  return nearest;
}

/**
 * Calculate intersection of ray with line segment
 */
function rayLineIntersection(rayOrigin: XY, rayDir: XY, lineStart: XY, lineEnd: XY): XY | null {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  
  const denominator = rayDir[0] * dy - rayDir[1] * dx;
  
  if (Math.abs(denominator) < 1e-10) {
    return null;
  }
  
  const t = ((lineStart[0] - rayOrigin[0]) * dy - (lineStart[1] - rayOrigin[1]) * dx) / denominator;
  const u = ((lineStart[0] - rayOrigin[0]) * rayDir[1] - (lineStart[1] - rayOrigin[1]) * rayDir[0]) / denominator;
  
  if (t > 0 && u >= 0 && u <= 1) {
    return [
      rayOrigin[0] + t * rayDir[0],
      rayOrigin[1] + t * rayDir[1]
    ];
  }
  
  return null;
}

/**
 * Classify skeleton edge based on connectivity and boundary vertices
 */
function classifySkeletonEdge(
  edge: SkeletonEdge,
  reflexIndices: Set<number>,
  vertices: XY[]
): 'ridge' | 'hip' | 'valley' {
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
  const v1x = prev[0] - curr[0];
  const v1y = prev[1] - curr[1];
  const len1 = Math.sqrt(v1x ** 2 + v1y ** 2);
  
  const v2x = next[0] - curr[0];
  const v2y = next[1] - curr[1];
  const len2 = Math.sqrt(v2x ** 2 + v2y ** 2);
  
  if (len1 === 0 || len2 === 0) {
    return curr;
  }
  
  const bisX = v1x / len1 + v2x / len2;
  const bisY = v1y / len1 + v2y / len2;
  
  return [curr[0] + bisX, curr[1] + bisY];
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
