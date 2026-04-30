// Deterministic post-classification of skeleton/topology edges into
// ridge / hip / valley using:
//   1. plane-adjacency + slope direction (azimuth)
//   2. concave/reflex corner detection on the footprint
//   3. fallback to "hip" so we never persist `unknown` interior edges
//
// Designed to be called AFTER computeStraightSkeleton() / topology engine v2
// has produced edges + planes, but BEFORE persistence to ai_roof_edges.

export type Pt = { x: number; y: number };

export type RoofPlane = {
  id: string;
  polygon_px: Pt[];
  pitch?: number | null;
  azimuthDeg?: number | null; // downslope direction, degrees clockwise from north / image up
};

export type RoofEdge = {
  edge_type: string;
  line_px: Pt[];
  adjacent_plane_ids?: string[];
  source?: string;
  confidence?: number;
  debug_reason?: string;
};

function centroid(poly: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / Math.max(poly.length, 1), y: y / Math.max(poly.length, 1) };
}

function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function unitFromAzimuthDeg(deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

function dot(a: Pt, b: Pt): number { return a.x * b.x + a.y * b.y; }

function normalize(v: Pt): Pt {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}

function polygonSignedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
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

function distancePointToSegment(p: Pt, a: Pt, b: Pt): number {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ap = { x: p.x - a.x, y: p.y - a.y };
  const t = Math.max(0, Math.min(1, dot(ap, ab) / Math.max(dot(ab, ab), 1e-9)));
  const proj = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return Math.hypot(p.x - proj.x, p.y - proj.y);
}

function edgeTouchesReflexCorner(edge: RoofEdge, footprint: Pt[], tolerancePx = 8): boolean {
  if (!edge.line_px || edge.line_px.length < 2 || footprint.length < 4) return false;
  const a = edge.line_px[0];
  const b = edge.line_px[edge.line_px.length - 1];
  const ccw = polygonSignedArea(footprint) > 0;

  for (let i = 0; i < footprint.length; i++) {
    const prev = footprint[(i - 1 + footprint.length) % footprint.length];
    const curr = footprint[i];
    const next = footprint[(i + 1) % footprint.length];
    if (!isReflexVertex(prev, curr, next, ccw)) continue;
    if (distancePointToSegment(curr, a, b) <= tolerancePx) return true;
  }
  return false;
}

function classifyBySlopeDirection(
  edge: RoofEdge,
  planeMap: Map<string, RoofPlane>,
): { edge_type: 'ridge' | 'hip' | 'valley' | 'unknown'; confidence: number; reason: string } {
  if (!edge.adjacent_plane_ids || edge.adjacent_plane_ids.length !== 2) {
    return { edge_type: 'unknown', confidence: 0.3, reason: 'edge does not have exactly two adjacent planes' };
  }
  if (!edge.line_px || edge.line_px.length < 2) {
    return { edge_type: 'unknown', confidence: 0.2, reason: 'edge has no valid line' };
  }

  const pA = planeMap.get(edge.adjacent_plane_ids[0]);
  const pB = planeMap.get(edge.adjacent_plane_ids[1]);
  if (!pA || !pB) {
    return { edge_type: 'unknown', confidence: 0.2, reason: 'adjacent plane id missing' };
  }

  const a = edge.line_px[0];
  const b = edge.line_px[edge.line_px.length - 1];
  const mid = midpoint(a, b);

  const cA = centroid(pA.polygon_px);
  const cB = centroid(pB.polygon_px);

  const fromEdgeToA = normalize({ x: cA.x - mid.x, y: cA.y - mid.y });
  const fromEdgeToB = normalize({ x: cB.x - mid.x, y: cB.y - mid.y });

  const hasAzimuth =
    typeof pA.azimuthDeg === 'number' && Number.isFinite(pA.azimuthDeg) &&
    typeof pB.azimuthDeg === 'number' && Number.isFinite(pB.azimuthDeg);

  if (!hasAzimuth) {
    return { edge_type: 'unknown', confidence: 0.45, reason: 'missing slope azimuth; defer to reflex/topology rule' };
  }

  const downA = unitFromAzimuthDeg(pA.azimuthDeg!);
  const downB = unitFromAzimuthDeg(pB.azimuthDeg!);

  const aFlowsAway = dot(downA, fromEdgeToA) > 0.2;
  const bFlowsAway = dot(downB, fromEdgeToB) > 0.2;
  const aFlowsToward = dot(downA, fromEdgeToA) < -0.2;
  const bFlowsToward = dot(downB, fromEdgeToB) < -0.2;

  if (aFlowsAway && bFlowsAway) {
    return { edge_type: 'ridge', confidence: 0.88, reason: 'both adjacent planes slope away from shared edge' };
  }
  if (aFlowsToward && bFlowsToward) {
    return { edge_type: 'valley', confidence: 0.9, reason: 'both adjacent planes slope toward shared edge' };
  }
  return { edge_type: 'hip', confidence: 0.72, reason: 'adjacent planes meet at descending exterior corner / mixed flow' };
}

export function classifyHipValleyRidgeEdges(args: {
  footprint_px: Pt[];
  planes: RoofPlane[];
  edges: RoofEdge[];
}): RoofEdge[] {
  const { footprint_px, planes, edges } = args;
  const planeMap = new Map(planes.map((p) => [p.id, p]));

  return edges.map((edge) => {
    if (edge.edge_type === 'eave' || edge.edge_type === 'rake') return edge;

    const slopeResult = classifyBySlopeDirection(edge, planeMap);
    if (slopeResult.edge_type !== 'unknown') {
      return {
        ...edge,
        edge_type: slopeResult.edge_type,
        confidence: Math.max(edge.confidence ?? 0, slopeResult.confidence),
        debug_reason: slopeResult.reason,
        source: edge.source || 'topology_engine_v2',
      };
    }

    const touchesReflex = edgeTouchesReflexCorner(edge, footprint_px);
    if (touchesReflex) {
      return {
        ...edge,
        edge_type: 'valley',
        confidence: Math.max(edge.confidence ?? 0, 0.68),
        debug_reason: 'edge touches concave/reflex footprint corner',
        source: edge.source || 'topology_engine_v2',
      };
    }

    // Fallback: keep ridge if it was already a ridge from skeleton centerline,
    // otherwise default unknowns to hip rather than persisting "unknown".
    const fallback =
      edge.edge_type === 'ridge' || edge.edge_type === 'hip' || edge.edge_type === 'valley'
        ? edge.edge_type
        : 'hip';

    return {
      ...edge,
      edge_type: fallback,
      confidence: Math.max(edge.confidence ?? 0, 0.55),
      debug_reason: edge.debug_reason || 'fallback topology classification',
      source: edge.source || 'topology_engine_v2',
    };
  });
}
