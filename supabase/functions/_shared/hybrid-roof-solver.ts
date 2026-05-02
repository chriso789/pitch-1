// supabase/functions/_shared/hybrid-roof-solver.ts
// Constraint-based roof solver: Ridge defines planes, planes define edges.
// Replaces centroid-fan and per-edge-plane approaches that explode vertex count.
//
// Core idea: For ANY footprint (4 vertices or 40), we:
//   1. Find the dominant ridge axis (longest axis of footprint)
//   2. Build a single inset ridge line
//   3. Partition footprint vertices into 4 groups:
//      - Left eave, Right eave, Hip-end-A, Hip-end-B
//   4. Build exactly 4 planes: 2 trapezoids (eave sides) + 2 triangles (hip ends)
//   5. Clip all planes to footprint polygon (Sutherland-Hodgman)
//   6. Deduplicate edges

type Point = { x: number; y: number };

type GeneratedPlane = {
  plane_index: number;
  polygon_px: Point[];
  source: string;
};

type GeneratedEdge = {
  edge_type: "ridge" | "hip" | "eave";
  line_px: Point[];
  source: string;
};

type HybridSolverResult = {
  planes: GeneratedPlane[];
  edges: GeneratedEdge[];
  ridgeLine: { p1: Point; p2: Point } | null;
  roofType: "gable" | "hip" | "complex";
  debug: Record<string, unknown>;
};

// ─── GEOMETRY HELPERS ───────────────────────────────

function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function centroid(poly: Point[]): Point {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: y / poly.length };
}

/** Signed area of a polygon (positive = CCW) */
function polygonArea(poly: Point[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return area / 2;
}

/**
 * Oriented Bounding Box: find the direction that minimizes the bounding
 * rectangle width. Returns the long-axis unit vector.
 */
function obbLongAxis(poly: Point[]): { ux: number; uy: number } {
  let bestUx = 1, bestUy = 0, bestRatio = 0;
  const c = centroid(poly);
  for (let deg = 0; deg < 180; deg++) {
    const rad = (deg * Math.PI) / 180;
    const ux = Math.cos(rad), uy = Math.sin(rad);
    const nx = -uy, ny = ux;
    let minP = Infinity, maxP = -Infinity, minN = Infinity, maxN = -Infinity;
    for (const p of poly) {
      const dp = (p.x - c.x) * ux + (p.y - c.y) * uy;
      const dn = (p.x - c.x) * nx + (p.y - c.y) * ny;
      if (dp < minP) minP = dp;
      if (dp > maxP) maxP = dp;
      if (dn < minN) minN = dn;
      if (dn > maxN) maxN = dn;
    }
    const spanP = maxP - minP;
    const spanN = maxN - minN;
    const ratio = spanP / (spanN || 1);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestUx = ux;
      bestUy = uy;
    }
  }
  return { ux: bestUx, uy: bestUy };
}

function projectOntoAxis(
  poly: Point[],
  c: Point,
  ux: number,
  uy: number
): number[] {
  return poly.map((p) => (p.x - c.x) * ux + (p.y - c.y) * uy);
}

// ─── SUTHERLAND-HODGMAN POLYGON CLIPPING ────────────

function clipPolygonByEdge(
  polygon: Point[],
  edgeA: Point,
  edgeB: Point
): Point[] {
  if (polygon.length === 0) return [];
  const output: Point[] = [];
  const inside = (p: Point) =>
    (edgeB.x - edgeA.x) * (p.y - edgeA.y) - (edgeB.y - edgeA.y) * (p.x - edgeA.x) >= 0;

  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const curIn = inside(current);
    const nextIn = inside(next);

    if (curIn) output.push(current);
    if (curIn !== nextIn) {
      const ix = intersect(edgeA, edgeB, current, next);
      if (ix) output.push(ix);
    }
  }
  return output;
}

function intersect(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
  return { x: a1.x + t * dx1, y: a1.y + t * dy1 };
}

/** Clip subject polygon to clip polygon using Sutherland-Hodgman */
function clipPolygon(subject: Point[], clip: Point[]): Point[] {
  let output = [...subject];
  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0) break;
    const edgeA = clip[i];
    const edgeB = clip[(i + 1) % clip.length];
    output = clipPolygonByEdge(output, edgeA, edgeB);
  }
  return output;
}

/** Ensure footprint is CCW for clipping */
function ensureCCW(poly: Point[]): Point[] {
  if (polygonArea(poly) < 0) return [...poly].reverse();
  return poly;
}

// ─── EDGE DEDUPLICATION ─────────────────────────────

function edgeKey(a: Point, b: Point, tolerance: number = 4): string {
  const r = (n: number) => Math.round(n / tolerance);
  const k1 = `${r(a.x)},${r(a.y)}|${r(b.x)},${r(b.y)}`;
  const k2 = `${r(b.x)},${r(b.y)}|${r(a.x)},${r(a.y)}`;
  return k1 < k2 ? k1 : k2;
}

function deduplicateEdges(edges: GeneratedEdge[]): { deduped: GeneratedEdge[]; removed: number } {
  const seen = new Set<string>();
  const deduped: GeneratedEdge[] = [];
  let removed = 0;
  for (const e of edges) {
    if (e.line_px.length < 2) { removed++; continue; }
    const key = edgeKey(e.line_px[0], e.line_px[e.line_px.length - 1]);
    if (seen.has(key)) { removed++; continue; }
    // Drop zero-length edges
    if (dist(e.line_px[0], e.line_px[e.line_px.length - 1]) < 2) { removed++; continue; }
    seen.add(key);
    deduped.push(e);
  }
  return { deduped, removed };
}

// ─── VERTEX PARTITION ───────────────────────────────

function partitionVertices(
  poly: Point[],
  c: Point,
  ux: number,
  uy: number,
  _ridgeP1: Point,
  _ridgeP2: Point,
  insetFrac: number
): { leftEave: Point[]; rightEave: Point[]; hipA: Point[]; hipB: Point[] } {
  const nx = -uy, ny = ux;
  const projections = projectOntoAxis(poly, c, ux, uy);
  const minProj = Math.min(...projections);
  const maxProj = Math.max(...projections);
  const span = maxProj - minProj;

  const hipThreshLow = minProj + span * insetFrac;
  const hipThreshHigh = maxProj - span * insetFrac;

  const leftEave: Point[] = [];
  const rightEave: Point[] = [];
  const hipA: Point[] = [];
  const hipB: Point[] = [];

  const eaveZone: { p: Point; cross: number }[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const proj = projections[i];
    const cross = (p.x - c.x) * nx + (p.y - c.y) * ny;

    if (proj <= hipThreshLow) {
      hipA.push(p);
    } else if (proj >= hipThreshHigh) {
      hipB.push(p);
    } else {
      eaveZone.push({ p, cross });
    }
  }

  if (eaveZone.length > 0) {
    const crossValues = eaveZone.map((e) => e.cross).sort((a, b) => a - b);
    const medianCross = crossValues[Math.floor(crossValues.length / 2)];
    for (const e of eaveZone) {
      if (e.cross < medianCross) {
        leftEave.push(e.p);
      } else {
        rightEave.push(e.p);
      }
    }
  }

  const sortByProj = (a: Point, b: Point) => {
    const pa = (a.x - c.x) * ux + (a.y - c.y) * uy;
    const pb = (b.x - c.x) * ux + (b.y - c.y) * uy;
    return pa - pb;
  };
  leftEave.sort(sortByProj);
  rightEave.sort(sortByProj);

  const sortAngular = (pts: Point[]) => {
    if (pts.length <= 1) return;
    const hc = centroid(pts);
    pts.sort((a, b) =>
      Math.atan2(a.y - hc.y, a.x - hc.x) - Math.atan2(b.y - hc.y, b.x - hc.x)
    );
  };
  sortAngular(hipA);
  sortAngular(hipB);

  return { leftEave, rightEave, hipA, hipB };
}

// ─── BUILD EDGES FROM CLIPPED PLANES ────────────────

function buildEdgesFromClippedPlanes(
  planes: GeneratedPlane[],
  ridgeP1: Point,
  ridgeP2: Point,
  source: string
): GeneratedEdge[] {
  const edges: GeneratedEdge[] = [];

  // Ridge
  edges.push({ edge_type: "ridge", line_px: [ridgeP1, ridgeP2], source });

  // For each plane, walk its perimeter and classify edges
  for (const plane of planes) {
    const verts = plane.polygon_px;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      
      // Check if this edge segment lies on the ridge line
      if (isOnRidgeLine(a, b, ridgeP1, ridgeP2, 4)) continue; // ridge already added
      
      // Check if this edge is shared between two planes (hip)
      const shared = isSharedEdge(a, b, planes, plane.plane_index, 4);
      if (shared) {
        edges.push({ edge_type: "hip", line_px: [a, b], source });
      } else {
        edges.push({ edge_type: "eave", line_px: [a, b], source });
      }
    }
  }

  return edges;
}

function isOnRidgeLine(a: Point, b: Point, r1: Point, r2: Point, tol: number): boolean {
  // Check if both endpoints are near the ridge line
  return distToSegment(a, r1, r2) < tol && distToSegment(b, r1, r2) < tol;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function isSharedEdge(a: Point, b: Point, planes: GeneratedPlane[], excludeIdx: number, tol: number): boolean {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  for (const p of planes) {
    if (p.plane_index === excludeIdx) continue;
    // Check if midpoint of this edge is close to any edge of the other plane
    for (let i = 0; i < p.polygon_px.length; i++) {
      const c = p.polygon_px[i];
      const d = p.polygon_px[(i + 1) % p.polygon_px.length];
      if (distToSegment(mid, c, d) < tol && distToSegment(a, c, d) < tol * 2 && distToSegment(b, c, d) < tol * 2) {
        return true;
      }
    }
  }
  return false;
}

// ─── MAIN CONSTRAINT SOLVER ────────────────────────

function solveConstraint(footprint: Point[]): HybridSolverResult {
  const source = "constraint_ridge_first";
  const ccwFootprint = ensureCCW(footprint);
  const c = centroid(ccwFootprint);
  const { ux, uy } = obbLongAxis(ccwFootprint);

  const projections = projectOntoAxis(ccwFootprint, c, ux, uy);
  const minProj = Math.min(...projections);
  const maxProj = Math.max(...projections);
  const span = maxProj - minProj;

  const insetFrac = 0.25;
  const ridgeP1: Point = {
    x: c.x + ux * (minProj + span * insetFrac),
    y: c.y + uy * (minProj + span * insetFrac),
  };
  const ridgeP2: Point = {
    x: c.x + ux * (maxProj - span * insetFrac),
    y: c.y + uy * (maxProj - span * insetFrac),
  };

  const { leftEave, rightEave, hipA, hipB } = partitionVertices(
    ccwFootprint, c, ux, uy, ridgeP1, ridgeP2, insetFrac
  );

  // Build raw planes (may extend past footprint)
  const rawPlanes: GeneratedPlane[] = [];

  if (leftEave.length >= 1) {
    rawPlanes.push({
      plane_index: 1,
      polygon_px: [...leftEave, ridgeP2, ridgeP1],
      source,
    });
  }
  if (rightEave.length >= 1) {
    rawPlanes.push({
      plane_index: 2,
      polygon_px: [...rightEave, ridgeP1, ridgeP2],
      source,
    });
  }
  if (hipA.length >= 1) {
    rawPlanes.push({
      plane_index: 3,
      polygon_px: [...hipA, ridgeP1],
      source,
    });
  }
  if (hipB.length >= 1) {
    rawPlanes.push({
      plane_index: 4,
      polygon_px: [...hipB, ridgeP2],
      source,
    });
  }

  // ─── CLIP ALL PLANES TO FOOTPRINT ──────────────
  const footprintArea = Math.abs(polygonArea(ccwFootprint));
  const clippedPlanes: GeneratedPlane[] = [];
  let planesDiscarded = 0;
  let beforeAreaTotal = 0;
  let afterAreaTotal = 0;

  for (const plane of rawPlanes) {
    const beforeArea = Math.abs(polygonArea(plane.polygon_px));
    beforeAreaTotal += beforeArea;

    const clipped = clipPolygon(plane.polygon_px, ccwFootprint);
    if (clipped.length < 3) { planesDiscarded++; continue; }

    const afterArea = Math.abs(polygonArea(clipped));
    if (afterArea < footprintArea * 0.05) { planesDiscarded++; continue; }

    afterAreaTotal += afterArea;
    clippedPlanes.push({ ...plane, polygon_px: clipped });
  }

  console.log("[PLANE_CLIP]", JSON.stringify({
    before_area: Math.round(beforeAreaTotal),
    after_area: Math.round(afterAreaTotal),
    footprint_area: Math.round(footprintArea),
    planes_kept: clippedPlanes.length,
    planes_discarded: planesDiscarded,
  }));

  // ─── BUILD EDGES FROM CLIPPED PLANES ───────────
  const rawEdges = buildEdgesFromClippedPlanes(clippedPlanes, ridgeP1, ridgeP2, source);

  // ─── DEDUPLICATE EDGES ─────────────────────────
  const { deduped, removed } = deduplicateEdges(rawEdges);

  console.log("[EDGE_DEDUPE]", JSON.stringify({
    raw_edges: rawEdges.length,
    deduped_edges: deduped.length,
    removed_duplicates: removed,
  }));

  // ─── AREA CONSISTENCY CHECK ────────────────────
  const sumPlaneArea = clippedPlanes.reduce((s, p) => s + Math.abs(polygonArea(p.polygon_px)), 0);
  const areaRatio = sumPlaneArea / (footprintArea || 1);
  if (areaRatio < 0.9 || areaRatio > 1.1) {
    console.warn("[AREA_CHECK] plane_area_mismatch", JSON.stringify({
      sum_plane_area: Math.round(sumPlaneArea),
      footprint_area: Math.round(footprintArea),
      ratio: areaRatio.toFixed(3),
    }));
  } else {
    console.log("[AREA_CHECK] OK", JSON.stringify({
      ratio: areaRatio.toFixed(3),
    }));
  }

  return {
    planes: clippedPlanes,
    edges: deduped,
    ridgeLine: { p1: ridgeP1, p2: ridgeP2 },
    roofType: clippedPlanes.length <= 2 ? "gable" : "hip",
    debug: {
      method: "constraint_ridge_first",
      vertex_count: footprint.length,
      planes: clippedPlanes.length,
      ridge_length: dist(ridgeP1, ridgeP2),
      area_ratio: areaRatio.toFixed(3),
      edge_dedup: { raw: rawEdges.length, final: deduped.length, removed },
      partition: {
        leftEave: leftEave.length,
        rightEave: rightEave.length,
        hipA: hipA.length,
        hipB: hipB.length,
      },
    },
  };
}

// ─── MAIN EXPORT ────────────────────────────────

export function solveHybridRoof(footprint: Point[]): HybridSolverResult {
  if (footprint.length < 3) {
    return {
      planes: [],
      edges: [],
      ridgeLine: null,
      roofType: "complex",
      debug: { error: "footprint_too_small" },
    };
  }

  const result = solveConstraint(footprint);

  console.log("[CONSTRAINT_SOLVER]", JSON.stringify({
    roofType: result.roofType,
    method: result.debug.method,
    planes: result.planes.length,
    edges: result.edges.length,
    ridgeLength: result.ridgeLine ? dist(result.ridgeLine.p1, result.ridgeLine.p2) : 0,
    area_ratio: result.debug.area_ratio,
    partition: result.debug.partition,
  }));

  return result;
}
