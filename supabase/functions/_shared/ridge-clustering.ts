// Ridge clustering + per-region plane splitting.
//
// Reference implementation of the "cluster ridges → local regions → split
// per region → stitch back" algorithm. The PRODUCTION pipeline in
// start-ai-measurement uses `ridge-cluster-region-split.ts`, which wraps
// the same idea with region padding, recursive sub-detection per region,
// and fallback instrumentation. This module is kept as the canonical
// drop-in spec and can be used directly by other callers / tests.

import { splitPolygonByLine as _splitPolygonByLine, type Point as SplitPoint } from "./ridge-plane-splitter.ts";

export type Point = { x: number; y: number };

export type Ridge = {
  id?: string;
  p1: Point;
  p2: Point;
  angleDeg: number;
  score: number;
};

export type Cluster = {
  id: number;
  ridges: Ridge[];
  angle: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
};

export type Plane = {
  id: number;
  polygon: Point[];
};

// ─── BASIC UTILS ───────────────────────────────────────────────

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

function midpoint(r: Ridge): Point {
  return { x: (r.p1.x + r.p2.x) / 2, y: (r.p1.y + r.p2.y) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function expandBBox(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  pad = 30,
) {
  return {
    minX: bbox.minX - pad,
    minY: bbox.minY - pad,
    maxX: bbox.maxX + pad,
    maxY: bbox.maxY + pad,
  };
}

// ─── STEP 1: CLUSTER RIDGES ─────────────────────────────────────

export function clusterRidges(
  ridges: Ridge[],
  angleThreshold = 20,
  distanceThreshold = 50,
): Cluster[] {
  const clusters: Cluster[] = [];
  let clusterId = 0;

  for (const ridge of ridges) {
    let added = false;
    for (const cluster of clusters) {
      const angleMatch = angleDiff(ridge.angleDeg, cluster.angle) < angleThreshold;
      const distMatch = cluster.ridges.some(
        (r) => distance(midpoint(r), midpoint(ridge)) < distanceThreshold,
      );
      if (angleMatch && distMatch) {
        cluster.ridges.push(ridge);
        added = true;
        break;
      }
    }
    if (!added) {
      clusters.push({
        id: clusterId++,
        ridges: [ridge],
        angle: ridge.angleDeg,
        bbox: null,
      });
    }
  }
  return clusters;
}

// ─── STEP 2: BUILD CLUSTER BBOX ─────────────────────────────────

export function computeClusterBounds(clusters: Cluster[]): Cluster[] {
  for (const cluster of clusters) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of cluster.ridges) {
      for (const p of [r.p1, r.p2]) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    cluster.bbox = expandBBox({ minX, minY, maxX, maxY });
  }
  return clusters;
}

// ─── STEP 3: REGION INTERSECTION ────────────────────────────────

function polygonBBox(poly: Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function bboxOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

// ─── STEP 4: SPLIT PER REGION ───────────────────────────────────

export function splitPlanesByCluster(
  footprint: Point[],
  clusters: Cluster[],
): Plane[] {
  let planes: Point[][] = [footprint];

  for (const cluster of clusters) {
    if (!cluster.bbox) continue;
    const newPlanes: Point[][] = [];

    for (const plane of planes) {
      const planeBox = polygonBBox(plane);
      if (!bboxOverlap(planeBox, cluster.bbox)) {
        newPlanes.push(plane);
        continue;
      }

      let splitApplied = false;
      for (const ridge of cluster.ridges) {
        const split = _splitPolygonByLine(plane as SplitPoint[], {
          p1: ridge.p1,
          p2: ridge.p2,
          score: ridge.score,
        });
        if (split.length === 2) {
          newPlanes.push(split[0], split[1]);
          splitApplied = true;
          break;
        }
      }
      if (!splitApplied) newPlanes.push(plane);
    }
    planes = newPlanes;
  }

  return planes.map((p, i) => ({ id: i, polygon: p }));
}

// ─── MAIN PIPELINE ──────────────────────────────────────────────

export function buildPlanesFromClusters(footprint: Point[], ridges: Ridge[]) {
  const clusters = computeClusterBounds(clusterRidges(ridges));

  console.log("[RIDGE_CLUSTERING]", JSON.stringify({
    total_ridges: ridges.length,
    clusters: clusters.length,
    cluster_sizes: clusters.map((c) => c.ridges.length),
  }));

  const planes = splitPlanesByCluster(footprint, clusters);

  console.log("[REGION_SPLIT]", JSON.stringify({ planes: planes.length }));

  return { planes, clusters };
}
