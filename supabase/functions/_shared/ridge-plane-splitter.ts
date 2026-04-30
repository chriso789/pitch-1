// Ridge-driven recursive plane splitter.
//
// Given a footprint polygon and a ridge-detection callback, this module
// recursively splits the polygon along validated ridges to produce a
// multi-facet plane decomposition. This is the missing layer between
// "single-plane fallback" and "real geometry engine" output.
//
// Contract:
//   - NO ridge → NO split (returns the input polygon as a single plane).
//   - Ridges are filtered by score (must be ≥ 50% of the strongest).
//   - Recursion is bounded by maxDepth to guarantee termination.

export type Point = { x: number; y: number };

export type Line = {
  p1: Point;
  p2: Point;
  score?: number;
};

export type Plane = {
  id: number;
  polygon: Point[];
};

// ─── GEOMETRY HELPERS ──────────────────────────────────────────────────────

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function perpendicular(v: Point): Point {
  return { x: -v.y, y: v.x };
}

function sideOfLine(p: Point, line: Line): number {
  const dir = subtract(line.p2, line.p1);
  const normal = perpendicular(dir);
  const v = subtract(p, line.p1);
  return dot(v, normal);
}

// ─── LINE / POLYGON SPLIT ──────────────────────────────────────────────────

function intersectSegments(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): Point | null {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-6) return null;

  const ua = ((b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x)) / d;
  if (ua < 0 || ua > 1) return null;

  return {
    x: a1.x + ua * (a2.x - a1.x),
    y: a1.y + ua * (a2.y - a1.y),
  };
}

function splitPolygonByLine(polygon: Point[], line: Line): Point[][] {
  const left: Point[] = [];
  const right: Point[] = [];

  for (let i = 0; i < polygon.length; i++) {
    const curr = polygon[i];
    const next = polygon[(i + 1) % polygon.length];

    const currSide = sideOfLine(curr, line);
    const nextSide = sideOfLine(next, line);

    if (currSide >= 0) left.push(curr);
    if (currSide <= 0) right.push(curr);

    if (currSide * nextSide < 0) {
      const intersection = intersectSegments(curr, next, line.p1, line.p2);
      if (intersection) {
        left.push(intersection);
        right.push(intersection);
      }
    }
  }

  const result: Point[][] = [];
  if (left.length >= 3) result.push(left);
  if (right.length >= 3) result.push(right);
  return result;
}

// ─── RIDGE FILTER ──────────────────────────────────────────────────────────

export function filterStrongRidges(lines: Line[]): Line[] {
  if (!lines.length) return [];
  const maxScore = Math.max(...lines.map((l) => l.score ?? 0));
  if (maxScore <= 0) return lines; // no scores → trust caller
  return lines.filter((l) => (l.score ?? 0) > maxScore * 0.5);
}

// ─── MAIN RECURSIVE SPLITTER ───────────────────────────────────────────────

export function splitPlanesFromRidges(
  footprint: Point[],
  detectRidgesFn: (poly: Point[]) => Line[],
  depth = 0,
  maxDepth = 4,
): Plane[] {
  if (depth > maxDepth) {
    return [{ id: depth, polygon: footprint }];
  }

  const rawRidges = detectRidgesFn(footprint) || [];
  const ridges = filterStrongRidges(rawRidges);

  if (ridges.length === 0) {
    return [{ id: depth, polygon: footprint }];
  }

  let planes: Point[][] = [footprint];

  for (const ridge of ridges) {
    const newPlanes: Point[][] = [];
    for (const plane of planes) {
      const split = splitPolygonByLine(plane, ridge);
      if (split.length === 2) {
        newPlanes.push(split[0], split[1]);
      } else {
        newPlanes.push(plane);
      }
    }
    planes = newPlanes;
  }

  // Recurse inside each resulting plane.
  const finalPlanes: Plane[] = [];
  for (const poly of planes) {
    const subPlanes = splitPlanesFromRidges(
      poly,
      detectRidgesFn,
      depth + 1,
      maxDepth,
    );
    finalPlanes.push(...subPlanes);
  }

  return finalPlanes.map((p, i) => ({ id: i, polygon: p.polygon }));
}
