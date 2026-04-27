// Deterministic edge classification based on plane adjacency and normals.
// 1 plane  → exterior edge (eave if horizontal, otherwise rake)
// 2 planes → ridge / valley / hip based on normal relationship

export type Point = { x: number; y: number };

export type Plane = {
  id: string;
  polygon: Point[];
  normal?: { x: number; y: number; z: number };
  pitch?: number | null;
};

export type Edge = {
  p1: Point;
  p2: Point;
  adjacentPlanes: Plane[];
};

export type EdgeType = "eave" | "rake" | "ridge" | "valley" | "hip" | "unknown";

// ---------- vector math ----------

function dot3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize3(v: { x: number; y: number; z: number }) {
  const mag = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}

export function planeNormalFromPitch(pitch: number, direction: number) {
  const slopeAngle = Math.atan(pitch / 12);
  return normalize3({
    x: Math.cos(direction) * Math.sin(slopeAngle),
    y: Math.sin(direction) * Math.sin(slopeAngle),
    z: Math.cos(slopeAngle),
  });
}

// ---------- classification ----------

export function classifyEdge(edge: Edge): EdgeType {
  const planes = edge.adjacentPlanes;

  // Exterior edges
  if (planes.length === 1) {
    const dy = Math.abs(edge.p1.y - edge.p2.y);
    if (dy < 2) return "eave";
    return "rake";
  }

  // Interior edges
  if (planes.length >= 2) {
    const n1 = planes[0].normal ?? { x: 0, y: 0, z: 1 };
    const n2 = planes[1].normal ?? { x: 0, y: 0, z: 1 };

    const dotVal = dot3(n1, n2);

    if (dotVal < 0) {
      if (n1.z > 0 && n2.z > 0) return "ridge";
      return "valley";
    }
    if (dotVal > 0) return "hip";
  }

  return "unknown";
}

// ---------- edge extraction ----------

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sharesEdge(poly: Point[], p1: Point, p2: Point, tol = 2): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (
      (distance(a, p1) < tol && distance(b, p2) < tol) ||
      (distance(a, p2) < tol && distance(b, p1) < tol)
    ) {
      return true;
    }
  }
  return false;
}

export function extractEdges(planes: Plane[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < planes.length; i++) {
    const poly = planes[i].polygon;
    for (let j = 0; j < poly.length; j++) {
      const p1 = poly[j];
      const p2 = poly[(j + 1) % poly.length];

      // Dedup symmetric key
      const key = [
        Math.round(p1.x), Math.round(p1.y),
        Math.round(p2.x), Math.round(p2.y),
      ].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      const adjacentPlanes = planes.filter((p) =>
        sharesEdge(p.polygon, p1, p2)
      );

      edges.push({ p1, p2, adjacentPlanes });
    }
  }

  return edges;
}

export function edgeLengthFt(edge: Edge, feetPerPixel: number): number {
  return distance(edge.p1, edge.p2) * feetPerPixel;
}
