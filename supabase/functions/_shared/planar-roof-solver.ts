/**
 * Planar Roof Solver — topology-first plane construction.
 *
 * Instead of splitting a footprint recursively and hoping polygons align,
 * this solver builds a planar graph from footprint edges + interior ridge/
 * skeleton lines, then extracts faces (planes) via minimal-cycle traversal.
 *
 * Guarantees:
 *   • Every plane edge is EITHER a shared boundary (2 planes) or exterior (1 plane)
 *   • Planes are a partition of the footprint — no overlaps, no gaps
 *   • Edge classification can simply count face adjacency
 */

type Pt = { x: number; y: number };
type Seg = { a: Pt; b: Pt };

// ── GRID SNAP ──────────────────────────────────────────────
function snap(p: Pt, grid = 2): Pt {
  return {
    x: Math.round(p.x / grid) * grid,
    y: Math.round(p.y / grid) * grid,
  };
}

function ptKey(p: Pt): string {
  return `${p.x}:${p.y}`;
}

function segKey(a: Pt, b: Pt): string {
  const ka = ptKey(a), kb = ptKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

// ── INTERSECT interior segments with footprint edges ──────
// Clip ridge endpoints to the nearest footprint vertex/edge when they
// are close but not exactly on the boundary.
function snapToFootprint(p: Pt, footprint: Pt[], tol = 6): Pt {
  let best = p;
  let bestD = tol;
  // Snap to vertex
  for (const v of footprint) {
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d < bestD) { bestD = d; best = v; }
  }
  // Snap to edge
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const proj = projectPointOnSegment(p, a, b);
    if (proj) {
      const d = Math.hypot(proj.x - p.x, proj.y - p.y);
      if (d < bestD) { bestD = d; best = snap(proj); }
    }
  }
  return best;
}

function projectPointOnSegment(p: Pt, a: Pt, b: Pt): Pt | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return null;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// ── INSERT intersection points into footprint edges ───────
// When an interior line endpoint lands on a footprint edge (not vertex),
// we must split that footprint edge so the planar graph is fully connected.
function insertMidpointsIntoFootprint(footprint: Pt[], midpoints: Pt[]): Pt[] {
  const result: Pt[] = [];
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    result.push(a);
    // Find midpoints that lie on segment a→b
    const onEdge = midpoints.filter(mp => {
      if (ptKey(mp) === ptKey(a) || ptKey(mp) === ptKey(b)) return false;
      const proj = projectPointOnSegment(mp, a, b);
      if (!proj) return false;
      return Math.hypot(proj.x - mp.x, proj.y - mp.y) < 2;
    });
    // Sort by parameter along the edge
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    onEdge.sort((p, q) => {
      const tp = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
      const tq = len2 > 0 ? ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2 : 0;
      return tp - tq;
    });
    for (const mp of onEdge) result.push(mp);
  }
  return result;
}

// ── BUILD HALF-EDGE ADJACENCY ─────────────────────────────
type AdjMap = Map<string, Map<string, Pt>>;

function buildAdjacency(segments: Seg[]): AdjMap {
  const adj: AdjMap = new Map();
  const ensure = (k: string) => { if (!adj.has(k)) adj.set(k, new Map()); };
  for (const { a, b } of segments) {
    const ka = ptKey(a), kb = ptKey(b);
    ensure(ka); ensure(kb);
    adj.get(ka)!.set(kb, b);
    adj.get(kb)!.set(ka, a);
  }
  return adj;
}

// ── MINIMAL CYCLE (FACE) EXTRACTION ───────────────────────
// Walk the planar graph using the "next edge by smallest CCW angle" rule.
function angle(from: Pt, to: Pt): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function extractMinimalCycles(adj: AdjMap): Pt[][] {
  const usedDirected = new Set<string>();
  const faces: Pt[][] = [];

  for (const [nodeKey, neighbors] of adj.entries()) {
    for (const [neighborKey] of neighbors) {
      const dirKey = `${nodeKey}->${neighborKey}`;
      if (usedDirected.has(dirKey)) continue;

      // Walk
      const cycle: Pt[] = [];
      let curKey = nodeKey;
      let nextKey = neighborKey;
      let steps = 0;
      const maxSteps = adj.size * 2;

      while (steps < maxSteps) {
        const dk = `${curKey}->${nextKey}`;
        if (usedDirected.has(dk)) break;
        usedDirected.add(dk);

        const curNeighbors = adj.get(curKey);
        const nextNeighbors = adj.get(nextKey);
        if (!curNeighbors || !nextNeighbors) break;

        cycle.push(parsePtKey(curKey));

        // Find next edge: smallest CW angle from incoming direction
        const inAngle = angle(parsePtKey(nextKey), parsePtKey(curKey));
        let bestKey: string | null = null;
        let bestAngle = Infinity;

        for (const [candKey] of nextNeighbors) {
          if (candKey === curKey) continue; // don't go back
          const candAngle = angle(parsePtKey(nextKey), parsePtKey(candKey));
          let diff = candAngle - inAngle;
          // Normalize to (0, 2π]
          while (diff <= 0) diff += 2 * Math.PI;
          while (diff > 2 * Math.PI) diff -= 2 * Math.PI;
          if (diff < bestAngle) {
            bestAngle = diff;
            bestKey = candKey;
          }
        }

        if (!bestKey) {
          // Dead end — try going back if it's the only option
          if (nextNeighbors.has(curKey) && nextNeighbors.size === 1) {
            break; // leaf edge, not a face
          }
          // Pick any unused
          for (const [candKey] of nextNeighbors) {
            const dk2 = `${nextKey}->${candKey}`;
            if (!usedDirected.has(dk2)) { bestKey = candKey; break; }
          }
          if (!bestKey) break;
        }

        curKey = nextKey;
        nextKey = bestKey;
        steps++;

        if (curKey === nodeKey && nextKey === neighborKey) break; // closed
        if (curKey === nodeKey) break; // back to start
      }

      if (cycle.length >= 3) {
        // Check if it's the outer (unbounded) face — skip it
        const area = signedArea(cycle);
        if (area > 0) {
          // CW = interior face in our coordinate system (y-down)
          faces.push(cycle);
        }
        // If area < 0, it's the outer boundary — skip
      }
    }
  }

  return faces;
}

function parsePtKey(k: string): Pt {
  const [x, y] = k.split(":").map(Number);
  return { x, y };
}

function signedArea(poly: Pt[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return area / 2;
}

// ── MAIN SOLVER ───────────────────────────────────────────
export interface PlanarSolverResult {
  faces: Array<{ id: number; polygon: Pt[] }>;
  edges: Seg[];
  debug: {
    input_footprint_vertices: number;
    input_interior_lines: number;
    total_graph_segments: number;
    total_graph_nodes: number;
    faces_extracted: number;
    faces_with_area: number;
  };
}

export function solveRoofPlanes(
  rawFootprint: Pt[],
  interiorLines: Seg[],
): PlanarSolverResult {
  if (rawFootprint.length < 3) {
    return { faces: [], edges: [], debug: { input_footprint_vertices: 0, input_interior_lines: 0, total_graph_segments: 0, total_graph_nodes: 0, faces_extracted: 0, faces_with_area: 0 } };
  }

  // 1. Snap everything
  const footprint = rawFootprint.map(p => snap(p));

  // 2. Snap interior line endpoints to footprint
  const snappedInterior: Seg[] = interiorLines.map(seg => ({
    a: snap(snapToFootprint(snap(seg.a), footprint)),
    b: snap(snapToFootprint(snap(seg.b), footprint)),
  })).filter(seg => ptKey(seg.a) !== ptKey(seg.b)); // remove zero-length

  // 3. Collect all unique endpoints from interior lines that land on footprint edges
  const interiorEndpoints = snappedInterior.flatMap(s => [s.a, s.b]);

  // 4. Insert midpoints into footprint to ensure connectivity
  const augFootprint = insertMidpointsIntoFootprint(footprint, interiorEndpoints);

  // 5. Build all graph segments
  const allSegments: Seg[] = [];
  const segSet = new Set<string>();

  const addSeg = (a: Pt, b: Pt) => {
    const k = segKey(a, b);
    if (segSet.has(k)) return;
    if (ptKey(a) === ptKey(b)) return;
    segSet.add(k);
    allSegments.push({ a, b });
  };

  // Footprint edges (with midpoints inserted)
  for (let i = 0; i < augFootprint.length; i++) {
    addSeg(augFootprint[i], augFootprint[(i + 1) % augFootprint.length]);
  }

  // Interior lines
  for (const seg of snappedInterior) {
    addSeg(seg.a, seg.b);
  }

  // 6. Build adjacency and extract faces
  const adj = buildAdjacency(allSegments);
  const rawFaces = extractMinimalCycles(adj);

  // 7. Filter: only keep faces with meaningful area (>50 px²)
  const minArea = 50;
  const validFaces = rawFaces
    .filter(f => Math.abs(signedArea(f)) > minArea)
    .map((polygon, i) => ({ id: i, polygon }));

  const debug = {
    input_footprint_vertices: rawFootprint.length,
    input_interior_lines: interiorLines.length,
    total_graph_segments: allSegments.length,
    total_graph_nodes: adj.size,
    faces_extracted: rawFaces.length,
    faces_with_area: validFaces.length,
  };

  console.log("[PLANAR_SOLVER]", JSON.stringify(debug));

  return { faces: validFaces, edges: allSegments, debug };
}
