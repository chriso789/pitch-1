// supabase/functions/_shared/multi-structure-roof-solver.ts
// Multi-structure roof solver: uses detected ridge hints from imagery
// to produce unique per-roof topology instead of a generic OBB template.

type Point = { x: number; y: number };

type RidgeHint = {
  p1: Point;
  p2: Point;
  score?: number;
};

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

type MultiStructureResult = {
  planes: GeneratedPlane[];
  edges: GeneratedEdge[];
  ridgeLine: { p1: Point; p2: Point } | null;
  roofType: "gable" | "hip" | "complex";
  debug: Record<string, unknown>;
};

// ─── GEOMETRY HELPERS ───────────────────────────────

const SNAP_GRID = 2;

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

function ensureCCW(poly: Point[]): Point[] {
  if (polygonArea(poly) < 0) return [...poly].reverse();
  return poly;
}

// ─── SUTHERLAND-HODGMAN POLYGON CLIPPING ────────────

function intersect(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
  return { x: a1.x + t * dx1, y: a1.y + t * dy1 };
}

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

function clipPolygon(subject: Point[], clip: Point[]): Point[] {
  let output = [...subject];
  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0) break;
    output = clipPolygonByEdge(output, clip[i], clip[(i + 1) % clip.length]);
  }
  return output;
}

// ─── RIDGE PROCESSING ───────────────────────────────

/** Extend a ridge line to span across the full footprint bounding box */
function extendRidgeToFootprint(ridge: RidgeHint, footprint: Point[]): { p1: Point; p2: Point } {
  const dx = ridge.p2.x - ridge.p1.x;
  const dy = ridge.p2.y - ridge.p1.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return { p1: ridge.p1, p2: ridge.p2 };
  
  const ux = dx / len;
  const uy = dy / len;
  
  // Find the footprint span along the ridge direction
  const c = { x: (ridge.p1.x + ridge.p2.x) / 2, y: (ridge.p1.y + ridge.p2.y) / 2 };
  let minProj = Infinity, maxProj = -Infinity;
  for (const p of footprint) {
    const proj = (p.x - c.x) * ux + (p.y - c.y) * uy;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }
  
  // Inset the ridge endpoints to ~25% from the edges (hip inset)
  const span = maxProj - minProj;
  const inset = span * 0.20;
  
  return {
    p1: snap({ x: c.x + ux * (minProj + inset), y: c.y + uy * (minProj + inset) }),
    p2: snap({ x: c.x + ux * (maxProj - inset), y: c.y + uy * (maxProj - inset) }),
  };
}

/** Cluster ridges by angle similarity */
function clusterRidgesByAngle(ridges: RidgeHint[], angleTolRad = 0.35): RidgeHint[][] {
  const clusters: RidgeHint[][] = [];
  
  for (const r of ridges) {
    const angle = Math.atan2(r.p2.y - r.p1.y, r.p2.x - r.p1.x);
    let added = false;
    
    for (const cluster of clusters) {
      const refAngle = Math.atan2(
        cluster[0].p2.y - cluster[0].p1.y,
        cluster[0].p2.x - cluster[0].p1.x
      );
      // Compare angles (accounting for 180° equivalence)
      let diff = Math.abs(angle - refAngle);
      if (diff > Math.PI / 2) diff = Math.PI - diff;
      
      if (diff < angleTolRad) {
        cluster.push(r);
        added = true;
        break;
      }
    }
    
    if (!added) clusters.push([r]);
  }
  
  return clusters;
}

/** Pick the best ridge from a cluster (longest or highest score) */
function pickBestRidge(cluster: RidgeHint[]): RidgeHint {
  return cluster.reduce((best, r) => {
    const bestLen = dist(best.p1, best.p2);
    const rLen = dist(r.p1, r.p2);
    const bestScore = (best.score ?? 0) + bestLen;
    const rScore = (r.score ?? 0) + rLen;
    return rScore > bestScore ? r : best;
  });
}

// ─── PLANE BUILDING FROM RIDGE ──────────────────────

/**
 * Split a footprint into 4 planes (hip roof) given a ridge line.
 * Uses perpendicular classification: vertices on each side of ridge → eave planes,
 * vertices near ridge endpoints → hip triangles.
 */
function buildPlanesFromRidge(
  footprint: Point[],
  ridgeP1: Point,
  ridgeP2: Point,
  planeOffset: number,
  source: string
): GeneratedPlane[] {
  const ccw = ensureCCW(footprint);
  
  // Ridge direction
  const rdx = ridgeP2.x - ridgeP1.x;
  const rdy = ridgeP2.y - ridgeP1.y;
  const rlen = Math.sqrt(rdx * rdx + rdy * rdy);
  if (rlen < 1) return [];
  
  const ux = rdx / rlen; // along ridge
  const uy = rdy / rlen;
  const nx = -uy;        // perpendicular to ridge
  const ny = ux;
  
  const rc = { x: (ridgeP1.x + ridgeP2.x) / 2, y: (ridgeP1.y + ridgeP2.y) / 2 };
  
  // Project each footprint vertex onto ridge-parallel and ridge-perpendicular axes
  const projAlong = ccw.map(p => (p.x - rc.x) * ux + (p.y - rc.y) * uy);
  const projPerp = ccw.map(p => (p.x - rc.x) * nx + (p.y - rc.y) * ny);
  
  const minAlong = Math.min(...projAlong);
  const maxAlong = Math.max(...projAlong);
  const spanAlong = maxAlong - minAlong;
  
  // Ridge endpoints in along-projection space
  const rp1Along = (ridgeP1.x - rc.x) * ux + (ridgeP1.y - rc.y) * uy;
  const rp2Along = (ridgeP2.x - rc.x) * ux + (ridgeP2.y - rc.y) * uy;
  const ridgeMinAlong = Math.min(rp1Along, rp2Along);
  const ridgeMaxAlong = Math.max(rp1Along, rp2Along);
  
  // Classify vertices into 4 groups
  const leftEave: Point[] = [];   // perpendicular < 0, between ridge endpoints
  const rightEave: Point[] = [];  // perpendicular > 0, between ridge endpoints
  const hipA: Point[] = [];       // beyond ridge endpoint A
  const hipB: Point[] = [];       // beyond ridge endpoint B
  
  for (let i = 0; i < ccw.length; i++) {
    const along = projAlong[i];
    const perp = projPerp[i];
    
    if (along < ridgeMinAlong - spanAlong * 0.05) {
      hipA.push(ccw[i]);
    } else if (along > ridgeMaxAlong + spanAlong * 0.05) {
      hipB.push(ccw[i]);
    } else if (perp < 0) {
      leftEave.push(ccw[i]);
    } else {
      rightEave.push(ccw[i]);
    }
  }
  
  // Sort eave vertices along ridge direction
  const sortByAlong = (pts: Point[]) => pts.sort((a, b) => {
    const pa = (a.x - rc.x) * ux + (a.y - rc.y) * uy;
    const pb = (b.x - rc.x) * ux + (b.y - rc.y) * uy;
    return pa - pb;
  });
  sortByAlong(leftEave);
  sortByAlong(rightEave);
  
  const planes: GeneratedPlane[] = [];
  
  // Left eave trapezoid
  if (leftEave.length >= 1) {
    planes.push({
      plane_index: planeOffset + 1,
      polygon_px: [...leftEave, ridgeP2, ridgeP1],
      source,
    });
  }
  // Right eave trapezoid
  if (rightEave.length >= 1) {
    planes.push({
      plane_index: planeOffset + 2,
      polygon_px: [...rightEave, ridgeP1, ridgeP2],
      source,
    });
  }
  // Hip triangle A
  if (hipA.length >= 1) {
    planes.push({
      plane_index: planeOffset + 3,
      polygon_px: [...hipA, ridgeP1],
      source,
    });
  }
  // Hip triangle B
  if (hipB.length >= 1) {
    planes.push({
      plane_index: planeOffset + 4,
      polygon_px: [...hipB, ridgeP2],
      source,
    });
  }
  
  return planes;
}

// ─── EDGE CLASSIFICATION ────────────────────────────

function ptKey(p: Point): string {
  return `${p.x},${p.y}`;
}

function canonicalEdgeKey(a: Point, b: Point): string {
  const ka = ptKey(a);
  const kb = ptKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function classifyEdgesFromPlanes(
  planes: GeneratedPlane[],
  ridgeLines: { p1: Point; p2: Point }[],
  source: string
): GeneratedEdge[] {
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

  const edges: GeneratedEdge[] = [];
  const emittedKeys = new Set<string>();

  for (const [key, planeIds] of adjacency.entries()) {
    if (emittedKeys.has(key)) continue;
    emittedKeys.add(key);

    const [partA, partB] = key.split("|");
    const [ax, ay] = partA.split(",").map(Number);
    const [bx, by] = partB.split(",").map(Number);
    const a: Point = { x: ax, y: ay };
    const b: Point = { x: bx, y: by };

    if (dist(a, b) < 1) continue;

    if (planeIds.size >= 2) {
      // Check if this edge is on any ridge line
      const isRidge = ridgeLines.some(
        rl => distToSegment(a, rl.p1, rl.p2) < SNAP_GRID + 2 &&
              distToSegment(b, rl.p1, rl.p2) < SNAP_GRID + 2
      );
      edges.push({
        edge_type: isRidge ? "ridge" : "hip",
        line_px: [a, b],
        source,
        adjacent_plane_ids: [...planeIds],
      });
    } else {
      edges.push({
        edge_type: "eave",
        line_px: [a, b],
        source,
        adjacent_plane_ids: [...planeIds],
      });
    }
  }

  return edges;
}

// ─── MAIN MULTI-STRUCTURE SOLVER ────────────────────

export function solveMultiStructureRoof(
  footprint: Point[],
  ridgeHints: RidgeHint[]
): MultiStructureResult {
  const source = "constraint_solver_topology";
  
  if (footprint.length < 3) {
    return { planes: [], edges: [], ridgeLine: null, roofType: "complex", debug: { error: "footprint_too_small" } };
  }
  
  // Filter out noise ridges (too short)
  const validRidges = ridgeHints.filter(r => dist(r.p1, r.p2) > 30);
  
  if (validRidges.length === 0) {
    console.log("[MULTI_STRUCTURE_SOLVER] No valid ridge hints, returning empty");
    return { planes: [], edges: [], ridgeLine: null, roofType: "complex", debug: { error: "no_valid_ridge_hints" } };
  }
  
  const ccwFootprint = ensureCCW(footprint);
  const footprintArea = Math.abs(polygonArea(ccwFootprint));
  
  // Cluster ridges by angle
  const clusters = clusterRidgesByAngle(validRidges);
  
  console.log("[MULTI_STRUCTURE_SOLVER] Ridge clustering", JSON.stringify({
    input_ridges: validRidges.length,
    clusters: clusters.length,
    cluster_sizes: clusters.map(c => c.length),
  }));
  
  // For each cluster, pick the best ridge and extend it
  const ridgeSystems: { original: RidgeHint; extended: { p1: Point; p2: Point } }[] = [];
  
  for (const cluster of clusters) {
    const best = pickBestRidge(cluster);
    const extended = extendRidgeToFootprint(best, ccwFootprint);
    ridgeSystems.push({ original: best, extended });
  }
  
  // Build planes per ridge system
  let allPlanes: GeneratedPlane[] = [];
  const allRidgeLines: { p1: Point; p2: Point }[] = [];
  
  for (let i = 0; i < ridgeSystems.length; i++) {
    const { extended } = ridgeSystems[i];
    const planes = buildPlanesFromRidge(
      ccwFootprint,
      extended.p1,
      extended.p2,
      i * 4, // offset plane indices
      source
    );
    
    // Clip all planes to footprint and snap
    for (const plane of planes) {
      const clipped = clipPolygon(plane.polygon_px, ccwFootprint);
      if (clipped.length < 3) continue;
      const snapped = snapPoly(clipped);
      const area = Math.abs(polygonArea(snapped));
      if (area < footprintArea * 0.04) continue;
      allPlanes.push({ ...plane, polygon_px: snapped });
    }
    
    allRidgeLines.push(extended);
  }
  
  // If multiple ridge systems produced overlapping planes, keep the first valid set
  // For now, if we have a single ridge system, use it directly
  if (ridgeSystems.length === 1 && allPlanes.length >= 3) {
    // Single ridge system — standard hip roof
    const edges = classifyEdgesFromPlanes(allPlanes, allRidgeLines, source);
    
    const primaryRidge = ridgeSystems[0].extended;
    
    const result: MultiStructureResult = {
      planes: allPlanes,
      edges,
      ridgeLine: { p1: primaryRidge.p1, p2: primaryRidge.p2 },
      roofType: allPlanes.length <= 2 ? "gable" : "hip",
      debug: {
        method: "multi_structure_ridge_hint",
        ridge_systems: ridgeSystems.length,
        planes: allPlanes.length,
        edges_total: edges.length,
        edges_ridge: edges.filter(e => e.edge_type === "ridge").length,
        edges_hip: edges.filter(e => e.edge_type === "hip").length,
        edges_eave: edges.filter(e => e.edge_type === "eave").length,
        ridge_hint_used: {
          p1: primaryRidge.p1,
          p2: primaryRidge.p2,
          length: dist(primaryRidge.p1, primaryRidge.p2),
        },
      },
    };
    
    // Area check
    const sumArea = allPlanes.reduce((s, p) => s + Math.abs(polygonArea(p.polygon_px)), 0);
    const areaRatio = sumArea / (footprintArea || 1);
    (result.debug as any).area_ratio = areaRatio.toFixed(3);
    
    if (areaRatio < 0.85 || areaRatio > 1.15) {
      console.warn("[MULTI_STRUCTURE_SOLVER] area mismatch", { ratio: areaRatio.toFixed(3) });
    }
    
    console.log("[MULTI_STRUCTURE_SOLVER] Result", JSON.stringify({
      planes: allPlanes.length,
      edges: edges.length,
      ridge: edges.filter(e => e.edge_type === "ridge").length,
      hip: edges.filter(e => e.edge_type === "hip").length,
      eave: edges.filter(e => e.edge_type === "eave").length,
      area_ratio: areaRatio.toFixed(3),
    }));
    
    return result;
  }
  
  // Multiple ridge systems or insufficient planes — return what we have
  if (allPlanes.length >= 3) {
    const edges = classifyEdgesFromPlanes(allPlanes, allRidgeLines, source);
    return {
      planes: allPlanes,
      edges,
      ridgeLine: allRidgeLines[0] ? { p1: allRidgeLines[0].p1, p2: allRidgeLines[0].p2 } : null,
      roofType: "complex",
      debug: {
        method: "multi_structure_multi_ridge",
        ridge_systems: ridgeSystems.length,
        planes: allPlanes.length,
        edges: edges.length,
      },
    };
  }
  
  console.log("[MULTI_STRUCTURE_SOLVER] Insufficient planes from ridge hints", { planes: allPlanes.length });
  return { planes: [], edges: [], ridgeLine: null, roofType: "complex", debug: { error: "insufficient_planes", planes: allPlanes.length } };
}
