// Ridge clustering + region-local plane splitter.
//
// PURPOSE
// -------
// Complex multi-wing roofs (e.g. Montelluna-style) have MULTIPLE independent
// ridge systems. Splitting the entire footprint along every detected ridge
// (the previous "global ridge split" behavior) produces giant rectangles that
// do not match the building outline.
//
// This module replaces that global behavior with:
//   1. Cluster ridges by orientation (angle) AND location (midpoint proximity).
//   2. For each cluster, compute a LOCAL region bbox (expanded ~25 px).
//   3. Clip the footprint to each region (Sutherland-Hodgman, convex bbox).
//   4. Run the existing recursive ridge splitter inside each region using
//      ONLY that cluster's ridges.
//   5. Union all regional planes and return.
//
// A ridge therefore only ever splits geometry inside its own local region.
//
// Run order (in start-ai-measurement):
//   ridge_filter
//   → ridge_cluster_region_split  (this module)
//   → ridge_aligned_plane_merge
//   → adjacency graph
//   → edge classification

import {
  splitPlanesFromRidges,
  type Line as RidgeLine,
  type Plane,
  type Point,
} from "./ridge-plane-splitter.ts";

// ─── PUBLIC TYPES ──────────────────────────────────────────────────────────

export type ClusterRidge = RidgeLine & {
  id?: string | number;
  ridge_id?: string | number;
  angleDeg?: number;
};

export type RidgeCluster = {
  cluster_index: number;
  ridges: ClusterRidge[];
  angle_deg: number;        // mean angle (0..180) of the cluster
  region_bbox: BBox;        // expanded local region for this cluster
  ridge_count: number;
};

export type BBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type RegionSplitResult = {
  planes: ClusteredPlane[];
  clusters: RidgeCluster[];
  debug: {
    total_ridges: number;
    cluster_count: number;
    cluster_sizes: number[];
    region_planes_per_cluster: number[];
    fallback_used: boolean;
    reason?: string;
  };
};

export type ClusteredPlane = Plane & {
  cluster_id: string;
  ridge_group_id: string;
  region_bbox: BBox;
  source_ridge_ids: string[];
};

// ─── ANGLE / GEOMETRY HELPERS ──────────────────────────────────────────────

function ridgeAngleDeg(r: RidgeLine): number {
  // Returns angle in [0, 180) — undirected line angle.
  const a = Math.atan2(r.p2.y - r.p1.y, r.p2.x - r.p1.x) * 180 / Math.PI;
  let n = a;
  while (n < 0) n += 180;
  while (n >= 180) n -= 180;
  return n;
}

function angleDelta(a: number, b: number): number {
  // Smallest unsigned difference between two undirected angles in [0,180).
  let d = Math.abs(a - b) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

function midpoint(r: RidgeLine): Point {
  return { x: (r.p1.x + r.p2.x) / 2, y: (r.p1.y + r.p2.y) / 2 };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function bboxOfPoints(points: Point[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function expandBBox(b: BBox, pad: number): BBox {
  return {
    minX: b.minX - pad,
    minY: b.minY - pad,
    maxX: b.maxX + pad,
    maxY: b.maxY + pad,
  };
}

function bboxToPolygon(b: BBox): Point[] {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}

function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const u = poly[i], v = poly[(i + 1) % poly.length];
    a += u.x * v.y - v.x * u.y;
  }
  return Math.abs(a / 2);
}

// ─── SUTHERLAND-HODGMAN POLYGON CLIPPING (convex clip) ─────────────────────
// Clip an arbitrary subject polygon against a convex clip polygon (here, the
// region bbox rectangle). Returns the clipped polygon (possibly empty).

type Edge = { a: Point; b: Point };

function inside(p: Point, e: Edge): boolean {
  // Treat edge a→b as a half-plane; "inside" is to the LEFT (CCW clip).
  return (e.b.x - e.a.x) * (p.y - e.a.y) - (e.b.y - e.a.y) * (p.x - e.a.x) >= 0;
}

function intersect(s: Point, p: Point, e: Edge): Point {
  const x1 = s.x, y1 = s.y, x2 = p.x, y2 = p.y;
  const x3 = e.a.x, y3 = e.a.y, x4 = e.b.x, y4 = e.b.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-9) return p;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

function ensureCCW(poly: Point[]): Point[] {
  let signed = 0;
  for (let i = 0; i < poly.length; i++) {
    const u = poly[i], v = poly[(i + 1) % poly.length];
    signed += u.x * v.y - v.x * u.y;
  }
  return signed >= 0 ? poly : poly.slice().reverse();
}

export function clipPolygonToBBox(subject: Point[], bbox: BBox): Point[] {
  if (subject.length < 3) return [];
  const clipPoly = ensureCCW(bboxToPolygon(bbox));
  let output = subject.slice();
  for (let i = 0; i < clipPoly.length; i++) {
    const e: Edge = { a: clipPoly[i], b: clipPoly[(i + 1) % clipPoly.length] };
    const input = output;
    output = [];
    if (input.length === 0) break;
    let s = input[input.length - 1];
    for (const p of input) {
      if (inside(p, e)) {
        if (!inside(s, e)) output.push(intersect(s, p, e));
        output.push(p);
      } else if (inside(s, e)) {
        output.push(intersect(s, p, e));
      }
      s = p;
    }
  }
  return output;
}

// ─── CLUSTERING ────────────────────────────────────────────────────────────

export function clusterRidges(
  ridges: ClusterRidge[],
  opts: { angleToleranceDeg?: number; midpointDistPx?: number } = {},
): ClusterRidge[][] {
  const angleTol = opts.angleToleranceDeg ?? 20;
  const distTol = opts.midpointDistPx ?? 50;

  const enriched = ridges.map((r) => ({
    r,
    angle: typeof r.angleDeg === "number" ? r.angleDeg : ridgeAngleDeg(r),
    mid: midpoint(r),
  }));

  const visited = new Array(enriched.length).fill(false);
  const clusters: ClusterRidge[][] = [];

  for (let i = 0; i < enriched.length; i++) {
    if (visited[i]) continue;
    const stack = [i];
    const group: ClusterRidge[] = [];
    while (stack.length) {
      const k = stack.pop()!;
      if (visited[k]) continue;
      visited[k] = true;
      group.push({ ...enriched[k].r, angleDeg: enriched[k].angle });
      for (let j = 0; j < enriched.length; j++) {
        if (visited[j]) continue;
        if (
          angleDelta(enriched[k].angle, enriched[j].angle) <= angleTol &&
          dist(enriched[k].mid, enriched[j].mid) <= distTol
        ) {
          stack.push(j);
        }
      }
    }
    clusters.push(group);
  }

  return clusters;
}

// ─── REGION BBOX FOR CLUSTER ───────────────────────────────────────────────

function clusterRegionBBox(group: ClusterRidge[], padPx: number): BBox {
  const pts: Point[] = [];
  for (const r of group) {
    pts.push(r.p1, r.p2);
  }
  return expandBBox(bboxOfPoints(pts), padPx);
}

function meanAngle(group: ClusterRidge[]): number {
  // Average undirected angle via doubled-angle vector trick.
  let sx = 0, sy = 0;
  for (const r of group) {
    const a = (typeof r.angleDeg === "number" ? r.angleDeg : ridgeAngleDeg(r)) * 2;
    const rad = a * Math.PI / 180;
    sx += Math.cos(rad);
    sy += Math.sin(rad);
  }
  let mean = Math.atan2(sy, sx) * 90 / Math.PI; // /2, in deg
  while (mean < 0) mean += 180;
  return mean;
}

// ─── MAIN ENTRY ────────────────────────────────────────────────────────────

export function splitPlanesByRidgeClusters(args: {
  footprint: Point[];
  ridges: ClusterRidge[];
  angleToleranceDeg?: number;
  midpointDistPx?: number;
  regionPadPx?: number;
  detectRidgesFn?: (poly: Point[]) => RidgeLine[]; // optional re-detection inside regions
  recursionMaxDepth?: number;
}): RegionSplitResult {
  const {
    footprint,
    ridges,
    regionPadPx = 25,
    recursionMaxDepth = 3,
  } = args;

  const total_ridges = ridges.length;

  if (total_ridges === 0 || footprint.length < 3) {
    return {
      planes: [{ id: 0, polygon: footprint }],
      clusters: [],
      debug: {
        total_ridges,
        cluster_count: 0,
        cluster_sizes: [],
        region_planes_per_cluster: [],
        fallback_used: true,
        reason: "no_ridges_or_invalid_footprint",
      },
    };
  }

  const groups = clusterRidges(ridges, {
    angleToleranceDeg: args.angleToleranceDeg,
    midpointDistPx: args.midpointDistPx,
  });

  const clusters: RidgeCluster[] = groups.map((g, i) => ({
    cluster_index: i,
    ridges: g,
    angle_deg: meanAngle(g),
    region_bbox: clusterRegionBBox(g, regionPadPx),
    ridge_count: g.length,
  }));

  // Footprint area for "leftover" detection.
  const footprintArea = polygonArea(footprint);
  const allPlanes: ClusteredPlane[] = [];
  const region_planes_per_cluster: number[] = [];
  let coveredArea = 0;

  for (const c of clusters) {
    const region = clipPolygonToBBox(footprint, c.region_bbox);
    if (region.length < 3) {
      region_planes_per_cluster.push(0);
      continue;
    }
    coveredArea += polygonArea(region);

    // Build a per-region detect function: only this cluster's ridges, plus
    // optional fresh in-region detection (clipped by region too).
    const clusterRidges = c.ridges;
    const detectInRegion = (poly: Point[]): RidgeLine[] => {
      // First: this cluster's ridges, but only if their midpoint falls in poly.
      const polyBBox = bboxOfPoints(poly);
      const inBox = clusterRidges.filter((r) => {
        const m = midpoint(r);
        return (
          m.x >= polyBBox.minX - 2 && m.x <= polyBBox.maxX + 2 &&
          m.y >= polyBBox.minY - 2 && m.y <= polyBBox.maxY + 2
        );
      });
      if (inBox.length > 0) return inBox;
      // Optional fresh detect inside region (filtered to cluster orientation).
      if (args.detectRidgesFn) {
        const more = args.detectRidgesFn(poly) || [];
        return more.filter((r) =>
          angleDelta(ridgeAngleDeg(r), c.angle_deg) <= 25
        );
      }
      return [];
    };

    const regionPlanes = splitPlanesFromRidges(
      region,
      detectInRegion,
      0,
      recursionMaxDepth,
    );
    region_planes_per_cluster.push(regionPlanes.length);
    for (const p of regionPlanes) {
      allPlanes.push({
        id: allPlanes.length,
        polygon: p.polygon,
        cluster_id: String(c.cluster_index),
        ridge_group_id: String(c.cluster_index),
        region_bbox: c.region_bbox,
        source_ridge_ids: c.ridges.map((r, idx) => String(r.ridge_id ?? r.id ?? `${c.cluster_index}:${idx}`)),
      });
    }
  }

  // If clusters covered <85% of the footprint, add the un-covered remainder
  // as its own un-split plane so we don't lose geometry.
  if (footprintArea > 0 && coveredArea / footprintArea < 0.85) {
    // Cheap remainder: bbox-subtract isn't available; instead, if NO planes
    // were produced at all, fall back to whole footprint.
    if (allPlanes.length === 0) {
      return {
        planes: [{ id: 0, polygon: footprint, cluster_id: "fallback", ridge_group_id: "fallback", region_bbox: bboxOfPoints(footprint), source_ridge_ids: [] }],
        clusters,
        debug: {
          total_ridges,
          cluster_count: clusters.length,
          cluster_sizes: clusters.map((c) => c.ridge_count),
          region_planes_per_cluster,
          fallback_used: true,
          reason: "regions_produced_no_planes",
        },
      };
    }
  }

  // De-duplicate near-empty planes (area < 1px²).
  const filtered = allPlanes.filter((p) => polygonArea(p.polygon) >= 1);

  return {
    planes: filtered.length > 0 ? filtered : [{ id: 0, polygon: footprint }],
    clusters,
    debug: {
      total_ridges,
      cluster_count: clusters.length,
      cluster_sizes: clusters.map((c) => c.ridge_count),
      region_planes_per_cluster,
      fallback_used: filtered.length === 0,
      reason: filtered.length === 0 ? "no_valid_regional_planes" : undefined,
    },
  };
}
