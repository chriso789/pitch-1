// supabase/functions/_shared/hybrid-roof-solver.ts
// Hybrid roof solver: type-aware topology generation.
// Replaces centroid-fan starburst with proper ridge-based (gable)
// or corner-based hip geometry depending on footprint shape.

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

function centroid(poly: Point[]): Point {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: y / poly.length };
}

function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Find the two footprint vertices forming the longest diagonal. */
function longestAxis(poly: Point[]): [Point, Point] {
  let max = 0;
  let best: [Point, Point] = [poly[0], poly[1]];
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 1; j < poly.length; j++) {
      const d = dist(poly[i], poly[j]);
      if (d > max) { max = d; best = [poly[i], poly[j]]; }
    }
  }
  return best;
}

// ─── ROOF TYPE DETECTION ───────────────────────────

function detectRoofType(footprint: Point[]): "gable" | "hip" | "complex" {
  // Simplify noisy footprints: if >8 vertices, treat as complex
  if (footprint.length > 8) return "complex";
  if (footprint.length === 4) return "gable";
  if (footprint.length >= 5 && footprint.length <= 8) return "hip";
  return "complex";
}

// ─── GABLE SOLVER (4-sided, ridge-based) ────────────

function solveGable(footprint: Point[]): HybridSolverResult {
  const source = "hybrid_gable";
  const edges_arr = [
    { a: footprint[0], b: footprint[1], len: dist(footprint[0], footprint[1]) },
    { a: footprint[1], b: footprint[2], len: dist(footprint[1], footprint[2]) },
    { a: footprint[2], b: footprint[3], len: dist(footprint[2], footprint[3]) },
    { a: footprint[3], b: footprint[0], len: dist(footprint[3], footprint[0]) },
  ];

  // Longer opposite pair = eaves, shorter pair = gable ends
  const pairA = edges_arr[0].len + edges_arr[2].len;
  const pairB = edges_arr[1].len + edges_arr[3].len;

  let eaveIdxs: [number, number];
  let gableIdxs: [number, number];
  if (pairA >= pairB) {
    eaveIdxs = [0, 2];
    gableIdxs = [1, 3];
  } else {
    eaveIdxs = [1, 3];
    gableIdxs = [0, 2];
  }

  // Ridge runs between midpoints of the two gable (shorter) edges
  const ridgeP1 = midpoint(edges_arr[gableIdxs[0]].a, edges_arr[gableIdxs[0]].b);
  const ridgeP2 = midpoint(edges_arr[gableIdxs[1]].a, edges_arr[gableIdxs[1]].b);

  // 2 planes: each eave edge → ridge
  const e0 = edges_arr[eaveIdxs[0]];
  const e2 = edges_arr[eaveIdxs[1]];

  const planes: GeneratedPlane[] = [
    { plane_index: 1, polygon_px: [e0.a, e0.b, ridgeP2, ridgeP1], source },
    { plane_index: 2, polygon_px: [e2.a, e2.b, ridgeP1, ridgeP2], source },
  ];

  const genEdges: GeneratedEdge[] = [
    { edge_type: "ridge", line_px: [ridgeP1, ridgeP2], source },
    // Rakes at gable ends
    { edge_type: "eave", line_px: [e0.a, e0.b], source },
    { edge_type: "eave", line_px: [e2.a, e2.b], source },
    { edge_type: "eave", line_px: [edges_arr[gableIdxs[0]].a, edges_arr[gableIdxs[0]].b], source },
    { edge_type: "eave", line_px: [edges_arr[gableIdxs[1]].a, edges_arr[gableIdxs[1]].b], source },
  ];

  return {
    planes,
    edges: genEdges,
    ridgeLine: { p1: ridgeP1, p2: ridgeP2 },
    roofType: "gable",
    debug: { method: "gable_ridge", planes: 2, ridge_length: dist(ridgeP1, ridgeP2) },
  };
}

// ─── HIP SOLVER (4-sided with inset ridge + hip lines) ────────────

function solveHip4(footprint: Point[]): HybridSolverResult {
  const source = "hybrid_hip4";
  const edges_arr = [
    { a: footprint[0], b: footprint[1], len: dist(footprint[0], footprint[1]) },
    { a: footprint[1], b: footprint[2], len: dist(footprint[1], footprint[2]) },
    { a: footprint[2], b: footprint[3], len: dist(footprint[2], footprint[3]) },
    { a: footprint[3], b: footprint[0], len: dist(footprint[3], footprint[0]) },
  ];

  const pairA = edges_arr[0].len + edges_arr[2].len;
  const pairB = edges_arr[1].len + edges_arr[3].len;

  let eaveIdxs: [number, number];
  let hipIdxs: [number, number];
  if (pairA >= pairB) {
    eaveIdxs = [0, 2];
    hipIdxs = [1, 3];
  } else {
    eaveIdxs = [1, 3];
    hipIdxs = [0, 2];
  }

  // Ridge inset 30% from each hip end
  const hipMid0 = midpoint(edges_arr[hipIdxs[0]].a, edges_arr[hipIdxs[0]].b);
  const hipMid1 = midpoint(edges_arr[hipIdxs[1]].a, edges_arr[hipIdxs[1]].b);
  const inset = 0.30;
  const ridgeP1: Point = {
    x: hipMid0.x + (hipMid1.x - hipMid0.x) * inset,
    y: hipMid0.y + (hipMid1.y - hipMid0.y) * inset,
  };
  const ridgeP2: Point = {
    x: hipMid1.x + (hipMid0.x - hipMid1.x) * inset,
    y: hipMid1.y + (hipMid0.y - hipMid1.y) * inset,
  };

  // Determine which ridge point is closest to which hip edge
  const nearR0 = dist(hipMid0, ridgeP1) <= dist(hipMid0, ridgeP2) ? ridgeP1 : ridgeP2;
  const nearR1 = nearR0 === ridgeP1 ? ridgeP2 : ridgeP1;

  const e0 = edges_arr[eaveIdxs[0]];
  const e2 = edges_arr[eaveIdxs[1]];

  const planes: GeneratedPlane[] = [
    { plane_index: 1, polygon_px: [e0.a, e0.b, ridgeP2, ridgeP1], source },
    { plane_index: 2, polygon_px: [e2.a, e2.b, ridgeP1, ridgeP2], source },
    { plane_index: 3, polygon_px: [edges_arr[hipIdxs[0]].a, edges_arr[hipIdxs[0]].b, nearR0], source },
    { plane_index: 4, polygon_px: [edges_arr[hipIdxs[1]].a, edges_arr[hipIdxs[1]].b, nearR1], source },
  ];

  const genEdges: GeneratedEdge[] = [
    { edge_type: "ridge", line_px: [ridgeP1, ridgeP2], source },
    { edge_type: "hip", line_px: [nearR0, edges_arr[hipIdxs[0]].a], source },
    { edge_type: "hip", line_px: [nearR0, edges_arr[hipIdxs[0]].b], source },
    { edge_type: "hip", line_px: [nearR1, edges_arr[hipIdxs[1]].a], source },
    { edge_type: "hip", line_px: [nearR1, edges_arr[hipIdxs[1]].b], source },
    ...edges_arr.map(e => ({ edge_type: "eave" as const, line_px: [e.a, e.b], source })),
  ];

  return {
    planes,
    edges: genEdges,
    ridgeLine: { p1: ridgeP1, p2: ridgeP2 },
    roofType: "hip",
    debug: { method: "hip4_ridge_inset", planes: 4, ridge_length: dist(ridgeP1, ridgeP2) },
  };
}

// ─── HIP SOLVER (N-sided, ridge + hip lines via OBB) ────────────

function solveHipN(footprint: Point[]): HybridSolverResult {
  const source = "hybrid_hipN";

  // Find longest axis of the footprint to define the ridge direction
  const [axA, axB] = longestAxis(footprint);
  const c = centroid(footprint);

  // Ridge runs through centroid, parallel to longest axis, inset 30% from ends
  const dx = axB.x - axA.x;
  const dy = axB.y - axA.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len;
  const uy = dy / len;

  // Project all vertices onto the ridge axis to find extent
  const projections = footprint.map(p => (p.x - c.x) * ux + (p.y - c.y) * uy);
  const minProj = Math.min(...projections);
  const maxProj = Math.max(...projections);
  const span = maxProj - minProj;

  const inset = 0.25;
  const ridgeP1: Point = {
    x: c.x + ux * (minProj + span * inset),
    y: c.y + uy * (minProj + span * inset),
  };
  const ridgeP2: Point = {
    x: c.x + ux * (maxProj - span * inset),
    y: c.y + uy * (maxProj - span * inset),
  };

  // Classify each footprint vertex as "near ridgeP1 end" or "near ridgeP2 end" or "along eave"
  // Create planes: each perimeter edge → nearest ridge endpoint or ridge segment
  const planes: GeneratedPlane[] = [];
  const genEdges: GeneratedEdge[] = [
    { edge_type: "ridge", line_px: [ridgeP1, ridgeP2], source },
  ];

  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const edgeMid = midpoint(a, b);

    // Project edge midpoint onto ridge axis
    const proj = (edgeMid.x - c.x) * ux + (edgeMid.y - c.y) * uy;
    const relativePos = (proj - minProj) / span;

    if (relativePos < inset) {
      // Near ridgeP1 end → triangle (hip end)
      planes.push({ plane_index: planes.length + 1, polygon_px: [a, b, ridgeP1], source });
      genEdges.push({ edge_type: "hip", line_px: [ridgeP1, a], source });
    } else if (relativePos > (1 - inset)) {
      // Near ridgeP2 end → triangle (hip end)
      planes.push({ plane_index: planes.length + 1, polygon_px: [a, b, ridgeP2], source });
      genEdges.push({ edge_type: "hip", line_px: [ridgeP2, b], source });
    } else {
      // Along the eave → trapezoid to ridge segment
      planes.push({ plane_index: planes.length + 1, polygon_px: [a, b, ridgeP2, ridgeP1], source });
    }

    genEdges.push({ edge_type: "eave", line_px: [a, b], source });
  }

  return {
    planes,
    edges: genEdges,
    ridgeLine: { p1: ridgeP1, p2: ridgeP2 },
    roofType: "hip",
    debug: {
      method: "hipN_obb_ridge",
      vertex_count: footprint.length,
      planes: planes.length,
      ridge_length: dist(ridgeP1, ridgeP2),
    },
  };
}

// ─── MAIN EXPORT ────────────────────────────────

export function solveHybridRoof(footprint: Point[]): HybridSolverResult {
  if (footprint.length < 3) {
    return {
      planes: [], edges: [], ridgeLine: null, roofType: "complex",
      debug: { error: "footprint_too_small" },
    };
  }

  const type = detectRoofType(footprint);

  let result: HybridSolverResult;

  if (type === "gable" && footprint.length === 4) {
    // Check aspect ratio — very square = hip, elongated = gable
    const edges = [
      dist(footprint[0], footprint[1]),
      dist(footprint[1], footprint[2]),
      dist(footprint[2], footprint[3]),
      dist(footprint[3], footprint[0]),
    ];
    const pairA = edges[0] + edges[2];
    const pairB = edges[1] + edges[3];
    const ratio = Math.max(pairA, pairB) / Math.min(pairA, pairB);

    if (ratio < 1.3) {
      // Nearly square → hip roof (pyramid-like)
      result = solveHip4(footprint);
    } else {
      // Default 4-sided to hip (most residential roofs are hip)
      result = solveHip4(footprint);
    }
  } else if (type === "hip") {
    result = solveHipN(footprint);
  } else {
    // Complex: use N-sided hip solver as best approximation
    result = solveHipN(footprint);
  }

  console.log("[HYBRID_SOLVER]", JSON.stringify({
    roofType: result.roofType,
    method: result.debug.method,
    planes: result.planes.length,
    edges: result.edges.length,
    ridgeLength: result.ridgeLine ? dist(result.ridgeLine.p1, result.ridgeLine.p2) : 0,
  }));

  return result;
}
