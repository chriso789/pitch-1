// Footprint-first deterministic plane solver.
// Footprint is primary; ridges are validators/hints only.
//
// CRITICAL CONTRACT (post-9-Palm-Harbor fix):
// Every accepted ridge MUST become a shared boundary segment between exactly
// two adjacent plane polygons. Floating internal lines are forbidden.
// We achieve this by always splitting an EXISTING plane edge-to-edge with
// a chord that runs from one polygon boundary to another, using the ridge
// only as a direction/seed hint.

type Point = { x: number; y: number };

export type SolverRidge = {
  p1: Point;
  p2: Point;
  score?: number;
};

export type SolverPlane = {
  id: number;
  polygon: Point[];
  area_px?: number;
};

const SHARED_EPS = 4;        // px tolerance for "same segment"
const MIN_SHARED_LEN = 6;    // px minimum shared boundary length
const MIN_AREA_RATIO = 0.02; // drop tiny shards <2% of footprint

// ─── GEOMETRY UTILS ───────────────────────────────────────────────

function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(a / 2);
}

function insideFootprint(p: Point, footprint: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
    const xi = footprint[i].x, yi = footprint[i].y;
    const xj = footprint[j].x, yj = footprint[j].y;
    const intersect =
      (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonCentroid(poly: Point[]): Point {
  let x = 0, y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

function sub(a: Point, b: Point) { return { x: a.x - b.x, y: a.y - b.y }; }
function dot(a: Point, b: Point) { return a.x * b.x + a.y * b.y; }
function len(a: Point) { return Math.hypot(a.x, a.y); }

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const t = Math.max(0, Math.min(1, dot(ap, ab) / Math.max(dot(ab, ab), 1e-9)));
  const q = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function projectT(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  return dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-9);
}

// Length of overlap between two collinear-ish segments. Returns 0 if they
// are not collinear within SHARED_EPS or do not overlap by ≥ MIN_SHARED_LEN.
export function sharedSegmentLength(
  a1: Point, a2: Point, b1: Point, b2: Point,
): number {
  if (pointToSegmentDistance(b1, a1, a2) > SHARED_EPS) return 0;
  if (pointToSegmentDistance(b2, a1, a2) > SHARED_EPS) return 0;
  const t1 = projectT(b1, a1, a2);
  const t2 = projectT(b2, a1, a2);
  const lo = Math.max(0, Math.min(t1, t2));
  const hi = Math.min(1, Math.max(t1, t2));
  if (hi - lo <= 0) return 0;
  return (hi - lo) * len(sub(a2, a1));
}

// ─── SPLIT LOGIC ──────────────────────────────────────────────────
// Edge-to-edge chord split: extends the ridge to the polygon boundary so
// the resulting two polygons share the chord as a real boundary segment.

function lineLineIntersect(
  p: Point, dir: Point, a: Point, b: Point,
): { point: Point; t: number; u: number } | null {
  const r = dir;
  const s = sub(b, a);
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const qp = sub(a, p);
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;
  return { point: { x: p.x + r.x * t, y: p.y + r.y * t }, t, u };
}

// Find the chord that the ridge implies on the polygon: extend ridge in both
// directions until it crosses two polygon edges. Returns those intersections
// (already snapped onto polygon boundary).
function ridgeChordOnPolygon(
  poly: Point[], ridge: SolverRidge,
): { hits: Array<{ point: Point; edgeIndex: number; t: number }> } | null {
  const dir = sub(ridge.p2, ridge.p1);
  if (len(dir) < 1e-6) return null;
  const hits: Array<{ point: Point; edgeIndex: number; t: number }> = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const inter = lineLineIntersect(ridge.p1, dir, a, b);
    if (!inter) continue;
    if (inter.u < -1e-6 || inter.u > 1 + 1e-6) continue;
    hits.push({ point: inter.point, edgeIndex: i, t: inter.t });
  }
  if (hits.length < 2) return null;
  // Sort by t (parametric position along ridge direction) and pick extremes
  hits.sort((a, b) => a.t - b.t);
  return { hits: [hits[0], hits[hits.length - 1]] };
}

function splitPolygonByChord(
  poly: Point[],
  chord: { point: Point; edgeIndex: number }[],
): Point[][] | null {
  if (chord.length !== 2) return null;
  const [c0, c1] = chord;
  if (c0.edgeIndex === c1.edgeIndex) return null; // degenerate
  // Walk poly from c0 → c1 along the perimeter producing left half, then
  // c1 → c0 producing right half. Insert chord endpoints onto their host edges.
  const a = chord[0].edgeIndex < chord[1].edgeIndex ? chord[0] : chord[1];
  const b = chord[0].edgeIndex < chord[1].edgeIndex ? chord[1] : chord[0];

  const left: Point[] = [a.point];
  for (let i = a.edgeIndex + 1; i <= b.edgeIndex; i++) {
    left.push(poly[i % poly.length]);
  }
  left.push(b.point);

  const right: Point[] = [b.point];
  for (let i = b.edgeIndex + 1; i < poly.length + a.edgeIndex + 1; i++) {
    right.push(poly[i % poly.length]);
  }
  right.push(a.point);

  if (left.length < 3 || right.length < 3) return null;
  return [left, right];
}

// ─── RIDGE VALIDATION ─────────────────────────────────────────────

function ridgeValid(ridge: SolverRidge, footprint: Point[], relaxLength = false): boolean {
  const l = Math.hypot(
    ridge.p2.x - ridge.p1.x,
    ridge.p2.y - ridge.p1.y,
  );
  const xs = footprint.map((p) => p.x);
  const fpWidth = Math.max(...xs) - Math.min(...xs);

  // Skeleton-derived ridges ARE the structural lines — they may span the
  // full footprint width. Only enforce the 60% cap for image-detected ridges.
  if (!relaxLength && l > fpWidth * 0.6) return false;
  // For skeleton ridges, still reject absurdly long ones (>1.5× footprint)
  if (relaxLength && l > fpWidth * 1.5) return false;
  if (
    !insideFootprint(ridge.p1, footprint) ||
    !insideFootprint(ridge.p2, footprint)
  ) return false;
  return true;
}

// ─── PLANE ADJACENCY VALIDATION ───────────────────────────────────

export function planeAdjacencyStats(planes: Point[][]) {
  let sharedBoundaryCount = 0;
  let twoPlaneBoundaryCount = 0;
  const edgeSharers = new Map<string, Set<number>>();

  for (let i = 0; i < planes.length; i++) {
    const A = planes[i];
    for (let j = i + 1; j < planes.length; j++) {
      const B = planes[j];
      let pairShares = false;
      for (let ei = 0; ei < A.length; ei++) {
        const a1 = A[ei], a2 = A[(ei + 1) % A.length];
        for (let ej = 0; ej < B.length; ej++) {
          const b1 = B[ej], b2 = B[(ej + 1) % B.length];
          const overlap = sharedSegmentLength(a1, a2, b1, b2);
          if (overlap >= MIN_SHARED_LEN) {
            sharedBoundaryCount++;
            pairShares = true;
            const key = `${Math.round((a1.x + a2.x) / 2)}:${Math.round((a1.y + a2.y) / 2)}:${Math.round((b1.x + b2.x) / 2)}:${Math.round((b1.y + b2.y) / 2)}`;
            if (!edgeSharers.has(key)) edgeSharers.set(key, new Set());
            edgeSharers.get(key)!.add(i);
            edgeSharers.get(key)!.add(j);
          }
        }
      }
      if (pairShares) twoPlaneBoundaryCount++;
    }
  }

  return {
    plane_count: planes.length,
    shared_boundary_count: sharedBoundaryCount,
    two_plane_boundary_count: twoPlaneBoundaryCount,
  };
}

// ─── MAIN SOLVER ──────────────────────────────────────────────────

export function solvePlanesFromFootprint(
  footprint: Point[],
  ridges: SolverRidge[],
): {
  planes: SolverPlane[];
  stats: Record<string, unknown>;
  adjacency: ReturnType<typeof planeAdjacencyStats>;
} {
  let planes: Point[][] = [footprint];

  const validRidges = ridges.filter((r) => ridgeValid(r, footprint));
  let acceptedSplits = 0;
  let rejectedSplits = 0;

  console.log("[FOOTPRINT_SOLVER][RIDGE_VALIDATION]", {
    input: ridges.length,
    valid: validRidges.length,
    rejected: ridges.length - validRidges.length,
  });

  for (const ridge of validRidges) {
    let didSplit = false;
    const newPlanes: Point[][] = [];
    for (const plane of planes) {
      const chord = ridgeChordOnPolygon(plane, ridge);
      if (!chord) {
        newPlanes.push(plane);
        continue;
      }
      const split = splitPolygonByChord(plane, chord.hits);
      if (!split) {
        newPlanes.push(plane);
        continue;
      }
      // After split, both halves must share the chord segment with length
      // ≥ MIN_SHARED_LEN, otherwise reject the split.
      const [L, R] = split;
      const sharedLen = (() => {
        let best = 0;
        for (let i = 0; i < L.length; i++) {
          const a1 = L[i], a2 = L[(i + 1) % L.length];
          for (let j = 0; j < R.length; j++) {
            const b1 = R[j], b2 = R[(j + 1) % R.length];
            best = Math.max(best, sharedSegmentLength(a1, a2, b1, b2));
          }
        }
        return best;
      })();
      if (sharedLen < MIN_SHARED_LEN) {
        rejectedSplits++;
        newPlanes.push(plane);
        continue;
      }
      newPlanes.push(L, R);
      didSplit = true;
    }
    if (didSplit) acceptedSplits++;
    planes = newPlanes;
    if (planes.length > 20) break;
  }

  const footprintArea = polygonArea(footprint);

  const cleaned = planes.filter((p) => {
    const a = polygonArea(p);
    if (a < footprintArea * MIN_AREA_RATIO) return false;
    if (!insideFootprint(polygonCentroid(p), footprint)) return false;
    return true;
  });

  const totalArea = cleaned.reduce((s, p) => s + polygonArea(p), 0);
  const ratio = totalArea / footprintArea;

  if (ratio > 1.15) {
    console.warn("[FOOTPRINT_SOLVER][AREA_REJECT]", {
      totalArea,
      footprintArea,
      ratio,
    });
    const adjacency = planeAdjacencyStats([footprint]);
    return {
      planes: [{ id: 0, polygon: footprint, area_px: footprintArea }],
      stats: {
        rejected: true,
        reason: "area_inflation",
        ratio,
        input_ridges: ridges.length,
        valid_ridges: validRidges.length,
        accepted_splits: acceptedSplits,
        rejected_splits: rejectedSplits,
      },
      adjacency,
    };
  }

  const adjacency = planeAdjacencyStats(cleaned);

  console.log("[FOOTPRINT_SOLVER][RESULT]", {
    planes: cleaned.length,
    area_ratio: ratio,
    accepted_splits: acceptedSplits,
    rejected_splits: rejectedSplits,
    shared_boundary_count: adjacency.shared_boundary_count,
  });

  return {
    planes: cleaned.map((p, i) => ({
      id: i,
      polygon: p,
      area_px: polygonArea(p),
    })),
    stats: {
      rejected: false,
      input_ridges: ridges.length,
      valid_ridges: validRidges.length,
      accepted_splits: acceptedSplits,
      rejected_splits: rejectedSplits,
      plane_count: cleaned.length,
      area_ratio: ratio,
    },
    adjacency,
  };
}

// ─── SKELETON-DRIVEN REBUILD ──────────────────────────────────────
// When classifyPlaneEdges emits 0 ridge/hip/valley, the caller can pass in
// straight-skeleton interior segments and rebuild planes from them so each
// skeleton segment becomes a real shared boundary. This is the "fix the plane
// graph" path required when image-detected ridges fail to support adjacency.

export function rebuildPlanesFromSkeletonSegments(
  footprint: Point[],
  segments: Array<{ p1: Point; p2: Point }>,
): {
  planes: SolverPlane[];
  stats: Record<string, unknown>;
  adjacency: ReturnType<typeof planeAdjacencyStats>;
} {
  // Each skeleton segment is treated as a high-confidence ridge hint, then
  // we run the same edge-to-edge chord split machinery. This guarantees the
  // resulting planes share the skeleton segments as real boundaries.
  const ridges: SolverRidge[] = segments
    .filter((s) => Number.isFinite(s.p1?.x) && Number.isFinite(s.p2?.x))
    .map((s) => ({ p1: s.p1, p2: s.p2, score: 0.95 }));
  const result = solvePlanesFromFootprint(footprint, ridges);
  return {
    ...result,
    stats: { ...result.stats, source: "straight_skeleton_rebuild" },
  };
}
