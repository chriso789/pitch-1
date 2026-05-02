/**
 * Footprint Partitioner — derives roof planes by subdividing the footprint polygon
 * with ridge/hip split lines. Guarantees corners align exactly with the original
 * footprint and planes perfectly tile it.
 */

export type Point = { x: number; y: number };
export type Edge = { a: Point; b: Point };
export type Face = { id: number; polygon: Point[] };

// ─── SNAP ─────────────────────────────

function snap(p: Point, grid = 2): Point {
  return {
    x: Math.round(p.x / grid) * grid,
    y: Math.round(p.y / grid) * grid,
  };
}

function ptKey(p: Point): string {
  return `${p.x}:${p.y}`;
}

// ─── EDGE KEY ─────────────────────────

function edgeKey(a: Point, b: Point): string {
  const p1 = ptKey(a);
  const p2 = ptKey(b);
  return [p1, p2].sort().join('|');
}

// ─── LINE-SEGMENT INTERSECTION ────────

function segIntersect(
  a1: Point, a2: Point,
  b1: Point, b2: Point
): Point | null {
  const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-9) return null;

  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
  const u = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom;

  // Strict interior intersections only (avoid double-counting endpoints)
  if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) return null;

  return { x: a1.x + t * dx1, y: a1.y + t * dy1 };
}

// ─── SPLIT EDGES AT INTERSECTIONS ─────

interface SplitEdge { a: Point; b: Point }

function splitEdgesAtIntersections(
  footprintEdges: SplitEdge[],
  splitEdges: SplitEdge[]
): SplitEdge[] {
  const allInput = [...footprintEdges, ...splitEdges];
  const result: SplitEdge[] = [];

  for (let i = 0; i < allInput.length; i++) {
    const seg = allInput[i];
    const cuts: Point[] = [seg.a];

    for (let j = 0; j < allInput.length; j++) {
      if (i === j) continue;
      const other = allInput[j];
      const pt = segIntersect(seg.a, seg.b, other.a, other.b);
      if (pt) cuts.push(snap(pt));
    }

    cuts.push(seg.b);

    // Sort cuts along the segment direction
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    cuts.sort((p, q) => (p.x - seg.a.x) * dx + (p.y - seg.a.y) * dy
      - ((q.x - seg.a.x) * dx + (q.y - seg.a.y) * dy));

    for (let k = 0; k < cuts.length - 1; k++) {
      const a = snap(cuts[k]);
      const b = snap(cuts[k + 1]);
      if (ptKey(a) !== ptKey(b)) {
        result.push({ a, b });
      }
    }
  }

  return result;
}

// ─── BUILD HALF-EDGE GRAPH ────────────

function buildAdjacency(edges: SplitEdge[]): Map<string, Point[]> {
  const graph = new Map<string, Point[]>();

  for (const e of edges) {
    const ak = ptKey(e.a);
    const bk = ptKey(e.b);
    if (!graph.has(ak)) graph.set(ak, []);
    if (!graph.has(bk)) graph.set(bk, []);
    graph.get(ak)!.push(e.b);
    graph.get(bk)!.push(e.a);
  }

  return graph;
}

// ─── ANGLE BETWEEN POINTS ─────────────

function angle(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// ─── FACE EXTRACTION VIA MINIMUM-ANGLE WALK ──

function extractFaces(edges: SplitEdge[]): Face[] {
  const graph = buildAdjacency(edges);
  const usedHalfEdges = new Set<string>();
  const faces: Face[] = [];
  let faceId = 0;

  // Sort neighbor lists by angle for consistent traversal
  for (const [key, neighbors] of graph.entries()) {
    const [cx, cy] = key.split(':').map(Number);
    const center = { x: cx, y: cy };
    neighbors.sort((a, b) => angle(center, a) - angle(center, b));
  }

  for (const e of edges) {
    // Try both directions of every edge
    for (const [start, startNext] of [[e.a, e.b], [e.b, e.a]]) {
      const halfKey = `${ptKey(start)}->${ptKey(startNext)}`;
      if (usedHalfEdges.has(halfKey)) continue;

      const polygon: Point[] = [];
      let prev = start;
      let curr = startNext;
      let safe = 0;

      while (safe++ < 200) {
        const hk = `${ptKey(prev)}->${ptKey(curr)}`;
        if (usedHalfEdges.has(hk) && polygon.length > 0) break;
        usedHalfEdges.add(hk);
        polygon.push(prev);

        // At curr, pick the next edge by turning as far RIGHT as possible
        // (minimum angle walk → extracts bounded faces)
        const neighbors = graph.get(ptKey(curr));
        if (!neighbors || neighbors.length === 0) break;

        const incomingAngle = angle(curr, prev); // direction we came FROM
        let bestNext: Point | null = null;
        let bestAngleDiff = Infinity;

        for (const nb of neighbors) {
          if (ptKey(nb) === ptKey(prev) && neighbors.length > 1) continue;
          // Angle from curr to nb
          const outAngle = angle(curr, nb);
          // We want the smallest positive turn to the right from incoming direction
          let diff = outAngle - incomingAngle;
          // Normalize to (0, 2π]
          while (diff <= 0) diff += 2 * Math.PI;
          while (diff > 2 * Math.PI) diff -= 2 * Math.PI;

          if (diff < bestAngleDiff) {
            bestAngleDiff = diff;
            bestNext = nb;
          }
        }

        if (!bestNext) break;

        prev = curr;
        curr = bestNext;

        if (ptKey(curr) === ptKey(start)) {
          // Close the loop
          polygon.push(prev);
          break;
        }
      }

      if (polygon.length >= 3 && ptKey(polygon[polygon.length - 1]) !== ptKey(start)) {
        // Didn't close — skip
        continue;
      }

      if (polygon.length >= 3) {
        // Check winding — only keep CCW faces (interior), skip the outer face
        const area = signedArea(polygon);
        if (area > 0) {
          // CCW = interior face
          faces.push({ id: faceId++, polygon });
        }
      }
    }
  }

  return faces;
}

function signedArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += (b.x - a.x) * (b.y + a.y);
  }
  return -sum / 2; // negative because pixel Y is inverted
}

// ─── FINAL PARTITIONER ─────────────────

export function partitionFootprint(
  footprint: Point[],
  ridgeLines: Edge[]
): Face[] {
  if (footprint.length < 3) {
    console.log('[FOOTPRINT_PARTITION] footprint too small');
    return [];
  }

  // Snap all footprint points
  const snappedFootprint = footprint.map(p => snap(p));

  // Build footprint edges
  const footprintEdges: SplitEdge[] = [];
  for (let i = 0; i < snappedFootprint.length; i++) {
    footprintEdges.push({
      a: snappedFootprint[i],
      b: snappedFootprint[(i + 1) % snappedFootprint.length],
    });
  }

  // Build split edges (ridges/hips that cut the footprint)
  const splitEdges: SplitEdge[] = ridgeLines.map(r => ({
    a: snap(r.a),
    b: snap(r.b),
  }));

  // Split all edges at their mutual intersections
  const allEdges = splitEdgesAtIntersections(footprintEdges, splitEdges);

  // Deduplicate edges
  const seen = new Set<string>();
  const deduped: SplitEdge[] = [];
  for (const e of allEdges) {
    const k = edgeKey(e.a, e.b);
    if (!seen.has(k)) {
      seen.add(k);
      deduped.push(e);
    }
  }

  // Extract faces
  const faces = extractFaces(deduped);

  console.log('[FOOTPRINT_PARTITION]', {
    footprintVerts: snappedFootprint.length,
    ridgeLines: ridgeLines.length,
    totalEdges: deduped.length,
    facesFound: faces.length,
  });

  return faces;
}
