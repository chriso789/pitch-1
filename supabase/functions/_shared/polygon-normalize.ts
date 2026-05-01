// Normalize plane polygons so adjacent planes share exact boundary vertices.
// Uses GRID SNAPPING to force topological connectivity — all vertices are
// rounded to the nearest GRID px so edges from different planes that are
// "close" become IDENTICAL.

export type Pt = { x: number; y: number };

const GRID = 2; // px — must match plane-edge-classifier GRID

function snap(p: Pt): Pt {
  return {
    x: Math.round(p.x / GRID) * GRID,
    y: Math.round(p.y / GRID) * GRID,
  };
}

function vtxKey(p: Pt): string {
  return `${p.x}:${p.y}`;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return a / 2;
}

function ensureCCW(poly: Pt[]): Pt[] {
  const area = polygonArea(poly);
  return area < 0 ? poly.slice().reverse() : poly.slice();
}

/**
 * Snap all vertices to grid, dedupe consecutive, ensure CCW.
 */
function cleanPolygon(poly: Pt[]): Pt[] {
  // 1. Grid snap
  let pts = poly.map(snap);

  // 2. Dedupe consecutive
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (vtxKey(pts[i]) !== vtxKey(out[out.length - 1])) {
      out.push(pts[i]);
    }
  }
  // Close-loop dedupe
  if (out.length > 1 && vtxKey(out[0]) === vtxKey(out[out.length - 1])) {
    out.pop();
  }
  if (out.length < 3) return out;

  // 3. CCW
  return ensureCCW(out);
}

/**
 * After grid-snapping, insert vertices from other polygons onto shared edges.
 * If vertex V from polygon B lands exactly on edge (A[i], A[i+1]) of polygon A
 * (checked after snapping), insert it so the edge is subdivided identically.
 */
function insertSharedVertices(polys: Pt[][]): Pt[][] {
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

          const edgeLen = dist(a, b);
          if (edgeLen < GRID) continue;

          // Find other-polygon vertices that lie ON this edge (post-snap)
          const inserts: { t: number; pt: Pt }[] = [];
          for (const v of other) {
            if (vtxKey(v) === vtxKey(a) || vtxKey(v) === vtxKey(b)) continue;
            // Check collinearity: cross product ≈ 0 and 0 < t < 1
            const dx = b.x - a.x, dy = b.y - a.y;
            const cross = (v.x - a.x) * dy - (v.y - a.y) * dx;
            if (Math.abs(cross) > GRID * 1.5) continue; // not on line
            const t = dx !== 0
              ? (v.x - a.x) / dx
              : dy !== 0
                ? (v.y - a.y) / dy
                : -1;
            if (t <= 0.01 || t >= 0.99) continue;
            inserts.push({ t, pt: v });
          }

          inserts.sort((a, b) => a.t - b.t);
          for (const ins of inserts) {
            if (newPoly.length > 0 && vtxKey(newPoly[newPoly.length - 1]) === vtxKey(ins.pt)) continue;
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
    grid_px: number;
  };
}

/**
 * Normalize plane polygons for true topological connectivity.
 *
 * 1. Grid-snap all vertices (GRID px)
 * 2. Dedupe consecutive identical vertices
 * 3. Ensure CCW winding
 * 4. Insert shared-edge vertices from other polygons
 * 5. Final dedupe
 */
export function normalizeAdjacentPlanes(
  polygons: Pt[][],
  _tol: number = GRID, // ignored — always uses GRID
): NormalizeResult {
  const totalVertsBefore = polygons.reduce((s, p) => s + p.length, 0);

  // Step 1-3: clean each polygon
  let polys = polygons.map(cleanPolygon);

  const vertsAfterSnap = polys.reduce((s, p) => s + p.length, 0);
  const snapped = totalVertsBefore - vertsAfterSnap; // approximate

  // Step 4: insert shared vertices
  const vertsBefore4 = polys.reduce((s, p) => s + p.length, 0);
  polys = insertSharedVertices(polys);
  const inserted = polys.reduce((s, p) => s + p.length, 0) - vertsBefore4;

  // Step 5: final dedupe
  polys = polys.map((p) => {
    const out: Pt[] = [p[0]];
    for (let i = 1; i < p.length; i++) {
      if (vtxKey(p[i]) !== vtxKey(out[out.length - 1])) out.push(p[i]);
    }
    if (out.length > 1 && vtxKey(out[0]) === vtxKey(out[out.length - 1])) out.pop();
    return out;
  });

  const totalVertsAfter = polys.reduce((s, p) => s + p.length, 0);

  return {
    polygons: polys,
    debug: {
      input_plane_count: polygons.length,
      total_vertices_before: totalVertsBefore,
      total_vertices_after: totalVertsAfter,
      vertices_snapped: Math.max(0, snapped),
      vertices_inserted: Math.max(0, inserted),
      winding_reversed: 0, // not tracked after refactor
      duplicates_removed: Math.max(0, totalVertsBefore - totalVertsAfter + inserted),
      grid_px: GRID,
    },
  };
}
