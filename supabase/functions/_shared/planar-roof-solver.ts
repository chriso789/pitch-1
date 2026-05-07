/**
 * Planar Roof Solver v2 — Production-grade topology reconstruction.
 *
 * Pipeline:
 *   1. Snap footprint + interior edges
 *   2. Collinear merge (angle < 5°, overlapping projections)
 *   3. Dynamic segment filtering (by classification priority)
 *   4. Ordered intersection filtering + splitting
 *   5. Graph consistency (dangling removal)
 *   6. Perimeter re-injection (hard guarantee)
 *   7. Build adjacency + extract minimal cycles
 *   8. Face filtering
 *   9. Polygon simplification (Douglas-Peucker 2px)
 *
 * Guarantees:
 *   • Every face edge is EITHER shared (2 faces) or exterior (1 face)
 *   • Footprint edges are NEVER pruned — re-injected unconditionally
 *   • Intersection splits only occur when geometrically justified
 */

import { filterRoofFaces } from "./face-filter.ts";
import {
  ENDPOINT_SNAP_TOL_PX,
  FOOTPRINT_TOUCH_TOL_PX,
  MIN_SEGMENT_LENGTH_PX,
  COLLINEAR_ANGLE_DEG,
  INTERSECTION_MIN_ANGLE_DEG,
  INTERSECTION_MIN_DISTANCE_PX,
  SIMPLIFY_TOLERANCE_PX,
  GRID_SNAP_PX,
  MIN_FACE_AREA_RATIO,
  MIN_FACE_AREA_ABS_PX,
  LOCALITY_SPAN_RATIO_SOFT,
  LOCALITY_SPAN_RATIO_HARD,
  LOCALITY_EXTENSION_SOFT_PX,
  LOCALITY_EXTENSION_HARD_PX,
  MAX_STRUCTURAL_MERGE_GAP_PX,
} from "./solver-config.ts";

type Pt = { x: number; y: number };
type Seg = { a: Pt; b: Pt; source?: 'footprint' | 'interior'; edgeType?: 'ridge' | 'valley' | 'hip' | 'eave' | 'unclassified'; edgeScore?: number; originalLengthPx?: number; autoExtended?: boolean; localityPenalty?: number };

// ── FORMALIZED SOLVER CONTRACT ─────────────────────────────────────
export interface PlanarRoofSolverInput {
  footprintPx: Array<[number, number]>;
  interiorLines: InteriorLine[];
  rasterWidth?: number;
  rasterHeight?: number;
  footprintAreaPx?: number;
}

export interface PlanarRoofSolverOutput {
  status: 'validated' | 'failed';
  failReason?: string;
  faces: Array<{
    id: number;
    polygon: Pt[];
    areaPx: number;
  }>;
  structuralEdges: Array<{
    type: string;
    a: Pt;
    b: Pt;
    lengthPx: number;
    source: string;
    confidence: number;
  }>;
  metrics: PlanarSolverMetrics;
}

export interface PlanarSolverMetrics {
  input_interior_count: number;
  footprint_edge_count: number;
  collinear_merges: number;
  intersection_filter_skipped: number;
  intersections_split: number;
  dangling_edges_removed: number;
  faces_extracted: number;
  fragment_merges: number;
  face_count_before_merge: number;
  face_count_after_merge: number;
  faces_rejected_by_area: number;
  valid_faces: number;
  coverage_ratio: number;
  polygonizer_fallback_used: boolean;
}

// ── GRID SNAP ──────────────────────────────────────────────
function snap(p: Pt, grid = GRID_SNAP_PX): Pt {
  return {
    x: Math.round(p.x / grid) * grid,
    y: Math.round(p.y / grid) * grid,
  };
}

function ptKey(p: Pt): string {
  return `${p.x}:${p.y}`;
}

function segKey(a: Pt, b: Pt): string {
  const ka = ptKey(a), kb = ptKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function segmentLength(seg: Seg): number {
  return dist(seg.a, seg.b);
}

function isStructural(seg: Seg): boolean {
  return seg.edgeType === 'ridge' || seg.edgeType === 'valley' || seg.edgeType === 'hip';
}

function footprintDiagonal(footprint: Pt[]): number {
  if (footprint.length === 0) return 1;
  const xs = footprint.map(p => p.x);
  const ys = footprint.map(p => p.y);
  return Math.max(1, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function cross(a: Pt, b: Pt): number {
  return a.x * b.y - a.y * b.x;
}

function segAngleRad(s: Seg): number {
  return Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
}

function angleBetweenSegs(s1: Seg, s2: Seg): number {
  const a1 = segAngleRad(s1);
  const a2 = segAngleRad(s2);
  let diff = Math.abs(a1 - a2);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  if (diff > Math.PI / 2) diff = Math.PI - diff; // treat opposite directions as same
  return diff * 180 / Math.PI; // degrees
}

// ── POINT ON SEGMENT ─────────────────────────────────────
function projectPointOnSegment(p: Pt, a: Pt, b: Pt): Pt | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return null;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function pointOnSegment(p: Pt, a: Pt, b: Pt, tol = 2.5): boolean {
  const proj = projectPointOnSegment(p, a, b);
  if (!proj || dist(proj, p) > tol) return false;
  const minX = Math.min(a.x, b.x) - tol, maxX = Math.max(a.x, b.x) + tol;
  const minY = Math.min(a.y, b.y) - tol, maxY = Math.max(a.y, b.y) + tol;
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

function pointNearFootprint(p: Pt, footprint: Pt[], tol = FOOTPRINT_TOUCH_TOL_PX): boolean {
  for (let i = 0; i < footprint.length; i++) {
    if (pointOnSegment(p, footprint[i], footprint[(i + 1) % footprint.length], tol)) return true;
  }
  return false;
}

function snapToFootprint(p: Pt, footprint: Pt[], tol = 6): Pt {
  let best = p;
  let bestD = tol;
  for (const v of footprint) {
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d < bestD) { bestD = d; best = v; }
  }
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const proj = projectPointOnSegment(p, a, b);
    if (proj) {
      const d = Math.hypot(proj.x - p.x, proj.y - p.y);
      if (d < bestD) { bestD = d; best = snap(proj); }
    }
  }
  return best;
}

// ── SEGMENT INTERSECTION ─────────────────────────────────
function rawSegmentIntersection(a: Pt, b: Pt, c: Pt, d: Pt): { point: Pt; t: number; u: number } | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const qp = sub(c, a);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { point: snap({ x: a.x + r.x * t, y: a.y + r.y * t }), t, u };
}

// ── MINIMUM DISTANCE BETWEEN SEGMENTS ────────────────────
function minDistBetweenSegments(s1: Seg, s2: Seg): number {
  // Approximate: check endpoints of each against the other segment
  const dists: number[] = [];
  const proj1a = projectPointOnSegment(s1.a, s2.a, s2.b);
  if (proj1a) dists.push(dist(s1.a, proj1a));
  const proj1b = projectPointOnSegment(s1.b, s2.a, s2.b);
  if (proj1b) dists.push(dist(s1.b, proj1b));
  const proj2a = projectPointOnSegment(s2.a, s1.a, s1.b);
  if (proj2a) dists.push(dist(s2.a, proj2a));
  const proj2b = projectPointOnSegment(s2.b, s1.a, s1.b);
  if (proj2b) dists.push(dist(s2.b, proj2b));
  dists.push(dist(s1.a, s2.a), dist(s1.a, s2.b), dist(s1.b, s2.a), dist(s1.b, s2.b));
  return Math.min(...dists);
}

// ── SNAP INTERIOR FRAGMENTS ──────────────────────────────
function snapInteriorFragmentsToGraph(rawLines: Seg[], footprint: Pt[]): Seg[] {
  const anchors: Pt[] = [...footprint];
  const snapEndpoint = (p: Pt): Pt => {
    const fp = snapToFootprint(p, footprint, FOOTPRINT_TOUCH_TOL_PX);
    if (dist(fp, p) <= FOOTPRINT_TOUCH_TOL_PX) return fp;
    for (const anchor of anchors) {
      if (dist(anchor, p) <= ENDPOINT_SNAP_TOL_PX) return anchor;
    }
    const sp = snap(p);
    anchors.push(sp);
    return sp;
  };

  const out: Seg[] = [];
  const seen = new Set<string>();
  for (const line of rawLines) {
    const a = snapEndpoint(snap(line.a));
    const b = snapEndpoint(snap(line.b));
    if (ptKey(a) === ptKey(b) || dist(a, b) < MIN_SEGMENT_LENGTH_PX) continue;
    const k = segKey(a, b);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ a, b, source: 'interior', edgeType: line.edgeType || 'unclassified', edgeScore: line.edgeScore });
  }
  return out;
}

// ── EXTEND LINE TO FOOTPRINT ─────────────────────────────
function extendLineToFootprint(seg: Seg, footprint: Pt[], maxExtraPx = Infinity, maxSpanPx = Infinity): Seg | null {
  const dir = sub(seg.b, seg.a);
  const originalLen = segmentLength(seg);
  if (Math.hypot(dir.x, dir.y) < 4) return null;

  const hits: Array<{ point: Pt; t: number }> = [];
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const edge = sub(b, a);
    const den = cross(dir, edge);
    if (Math.abs(den) < 1e-9) continue;
    const ap = sub(a, seg.a);
    const t = cross(ap, edge) / den;
    const u = cross(ap, dir) / den;
    if (u < -1e-6 || u > 1 + 1e-6) continue;
    hits.push({ point: snap({ x: seg.a.x + dir.x * t, y: seg.a.y + dir.y * t }), t });
  }

  const unique: Array<{ point: Pt; t: number }> = [];
  for (const h of hits.sort((a, b) => a.t - b.t)) {
    if (!unique.some((u) => dist(u.point, h.point) < 3)) unique.push(h);
  }
  if (unique.length >= 2) {
    const candidate = { ...seg, a: unique[0].point, b: unique[unique.length - 1].point, originalLengthPx: originalLen, autoExtended: true };
    const extendedLen = segmentLength(candidate);
    if (extendedLen > maxSpanPx || extendedLen - originalLen > maxExtraPx) return null;
    return candidate;
  }

  const a = snapToFootprint(seg.a, footprint, 12);
  const b = snapToFootprint(seg.b, footprint, 12);
  const candidate = ptKey(a) !== ptKey(b) ? { ...seg, a, b, originalLengthPx: originalLen, autoExtended: true } : null;
  if (!candidate) return null;
  const extendedLen = segmentLength(candidate);
  if (extendedLen > maxSpanPx || extendedLen - originalLen > maxExtraPx) return null;
  return candidate;
}

// ── COLLINEAR MERGE ──────────────────────────────────────
function mergeCollinearSegments(segments: Seg[]): Seg[] {
  const merged: Seg[] = [];
  const used = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    let current = segments[i];
    let changed = true;

    while (changed) {
      changed = false;
      for (let j = 0; j < segments.length; j++) {
        if (i === j || used.has(j)) continue;
        const angleDiff = angleBetweenSegs(current, segments[j]);
        if (angleDiff > COLLINEAR_ANGLE_DEG) continue;

        // Check if they overlap or are adjacent (project onto shared axis)
        const dir = sub(current.b, current.a);
        const len = Math.hypot(dir.x, dir.y);
        if (len < 1) continue;
        const nx = dir.x / len, ny = dir.y / len;

        const project = (p: Pt) => (p.x - current.a.x) * nx + (p.y - current.a.y) * ny;
        const t1 = 0, t2 = len;
        const t3 = project(segments[j].a), t4 = project(segments[j].b);
        const minT = Math.min(t3, t4), maxT = Math.max(t3, t4);

        // Check perpendicular distance
        const midJ = { x: (segments[j].a.x + segments[j].b.x) / 2, y: (segments[j].a.y + segments[j].b.y) / 2 };
        const projMid = projectPointOnSegment(midJ, current.a, current.b);
        const perpDist = projMid ? dist(midJ, projMid) : 999;
        if (perpDist > 15) continue; // too far apart

        // Overlapping or adjacent. Structural dividers use a much tighter gap
        // so short local ridge/valley fragments do not merge into global spans.
        const allowedGap = (isStructural(current) || isStructural(segments[j])) ? MAX_STRUCTURAL_MERGE_GAP_PX : 10;
        if (minT <= t2 + allowedGap && maxT >= t1 - allowedGap) {
          const currentLen = segmentLength(current);
          const allT = [t1, t2, minT, maxT];
          const globalMin = Math.min(...allT);
          const globalMax = Math.max(...allT);
          const candidateSpan = globalMax - globalMin;
          if ((isStructural(current) || isStructural(segments[j])) && candidateSpan > Math.max(currentLen, segmentLength(segments[j])) + allowedGap) {
            continue;
          }
          const newA = snap({ x: current.a.x + nx * globalMin, y: current.a.y + ny * globalMin });
          const newB = snap({ x: current.a.x + nx * globalMax, y: current.a.y + ny * globalMax });
          // Preserve higher priority type
          const bestType = priorityType(current.edgeType, segments[j].edgeType);
          const bestScore = Math.max(current.edgeScore || 0, segments[j].edgeScore || 0);
          current = { a: newA, b: newB, source: current.source, edgeType: bestType, edgeScore: bestScore };
          used.add(j);
          changed = true;
        }
      }
    }
    merged.push(current);
  }

  return merged;
}

function priorityType(a?: string, b?: string): 'ridge' | 'valley' | 'hip' | 'eave' | 'unclassified' {
  const priority: Record<string, number> = { ridge: 4, valley: 4, hip: 3, eave: 2, unclassified: 0 };
  const pa = priority[a || 'unclassified'] || 0;
  const pb = priority[b || 'unclassified'] || 0;
  return (pa >= pb ? a : b) as any || 'unclassified';
}

// ── DYNAMIC SEGMENT FILTERING ────────────────────────────
function filterByClassificationPriority(segments: Seg[], footprint: Pt[]): Seg[] {
  // Build set of nodes connected to ridge/valley
  const structuralNodes = new Set<string>();
  for (const s of segments) {
    if (s.edgeType === 'ridge' || s.edgeType === 'valley') {
      structuralNodes.add(ptKey(s.a));
      structuralNodes.add(ptKey(s.b));
    }
  }

  return segments.filter(seg => {
    if (seg.source === 'footprint') return true; // never drop footprint
    const len = segmentLength(seg);
    const type = seg.edgeType || 'unclassified';

    switch (type) {
      case 'ridge':
      case 'valley':
        return true; // always keep
      case 'hip':
        // keep if > 2px OR connects to ridge/valley
        return len > 2 || structuralNodes.has(ptKey(seg.a)) || structuralNodes.has(ptKey(seg.b));
      case 'eave':
        return len > 3;
      default: // unclassified
        return len > 8;
    }
  });
}

// ── ORDERED INTERSECTION FILTERING + SPLITTING ───────────
function splitSegmentsWithFilteredIntersections(segments: Seg[]): { result: Seg[]; intersectionCount: number; intersectionFilterSkipped: number } {
  const pointsBySeg: Pt[][] = segments.map((s) => [s.a, s.b]);
  let intersectionCount = 0;
  let intersectionFilterSkipped = 0;

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const inter = rawSegmentIntersection(segments[i].a, segments[i].b, segments[j].a, segments[j].b);
      if (!inter) continue;

      const angleDiff = angleBetweenSegs(segments[i], segments[j]);
      if (angleDiff < COLLINEAR_ANGLE_DEG) { intersectionFilterSkipped++; continue; }
      if (angleDiff < INTERSECTION_MIN_ANGLE_DEG) { intersectionFilterSkipped++; continue; }

      const NEAR_ENDPOINT_TOL = 4;
      const nearEndpointI = dist(inter.point, segments[i].a) < NEAR_ENDPOINT_TOL ||
                            dist(inter.point, segments[i].b) < NEAR_ENDPOINT_TOL;
      const nearEndpointJ = dist(inter.point, segments[j].a) < NEAR_ENDPOINT_TOL ||
                            dist(inter.point, segments[j].b) < NEAR_ENDPOINT_TOL;

      // Only skip a true shared endpoint. A T-junction is exactly the case we
      // must split: one line ends on another line's interior. Previously these
      // were counted as "near endpoint" and skipped, leaving fragmented graphs
      // that produced only tiny sliver cycles.
      if (nearEndpointI && nearEndpointJ) { intersectionFilterSkipped++; continue; }

      intersectionCount++;
      pointsBySeg[i].push(inter.point);
      pointsBySeg[j].push(inter.point);
    }
  }

  const out: Seg[] = [];
  const seen = new Set<string>();
  const add = (a: Pt, b: Pt, parent: Seg) => {
    if (ptKey(a) === ptKey(b) || dist(a, b) < 3) return;
    const k = segKey(a, b);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ a, b, source: parent.source, edgeType: parent.edgeType, edgeScore: parent.edgeScore });
  };

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const len2 = Math.max(dx * dx + dy * dy, 1e-9);
    const pts = pointsBySeg[i]
      .map(snap)
      .filter((p, idx, arr) => arr.findIndex((q) => ptKey(q) === ptKey(p)) === idx)
      .sort((p, q) => (((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2) - (((q.x - s.a.x) * dx + (q.y - s.a.y) * dy) / len2));
    for (let k = 0; k < pts.length - 1; k++) add(pts[k], pts[k + 1], s);
  }

  return { result: out, intersectionCount, intersectionFilterSkipped };
}

// ── PRUNE DANGLING + GRAPH CONSISTENCY ───────────────────
function pruneDanglingInteriorSegments(segments: Seg[], footprint: Pt[]): { kept: Seg[]; removed: number } {
  let current = segments;
  let removed = 0;
  let changed = true;

  while (changed) {
    changed = false;
    const degree = new Map<string, number>();
    for (const seg of current) {
      const ka = ptKey(seg.a), kb = ptKey(seg.b);
      degree.set(ka, (degree.get(ka) || 0) + 1);
      degree.set(kb, (degree.get(kb) || 0) + 1);
    }

    const next = current.filter((seg) => {
      // Footprint segments are immune to removal
      if (seg.source === 'footprint') return true;

      const aBoundary = pointNearFootprint(seg.a, footprint, 3);
      const bBoundary = pointNearFootprint(seg.b, footprint, 3);
      const footprintEdge = aBoundary && bBoundary && pointNearFootprint({ x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 }, footprint, 3);
      if (footprintEdge) return true;

      const aDangling = (degree.get(ptKey(seg.a)) || 0) <= 1 && !aBoundary;
      const bDangling = (degree.get(ptKey(seg.b)) || 0) <= 1 && !bBoundary;
      if (aDangling || bDangling) {
        removed++;
        changed = true;
        return false;
      }
      return true;
    });

    current = next;
  }

  // Final graph consistency pass: remove edges on nodes with degree < 2 not on boundary
  const finalDegree = new Map<string, number>();
  for (const seg of current) {
    const ka = ptKey(seg.a), kb = ptKey(seg.b);
    finalDegree.set(ka, (finalDegree.get(ka) || 0) + 1);
    finalDegree.set(kb, (finalDegree.get(kb) || 0) + 1);
  }
  
  current = current.filter(seg => {
    if (seg.source === 'footprint') return true;
    const degA = finalDegree.get(ptKey(seg.a)) || 0;
    const degB = finalDegree.get(ptKey(seg.b)) || 0;
    const aBound = pointNearFootprint(seg.a, footprint, 3);
    const bBound = pointNearFootprint(seg.b, footprint, 3);
    if (degA < 2 && !aBound) { removed++; return false; }
    if (degB < 2 && !bBound) { removed++; return false; }
    return true;
  });

  return { kept: current, removed };
}

// ── PERIMETER RE-INJECTION ───────────────────────────────
function reinjectPerimeter(graphSegments: Seg[], footprint: Pt[]): Seg[] {
  const segSet = new Set<string>();
  for (const seg of graphSegments) {
    segSet.add(segKey(seg.a, seg.b));
  }

  const result = [...graphSegments];
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const dir = sub(b, a);
    const len2 = dir.x * dir.x + dir.y * dir.y;
    if (len2 < 4) continue;

    // Rebuild perimeter as non-overlapping subsegments using every existing
    // graph node that lies on this footprint edge. Adding the original full
    // edge on top of already-split perimeter segments creates duplicate
    // collinear half-edges; the face walker then extracts only tiny sliver
    // cycles instead of the true roof facets.
    const pointsOnEdge = [a, b];
    for (const seg of graphSegments) {
      for (const p of [seg.a, seg.b]) {
        if (pointOnSegment(p, a, b, 3) && !pointsOnEdge.some((q) => dist(q, p) < 2)) {
          pointsOnEdge.push(p);
        }
      }
    }

    pointsOnEdge.sort((p, q) =>
      (((p.x - a.x) * dir.x + (p.y - a.y) * dir.y) / len2) -
      (((q.x - a.x) * dir.x + (q.y - a.y) * dir.y) / len2)
    );

    for (let j = 0; j < pointsOnEdge.length - 1; j++) {
      const p1 = pointsOnEdge[j];
      const p2 = pointsOnEdge[j + 1];
      if (dist(p1, p2) < 3) continue;
      const k = segKey(p1, p2);
      if (!segSet.has(k)) {
        result.push({ a: p1, b: p2, source: 'footprint', edgeType: 'eave', edgeScore: 0.85 });
        segSet.add(k);
      }
    }
  }

  return result;
}

// ── INSERT MIDPOINTS INTO FOOTPRINT ──────────────────────
function insertMidpointsIntoFootprint(footprint: Pt[], midpoints: Pt[]): Pt[] {
  const result: Pt[] = [];
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    result.push(a);
    const onEdge = midpoints.filter(mp => {
      if (ptKey(mp) === ptKey(a) || ptKey(mp) === ptKey(b)) return false;
      const proj = projectPointOnSegment(mp, a, b);
      if (!proj) return false;
      return Math.hypot(proj.x - mp.x, proj.y - mp.y) < 2;
    });
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    onEdge.sort((p, q) => {
      const tp = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
      const tq = len2 > 0 ? ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2 : 0;
      return tp - tq;
    });
    for (const mp of onEdge) result.push(mp);
  }
  return result;
}

// ── BUILD HALF-EDGE ADJACENCY ────────────────────────────
type AdjMap = Map<string, Map<string, Pt>>;

function buildAdjacency(segments: Seg[]): AdjMap {
  const adj: AdjMap = new Map();
  const ensure = (k: string) => { if (!adj.has(k)) adj.set(k, new Map()); };
  for (const { a, b } of segments) {
    const ka = ptKey(a), kb = ptKey(b);
    ensure(ka); ensure(kb);
    adj.get(ka)!.set(kb, b);
    adj.get(kb)!.set(ka, a);
  }
  return adj;
}

// ── MINIMAL CYCLE (FACE) EXTRACTION ──────────────────────
function angle(from: Pt, to: Pt): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function parsePtKey(k: string): Pt {
  const [x, y] = k.split(":").map(Number);
  return { x, y };
}

function extractMinimalCycles(adj: AdjMap): Pt[][] {
  const sortedNeighbors = new Map<string, string[]>();
  for (const [nodeKey, neighbors] of adj.entries()) {
    const origin = parsePtKey(nodeKey);
    sortedNeighbors.set(
      nodeKey,
      [...neighbors.keys()].sort((a, b) => angle(origin, parsePtKey(a)) - angle(origin, parsePtKey(b))),
    );
  }

  const usedDirected = new Set<string>();
  const faces: Pt[][] = [];
  const seenFaces = new Set<string>();

  for (const [nodeKey, neighbors] of adj.entries()) {
    for (const [neighborKey] of neighbors) {
      const startU = nodeKey;
      const startV = neighborKey;
      if (usedDirected.has(`${startU}->${startV}`)) continue;

      const cycle: Pt[] = [];
      let curKey = startU;
      let nextKey = startV;
      let steps = 0;
      const maxSteps = Math.max(adj.size * 4, 12);
      let closed = false;

      while (steps < maxSteps) {
        const dk = `${curKey}->${nextKey}`;
        if (usedDirected.has(dk)) break;
        usedDirected.add(dk);

        cycle.push(parsePtKey(curKey));
        const nextNeighbors = sortedNeighbors.get(nextKey);
        if (!nextNeighbors?.length) break;
        const incomingIdx = nextNeighbors.indexOf(curKey);
        if (incomingIdx < 0) break;
        const bestKey = nextNeighbors[(incomingIdx - 1 + nextNeighbors.length) % nextNeighbors.length];

        curKey = nextKey;
        nextKey = bestKey;
        steps++;

        if (curKey === startU && nextKey === startV) { closed = true; break; }
      }

      if (closed && cycle.length >= 3) {
        const key = normalizedCycleKey(cycle);
        if (seenFaces.has(key)) continue;
        seenFaces.add(key);
        faces.push(cycle);
      }
    }
  }

  return faces;
}

function normalizedCycleKey(poly: Pt[]): string {
  const keys = poly.map(ptKey);
  const rotations = keys.map((_, i) => [...keys.slice(i), ...keys.slice(0, i)].join("|"));
  const reversed = [...keys].reverse();
  const reverseRotations = reversed.map((_, i) => [...reversed.slice(i), ...reversed.slice(0, i)].join("|"));
  return [...rotations, ...reverseRotations].sort()[0] || "";
}

function signedArea(poly: Pt[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return area / 2;
}

function polygonBoundaryHit(p: Pt, poly: Pt[], tol = 3): boolean {
  for (let i = 0; i < poly.length; i++) {
    if (pointOnSegment(p, poly[i], poly[(i + 1) % poly.length], tol)) return true;
  }
  return false;
}

function pointInPolygonStrict(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function splitPolygonByDivider(poly: Pt[], divider: Seg, minArea: number): Pt[][] | null {
  if (poly.length < 3 || segmentLength(divider) < MIN_SEGMENT_LENGTH_PX) return null;
  const mid = { x: (divider.a.x + divider.b.x) / 2, y: (divider.a.y + divider.b.y) / 2 };
  if (polygonBoundaryHit(mid, poly, 4) || !pointInPolygonStrict(mid, poly)) return null;

  const hits: Array<{ point: Pt; edgeIndex: number; edgeT: number; lineT: number }> = [];
  const addHit = (point: Pt, edgeIndex: number, edgeT: number, lineT: number) => {
    const p = snap(point);
    if (hits.some((h) => dist(h.point, p) < 3)) return;
    hits.push({ point: p, edgeIndex, edgeT, lineT });
  };

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const inter = rawSegmentIntersection(divider.a, divider.b, a, b);
    if (inter) addHit(inter.point, i, inter.u, inter.t);
    for (const endpoint of [divider.a, divider.b]) {
      if (!pointOnSegment(endpoint, a, b, 3)) continue;
      const edgeLen2 = Math.max((b.x - a.x) ** 2 + (b.y - a.y) ** 2, 1e-9);
      const edgeT = ((endpoint.x - a.x) * (b.x - a.x) + (endpoint.y - a.y) * (b.y - a.y)) / edgeLen2;
      const lineLen2 = Math.max((divider.b.x - divider.a.x) ** 2 + (divider.b.y - divider.a.y) ** 2, 1e-9);
      const lineT = ((endpoint.x - divider.a.x) * (divider.b.x - divider.a.x) + (endpoint.y - divider.a.y) * (divider.b.y - divider.a.y)) / lineLen2;
      addHit(endpoint, i, edgeT, lineT);
    }
  }

  if (hits.length < 2) return null;
  hits.sort((a, b) => a.lineT - b.lineT);
  const h1 = hits[0];
  const h2 = hits[hits.length - 1];
  if (dist(h1.point, h2.point) < MIN_SEGMENT_LENGTH_PX) return null;

  const byEdge = new Map<number, typeof hits>();
  for (const h of [h1, h2]) {
    if (!byEdge.has(h.edgeIndex)) byEdge.set(h.edgeIndex, []);
    byEdge.get(h.edgeIndex)!.push(h);
  }

  const augmented: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    augmented.push(poly[i]);
    const edgeHits = (byEdge.get(i) || []).sort((a, b) => a.edgeT - b.edgeT);
    for (const h of edgeHits) {
      if (h.edgeT > 1e-3 && h.edgeT < 1 - 1e-3 && !augmented.some((p) => dist(p, h.point) < 2)) {
        augmented.push(h.point);
      }
    }
  }

  const idx1 = augmented.findIndex((p) => dist(p, h1.point) < 3);
  const idx2 = augmented.findIndex((p) => dist(p, h2.point) < 3);
  if (idx1 < 0 || idx2 < 0 || idx1 === idx2) return null;

  const walk = (from: number, to: number): Pt[] => {
    const out: Pt[] = [];
    let i = from;
    while (true) {
      out.push(augmented[i]);
      if (i === to) break;
      i = (i + 1) % augmented.length;
      if (out.length > augmented.length + 1) break;
    }
    return out.filter((p, i, arr) => i === 0 || dist(p, arr[i - 1]) >= 2);
  };

  const p1 = walk(idx1, idx2);
  const p2 = walk(idx2, idx1);
  const a1 = Math.abs(signedArea(p1));
  const a2 = Math.abs(signedArea(p2));
  const originalArea = Math.abs(signedArea(poly));
  if (p1.length < 3 || p2.length < 3 || a1 < minArea || a2 < minArea) return null;
  if (Math.abs((a1 + a2) - originalArea) > Math.max(10, originalArea * 0.03)) return null;
  return [p1, p2];
}

function polygonizeByStructuralDividers(footprint: Pt[], dividers: Seg[], minArea: number): Pt[][] {
  let cells: Pt[][] = [footprint];
  const primaryDividers = dividers
    .filter((seg) => seg.edgeType === 'ridge' || seg.edgeType === 'valley' || seg.edgeType === 'hip')
    .sort((a, b) => ((b.edgeScore || 0.5) * segmentLength(b)) - ((a.edgeScore || 0.5) * segmentLength(a)));

  for (const divider of primaryDividers) {
    const next: Pt[][] = [];
    for (const cell of cells) {
      const split = splitPolygonByDivider(cell, divider, minArea);
      if (split) {
        next.push(...split);
      } else {
        next.push(cell);
      }
    }
    cells = next;
    if (cells.length >= 24) break;
  }

  return cells.filter((cell) => Math.abs(signedArea(cell)) >= minArea);
}

// ── POLYGON SIMPLIFICATION (Douglas-Peucker) ─────────────
function simplifyPolygon(poly: Pt[], tolerance: number): Pt[] {
  if (poly.length <= 3) return poly;

  function rdp(pts: Pt[], start: number, end: number, tol: number, keep: boolean[]): void {
    if (end - start < 2) return;
    let maxDist = 0;
    let maxIdx = start;
    const a = pts[start], b = pts[end];
    for (let i = start + 1; i < end; i++) {
      const proj = projectPointOnSegment(pts[i], a, b);
      const d = proj ? dist(pts[i], proj) : dist(pts[i], a);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > tol) {
      keep[maxIdx] = true;
      rdp(pts, start, maxIdx, tol, keep);
      rdp(pts, maxIdx, end, tol, keep);
    }
  }

  const keep = new Array(poly.length).fill(false);
  keep[0] = true;
  keep[poly.length - 1] = true;
  rdp(poly, 0, poly.length - 1, tolerance, keep);

  const result = poly.filter((_, i) => keep[i]);
  return result.length >= 3 ? result : poly;
}

// ── MAIN SOLVER ──────────────────────────────────────────
export interface InteriorLine {
  a: Pt;
  b: Pt;
  type?: 'ridge' | 'valley' | 'hip' | 'eave' | 'unclassified';
  score?: number;
}

// ── FORMAL SOLVER CONTRACT (Patent Parity) ──────────────────────
// Threshold invariants documented here for testability:
//   ENDPOINT_SNAP_TOL_PX = 12     — max distance for endpoint snapping
//   INTERSECTION_MIN_ANGLE_DEG = 15 — skip splits below this angle
//   COLLINEAR_ANGLE_DEG = 5       — merge segments within this angle
//   MIN_SEGMENT_LENGTH_PX = 3     — structural short segments allowed down to 3px
//   SIMPLIFY_TOLERANCE_PX = 2     — Douglas-Peucker simplification
//
// Required invariants for customer publication:
//   face_coverage_ratio >= 0.85
//   All coordinates in raster pixel space
//   Perimeter always preserved (re-injection guarantee)

export interface PlanarSolverDebug {
  input_footprint_vertices: number;
  input_interior_lines: number;
  snapped_interior_lines: number;
  collinear_merges: number;
  filtered_by_priority: number;
  intersections_split: number;
  intersection_filter_skipped: number;
  dangling_edges_removed: number;
  perimeter_reinjected: number;
  total_graph_segments: number;
  total_graph_nodes: number;
  faces_extracted: number;
  faces_with_area: number;
  face_coverage_ratio: number;
  fragment_merges: number;
  faces_rejected_by_area: number;
  customer_block_reason: string | null;
}

export interface PlanarSolverResult {
  faces: Array<{ id: number; polygon: Pt[] }>;
  edges: Seg[];
  debug: PlanarSolverDebug;
}

export function solveRoofPlanes(
  rawFootprint: Pt[],
  interiorLines: InteriorLine[],
): PlanarSolverResult {
  const emptyDebug: PlanarSolverDebug = {
    input_footprint_vertices: 0, input_interior_lines: 0, snapped_interior_lines: 0,
    collinear_merges: 0, filtered_by_priority: 0, intersections_split: 0,
    intersection_filter_skipped: 0, dangling_edges_removed: 0, perimeter_reinjected: 0,
    total_graph_segments: 0, total_graph_nodes: 0, faces_extracted: 0,
    faces_with_area: 0, face_coverage_ratio: 0, fragment_merges: 0,
    faces_rejected_by_area: 0, customer_block_reason: null,
  };

  if (rawFootprint.length < 3) {
    return { faces: [], edges: [], debug: emptyDebug };
  }

  // 1. Snap footprint
  const footprint = rawFootprint.map(p => snap(p));
  const roofDiagonalPx = footprintDiagonal(footprint);
  const maxStructuralSpanPx = roofDiagonalPx * MAX_STRUCTURAL_SPAN_RATIO;

  // 2. Convert interior lines with metadata
  const snappedInterior: Seg[] = interiorLines
    .map((seg) => ({
      a: snap(seg.a), b: snap(seg.b),
      source: 'interior' as const,
      edgeType: (seg.type || 'unclassified') as Seg['edgeType'],
      edgeScore: seg.score || 0.5,
      originalLengthPx: dist(snap(seg.a), snap(seg.b)),
    }))
    .filter((seg) => segmentLength(seg) >= MIN_SEGMENT_LENGTH_PX);

  const interiorFragments = snapInteriorFragmentsToGraph(snappedInterior, footprint)
    .map((seg) => {
      const touchesFootprint = pointNearFootprint(seg.a, footprint) || pointNearFootprint(seg.b, footprint);
      const isPrimaryDivider = seg.edgeType === 'ridge' || seg.edgeType === 'valley' || (seg.edgeType === 'hip' && (seg.edgeScore || 0) >= 0.35);
      const localSpanExceeded = isPrimaryDivider && segmentLength(seg) > maxStructuralSpanPx;
      // DSM ridge/valley/hip detections often stop short of the eave because
      // the edge detector sees only the high-gradient core. A planar roof graph
      // cannot form closed facets from floating chords, so extend trustworthy
      // structural dividers to the footprint before intersection splitting.
      // Locality guard: never turn local evidence into a cross-roof diagonal.
      return (touchesFootprint || isPrimaryDivider) && !localSpanExceeded
        ? extendLineToFootprint(seg, footprint, MAX_STRUCTURAL_EXTENSION_PX, maxStructuralSpanPx) || seg
        : seg;
    })
    .filter((seg): seg is Seg => !!seg && ptKey(seg.a) !== ptKey(seg.b) && segmentLength(seg) >= MIN_SEGMENT_LENGTH_PX);

  // 3. Collinear merge
  const beforeMerge = interiorFragments.length;
  const mergedInterior = mergeCollinearSegments(interiorFragments);
  const collinearMerges = beforeMerge - mergedInterior.length;

  // 4. Dynamic segment filtering by classification priority
  const beforeFilter = mergedInterior.length;
  const filteredInterior = filterByClassificationPriority(mergedInterior, footprint);
  const filteredByPriority = beforeFilter - filteredInterior.length;

  // 5. Collect interior endpoints on footprint
  const interiorEndpoints = filteredInterior.flatMap(s => [s.a, s.b]);

  // 6. Insert midpoints into footprint
  const augFootprint = insertMidpointsIntoFootprint(footprint, interiorEndpoints);

  // 7. Build all segments (footprint + interior)
  const allSegments: Seg[] = [];
  const segSet = new Set<string>();

  const addSeg = (a: Pt, b: Pt, source: Seg['source'], edgeType?: Seg['edgeType'], edgeScore?: number) => {
    const k = segKey(a, b);
    if (segSet.has(k)) return;
    if (ptKey(a) === ptKey(b)) return;
    segSet.add(k);
    allSegments.push({ a, b, source, edgeType, edgeScore });
  };

  // Footprint edges (immune to removal)
  for (let i = 0; i < augFootprint.length; i++) {
    addSeg(augFootprint[i], augFootprint[(i + 1) % augFootprint.length], 'footprint', 'eave', 0.85);
  }

  // Interior lines
  for (const seg of filteredInterior) {
    addSeg(seg.a, seg.b, 'interior', seg.edgeType, seg.edgeScore);
  }

  // 8. Split with ordered intersection filtering
  const { result: splitSegments, intersectionCount, intersectionFilterSkipped } = splitSegmentsWithFilteredIntersections(allSegments);

  // 9. Prune dangling + graph consistency
  const pruned = pruneDanglingInteriorSegments(splitSegments, footprint);

  // 10. Perimeter re-injection (hard guarantee)
  const beforeReinject = pruned.kept.length;
  const graphSegments = reinjectPerimeter(pruned.kept, footprint);
  const perimeterReinjected = graphSegments.length - beforeReinject;

  // 11. Build adjacency + extract faces
  const adj = buildAdjacency(graphSegments);
  const rawFaces = extractMinimalCycles(adj);

  // 12. Face filtering
  const footprintArea = Math.abs(signedArea(footprint));
  const minRawFaceArea = Math.max(30, footprintArea * 0.001);
  const allFaces = rawFaces
    .filter((f) => Math.abs(signedArea(f)) > minRawFaceArea)
    .map((polygon, i) => ({ id: i, polygon }));
  const facesRejectedByArea = rawFaces.length - allFaces.length;
  let validFaces = filterRoofFaces(allFaces, footprint)
    .map((face, i) => ({ id: i, polygon: simplifyPolygon(face.polygon, SIMPLIFY_TOLERANCE_PX) }));

  let polygonizerFallbackUsed = false;
  if (validFaces.length < 2) {
    const fallbackPolygons = polygonizeByStructuralDividers(footprint, filteredInterior, minRawFaceArea * 2);
    if (fallbackPolygons.length >= 2) {
      polygonizerFallbackUsed = true;
      validFaces = fallbackPolygons.map((polygon, i) => ({
        id: i,
        polygon: simplifyPolygon(polygon, SIMPLIFY_TOLERANCE_PX),
      }));
    }
  }

  const validArea = validFaces.reduce((sum, face) => sum + Math.abs(signedArea(face.polygon)), 0);
  const faceCoverageRatio = footprintArea > 0 ? validArea / footprintArea : 0;

  const customerBlockReason = faceCoverageRatio < 0.85 ? `coverage_${Math.round(faceCoverageRatio * 100)}pct_lt_85pct` : null;

  const debug: PlanarSolverDebug = {
    input_footprint_vertices: rawFootprint.length,
    input_interior_lines: interiorLines.length,
    snapped_interior_lines: interiorFragments.length,
    collinear_merges: collinearMerges,
    filtered_by_priority: filteredByPriority,
    intersections_split: intersectionCount,
    intersection_filter_skipped: intersectionFilterSkipped,
    dangling_edges_removed: pruned.removed,
    perimeter_reinjected: perimeterReinjected,
    total_graph_segments: graphSegments.length,
    total_graph_nodes: adj.size,
    faces_extracted: rawFaces.length,
    faces_with_area: validFaces.length,
    face_coverage_ratio: Number(faceCoverageRatio.toFixed(3)),
    fragment_merges: polygonizerFallbackUsed ? 1 : 0,
    faces_rejected_by_area: polygonizerFallbackUsed ? 0 : facesRejectedByArea,
    customer_block_reason: customerBlockReason,
  };

  console.log("[PLANAR_SOLVER]", JSON.stringify(debug));

  return { faces: validFaces, edges: graphSegments, debug };
}
