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

/**
 * Oriented Bounding Box: find the direction that minimizes the bounding
 * rectangle width. Returns the long-axis unit vector.
 */
function obbLongAxis(poly: Point[]): { ux: number; uy: number } {
  // Try angles 0-179° in 1° steps; pick the one giving the smallest min-width
  let bestUx = 1, bestUy = 0, bestRatio = 0;
  const c = centroid(poly);
  for (let deg = 0; deg < 180; deg++) {
    const rad = (deg * Math.PI) / 180;
    const ux = Math.cos(rad), uy = Math.sin(rad);
    const nx = -uy, ny = ux; // perpendicular
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

/**
 * Project all footprint vertices onto the ridge axis.
 * Return the axis-aligned projection value for each vertex.
 */
function projectOntoAxis(
  poly: Point[],
  c: Point,
  ux: number,
  uy: number
): number[] {
  return poly.map((p) => (p.x - c.x) * ux + (p.y - c.y) * uy);
}

/**
 * Classify footprint vertices into 4 groups based on their position
 * relative to the ridge axis:
 *   - hipEndA: vertices near the low-projection end
 *   - hipEndB: vertices near the high-projection end
 *   - eaveSideLeft: vertices on the left side of the ridge (negative cross)
 *   - eaveSideRight: vertices on the right side (positive cross)
 *
 * Returns ordered polygon vertices for each of the 4 planes.
 */
function partitionVertices(
  poly: Point[],
  c: Point,
  ux: number,
  uy: number,
  ridgeP1: Point,
  ridgeP2: Point,
  insetFrac: number
): { leftEave: Point[]; rightEave: Point[]; hipA: Point[]; hipB: Point[] } {
  const nx = -uy, ny = ux; // perpendicular (cross-axis)
  const projections = projectOntoAxis(poly, c, ux, uy);
  const minProj = Math.min(...projections);
  const maxProj = Math.max(...projections);
  const span = maxProj - minProj;

  const hipThreshLow = minProj + span * insetFrac;
  const hipThreshHigh = maxProj - span * insetFrac;

  const leftEave: Point[] = [];
  const rightEave: Point[] = [];
  const hipA: Point[] = []; // low end
  const hipB: Point[] = []; // high end

  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const proj = projections[i];
    const cross = (p.x - c.x) * nx + (p.y - c.y) * ny;

    if (proj <= hipThreshLow) {
      hipA.push(p);
    } else if (proj >= hipThreshHigh) {
      hipB.push(p);
    } else if (cross < 0) {
      leftEave.push(p);
    } else {
      rightEave.push(p);
    }
  }

  // Sort eave vertices along the ridge axis so the polygon is ordered
  const sortByProj = (a: Point, b: Point) => {
    const pa = (a.x - c.x) * ux + (a.y - c.y) * uy;
    const pb = (b.x - c.x) * ux + (b.y - c.y) * uy;
    return pa - pb;
  };
  leftEave.sort(sortByProj);
  rightEave.sort(sortByProj);

  // Sort hip vertices angularly around their centroid for clean polygon
  const sortAngular = (pts: Point[]) => {
    if (pts.length <= 1) return;
    const hc = centroid(pts);
    pts.sort((a, b) => {
      return Math.atan2(a.y - hc.y, a.x - hc.x) - Math.atan2(b.y - hc.y, b.x - hc.x);
    });
  };
  sortAngular(hipA);
  sortAngular(hipB);

  return { leftEave, rightEave, hipA, hipB };
}

// ─── MAIN CONSTRAINT SOLVER ────────────────────────

function solveConstraint(footprint: Point[]): HybridSolverResult {
  const source = "constraint_ridge_first";
  const c = centroid(footprint);
  const { ux, uy } = obbLongAxis(footprint);

  // Project footprint onto ridge axis to find extent
  const projections = projectOntoAxis(footprint, c, ux, uy);
  const minProj = Math.min(...projections);
  const maxProj = Math.max(...projections);
  const span = maxProj - minProj;

  // Inset ridge 25% from each end
  const insetFrac = 0.25;
  const ridgeP1: Point = {
    x: c.x + ux * (minProj + span * insetFrac),
    y: c.y + uy * (minProj + span * insetFrac),
  };
  const ridgeP2: Point = {
    x: c.x + ux * (maxProj - span * insetFrac),
    y: c.y + uy * (maxProj - span * insetFrac),
  };

  // Partition vertices
  const { leftEave, rightEave, hipA, hipB } = partitionVertices(
    footprint, c, ux, uy, ridgeP1, ridgeP2, insetFrac
  );

  const planes: GeneratedPlane[] = [];
  const genEdges: GeneratedEdge[] = [];

  // Ridge edge
  genEdges.push({ edge_type: "ridge", line_px: [ridgeP1, ridgeP2], source });

  // Plane 1: Left eave trapezoid (leftEave vertices + ridgeP1 + ridgeP2)
  if (leftEave.length >= 1) {
    planes.push({
      plane_index: 1,
      polygon_px: [...leftEave, ridgeP2, ridgeP1],
      source,
    });
    // Eave edges along the left side
    for (let i = 0; i < leftEave.length - 1; i++) {
      genEdges.push({ edge_type: "eave", line_px: [leftEave[i], leftEave[i + 1]], source });
    }
  }

  // Plane 2: Right eave trapezoid (rightEave vertices + ridgeP1 + ridgeP2)
  if (rightEave.length >= 1) {
    planes.push({
      plane_index: 2,
      polygon_px: [...rightEave, ridgeP1, ridgeP2],
      source,
    });
    for (let i = 0; i < rightEave.length - 1; i++) {
      genEdges.push({ edge_type: "eave", line_px: [rightEave[i], rightEave[i + 1]], source });
    }
  }

  // Plane 3: Hip-end A triangle (hipA vertices + ridgeP1)
  if (hipA.length >= 1) {
    planes.push({
      plane_index: 3,
      polygon_px: [...hipA, ridgeP1],
      source,
    });
    for (let i = 0; i < hipA.length - 1; i++) {
      genEdges.push({ edge_type: "eave", line_px: [hipA[i], hipA[i + 1]], source });
    }
    // Hip lines from ridge endpoint to hip-end corners
    genEdges.push({ edge_type: "hip", line_px: [ridgeP1, hipA[0]], source });
    if (hipA.length > 1) {
      genEdges.push({ edge_type: "hip", line_px: [ridgeP1, hipA[hipA.length - 1]], source });
    }
  }

  // Plane 4: Hip-end B triangle (hipB vertices + ridgeP2)
  if (hipB.length >= 1) {
    planes.push({
      plane_index: 4,
      polygon_px: [...hipB, ridgeP2],
      source,
    });
    for (let i = 0; i < hipB.length - 1; i++) {
      genEdges.push({ edge_type: "eave", line_px: [hipB[i], hipB[i + 1]], source });
    }
    genEdges.push({ edge_type: "hip", line_px: [ridgeP2, hipB[0]], source });
    if (hipB.length > 1) {
      genEdges.push({ edge_type: "hip", line_px: [ridgeP2, hipB[hipB.length - 1]], source });
    }
  }

  // Connect eave sides to hip ends (closing the perimeter)
  if (leftEave.length > 0 && hipA.length > 0) {
    genEdges.push({ edge_type: "eave", line_px: [hipA[hipA.length - 1], leftEave[0]], source });
  }
  if (leftEave.length > 0 && hipB.length > 0) {
    genEdges.push({ edge_type: "eave", line_px: [leftEave[leftEave.length - 1], hipB[0]], source });
  }
  if (rightEave.length > 0 && hipA.length > 0) {
    genEdges.push({ edge_type: "eave", line_px: [hipA[0], rightEave[0]], source });
  }
  if (rightEave.length > 0 && hipB.length > 0) {
    genEdges.push({ edge_type: "eave", line_px: [rightEave[rightEave.length - 1], hipB[hipB.length - 1]], source });
  }

  return {
    planes,
    edges: genEdges,
    ridgeLine: { p1: ridgeP1, p2: ridgeP2 },
    roofType: planes.length <= 2 ? "gable" : "hip",
    debug: {
      method: "constraint_ridge_first",
      vertex_count: footprint.length,
      planes: planes.length,
      ridge_length: dist(ridgeP1, ridgeP2),
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
    partition: result.debug.partition,
  }));

  return result;
}
