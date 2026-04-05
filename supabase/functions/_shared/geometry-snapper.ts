// Geometry Snapper
// Constrains AI-detected edges to the authoritative footprint polygon
// Clips lines to footprint boundary and snaps endpoints to vertices

type XY = [number, number]; // [x, y] in feet or [lng, lat]

export interface DetectedEdge {
  start: XY;
  end: XY;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'unknown';
  confidence: number;
  source: string;
}

export interface SnappedEdge extends DetectedEdge {
  snapped: boolean;
  originalStart: XY;
  originalEnd: XY;
  snapDistanceFt: { start: number; end: number };
}

export interface SnapResult {
  snappedEdges: SnappedEdge[];
  discardedCount: number;
  discardedReasons: string[];
  snapStats: {
    totalEdges: number;
    edgesSnapped: number;
    edgesDiscarded: number;
    avgSnapDistanceFt: number;
  };
}

/**
 * Distance from a point to a line segment, in coordinate units.
 */
function pointToSegmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.sqrt((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2);
  }

  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const proj: XY = [a[0] + t * dx, a[1] + t * dy];
  return Math.sqrt((p[0] - proj[0]) ** 2 + (p[1] - proj[1]) ** 2);
}

/**
 * Distance between two points.
 */
function dist(a: XY, b: XY): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

/**
 * Check if a point is inside a polygon using ray casting.
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
 * Minimum distance from a point to the polygon boundary.
 */
function pointToPolygonBoundaryDist(point: XY, polygon: XY[]): number {
  let minDist = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const d = pointToSegmentDistance(point, polygon[i], polygon[j]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Find the nearest vertex in the polygon to a given point.
 */
function nearestVertex(point: XY, vertices: XY[]): { vertex: XY; distance: number; index: number } {
  let minDist = Infinity;
  let nearest: XY = vertices[0];
  let nearestIdx = 0;

  for (let i = 0; i < vertices.length; i++) {
    const d = dist(point, vertices[i]);
    if (d < minDist) {
      minDist = d;
      nearest = vertices[i];
      nearestIdx = i;
    }
  }

  return { vertex: nearest, distance: minDist, index: nearestIdx };
}

/**
 * Snap detected AI edges to the authoritative footprint polygon.
 *
 * Rules:
 * 1. Discard edges entirely outside the footprint + buffer
 * 2. Snap endpoints within snapToleranceFt of a footprint vertex to that vertex
 * 3. Clip edges that partially extend outside the footprint
 *
 * @param edges - Detected edges from AI vision or skeleton
 * @param footprintVertices - Authoritative footprint polygon vertices (in feet coords)
 * @param snapToleranceFt - Max distance to snap an endpoint to a vertex (default 3ft)
 * @param bufferFt - Buffer beyond footprint for discarding (default 5ft)
 */
export function snapEdgesToFootprint(
  edges: DetectedEdge[],
  footprintVertices: XY[],
  snapToleranceFt: number = 3.0,
  bufferFt: number = 5.0
): SnapResult {
  const snappedEdges: SnappedEdge[] = [];
  const discardedReasons: string[] = [];
  let totalSnapDist = 0;
  let snapCount = 0;

  for (const edge of edges) {
    const startInside = pointInPolygon(edge.start, footprintVertices);
    const endInside = pointInPolygon(edge.end, footprintVertices);

    const startDistToBoundary = pointToPolygonBoundaryDist(edge.start, footprintVertices);
    const endDistToBoundary = pointToPolygonBoundaryDist(edge.end, footprintVertices);

    // Rule 1: Discard if both endpoints are outside footprint + buffer
    if (!startInside && startDistToBoundary > bufferFt &&
        !endInside && endDistToBoundary > bufferFt) {
      discardedReasons.push(`Edge ${edge.type} discarded: both endpoints outside footprint + ${bufferFt}ft buffer`);
      continue;
    }

    // Rule 2: Snap endpoints to nearest footprint vertex if within tolerance
    let snappedStart = edge.start;
    let snappedEnd = edge.end;
    let startSnapDist = 0;
    let endSnapDist = 0;
    let wasSnapped = false;

    const nearestToStart = nearestVertex(edge.start, footprintVertices);
    if (nearestToStart.distance <= snapToleranceFt) {
      snappedStart = nearestToStart.vertex;
      startSnapDist = nearestToStart.distance;
      wasSnapped = true;
      totalSnapDist += startSnapDist;
      snapCount++;
    }

    const nearestToEnd = nearestVertex(edge.end, footprintVertices);
    if (nearestToEnd.distance <= snapToleranceFt) {
      snappedEnd = nearestToEnd.vertex;
      endSnapDist = nearestToEnd.distance;
      wasSnapped = true;
      totalSnapDist += endSnapDist;
      snapCount++;
    }

    // Rule 3: For eave/rake edges not yet snapped, project to nearest footprint segment
    if ((edge.type === 'eave' || edge.type === 'rake') && !wasSnapped) {
      // Try to project both endpoints onto the footprint boundary
      if (!startInside && startDistToBoundary <= bufferFt) {
        const projected = projectToPolygon(edge.start, footprintVertices);
        if (projected) {
          snappedStart = projected;
          startSnapDist = dist(edge.start, projected);
          wasSnapped = true;
        }
      }
      if (!endInside && endDistToBoundary <= bufferFt) {
        const projected = projectToPolygon(edge.end, footprintVertices);
        if (projected) {
          snappedEnd = projected;
          endSnapDist = dist(edge.end, projected);
          wasSnapped = true;
        }
      }
    }

    // Skip degenerate edges (zero length after snapping)
    if (dist(snappedStart, snappedEnd) < 0.5) {
      discardedReasons.push(`Edge ${edge.type} discarded: degenerate after snapping`);
      continue;
    }

    snappedEdges.push({
      ...edge,
      start: snappedStart,
      end: snappedEnd,
      snapped: wasSnapped,
      originalStart: edge.start,
      originalEnd: edge.end,
      snapDistanceFt: { start: startSnapDist, end: endSnapDist },
    });
  }

  return {
    snappedEdges,
    discardedCount: edges.length - snappedEdges.length,
    discardedReasons,
    snapStats: {
      totalEdges: edges.length,
      edgesSnapped: snappedEdges.filter(e => e.snapped).length,
      edgesDiscarded: edges.length - snappedEdges.length,
      avgSnapDistanceFt: snapCount > 0 ? totalSnapDist / snapCount : 0,
    },
  };
}

/**
 * Project a point onto the nearest polygon edge segment.
 */
function projectToPolygon(point: XY, polygon: XY[]): XY | null {
  let minDist = Infinity;
  let bestProj: XY | null = null;

  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const a = polygon[i];
    const b = polygon[j];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;

    let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const proj: XY = [a[0] + t * dx, a[1] + t * dy];
    const d = dist(point, proj);

    if (d < minDist) {
      minDist = d;
      bestProj = proj;
    }
  }

  return bestProj;
}
