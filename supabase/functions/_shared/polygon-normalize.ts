// Normalize plane polygons so adjacent planes share exact boundary vertices.
// This fixes the "planes = N, edges = 0" bug where ridge splitting produces
// polygons with close-but-not-identical vertices that sharedSegment() misses.

export type Pt = { x: number; y: number };

const DEFAULT_SNAP_TOL = 4; // px — match EPS in plane-edge-classifier

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return a / 2; // signed
}

/**
 * Ensure consistent counter-clockwise winding for all polygons.
 */
function ensureCCW(poly: Pt[]): Pt[] {
  const area = polygonArea(poly);
  return area < 0 ? poly.slice().reverse() : poly.slice();
}

/**
 * Remove near-duplicate consecutive vertices (within tol px).
 */
function dedupeConsecutive(poly: Pt[], tol: number): Pt[] {
  if (poly.length < 3) return poly;
  const out: Pt[] = [poly[0]];
  for (let i = 1; i < poly.length; i++) {
    if (dist(poly[i], out[out.length - 1]) > tol * 0.5) {
      out.push(poly[i]);
    }
  }
  // Check last vs first
  if (out.length > 1 && dist(out[out.length - 1], out[0]) <= tol * 0.5) {
    out.pop();
  }
  return out;
}

/**
 * Build a global vertex map: collect all vertices from all polygons,
 * snap any two within `tol` px to their average, then reassign.
 */
function buildSnappedVertices(
  allPolys: Pt[][],
  tol: number,
): Map<string, Pt> {
  // Collect all unique-ish vertices
  const allPts: Pt[] = [];
  for (const poly of allPolys) {
    for (const p of poly) allPts.push(p);
  }

  // Union-find style: group vertices within tol
  const groups: Pt[][] = [];
  const assigned = new Array(allPts.length).fill(-1);

  for (let i = 0; i < allPts.length; i++) {
    if (assigned[i] >= 0) continue;
    const group: number[] = [i];
    assigned[i] = groups.length;
    for (let j = i + 1; j < allPts.length; j++) {
      if (assigned[j] >= 0) continue;
      // Check distance to any member of the group
      if (group.some((gi) => dist(allPts[gi], allPts[j]) <= tol)) {
        group.push(j);
        assigned[j] = groups.length;
      }
    }
    groups.push(group.map((idx) => allPts[idx]));
  }

  // For each group compute centroid as the canonical position
  const canonMap = new Map<string, Pt>();
  for (let i = 0; i < allPts.length; i++) {
    const gIdx = assigned[i];
    if (gIdx < 0) continue;
    const group = groups[gIdx];
    const cx = group.reduce((s, p) => s + p.x, 0) / group.length;
    const cy = group.reduce((s, p) => s + p.y, 0) / group.length;
    const canon = { x: Math.round(cx * 100) / 100, y: Math.round(cy * 100) / 100 };
    canonMap.set(ptKey(allPts[i]), canon);
  }

  return canonMap;
}

function ptKey(p: Pt): string {
  return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
}

/**
 * Insert vertices from other polygons onto shared edges so that boundaries
 * share exact vertex sequences. If vertex V from polygon B lies within `tol`
 * of edge (A[i], A[i+1]) in polygon A, insert V onto that edge.
 */
function insertSharedVertices(polys: Pt[][], tol: number): Pt[][] {
  const result = polys.map((p) => p.slice());

  for (let pass = 0; pass < 2; pass++) {
    for (let pi = 0; pi < result.length; pi++) {
      for (let pj = 0; pj < result.length; pj++) {
        if (pi === pj) continue;
        const poly = result[pi];
        const other = result[pj];

        const newPoly: Pt[] = [];
        for (let ei = 0; ei < poly.length; ei++) {
          const a = poly[ei];
          const b = poly[(ei + 1) % poly.length];
          newPoly.push(a);

          // Find vertices from `other` that project onto edge (a, b)
          const edgeLen = dist(a, b);
          if (edgeLen < 1) continue;

          const inserts: { t: number; pt: Pt }[] = [];
          for (const v of other) {
            // Skip if v is already close to a or b
            if (dist(v, a) <= tol || dist(v, b) <= tol) continue;
            // Project v onto segment (a, b)
            const dx = b.x - a.x, dy = b.y - a.y;
            const t = ((v.x - a.x) * dx + (v.y - a.y) * dy) / (dx * dx + dy * dy);
            if (t <= 0.01 || t >= 0.99) continue;
            const proj = { x: a.x + dx * t, y: a.y + dy * t };
            if (dist(v, proj) <= tol) {
              inserts.push({ t, pt: { x: proj.x, y: proj.y } });
            }
          }

          // Sort by t and insert
          inserts.sort((a, b) => a.t - b.t);
          for (const ins of inserts) {
            // Don't insert if too close to last added
            if (newPoly.length > 0 && dist(newPoly[newPoly.length - 1], ins.pt) <= tol * 0.5) continue;
            newPoly.push(ins.pt);
          }
        }
        result[pi] = newPoly;
      }
    }
  }

  return result;
}

export interface NormalizeResult {
  polygons: Pt[][];
  debug: {
    input_plane_count: number;
    total_vertices_before: number;
    total_vertices_after: number;
    vertices_snapped: number;
    vertices_inserted: number;
    winding_reversed: number;
    duplicates_removed: number;
  };
}

/**
 * Normalize an array of plane polygons so they share exact boundary vertices.
 *
 * Steps:
 * 1. Ensure consistent CCW winding
 * 2. Dedupe consecutive near-identical vertices
 * 3. Snap all vertices within `tol` px to their centroid
 * 4. Insert shared-edge vertices from other polygons
 * 5. Final dedupe pass
 */
export function normalizeAdjacentPlanes(
  polygons: Pt[][],
  tol: number = DEFAULT_SNAP_TOL,
): NormalizeResult {
  const inputCount = polygons.length;
  const totalVertsBefore = polygons.reduce((s, p) => s + p.length, 0);

  let windReversed = 0;
  let dupsRemoved = 0;

  // Step 1: CCW winding
  let polys = polygons.map((p) => {
    const ccw = ensureCCW(p);
    if (ccw !== p && ccw.length > 0 && polygonArea(p) < 0) windReversed++;
    return ccw;
  });

  // Step 2: Dedupe
  polys = polys.map((p) => {
    const d = dedupeConsecutive(p, tol);
    dupsRemoved += p.length - d.length;
    return d;
  });

  // Step 3: Global vertex snap
  const canon = buildSnappedVertices(polys, tol);
  let snapped = 0;
  polys = polys.map((poly) =>
    poly.map((v) => {
      const key = ptKey(v);
      const c = canon.get(key);
      if (c && (Math.abs(c.x - v.x) > 0.01 || Math.abs(c.y - v.y) > 0.01)) {
        snapped++;
        return c;
      }
      return v;
    }),
  );

  // Step 4: Insert shared-edge vertices
  const vertsBefore4 = polys.reduce((s, p) => s + p.length, 0);
  polys = insertSharedVertices(polys, tol);
  const inserted = polys.reduce((s, p) => s + p.length, 0) - vertsBefore4;

  // Step 5: Final dedupe
  polys = polys.map((p) => dedupeConsecutive(p, tol * 0.5));

  const totalVertsAfter = polys.reduce((s, p) => s + p.length, 0);

  return {
    polygons: polys,
    debug: {
      input_plane_count: inputCount,
      total_vertices_before: totalVertsBefore,
      total_vertices_after: totalVertsAfter,
      vertices_snapped: snapped,
      vertices_inserted: Math.max(0, inserted),
      winding_reversed: windReversed,
      duplicates_removed: dupsRemoved,
    },
  };
}
