// Footprint-first deterministic plane solver.
// Footprint is primary; ridges are validators/hints only.

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

// ─── SPLIT LOGIC ──────────────────────────────────────────────────

function splitPolygonByLine(poly: Point[], ridge: SolverRidge): Point[][] {
  const left: Point[] = [];
  const right: Point[] = [];

  function side(p: Point) {
    return (
      (ridge.p2.x - ridge.p1.x) * (p.y - ridge.p1.y) -
      (ridge.p2.y - ridge.p1.y) * (p.x - ridge.p1.x)
    );
  }

  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i];
    const next = poly[(i + 1) % poly.length];
    const s1 = side(curr);
    const s2 = side(next);

    if (s1 >= 0) left.push(curr);
    if (s1 <= 0) right.push(curr);

    if (s1 * s2 < 0) {
      const t = Math.abs(s1) / (Math.abs(s1) + Math.abs(s2));
      const intersect = {
        x: curr.x + t * (next.x - curr.x),
        y: curr.y + t * (next.y - curr.y),
      };
      left.push(intersect);
      right.push(intersect);
    }
  }

  const result: Point[][] = [];
  if (left.length >= 3) result.push(left);
  if (right.length >= 3) result.push(right);
  return result;
}

// ─── RIDGE VALIDATION ─────────────────────────────────────────────

function ridgeValid(ridge: SolverRidge, footprint: Point[]): boolean {
  const len = Math.hypot(
    ridge.p2.x - ridge.p1.x,
    ridge.p2.y - ridge.p1.y,
  );
  const xs = footprint.map((p) => p.x);
  const fpWidth = Math.max(...xs) - Math.min(...xs);

  // Reject global ridges spanning >60% of footprint width
  if (len > fpWidth * 0.6) return false;

  // Endpoints must be inside footprint
  if (
    !insideFootprint(ridge.p1, footprint) ||
    !insideFootprint(ridge.p2, footprint)
  ) {
    return false;
  }
  return true;
}

// ─── MAIN SOLVER ──────────────────────────────────────────────────

export function solvePlanesFromFootprint(
  footprint: Point[],
  ridges: SolverRidge[],
): { planes: SolverPlane[]; stats: Record<string, unknown> } {
  let planes: Point[][] = [footprint];

  const validRidges = ridges.filter((r) => ridgeValid(r, footprint));

  console.log("[FOOTPRINT_SOLVER][RIDGE_VALIDATION]", {
    input: ridges.length,
    valid: validRidges.length,
    rejected: ridges.length - validRidges.length,
  });

  for (const ridge of validRidges) {
    const newPlanes: Point[][] = [];
    for (const plane of planes) {
      const split = splitPolygonByLine(plane, ridge);
      if (split.length === 2) {
        newPlanes.push(...split);
      } else {
        newPlanes.push(plane);
      }
    }
    planes = newPlanes;
    if (planes.length > 20) break; // runaway guard
  }

  const footprintArea = polygonArea(footprint);

  const cleaned = planes.filter((p) => {
    const a = polygonArea(p);
    if (a < footprintArea * 0.02) return false;
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
    return {
      planes: [{ id: 0, polygon: footprint, area_px: footprintArea }],
      stats: {
        rejected: true,
        reason: "area_inflation",
        ratio,
        input_ridges: ridges.length,
        valid_ridges: validRidges.length,
      },
    };
  }

  console.log("[FOOTPRINT_SOLVER][RESULT]", {
    planes: cleaned.length,
    area_ratio: ratio,
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
      plane_count: cleaned.length,
      area_ratio: ratio,
    },
  };
}
