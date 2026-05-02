// supabase/functions/_shared/hybrid-roof-solver.ts
// Constraint-based roof solver: Ridge defines planes, planes define edges.
// v3: Vertex snapping + exact edge adjacency for reliable ridge/hip/valley classification.

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
  adjacent_plane_ids?: number[];
};

type HybridSolverResult = {
  planes: GeneratedPlane[];
  edges: GeneratedEdge[];
  ridgeLine: { p1: Point; p2: Point } | null;
  roofType: "gable" | "hip" | "complex";
  debug: Record<string, unknown>;
};

// ─── GEOMETRY HELPERS ───────────────────────────────

const SNAP_GRID = 2; // px — all vertices snap to this grid

function snap(p: Point): Point {
  return {
    x: Math.round(p.x / SNAP_GRID) * SNAP_GRID,
    y: Math.round(p.y / SNAP_GRID) * SNAP_GRID,
  };
}

function snapPoly(poly: Point[]): Point[] {
  return poly.map(snap);
}

function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function centroid(poly: Point[]): Point {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: y / poly.length };
}

function polygonArea(poly: Point[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return area / 2;
}

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

function projectOntoAxis(poly: Point[], c: Point, ux: number, uy: number): number[] {
  return poly.map((p) => (p.x - c.x) * ux + (p.y - c.y) * uy);
}

// ─── SUTHERLAND-HODGMAN POLYGON CLIPPING ────────────

function clipPolygonByEdge(polygon: Point[], edgeA: Point, edgeB: Point): Point[] {
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

function clipPolygon(subject: Point[], clip: Point[]): Point[] {
  let output = [...subject];
  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0) break;
    output = clipPolygonByEdge(output, clip[i], clip[(i + 1) % clip.length]);
  }
  return output;
}

function ensureCCW(poly: Point[]): Point[] {
  if (polygonArea(poly) < 0) return [...poly].reverse();
  return poly;
}

// ─── CANONICAL EDGE KEY (EXACT MATCH AFTER SNAP) ────

function ptKey(p: Point): string {
  return `${p.x},${p.y}`;
}

function canonicalEdgeKey(a: Point, b: Point): string {
  const ka = ptKey(a);
  const kb = ptKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

// ─── EDGE CLASSIFICATION VIA ADJACENCY GRAPH ────────

function classifyEdgesFromPlanes(
  planes: GeneratedPlane[],
  ridgeP1: Point,
  ridgeP2: Point,
  source: string
): GeneratedEdge[] {
  // Build adjacency: for every edge segment, record which plane IDs touch it
  const adjacency = new Map<string, Set<number>>();

  for (const plane of planes) {
    const verts = plane.polygon_px;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const key = canonicalEdgeKey(a, b);
      if (!adjacency.has(key)) adjacency.set(key, new Set());
      adjacency.get(key)!.add(plane.plane_index);
    }
  }

  const snappedR1 = snap(ridgeP1);
  const snappedR2 = snap(ridgeP2);

  const edges: GeneratedEdge[] = [];
  const emittedKeys = new Set<string>();

  for (const [key, planeIds] of adjacency.entries()) {
    if (emittedKeys.has(key)) continue;
    emittedKeys.add(key);

    // Parse the two endpoints back out
    const [partA, partB] = key.split("|");
    const [ax, ay] = partA.split(",").map(Number);
    const [bx, by] = partB.split(",").map(Number);
    const a: Point = { x: ax, y: ay };
    const b: Point = { x: bx, y: by };

    // Skip zero-length
    if (dist(a, b) < 1) continue;

    if (planeIds.size >= 2) {
      // Shared edge: ridge or hip
      // Is it on the ridge line?
      if (isOnRidgeLine(a, b, snappedR1, snappedR2, SNAP_GRID + 1)) {
        edges.push({ edge_type: "ridge", line_px: [a, b], source, adjacent_plane_ids: [...planeIds] });
      } else {
        edges.push({ edge_type: "hip", line_px: [a, b], source, adjacent_plane_ids: [...planeIds] });
      }
    } else {
      // Unshared edge = eave (boundary of single plane = exterior)
      edges.push({ edge_type: "eave", line_px: [a, b], source, adjacent_plane_ids: [...planeIds] });
    }
  }

  console.log("[EDGE_ADJACENCY]", JSON.stringify({
    total_unique_edges: adjacency.size,
    shared_2plus: [...adjacency.values()].filter(s => s.size >= 2).length,
    emitted: edges.length,
    ridge: edges.filter(e => e.edge_type === "ridge").length,
    hip: edges.filter(e => e.edge_type === "hip").length,
    eave: edges.filter(e => e.edge_type === "eave").length,
  }));

  return edges;
}

function isOnRidgeLine(a: Point, b: Point, r1: Point, r2: Point, tol: number): boolean {
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

// ─── VERTEX PARTITION ───────────────────────────────

function partitionVertices(
  poly: Point[],
  c: Point,
  ux: number,
  uy: number,
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
      if (e.cross < medianCross) leftEave.push(e.p);
      else rightEave.push(e.p);
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

// ─── MAIN CONSTRAINT SOLVER ────────────────────────

function solveConstraint(footprint: Point[]): HybridSolverResult {
  const source = "constraint_solver_topology";
  const ccwFootprint = ensureCCW(footprint);
  const c = centroid(ccwFootprint);
  const { ux, uy } = obbLongAxis(ccwFootprint);

  const projections = projectOntoAxis(ccwFootprint, c, ux, uy);
  const minProj = Math.min(...projections);
  const maxProj = Math.max(...projections);
  const span = maxProj - minProj;

  const insetFrac = 0.25;
  // Snap ridge endpoints to the grid so they match clipped plane vertices
  const ridgeP1 = snap({
    x: c.x + ux * (minProj + span * insetFrac),
    y: c.y + uy * (minProj + span * insetFrac),
  });
  const ridgeP2 = snap({
    x: c.x + ux * (maxProj - span * insetFrac),
    y: c.y + uy * (maxProj - span * insetFrac),
  });

  const { leftEave, rightEave, hipA, hipB } = partitionVertices(
    ccwFootprint, c, ux, uy, insetFrac
  );

  // Build raw planes using snapped ridge points
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

  // ─── CLIP ALL PLANES TO FOOTPRINT, THEN SNAP ──────
  const footprintArea = Math.abs(polygonArea(ccwFootprint));
  const clippedPlanes: GeneratedPlane[] = [];
  let planesDiscarded = 0;
  let afterAreaTotal = 0;

  for (const plane of rawPlanes) {
    const clipped = clipPolygon(plane.polygon_px, ccwFootprint);
    if (clipped.length < 3) { planesDiscarded++; continue; }

    // CRITICAL: Snap all clipped vertices to the grid so shared edges have identical coords
    const snapped = snapPoly(clipped);
    const afterArea = Math.abs(polygonArea(snapped));
    if (afterArea < footprintArea * 0.05) { planesDiscarded++; continue; }

    afterAreaTotal += afterArea;
    clippedPlanes.push({ ...plane, polygon_px: snapped });
  }

  console.log("[PLANE_CLIP]", JSON.stringify({
    after_area: Math.round(afterAreaTotal),
    footprint_area: Math.round(footprintArea),
    planes_kept: clippedPlanes.length,
    planes_discarded: planesDiscarded,
  }));

  // ─── CLASSIFY EDGES VIA EXACT ADJACENCY ────────
  const edges = classifyEdgesFromPlanes(clippedPlanes, ridgeP1, ridgeP2, source);

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
    console.log("[AREA_CHECK] OK", JSON.stringify({ ratio: areaRatio.toFixed(3) }));
  }

  return {
    planes: clippedPlanes,
    edges,
    ridgeLine: { p1: ridgeP1, p2: ridgeP2 },
    roofType: clippedPlanes.length <= 2 ? "gable" : "hip",
    debug: {
      method: "constraint_ridge_first",
      vertex_count: footprint.length,
      planes: clippedPlanes.length,
      ridge_length: dist(ridgeP1, ridgeP2),
      area_ratio: areaRatio.toFixed(3),
      edges_total: edges.length,
      edges_ridge: edges.filter(e => e.edge_type === "ridge").length,
      edges_hip: edges.filter(e => e.edge_type === "hip").length,
      edges_eave: edges.filter(e => e.edge_type === "eave").length,
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
    planes: result.planes.length,
    edges: result.edges.length,
    ridge: result.debug.edges_ridge,
    hip: result.debug.edges_hip,
    eave: result.debug.edges_eave,
    ridgeLength: result.ridgeLine ? dist(result.ridgeLine.p1, result.ridgeLine.p2) : 0,
    area_ratio: result.debug.area_ratio,
  }));

  return result;
}
