/**
 * Hook for detecting building shape from footprint coordinates
 * Used for applying learned patterns during AI measurement
 */

export type BuildingShape = 'rectangle' | 'L-shape' | 'T-shape' | 'U-shape' | 'complex';

export interface BuildingShapeResult {
  shape: BuildingShape;
  vertexCount: number;
  reflexCount: number;
  aspectRatio: number;
  confidence: number;
}

/**
 * Detect building shape from footprint coordinates
 */
export function detectBuildingShape(coords: [number, number][]): BuildingShapeResult {
  const n = coords.length;
  
  // Close the ring if needed
  let vertices = [...coords];
  if (vertices[0][0] !== vertices[n - 1][0] || vertices[0][1] !== vertices[n - 1][1]) {
    vertices = [...vertices, vertices[0]];
  }
  vertices = vertices.slice(0, -1); // Remove closing point for analysis
  
  const vertexCount = vertices.length;
  const reflexCount = countReflexVertices(vertices);
  
  // Calculate bounding box and aspect ratio
  const xs = vertices.map(v => v[0]);
  const ys = vertices.map(v => v[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const aspectRatio = width > 0 && height > 0 
    ? Math.max(width, height) / Math.min(width, height)
    : 1;

  // Classify shape
  let shape: BuildingShape;
  let confidence: number;

  if (vertexCount === 4 && reflexCount === 0) {
    shape = 'rectangle';
    confidence = 0.95;
  } else if (vertexCount === 6 && reflexCount === 1) {
    shape = 'L-shape';
    confidence = 0.90;
  } else if (vertexCount === 8 && reflexCount === 2) {
    // Could be T-shape or U-shape
    const pattern = analyzeReflexPattern(vertices);
    shape = pattern === 'T' ? 'T-shape' : pattern === 'U' ? 'U-shape' : 'complex';
    confidence = 0.85;
  } else if (vertexCount > 8 || reflexCount > 2) {
    shape = 'complex';
    confidence = 0.70;
  } else {
    shape = 'complex';
    confidence = 0.60;
  }

  return {
    shape,
    vertexCount,
    reflexCount,
    aspectRatio,
    confidence,
  };
}

/**
 * Count reflex (concave) vertices in a polygon
 */
function countReflexVertices(vertices: [number, number][]): number {
  const n = vertices.length;
  let count = 0;

  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    // Cross product to determine convexity
    const ax = prev[0] - curr[0];
    const ay = prev[1] - curr[1];
    const bx = next[0] - curr[0];
    const by = next[1] - curr[1];
    const cross = ax * by - ay * bx;

    if (cross < 0) count++; // Reflex in CCW orientation
  }

  return count;
}

/**
 * Analyze reflex vertex pattern to distinguish T-shape from U-shape
 */
function analyzeReflexPattern(vertices: [number, number][]): 'T' | 'U' | 'unknown' {
  const n = vertices.length;
  const reflexIndices: number[] = [];

  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    const ax = prev[0] - curr[0];
    const ay = prev[1] - curr[1];
    const bx = next[0] - curr[0];
    const by = next[1] - curr[1];
    const cross = ax * by - ay * bx;

    if (cross < 0) reflexIndices.push(i);
  }

  if (reflexIndices.length !== 2) return 'unknown';

  // Check if reflex vertices are adjacent (U-shape) or opposite (T-shape)
  const [i1, i2] = reflexIndices;
  const gap = Math.min(Math.abs(i2 - i1), n - Math.abs(i2 - i1));

  if (gap === 1) return 'U'; // Adjacent reflex vertices
  if (gap === n / 2) return 'T'; // Opposite reflex vertices

  return 'unknown';
}

/**
 * Get roof type suggestion based on building shape
 */
export function suggestRoofType(shape: BuildingShape): string {
  switch (shape) {
    case 'rectangle':
      return 'hip'; // Most common for rectangular
    case 'L-shape':
      return 'cross-hip';
    case 'T-shape':
      return 'cross-hip';
    case 'U-shape':
      return 'cross-hip';
    default:
      return 'complex';
  }
}
