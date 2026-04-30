// Adjacency graph builder + edge classifier for ridge_split_recursive planes.
// Deterministic, no ML. Produces shared interior edges with two-plane ownership
// and exterior edges classified as eave/rake.

export type Pt = { x: number; y: number };

export type PlaneIn = {
  plane_index?: number | string;
  id?: number | string;
  polygon_px: Pt[];
  pitch?: number | null;
  azimuthDeg?: number | null;
  azimuth_degrees?: number | null;
  azimuth?: number | null;
  source?: string;
};

export type ClassifiedRoofEdge = {
  edge_type: "ridge" | "hip" | "valley" | "eave" | "rake" | "unknown";
  line_px: Pt[];
  adjacent_plane_ids: string[];
  source: string;
  confidence: number;
  debug_reason: string;
};

const EPS = 3.0;

function pid(p: PlaneIn): string {
  return String(p.plane_index ?? p.id);
}
function dist(a: Pt, b: Pt): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function dot(a: Pt, b: Pt): number { return a.x * b.x + a.y * b.y; }
function sub(a: Pt, b: Pt): Pt { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Pt, b: Pt): Pt { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a: Pt, s: number): Pt { return { x: a.x * s, y: a.y * s }; }
function norm(v: Pt): Pt {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}
function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function centroid(poly: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / Math.max(1, poly.length), y: y / Math.max(1, poly.length) };
}
function segLen(a: Pt, b: Pt): number { return dist(a, b); }
function projectT(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const denom = dot(ab, ab) || 1;
  return dot(sub(p, a), ab) / denom;
}
function pointToSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const t = Math.max(0, Math.min(1, projectT(p, a, b)));
  const q = add(a, mul(sub(b, a), t));
  return dist(p, q);
}

function areColinearAndOverlapping(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const ab = sub(a2, a1);
  const len = Math.hypot(ab.x, ab.y);
  if (len < EPS) return false;

  const d1 = pointToSegmentDistance(b1, a1, a2);
  const d2 = pointToSegmentDistance(b2, a1, a2);
  if (Math.max(d1, d2) > EPS) return false;

  const t1 = projectT(b1, a1, a2);
  const t2 = projectT(b2, a1, a2);
  const lo = Math.max(0, Math.min(t1, t2));
  const hi = Math.min(1, Math.max(t1, t2));
  return hi - lo > 0.05;
}

function sharedSegment(a1: Pt, a2: Pt, b1: Pt, b2: Pt): [Pt, Pt] | null {
  if (!areColinearAndOverlapping(a1, a2, b1, b2)) return null;
  const lo = Math.max(0, Math.min(projectT(b1, a1, a2), projectT(b2, a1, a2)));
  const hi = Math.min(1, Math.max(projectT(b1, a1, a2), projectT(b2, a1, a2)));
  if (hi - lo <= 0.05) return null;
  const ab = sub(a2, a1);
  return [add(a1, mul(ab, lo)), add(a1, mul(ab, hi))];
}

function polygonSignedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function isReflexVertex(prev: Pt, curr: Pt, next: Pt, ccw: boolean): boolean {
  const cross =
    (curr.x - prev.x) * (next.y - curr.y) -
    (curr.y - prev.y) * (next.x - curr.x);
  return ccw ? cross < 0 : cross > 0;
}

function edgeTouchesReflexCorner(edge: [Pt, Pt], footprint: Pt[], tolerancePx = 10): boolean {
  if (!footprint || footprint.length < 4) return false;
  const [a, b] = edge;
  const ccw = polygonSignedArea(footprint) > 0;
  for (let i = 0; i < footprint.length; i++) {
    const prev = footprint[(i - 1 + footprint.length) % footprint.length];
    const curr = footprint[i];
    const next = footprint[(i + 1) % footprint.length];
    if (!isReflexVertex(prev, curr, next, ccw)) continue;
    if (pointToSegmentDistance(curr, a, b) <= tolerancePx) return true;
  }
  return false;
}

function unitFromAzimuthDeg(deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

function planeAzimuth(p: PlaneIn): number | null {
  const v = p.azimuthDeg ?? p.azimuth_degrees ?? p.azimuth;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function classifySharedEdge(args: {
  edge: [Pt, Pt];
  a: PlaneIn;
  b: PlaneIn;
  footprint: Pt[];
}): ClassifiedRoofEdge {
  const { edge, a, b, footprint } = args;
  const [p1, p2] = edge;
  const mid = midpoint(p1, p2);

  const ca = centroid(a.polygon_px);
  const cb = centroid(b.polygon_px);

  const fromEdgeToA = norm(sub(ca, mid));
  const fromEdgeToB = norm(sub(cb, mid));

  const azA = planeAzimuth(a);
  const azB = planeAzimuth(b);

  if (azA !== null && azB !== null) {
    const downA = unitFromAzimuthDeg(azA);
    const downB = unitFromAzimuthDeg(azB);

    const aAway = dot(downA, fromEdgeToA) > 0.2;
    const bAway = dot(downB, fromEdgeToB) > 0.2;
    const aToward = dot(downA, fromEdgeToA) < -0.2;
    const bToward = dot(downB, fromEdgeToB) < -0.2;

    if (aAway && bAway) {
      return {
        edge_type: "ridge",
        line_px: [p1, p2],
        adjacent_plane_ids: [pid(a), pid(b)],
        source: "ridge_split_recursive_adjacency",
        confidence: 0.9,
        debug_reason: "two adjacent planes slope away from shared edge",
      };
    }
    if (aToward && bToward) {
      return {
        edge_type: "valley",
        line_px: [p1, p2],
        adjacent_plane_ids: [pid(a), pid(b)],
        source: "ridge_split_recursive_adjacency",
        confidence: 0.92,
        debug_reason: "two adjacent planes slope toward shared edge",
      };
    }
    return {
      edge_type: "hip",
      line_px: [p1, p2],
      adjacent_plane_ids: [pid(a), pid(b)],
      source: "ridge_split_recursive_adjacency",
      confidence: 0.74,
      debug_reason: "mixed slope flow across adjacent planes",
    };
  }

  if (edgeTouchesReflexCorner(edge, footprint)) {
    return {
      edge_type: "valley",
      line_px: [p1, p2],
      adjacent_plane_ids: [pid(a), pid(b)],
      source: "ridge_split_recursive_adjacency",
      confidence: 0.68,
      debug_reason: "shared edge touches reflex footprint corner; azimuth missing",
    };
  }

  return {
    edge_type: "ridge",
    line_px: [p1, p2],
    adjacent_plane_ids: [pid(a), pid(b)],
    source: "ridge_split_recursive_adjacency",
    confidence: 0.58,
    debug_reason: "shared internal boundary with missing azimuth; default ridge",
  };
}

function isExteriorEdge(edge: [Pt, Pt], planes: PlaneIn[], ownerId: string): boolean {
  const [a1, a2] = edge;
  let sharedCount = 0;
  for (const p of planes) {
    if (pid(p) === ownerId) continue;
    const poly = p.polygon_px || [];
    for (let i = 0; i < poly.length; i++) {
      const b1 = poly[i];
      const b2 = poly[(i + 1) % poly.length];
      if (sharedSegment(a1, a2, b1, b2)) sharedCount++;
    }
  }
  return sharedCount === 0;
}

function classifyExteriorEdge(edge: [Pt, Pt], plane: PlaneIn): ClassifiedRoofEdge {
  const [p1, p2] = edge;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
  const normalized = Math.min(angle, 180 - angle);
  const isEave = normalized < 12 || Math.abs(normalized - 90) < 12;

  return {
    edge_type: isEave ? "eave" : "rake",
    line_px: [p1, p2],
    adjacent_plane_ids: [pid(plane)],
    source: "ridge_split_recursive_adjacency",
    confidence: 0.7,
    debug_reason: isEave
      ? "exterior edge aligned to dominant roof axis"
      : "exterior angled gable edge",
  };
}

function planeEdges(p: PlaneIn): [Pt, Pt][] {
  const poly = p.polygon_px || [];
  const out: [Pt, Pt][] = [];
  for (let i = 0; i < poly.length; i++) {
    out.push([poly[i], poly[(i + 1) % poly.length]]);
  }
  return out;
}

function edgeKey(e: ClassifiedRoofEdge): string {
  const a = e.line_px[0];
  const b = e.line_px[e.line_px.length - 1];
  const p = [
    `${Math.round(a.x)}:${Math.round(a.y)}`,
    `${Math.round(b.x)}:${Math.round(b.y)}`,
  ].sort();
  return `${e.edge_type}:${p[0]}-${p[1]}:${e.adjacent_plane_ids.slice().sort().join(",")}`;
}

export function buildAdjacencyAndClassifyEdges(args: {
  footprint_px: Pt[];
  planes: PlaneIn[];
}): ClassifiedRoofEdge[] {
  const { footprint_px, planes } = args;
  const edges: ClassifiedRoofEdge[] = [];

  // 1. Shared interior edges
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const a = planes[i];
      const b = planes[j];
      for (const ea of planeEdges(a)) {
        for (const eb of planeEdges(b)) {
          const shared = sharedSegment(ea[0], ea[1], eb[0], eb[1]);
          if (!shared) continue;
          if (segLen(shared[0], shared[1]) < 5) continue;
          edges.push(classifySharedEdge({
            edge: shared,
            a,
            b,
            footprint: footprint_px,
          }));
        }
      }
    }
  }

  // 2. Exterior edges
  for (const p of planes) {
    for (const e of planeEdges(p)) {
      if (!isExteriorEdge(e, planes, pid(p))) continue;
      if (segLen(e[0], e[1]) < 5) continue;
      edges.push(classifyExteriorEdge(e, p));
    }
  }

  // 3. Deduplicate
  const seen = new Set<string>();
  const deduped: ClassifiedRoofEdge[] = [];
  for (const e of edges) {
    const key = edgeKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  return deduped;
}
