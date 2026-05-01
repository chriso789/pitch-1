// Plane-tied edge classifier.
// Builds shared-boundary adjacency from final planes, classifies edges as
// ridge/valley/hip/eave/rake from plane adjacency + slope direction, and
// validates ridge hints against actual plane boundaries.

export type Pt = { x: number; y: number };

export type PlaneIn = {
  id?: string | number;
  plane_index?: string | number;
  polygon_px: Pt[];
  pitch?: number | null;
  pitch_degrees?: number | null;
  azimuth?: number | null;
  azimuthDeg?: number | null;
  azimuth_degrees?: number | null;
};

export type RidgeHint = {
  id?: string;
  p1: Pt;
  p2: Pt;
  score?: number;
};

export type ClassifiedEdge = {
  id: string;
  edge_type: "ridge" | "valley" | "hip" | "eave" | "rake" | "unknown";
  line_px: Pt[];
  adjacent_plane_ids: string[];
  confidence: number;
  source: "plane_edge_classifier_v1";
  debug_reason: string;
};

const EPS = 4;

function pid(p: PlaneIn, i: number): string {
  return String(p.id ?? p.plane_index ?? i);
}

function sub(a: Pt, b: Pt): Pt { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Pt, b: Pt): Pt { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a: Pt, s: number): Pt { return { x: a.x * s, y: a.y * s }; }
function dot(a: Pt, b: Pt): number { return a.x * b.x + a.y * b.y; }
function dist(a: Pt, b: Pt): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function norm(v: Pt): Pt {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}

function centroid(poly: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of poly || []) { x += p.x; y += p.y; }
  const n = Math.max(1, poly?.length || 0);
  return { x: x / n, y: y / n };
}

function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function planeEdges(poly: Pt[]): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (let i = 0; i < poly.length; i++) {
    out.push([poly[i], poly[(i + 1) % poly.length]]);
  }
  return out;
}

function pointToSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const t = Math.max(0, Math.min(1, dot(ap, ab) / Math.max(dot(ab, ab), 1e-9)));
  const q = add(a, mul(ab, t));
  return dist(p, q);
}

function projectT(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  return dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-9);
}

function sharedSegment(a1: Pt, a2: Pt, b1: Pt, b2: Pt): [Pt, Pt] | null {
  if (pointToSegmentDistance(b1, a1, a2) > EPS) return null;
  if (pointToSegmentDistance(b2, a1, a2) > EPS) return null;

  const t1 = projectT(b1, a1, a2);
  const t2 = projectT(b2, a1, a2);

  const lo = Math.max(0, Math.min(t1, t2));
  const hi = Math.min(1, Math.max(t1, t2));

  if (hi - lo <= 0.05) return null;

  const ab = sub(a2, a1);
  return [add(a1, mul(ab, lo)), add(a1, mul(ab, hi))];
}

function angleDeg(a: Pt, b: Pt): number {
  const deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  return ((deg % 180) + 180) % 180;
}

function angleDiff180(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

function azDeg(p: PlaneIn): number | null {
  const v = p.azimuthDeg ?? p.azimuth_degrees ?? p.azimuth;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function downVectorFromAzimuth(deg: number): Pt {
  const r = deg * Math.PI / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

function classifySharedBoundary(args: {
  a: PlaneIn;
  b: PlaneIn;
  aId: string;
  bId: string;
  segment: [Pt, Pt];
  ridgeHints: RidgeHint[];
  edgeIndex: number;
}): ClassifiedEdge {
  const { a, b, aId, bId, segment, ridgeHints, edgeIndex } = args;
  const [p1, p2] = segment;
  const mid = midpoint(p1, p2);

  const ca = centroid(a.polygon_px);
  const cb = centroid(b.polygon_px);

  const fromEdgeToA = norm(sub(ca, mid));
  const fromEdgeToB = norm(sub(cb, mid));

  const azA = azDeg(a);
  const azB = azDeg(b);

  const boundaryAngle = angleDeg(p1, p2);

  const alignedHint = ridgeHints.find((r) => {
    const hintAngle = angleDeg(r.p1, r.p2);
    const angleOk = angleDiff180(boundaryAngle, hintAngle) <= 12;
    const d1 = pointToSegmentDistance(p1, r.p1, r.p2);
    const d2 = pointToSegmentDistance(p2, r.p1, r.p2);
    return angleOk && Math.max(d1, d2) <= 12;
  });

  if (azA !== null && azB !== null) {
    const downA = downVectorFromAzimuth(azA);
    const downB = downVectorFromAzimuth(azB);

    const aAway = dot(downA, fromEdgeToA) > 0.15;
    const bAway = dot(downB, fromEdgeToB) > 0.15;

    const aToward = dot(downA, fromEdgeToA) < -0.15;
    const bToward = dot(downB, fromEdgeToB) < -0.15;

    if (aAway && bAway) {
      return {
        id: `E${edgeIndex}`,
        edge_type: "ridge",
        line_px: [p1, p2],
        adjacent_plane_ids: [aId, bId],
        confidence: alignedHint ? 0.95 : 0.85,
        source: "plane_edge_classifier_v1",
        debug_reason: alignedHint
          ? "shared boundary slopes away on both sides and matches ridge hint"
          : "shared boundary slopes away on both sides",
      };
    }

    if (aToward && bToward) {
      return {
        id: `E${edgeIndex}`,
        edge_type: "valley",
        line_px: [p1, p2],
        adjacent_plane_ids: [aId, bId],
        confidence: 0.9,
        source: "plane_edge_classifier_v1",
        debug_reason: "shared boundary slopes toward from both sides",
      };
    }

    return {
      id: `E${edgeIndex}`,
      edge_type: "hip",
      line_px: [p1, p2],
      adjacent_plane_ids: [aId, bId],
      confidence: 0.74,
      source: "plane_edge_classifier_v1",
      debug_reason: "shared boundary has mixed downslope flow",
    };
  }

  return {
    id: `E${edgeIndex}`,
    edge_type: alignedHint ? "ridge" : "unknown",
    line_px: [p1, p2],
    adjacent_plane_ids: [aId, bId],
    confidence: alignedHint ? 0.7 : 0.45,
    source: "plane_edge_classifier_v1",
    debug_reason: alignedHint
      ? "missing azimuth but ridge hint aligns with shared plane boundary"
      : "missing azimuth and no validated ridge hint",
  };
}

function classifyExteriorEdge(args: {
  plane: PlaneIn;
  planeId: string;
  edge: [Pt, Pt];
  edgeIndex: number;
}): ClassifiedEdge {
  const { plane, planeId, edge, edgeIndex } = args;
  const [p1, p2] = edge;

  const az = azDeg(plane);
  const eAngle = angleDeg(p1, p2);

  let edgeType: "eave" | "rake" = "eave";
  let reason = "default exterior edge";

  if (az !== null) {
    const downslopeAxis = ((az % 180) + 180) % 180;
    const d = angleDiff180(eAngle, downslopeAxis);

    if (d <= 30) {
      edgeType = "rake";
      reason = "exterior edge parallel to downslope axis";
    } else {
      edgeType = "eave";
      reason = "exterior edge perpendicular to downslope axis";
    }
  }

  return {
    id: `E${edgeIndex}`,
    edge_type: edgeType,
    line_px: [p1, p2],
    adjacent_plane_ids: [planeId],
    confidence: az !== null ? 0.78 : 0.55,
    source: "plane_edge_classifier_v1",
    debug_reason: reason,
  };
}

function edgeKey(e: ClassifiedEdge): string {
  const a = e.line_px[0];
  const b = e.line_px[e.line_px.length - 1];
  const pts = [
    `${Math.round(a.x)}:${Math.round(a.y)}`,
    `${Math.round(b.x)}:${Math.round(b.y)}`,
  ].sort();
  return `${e.edge_type}:${pts[0]}-${pts[1]}:${e.adjacent_plane_ids.slice().sort().join(",")}`;
}

export function classifyPlaneEdges(args: {
  planes: PlaneIn[];
  ridgeHints?: RidgeHint[];
}) {
  const planes = args.planes || [];
  const ridgeHints = args.ridgeHints || [];

  const sharedEdges: ClassifiedEdge[] = [];
  let edgeIndex = 0;

  // 1. Shared two-plane boundaries.
  for (let i = 0; i < planes.length; i++) {
    const a = planes[i];
    const aId = pid(a, i);

    for (let j = i + 1; j < planes.length; j++) {
      const b = planes[j];
      const bId = pid(b, j);

      for (const ea of planeEdges(a.polygon_px || [])) {
        for (const eb of planeEdges(b.polygon_px || [])) {
          const shared = sharedSegment(ea[0], ea[1], eb[0], eb[1]);
          if (!shared) continue;
          if (dist(shared[0], shared[1]) < 5) continue;

          sharedEdges.push(
            classifySharedBoundary({
              a, b, aId, bId,
              segment: shared,
              ridgeHints,
              edgeIndex: edgeIndex++,
            }),
          );
        }
      }
    }
  }

  // 2. Exterior one-plane edges (not coincident with any shared boundary).
  const exteriorEdges: ClassifiedEdge[] = [];

  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    const pId = pid(p, i);

    for (const e of planeEdges(p.polygon_px || [])) {
      if (dist(e[0], e[1]) < 5) continue;

      let isShared = false;
      for (const s of sharedEdges) {
        const ss = s.line_px as [Pt, Pt];
        const shared = sharedSegment(e[0], e[1], ss[0], ss[1]);
        if (shared && dist(shared[0], shared[1]) >= 5) {
          isShared = true;
          break;
        }
      }
      if (isShared) continue;

      exteriorEdges.push(
        classifyExteriorEdge({
          plane: p,
          planeId: pId,
          edge: e,
          edgeIndex: edgeIndex++,
        }),
      );
    }
  }

  // Reject any ridge edge not bounded by exactly 2 planes.
  const validated: ClassifiedEdge[] = [];
  for (const e of [...sharedEdges, ...exteriorEdges]) {
    if (e.edge_type === "ridge" && e.adjacent_plane_ids.length !== 2) {
      continue;
    }
    validated.push(e);
  }

  const deduped: ClassifiedEdge[] = [];
  const seen = new Set<string>();
  for (const e of validated) {
    const key = edgeKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }

  const counts = deduped.reduce((acc: Record<string, number>, e) => {
    acc[e.edge_type] = (acc[e.edge_type] || 0) + 1;
    return acc;
  }, {});

  const invalidRidgeHints = ridgeHints.filter((r) => {
    const hintAngle = angleDeg(r.p1, r.p2);
    return !sharedEdges.some((e) => {
      const eAngle = angleDeg(e.line_px[0], e.line_px[e.line_px.length - 1]);
      const angleOk = angleDiff180(hintAngle, eAngle) <= 12;
      const d1 = pointToSegmentDistance(r.p1, e.line_px[0], e.line_px[e.line_px.length - 1]);
      const d2 = pointToSegmentDistance(r.p2, e.line_px[0], e.line_px[e.line_px.length - 1]);
      return angleOk && Math.max(d1, d2) <= 18;
    });
  });

  console.log("[PLANE_EDGE_CLASSIFIER]", {
    planes: planes.length,
    edges: deduped.length,
    counts,
    ridge_hints: ridgeHints.length,
    invalid_ridge_hints: invalidRidgeHints.length,
  });

  return {
    edges: deduped,
    debug: {
      plane_count: planes.length,
      edge_count: deduped.length,
      counts,
      ridge_hints_total: ridgeHints.length,
      invalid_ridge_hints_count: invalidRidgeHints.length,
      invalid_ridge_hints: invalidRidgeHints.map((r) => ({
        id: r.id,
        score: r.score,
        p1: r.p1,
        p2: r.p2,
      })),
    },
  };
}
