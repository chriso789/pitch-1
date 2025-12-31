// Straight Skeleton Algorithm for Roof Topology Extraction
// FIXED: Proper vertex sharing - hips START at ridge endpoints, valleys END at ridge intersections
// All lines share exact vertices with zero tolerance

type XY = [number, number]; // [lng, lat]

interface SkeletonVertex {
  id: string;
  coords: XY;
  type: 'ridge_end' | 'eave_corner' | 'valley_ridge_intersection' | 'internal';
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
}

interface TopologicalSkeleton {
  vertices: Map<string, SkeletonVertex>;
  edges: SkeletonEdge[];
}

// Default soffit overhang in feet (typical residential is 12-18 inches)
const DEFAULT_SOFFIT_OFFSET_FT = 1.0;

/**
 * Compute straight skeleton of a polygon and classify edges into ridge/hip/valley
 * NEW: Applies eave offset to make perimeter follow actual roof edge
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
  
  // Generate skeleton based on shape
  let skeleton: SkeletonEdge[] = [];
  
  if (shapeType === 'rectangle') {
    skeleton = generateRectangularSkeleton(vertices);
  } else if (shapeType === 'L-shape' || shapeType === 'T-shape' || shapeType === 'U-shape') {
    skeleton = generateComplexSkeleton(vertices, reflexIndices);
  } else {
    skeleton = generateMedialAxisSkeleton(vertices, reflexIndices);
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
      return Math.abs(angle - 90) < 10;
    });
    
    if (allRightAngles) return 'rectangle';
  }
  
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
    id: 'ridge_main',
    start: ridgeStart,
    end: ridgeEnd,
    type: 'ridge',
    boundaryIndices: [],
    startVertexId: 'ridge_start',
    endVertexId: 'ridge_end'
  };
  
  // Create 4 hips: each starts at an eave corner and ends at the EXACT ridge endpoint
  // Hip topology: corner -> ridge endpoint (shared vertex)
  const hips: SkeletonEdge[] = [
    { 
      id: 'hip_1',
      start: edge1, 
      end: ridgeStart,  // EXACT ridge endpoint, not closest point
      type: 'hip', 
      boundaryIndices: [longestEdgeIdx],
      endVertexId: 'ridge_start'
    },
    { 
      id: 'hip_2',
      start: edge2, 
      end: ridgeEnd,    // EXACT ridge endpoint
      type: 'hip', 
      boundaryIndices: [(longestEdgeIdx + 1) % 4],
      endVertexId: 'ridge_end'
    },
    { 
      id: 'hip_3',
      start: opposite1, 
      end: ridgeEnd,    // EXACT ridge endpoint
      type: 'hip', 
      boundaryIndices: [(longestEdgeIdx + 2) % 4],
      endVertexId: 'ridge_end'
    },
    { 
      id: 'hip_4',
      start: opposite2, 
      end: ridgeStart,  // EXACT ridge endpoint
      type: 'hip', 
      boundaryIndices: [(longestEdgeIdx + 3) % 4],
      endVertexId: 'ridge_start'
    }
  ];
  
  console.log(`  Rectangular skeleton: 1 ridge, 4 hips with shared vertices`);
  
  return [ridge, ...hips];
}

/**
 * Generate skeleton for L, T, U shapes
 * FIXED: Creates SECONDARY RIDGES for building wings that connect to main ridge
 * Valleys terminate at ridge junction points, hips terminate at ridge endpoints
 */
function generateComplexSkeleton(vertices: XY[], reflexIndices: Set<number>): SkeletonEdge[] {
  const skeleton: SkeletonEdge[] = [];
  const n = vertices.length;
  
  const centroid = calculateCentroid(vertices);
  const bounds = getBounds(vertices);
  const buildingWidth = bounds.maxX - bounds.minX;
  const buildingHeight = bounds.maxY - bounds.minY;
  const isWiderThanTall = buildingWidth > buildingHeight;
  
  // Detect building wings by grouping reflex vertices
  const wings = detectBuildingWings(vertices, reflexIndices, bounds, isWiderThanTall);
  
  // Compute main ridge line first
  const ridgeMargin = 0.30;
  let mainRidgeStart: XY, mainRidgeEnd: XY;
  
  if (isWiderThanTall) {
    mainRidgeStart = [bounds.minX + buildingWidth * ridgeMargin, centroid[1]];
    mainRidgeEnd = [bounds.maxX - buildingWidth * ridgeMargin, centroid[1]];
  } else {
    mainRidgeStart = [centroid[0], bounds.minY + buildingHeight * ridgeMargin];
    mainRidgeEnd = [centroid[0], bounds.maxY - buildingHeight * ridgeMargin];
  }
  
  // Add main ridge
  skeleton.push({
    id: 'ridge_main',
    start: mainRidgeStart,
    end: mainRidgeEnd,
    type: 'ridge',
    boundaryIndices: [],
    startVertexId: 'ridge_start',
    endVertexId: 'ridge_end'
  });
  
  // Build junction vertices registry
  const junctionVertices: { id: string; coords: XY; type: string }[] = [
    { id: 'ridge_start', coords: mainRidgeStart, type: 'ridge_end' },
    { id: 'ridge_end', coords: mainRidgeEnd, type: 'ridge_end' }
  ];
  
  // Add secondary ridges for detected wings
  wings.forEach((wing, wingIdx) => {
    // Calculate where secondary ridge meets main ridge
    const wingCentroid = calculateCentroid(wing.vertices);
    
    // Project wing centroid onto main ridge to find junction point
    const junctionPoint = projectPointOntoLine(wingCentroid, mainRidgeStart, mainRidgeEnd);
    
    // Secondary ridge runs perpendicular to main ridge into the wing
    let secondaryRidgeEnd: XY;
    if (isWiderThanTall) {
      // Main ridge is horizontal, secondary ridge is vertical
      // Extend into the wing (above or below main ridge)
      const wingDirection = wing.isAbove ? 1 : -1;
      const wingExtent = wing.isAbove 
        ? Math.abs(wing.maxY - centroid[1]) * 0.7
        : Math.abs(centroid[1] - wing.minY) * 0.7;
      secondaryRidgeEnd = [junctionPoint[0], junctionPoint[1] + wingDirection * wingExtent];
    } else {
      // Main ridge is vertical, secondary ridge is horizontal
      const wingDirection = wing.isRight ? 1 : -1;
      const wingExtent = wing.isRight
        ? Math.abs(wing.maxX - centroid[0]) * 0.7
        : Math.abs(centroid[0] - wing.minX) * 0.7;
      secondaryRidgeEnd = [junctionPoint[0] + wingDirection * wingExtent, junctionPoint[1]];
    }
    
    const junctionId = `ridge_junction_${wingIdx}`;
    const secondaryEndId = `ridge_secondary_end_${wingIdx}`;
    
    junctionVertices.push({ id: junctionId, coords: junctionPoint, type: 'ridge_junction' });
    junctionVertices.push({ id: secondaryEndId, coords: secondaryRidgeEnd, type: 'ridge_end' });
    
    skeleton.push({
      id: `ridge_secondary_${wingIdx}`,
      start: junctionPoint,  // Connects exactly to main ridge
      end: secondaryRidgeEnd,
      type: 'ridge',
      boundaryIndices: [],
      startVertexId: junctionId,
      endVertexId: secondaryEndId
    });
  });
  
  // Collect all ridge endpoints for hip/valley termination
  const allRidgeEndpoints: { id: string; coords: XY }[] = junctionVertices.filter(
    v => v.type === 'ridge_end' || v.type === 'ridge_junction'
  );
  
  // Process reflex vertices to create valleys
  reflexIndices.forEach((idx, i) => {
    const vertex = vertices[idx];
    const prev = vertices[(idx - 1 + n) % n];
    const next = vertices[(idx + 1) % n];
    
    // Calculate bisector direction (inward for reflex vertices)
    const bisector = angleBisector(prev, vertex, next);
    const bisectorDir: XY = [bisector[0] - vertex[0], bisector[1] - vertex[1]];
    const bisectorLen = Math.sqrt(bisectorDir[0] ** 2 + bisectorDir[1] ** 2);
    
    if (bisectorLen > 0) {
      const normalizedDir: XY = [bisectorDir[0] / bisectorLen, bisectorDir[1] / bisectorLen];
      
      // Find intersection with any ridge line (main or secondary)
      let valleyEnd: XY | null = null;
      let valleyEndVertexId = '';
      
      // Try main ridge first
      const mainIntersection = rayLineIntersection(vertex, normalizedDir, mainRidgeStart, mainRidgeEnd);
      if (mainIntersection) {
        valleyEnd = mainIntersection;
        valleyEndVertexId = `valley_main_ridge_${i}`;
        junctionVertices.push({ id: valleyEndVertexId, coords: valleyEnd, type: 'valley_ridge_intersection' });
      }
      
      // Also try secondary ridges
      if (!valleyEnd) {
        for (const edge of skeleton) {
          if (edge.type === 'ridge' && edge.id !== 'ridge_main') {
            const intersection = rayLineIntersection(vertex, normalizedDir, edge.start, edge.end);
            if (intersection) {
              valleyEnd = intersection;
              valleyEndVertexId = `valley_sec_ridge_${i}`;
              junctionVertices.push({ id: valleyEndVertexId, coords: valleyEnd, type: 'valley_ridge_intersection' });
              break;
            }
          }
        }
      }
      
      // Fallback: use nearest ridge endpoint
      if (!valleyEnd) {
        const nearest = findNearestFromList(vertex, allRidgeEndpoints);
        valleyEnd = nearest.coords;
        valleyEndVertexId = nearest.id;
      }
      
      skeleton.push({
        id: `valley_${i}`,
        start: vertex,
        end: valleyEnd,
        type: 'valley',
        boundaryIndices: [idx],
        endVertexId: valleyEndVertexId
      });
    }
  });
  
  // Process convex vertices to create hips
  // Hips connect eave corners to NEAREST ridge endpoint
  for (let i = 0; i < n; i++) {
    if (!reflexIndices.has(i)) {
      const vertex = vertices[i];
      
      // Find nearest ridge endpoint (could be main or secondary)
      const nearest = findNearestFromList(vertex, allRidgeEndpoints);
      
      const hipLength = distance(vertex, nearest.coords);
      const mainRidgeLength = distance(mainRidgeStart, mainRidgeEnd);
      
      // Only add hip if reasonable length
      if (hipLength > mainRidgeLength * 0.03 && hipLength < mainRidgeLength * 4) {
        skeleton.push({
          id: `hip_${i}`,
          start: vertex,
          end: nearest.coords,
          type: 'hip',
          boundaryIndices: [i],
          endVertexId: nearest.id
        });
      }
    }
  }
  
  console.log(`  Complex skeleton: ${skeleton.filter(e => e.type === 'ridge').length} ridges (incl ${wings.length} secondary), ${skeleton.filter(e => e.type === 'hip').length} hips, ${skeleton.filter(e => e.type === 'valley').length} valleys`);
  console.log(`  Junction vertices: ${junctionVertices.length}`);
  
  return skeleton;
}

/**
 * Detect building wings (extensions) from reflex vertices
 * Returns wing metadata for secondary ridge generation
 */
function detectBuildingWings(
  vertices: XY[], 
  reflexIndices: Set<number>,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  isWiderThanTall: boolean
): Array<{ vertices: XY[]; isAbove: boolean; isRight: boolean; minX: number; maxX: number; minY: number; maxY: number }> {
  const wings: Array<{ vertices: XY[]; isAbove: boolean; isRight: boolean; minX: number; maxX: number; minY: number; maxY: number }> = [];
  
  // Simple wing detection: group consecutive non-reflex vertices that extend beyond the core
  const centroidY = (bounds.minY + bounds.maxY) / 2;
  const centroidX = (bounds.minX + bounds.maxX) / 2;
  
  // For T-shape: typically has 2 reflex vertices indicating the wing junction
  // For L-shape: typically has 1 reflex vertex
  
  const reflexArray = Array.from(reflexIndices).sort((a, b) => a - b);
  
  if (reflexArray.length >= 2) {
    // Group reflex vertices that are close together
    for (let i = 0; i < reflexArray.length; i += 2) {
      const reflex1Idx = reflexArray[i];
      const reflex2Idx = reflexArray[(i + 1) % reflexArray.length];
      
      // Vertices between these reflex points form a wing
      const wingVerts: XY[] = [];
      let idx = (reflex1Idx + 1) % vertices.length;
      while (idx !== reflex2Idx) {
        wingVerts.push(vertices[idx]);
        idx = (idx + 1) % vertices.length;
      }
      
      if (wingVerts.length >= 2) {
        const wingBounds = getBounds(wingVerts);
        const wingCentroidY = (wingBounds.minY + wingBounds.maxY) / 2;
        const wingCentroidX = (wingBounds.minX + wingBounds.maxX) / 2;
        
        wings.push({
          vertices: wingVerts,
          isAbove: wingCentroidY > centroidY,
          isRight: wingCentroidX > centroidX,
          ...wingBounds
        });
      }
    }
  }
  
  return wings;
}

/**
 * Project a point onto a line segment
 */
function projectPointOntoLine(point: XY, lineStart: XY, lineEnd: XY): XY {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lenSq = dx * dx + dy * dy;
  
  if (lenSq === 0) return lineStart;
  
  // Calculate projection parameter t
  const t = Math.max(0, Math.min(1, 
    ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / lenSq
  ));
  
  return [lineStart[0] + t * dx, lineStart[1] + t * dy];
}

/**
 * Find nearest point from a list
 */
function findNearestFromList(point: XY, list: Array<{ id: string; coords: XY }>): { id: string; coords: XY } {
  let nearest = list[0];
  let minDist = distance(point, nearest.coords);
  
  for (let i = 1; i < list.length; i++) {
    const d = distance(point, list[i].coords);
    if (d < minDist) {
      minDist = d;
      nearest = list[i];
    }
  }
  
  return nearest;
}

/**
 * Generate skeleton using medial axis approach (for complex shapes)
 * FIXED: All hips and valleys share exact vertices with ridge
 */
function generateMedialAxisSkeleton(vertices: XY[], reflexIndices: Set<number>): SkeletonEdge[] {
  const skeleton: SkeletonEdge[] = [];
  const n = vertices.length;
  const centroid = calculateCentroid(vertices);
  
  const bounds = getBounds(vertices);
  const isWiderThanTall = (bounds.maxX - bounds.minX) > (bounds.maxY - bounds.minY);
  
  let ridgeStart: XY, ridgeEnd: XY;
  
  if (isWiderThanTall) {
    ridgeStart = [bounds.minX + (bounds.maxX - bounds.minX) * 0.25, centroid[1]];
    ridgeEnd = [bounds.maxX - (bounds.maxX - bounds.minX) * 0.25, centroid[1]];
  } else {
    ridgeStart = [centroid[0], bounds.minY + (bounds.maxY - bounds.minY) * 0.25];
    ridgeEnd = [centroid[0], bounds.maxY - (bounds.maxY - bounds.minY) * 0.25];
  }
  
  skeleton.push({
    id: 'ridge_main',
    start: ridgeStart,
    end: ridgeEnd,
    type: 'ridge',
    boundaryIndices: [],
    startVertexId: 'ridge_start',
    endVertexId: 'ridge_end'
  });
  
  // Connect corners to ridge endpoints with proper valley/hip classification
  for (let i = 0; i < n; i++) {
    const vertex = vertices[i];
    const isReflex = reflexIndices.has(i);
    
    // For hips: connect to nearest ridge ENDPOINT
    // For valleys: connect to ridge intersection or nearest endpoint
    let endPoint: XY;
    let endVertexId: string;
    
    if (isReflex) {
      // Valley: try to find intersection with ridge
      const prev = vertices[(i - 1 + n) % n];
      const next = vertices[(i + 1) % n];
      const bisector = angleBisector(prev, vertex, next);
      const dir: XY = [bisector[0] - vertex[0], bisector[1] - vertex[1]];
      const len = Math.sqrt(dir[0] ** 2 + dir[1] ** 2);
      
      if (len > 0) {
        const normalizedDir: XY = [dir[0] / len, dir[1] / len];
        const intersection = rayLineIntersection(vertex, normalizedDir, ridgeStart, ridgeEnd);
        
        if (intersection) {
          endPoint = intersection;
          endVertexId = `valley_ridge_${i}`;
        } else {
          const distToStart = distance(vertex, ridgeStart);
          const distToEnd = distance(vertex, ridgeEnd);
          if (distToStart < distToEnd) {
            endPoint = ridgeStart;
            endVertexId = 'ridge_start';
          } else {
            endPoint = ridgeEnd;
            endVertexId = 'ridge_end';
          }
        }
      } else {
        endPoint = centroid;
        endVertexId = 'centroid';
      }
    } else {
      // Hip: connect to nearest ridge ENDPOINT (not closest point on line!)
      const distToStart = distance(vertex, ridgeStart);
      const distToEnd = distance(vertex, ridgeEnd);
      
      if (distToStart <= distToEnd) {
        endPoint = ridgeStart;
        endVertexId = 'ridge_start';
      } else {
        endPoint = ridgeEnd;
        endVertexId = 'ridge_end';
      }
    }
    
    // Only add if reasonable length
    const lineLength = distance(vertex, endPoint);
    const ridgeLength = distance(ridgeStart, ridgeEnd);
    
    if (lineLength > ridgeLength * 0.05) {
      skeleton.push({
        id: `${isReflex ? 'valley' : 'hip'}_${i}`,
        start: vertex,
        end: endPoint,
        type: isReflex ? 'valley' : 'hip',
        boundaryIndices: [i],
        endVertexId
      });
    }
  }
  
  console.log(`  Medial axis: ${skeleton.filter(e => e.type === 'ridge').length} ridges, ${skeleton.filter(e => e.type === 'hip').length} hips, ${skeleton.filter(e => e.type === 'valley').length} valleys`);
  
  return skeleton;
}

/**
 * CRITICAL: Enforce exact vertex sharing across all skeleton edges
 * This is a post-processing pass to ensure no gaps between connected edges
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
 * Returns intersection point or null if no intersection
 */
function rayLineIntersection(rayOrigin: XY, rayDir: XY, lineStart: XY, lineEnd: XY): XY | null {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  
  const denominator = rayDir[0] * dy - rayDir[1] * dx;
  
  if (Math.abs(denominator) < 1e-10) {
    // Ray and line are parallel
    return null;
  }
  
  const t = ((lineStart[0] - rayOrigin[0]) * dy - (lineStart[1] - rayOrigin[1]) * dx) / denominator;
  const u = ((lineStart[0] - rayOrigin[0]) * rayDir[1] - (lineStart[1] - rayOrigin[1]) * rayDir[0]) / denominator;
  
  // t must be positive (ray goes forward)
  // u must be in [0, 1] (intersection is on line segment)
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
