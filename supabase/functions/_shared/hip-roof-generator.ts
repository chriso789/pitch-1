// supabase/functions/_shared/hip-roof-generator.ts
// Pure geometry hip-roof plane generator.
// Given a convex/near-convex footprint, produces triangular facets
// radiating from the centroid (or a center ridge for 4-sided roofs).
// This is the UPSTREAM replacement for single-plane fallback on pitched roofs.

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

type HipRoofResult = {
  planes: GeneratedPlane[];
  edges: GeneratedEdge[];
  ridgeLine: { p1: Point; p2: Point } | null;
  debug: Record<string, unknown>;
};

function centroid(poly: Point[]): Point {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: y / poly.length };
}

function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * For a 4-sided footprint, find the longest axis and create a center ridge
 * parallel to it, then build 2 trapezoids + 2 triangles.
 * For other polygon counts, fall back to centroid fan (triangular facets).
 */
export function generateHipRoofPlanes(footprint: Point[]): HipRoofResult {
  if (footprint.length < 3) {
    return { planes: [], edges: [], ridgeLine: null, debug: { error: "footprint_too_small" } };
  }

  const source = "hip_roof_generator";

  // ── 4-sided: proper hip roof with center ridge ──
  if (footprint.length === 4) {
    return generate4SidedHipRoof(footprint, source);
  }

  // ── N-sided: centroid fan producing N triangular facets ──
  return generateCentroidFan(footprint, source);
}

function generate4SidedHipRoof(fp: Point[], source: string): HipRoofResult {
  // Find the two longest opposite edges to determine the ridge axis.
  // Pair edges: 0-1 vs 2-3, and 1-2 vs 3-0
  const edges = [
    { a: fp[0], b: fp[1], len: dist(fp[0], fp[1]) },
    { a: fp[1], b: fp[2], len: dist(fp[1], fp[2]) },
    { a: fp[2], b: fp[3], len: dist(fp[2], fp[3]) },
    { a: fp[3], b: fp[0], len: dist(fp[3], fp[0]) },
  ];

  // Determine which pair of opposite sides is longer (those become eaves)
  const pairA = edges[0].len + edges[2].len; // sides 0-1 and 2-3
  const pairB = edges[1].len + edges[3].len; // sides 1-2 and 3-0

  let eaveEdgeIdxs: [number, number];
  let hipEdgeIdxs: [number, number];

  if (pairA >= pairB) {
    eaveEdgeIdxs = [0, 2]; // longer pair = eaves
    hipEdgeIdxs = [1, 3];  // shorter pair = hip ends
  } else {
    eaveEdgeIdxs = [1, 3];
    hipEdgeIdxs = [0, 2];
  }

  // Ridge endpoints: inset from the midpoints of the hip (shorter) edges
  // Ridge runs parallel to the eave edges, set back ~30% from each hip edge
  const hipMid0 = midpoint(edges[hipEdgeIdxs[0]].a, edges[hipEdgeIdxs[0]].b);
  const hipMid1 = midpoint(edges[hipEdgeIdxs[1]].a, edges[hipEdgeIdxs[1]].b);

  const insetRatio = 0.30;
  const ridgeP1: Point = {
    x: hipMid0.x + (hipMid1.x - hipMid0.x) * insetRatio,
    y: hipMid0.y + (hipMid1.y - hipMid0.y) * insetRatio,
  };
  const ridgeP2: Point = {
    x: hipMid1.x + (hipMid0.x - hipMid1.x) * insetRatio,
    y: hipMid1.y + (hipMid0.y - hipMid1.y) * insetRatio,
  };

  // Build 4 planes:
  // 2 trapezoids (eave side → ridge) and 2 triangles (hip end → ridge point)
  const e0 = edges[eaveEdgeIdxs[0]];
  const e2 = edges[eaveEdgeIdxs[1]];

  // Determine which ridge point is closest to which hip edge
  const d0_r1 = dist(hipMid0, ridgeP1);
  const d0_r2 = dist(hipMid0, ridgeP2);
  const nearRidgeForHip0 = d0_r1 <= d0_r2 ? ridgeP1 : ridgeP2;
  const nearRidgeForHip1 = nearRidgeForHip0 === ridgeP1 ? ridgeP2 : ridgeP1;

  // Trapezoid 1: eave edge 0 → ridge
  // Trapezoid 2: eave edge 2 → ridge (reversed winding)
  // Triangle 1: hip edge 0 → nearest ridge point
  // Triangle 2: hip edge 1 → nearest ridge point
  const planes: GeneratedPlane[] = [
    { plane_index: 1, polygon_px: [e0.a, e0.b, ridgeP2, ridgeP1], source },
    { plane_index: 2, polygon_px: [e2.a, e2.b, ridgeP1, ridgeP2], source },
    { plane_index: 3, polygon_px: [edges[hipEdgeIdxs[0]].a, edges[hipEdgeIdxs[0]].b, nearRidgeForHip0], source },
    { plane_index: 4, polygon_px: [edges[hipEdgeIdxs[1]].a, edges[hipEdgeIdxs[1]].b, nearRidgeForHip1], source },
  ];

  const genEdges: GeneratedEdge[] = [
    // Ridge
    { edge_type: "ridge", line_px: [ridgeP1, ridgeP2], source: `${source}_ridge` },
    // 4 hip lines from ridge endpoints to corners
    { edge_type: "hip", line_px: [nearRidgeForHip0, edges[hipEdgeIdxs[0]].a], source: `${source}_hip` },
    { edge_type: "hip", line_px: [nearRidgeForHip0, edges[hipEdgeIdxs[0]].b], source: `${source}_hip` },
    { edge_type: "hip", line_px: [nearRidgeForHip1, edges[hipEdgeIdxs[1]].a], source: `${source}_hip` },
    { edge_type: "hip", line_px: [nearRidgeForHip1, edges[hipEdgeIdxs[1]].b], source: `${source}_hip` },
    // 4 eave edges (perimeter)
    ...edges.map(e => ({ edge_type: "eave" as const, line_px: [e.a, e.b], source: `${source}_eave` })),
  ];

  return {
    planes,
    edges: genEdges,
    ridgeLine: { p1: ridgeP1, p2: ridgeP2 },
    debug: {
      method: "4_sided_hip",
      eave_pair: pairA >= pairB ? "0-2" : "1-3",
      ridge_length_px: dist(ridgeP1, ridgeP2),
      plane_count: 4,
    },
  };
}

function generateCentroidFan(footprint: Point[], source: string): HipRoofResult {
  const c = centroid(footprint);
  const planes: GeneratedPlane[] = [];
  const genEdges: GeneratedEdge[] = [];

  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    planes.push({ plane_index: i + 1, polygon_px: [c, a, b], source });
    // Hip edge from centroid to each corner
    genEdges.push({ edge_type: "hip", line_px: [c, a], source: `${source}_hip` });
    // Eave edge along perimeter
    genEdges.push({ edge_type: "eave", line_px: [a, b], source: `${source}_eave` });
  }

  return {
    planes,
    edges: genEdges,
    ridgeLine: null, // centroid fan has no linear ridge
    debug: {
      method: "centroid_fan",
      vertex_count: footprint.length,
      plane_count: planes.length,
    },
  };
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
