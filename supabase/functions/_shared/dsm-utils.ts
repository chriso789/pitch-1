/**
 * DSM Utilities — Shared helpers for perpendicular profiling,
 * plane fitting, and closed polygon detection.
 * 
 * Used by autonomous-graph-solver.ts for:
 *   - Physics-based edge classification (ridge/valley/hip)
 *   - Facet validation via plane-fit error
 *   - Extracting closed polygons from edge graphs
 */

import type { DSMGrid, MaskedDSMGrid } from "./dsm-analyzer.ts";
import { getElevationAt, geoToPixel } from "./dsm-analyzer.ts";

type XY = [number, number]; // [lng, lat]

// ============= PERPENDICULAR PROFILE =============

export interface PerpendicularProfile {
  leftAvg: number;
  rightAvg: number;
  leftSlope: number;   // positive = elevation increases away from edge
  rightSlope: number;   // positive = elevation increases away from edge
  centerAvg: number;
  heightDelta: number;  // |leftAvg - rightAvg|
  sampleCount: number;
  leftOnRoof: boolean;  // whether left samples landed on roof mask
  rightOnRoof: boolean; // whether right samples landed on roof mask
  leftGroundDrop: boolean; // whether left side shows ground-level drop (>3m below center)
  rightGroundDrop: boolean; // whether right side shows ground-level drop (>3m below center)
}

/**
 * Sample DSM elevation perpendicular to an edge at multiple points along it.
 * Returns averaged left/right elevation profiles for physics-based classification.
 * 
 * For each sample point along the edge:
 *   - Sample N pixels perpendicular on each side
 *   - Compute average elevation on left vs right
 *   - Compute slope direction (away from edge = positive)
 */
export function getPerpendicularProfile(
  start: XY,
  end: XY,
  dsmGrid: DSMGrid,
  samplesAlongEdge: number = 5,
  perpDistanceMeters: number = 3,
  perpSamples: number = 3
): PerpendicularProfile {
  const edgeDx = end[0] - start[0];
  const edgeDy = end[1] - start[1];
  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
  
  if (edgeLen < 1e-10) {
    return { leftAvg: 0, rightAvg: 0, leftSlope: 0, rightSlope: 0, centerAvg: 0, heightDelta: 0, sampleCount: 0 };
  }

  // Perpendicular unit vector (in geographic degrees)
  const perpDx = -edgeDy / edgeLen;
  const perpDy = edgeDx / edgeLen;

  // Convert perpendicular distance from meters to approximate degrees
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(((start[1] + end[1]) / 2) * Math.PI / 180);
  const offsetLng = perpDistanceMeters / metersPerDegLng;
  const offsetLat = perpDistanceMeters / metersPerDegLat;
  // Use average offset scale for the perp vector
  const offsetScale = Math.sqrt(offsetLng * offsetLng * perpDx * perpDx + offsetLat * offsetLat * perpDy * perpDy);

  let leftSum = 0, rightSum = 0, centerSum = 0;
  let leftCount = 0, rightCount = 0, centerCount = 0;
  let leftFarSum = 0, rightFarSum = 0;
  let leftFarCount = 0, rightFarCount = 0;

  for (let i = 0; i < samplesAlongEdge; i++) {
    const t = (i + 0.5) / samplesAlongEdge;
    const cx = start[0] + edgeDx * t;
    const cy = start[1] + edgeDy * t;

    // Center elevation
    const ce = getElevationAt([cx, cy], dsmGrid);
    if (ce !== null) { centerSum += ce; centerCount++; }

    // Sample perpendicular on both sides at multiple distances
    for (let j = 1; j <= perpSamples; j++) {
      const frac = j / perpSamples;
      const dx = perpDx * offsetScale * frac;
      const dy = perpDy * offsetScale * frac;

      const leftE = getElevationAt([cx + dx, cy + dy], dsmGrid);
      const rightE = getElevationAt([cx - dx, cy - dy], dsmGrid);

      if (leftE !== null) {
        leftSum += leftE; leftCount++;
        if (j === perpSamples) { leftFarSum += leftE; leftFarCount++; }
      }
      if (rightE !== null) {
        rightSum += rightE; rightCount++;
        if (j === perpSamples) { rightFarSum += rightE; rightFarCount++; }
      }
    }
  }

  const leftAvg = leftCount > 0 ? leftSum / leftCount : 0;
  const rightAvg = rightCount > 0 ? rightSum / rightCount : 0;
  const centerAvg = centerCount > 0 ? centerSum / centerCount : 0;
  const leftFarAvg = leftFarCount > 0 ? leftFarSum / leftFarCount : leftAvg;
  const rightFarAvg = rightFarCount > 0 ? rightFarSum / rightFarCount : rightAvg;

  // Slope: positive means elevation drops away from edge (edge is higher)
  // negative means elevation rises away from edge (edge is lower)
  const leftSlope = centerAvg - leftFarAvg;   // positive = edge higher than left = slopes down to left
  const rightSlope = centerAvg - rightFarAvg;  // positive = edge higher than right = slopes down to right

  return {
    leftAvg,
    rightAvg,
    leftSlope,
    rightSlope,
    centerAvg,
    heightDelta: Math.abs(leftAvg - rightAvg),
    sampleCount: leftCount + rightCount + centerCount,
  };
}

/**
 * Classify an edge using DSM physics.
 * 
 * RIDGE:  edge is higher than both sides (both slopes positive = both sides drop away)
 * VALLEY: edge is lower than both sides (both slopes negative = both sides rise away)
 * HIP:    mixed slopes (one side drops, other rises or similar)
 * EAVE:   one side has no roof data (perimeter)
 */
export function classifyEdgeByDSM(
  start: XY,
  end: XY,
  dsmGrid: DSMGrid
): 'ridge' | 'valley' | 'hip' | 'eave' | null {
  const profile = getPerpendicularProfile(start, end, dsmGrid, 7, 3, 3);
  
  if (profile.sampleCount < 5) return null; // Insufficient data

  const minDelta = 0.15; // meters — minimum slope to classify
  
  const leftDrops = profile.leftSlope > minDelta;   // edge higher than left
  const rightDrops = profile.rightSlope > minDelta;  // edge higher than right
  const leftRises = profile.leftSlope < -minDelta;   // edge lower than left
  const rightRises = profile.rightSlope < -minDelta;  // edge lower than right

  if (leftDrops && rightDrops) return 'ridge';
  if (leftRises && rightRises) return 'valley';
  if ((leftDrops && rightRises) || (leftRises && rightDrops)) return 'hip';
  if ((leftDrops || rightDrops) && !(leftRises || rightRises)) return 'hip'; // one side flat
  
  return null; // Ambiguous
}

// ============= PLANE FITTING =============

/**
 * Fit a plane z = ax + by + c to DSM pixels within a polygon.
 * Returns the RMS error of the fit — low error means the polygon
 * corresponds to a real planar roof facet.
 * 
 * @returns fit error in meters, or null if insufficient data
 */
export function fitPlaneToPolygon(
  polygon: XY[],
  dsmGrid: DSMGrid
): number | null {
  if (polygon.length < 3) return null;

  // Get bounding box of polygon in pixel space
  const { bounds, width, height, data, noDataValue } = dsmGrid;
  
  const minPxX = Math.max(0, Math.floor((Math.min(...polygon.map(p => p[0])) - bounds.minLng) / (bounds.maxLng - bounds.minLng) * width));
  const maxPxX = Math.min(width - 1, Math.ceil((Math.max(...polygon.map(p => p[0])) - bounds.minLng) / (bounds.maxLng - bounds.minLng) * width));
  const minPxY = Math.max(0, Math.floor((bounds.maxLat - Math.max(...polygon.map(p => p[1]))) / (bounds.maxLat - bounds.minLat) * height));
  const maxPxY = Math.min(height - 1, Math.ceil((bounds.maxLat - Math.min(...polygon.map(p => p[1]))) / (bounds.maxLat - bounds.minLat) * height));

  // Collect points inside polygon
  const points: Array<{ x: number; y: number; z: number }> = [];

  for (let py = minPxY; py <= maxPxY; py++) {
    for (let px = minPxX; px <= maxPxX; px++) {
      const lng = bounds.minLng + ((px + 0.5) / width) * (bounds.maxLng - bounds.minLng);
      const lat = bounds.maxLat - ((py + 0.5) / height) * (bounds.maxLat - bounds.minLat);
      
      if (!pointInPolygonSimple([lng, lat], polygon)) continue;
      
      const z = data[py * width + px];
      if (z === noDataValue || isNaN(z)) continue;
      
      points.push({ x: px, y: py, z });
    }
  }

  if (points.length < 6) return null; // Need enough points for a meaningful fit

  // Least-squares plane fit: z = ax + by + c
  // Normal equations: [Sxx Sxy Sx] [a]   [Sxz]
  //                   [Sxy Syy Sy] [b] = [Syz]
  //                   [Sx  Sy  N ] [c]   [Sz ]
  const N = points.length;
  let Sx = 0, Sy = 0, Sz = 0;
  let Sxx = 0, Sxy = 0, Syy = 0;
  let Sxz = 0, Syz = 0;

  for (const p of points) {
    Sx += p.x; Sy += p.y; Sz += p.z;
    Sxx += p.x * p.x; Sxy += p.x * p.y; Syy += p.y * p.y;
    Sxz += p.x * p.z; Syz += p.y * p.z;
  }

  // Solve 3x3 system using Cramer's rule
  const A = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx,  Sy,  N],
  ];
  const B = [Sxz, Syz, Sz];

  const det = det3x3(A);
  if (Math.abs(det) < 1e-10) return null;

  const a = det3x3(replaceCol(A, B, 0)) / det;
  const b = det3x3(replaceCol(A, B, 1)) / det;
  const c = det3x3(replaceCol(A, B, 2)) / det;

  // Compute RMS error
  let sumSqErr = 0;
  for (const p of points) {
    const predicted = a * p.x + b * p.y + c;
    const err = p.z - predicted;
    sumSqErr += err * err;
  }

  return Math.sqrt(sumSqErr / N);
}

function det3x3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function replaceCol(m: number[][], b: number[], col: number): number[][] {
  return m.map((row, i) => row.map((v, j) => j === col ? b[i] : v));
}

function pointInPolygonSimple(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ============= CLOSED POLYGON DETECTION =============

interface GraphEdgeForPolygon {
  v1: string;
  v2: string;
  id?: string;
}

/**
 * Detect minimal closed polygons (faces) from a planar edge graph.
 * Uses the "next edge" traversal: at each vertex, pick the next edge
 * by smallest counter-clockwise angle from the incoming direction.
 * 
 * Returns arrays of vertex keys forming each face polygon.
 */
export function detectClosedPolygons(
  edges: GraphEdgeForPolygon[],
  vertexPositions: Map<string, XY>
): string[][] {
  if (edges.length === 0 || vertexPositions.size === 0) return [];

  // Build adjacency: for each vertex, list of (neighbor, edge_id)
  const adj = new Map<string, Array<{ neighbor: string; edgeIdx: number }>>();
  
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!adj.has(e.v1)) adj.set(e.v1, []);
    if (!adj.has(e.v2)) adj.set(e.v2, []);
    adj.get(e.v1)!.push({ neighbor: e.v2, edgeIdx: i });
    adj.get(e.v2)!.push({ neighbor: e.v1, edgeIdx: i });
  }

  // Sort neighbors by angle at each vertex
  for (const [v, neighbors] of adj) {
    const vPos = vertexPositions.get(v)!;
    neighbors.sort((a, b) => {
      const aPos = vertexPositions.get(a.neighbor)!;
      const bPos = vertexPositions.get(b.neighbor)!;
      const aAngle = Math.atan2(aPos[1] - vPos[1], aPos[0] - vPos[0]);
      const bAngle = Math.atan2(bPos[1] - vPos[1], bPos[0] - vPos[0]);
      return aAngle - bAngle;
    });
  }

  // Track used half-edges: "v1->v2"
  const usedHalfEdges = new Set<string>();
  const faces: string[][] = [];

  // For each directed half-edge, try to trace a face
  for (const edge of edges) {
    for (const [from, to] of [[edge.v1, edge.v2], [edge.v2, edge.v1]]) {
      const halfEdgeKey = `${from}->${to}`;
      if (usedHalfEdges.has(halfEdgeKey)) continue;

      // Trace face by always turning "most left" (smallest CCW angle)
      const faceVertices: string[] = [from];
      let current = from;
      let next = to;
      let steps = 0;
      const maxSteps = edges.length * 2 + 2;
      let valid = true;

      while (steps < maxSteps) {
        const hk = `${current}->${next}`;
        if (usedHalfEdges.has(hk)) { valid = false; break; }
        usedHalfEdges.add(hk);
        faceVertices.push(next);

        if (next === from && steps > 0) break; // Closed the loop

        // Find next edge: the one with smallest CCW angle from incoming direction
        const neighbors = adj.get(next);
        if (!neighbors || neighbors.length < 2) { valid = false; break; }

        const nextPos = vertexPositions.get(next)!;
        const currPos = vertexPositions.get(current)!;
        const incomingAngle = Math.atan2(currPos[1] - nextPos[1], currPos[0] - nextPos[0]);

        // Sort neighbors by angle relative to incoming direction (CCW)
        let bestNeighbor: string | null = null;
        let bestAngleDiff = Infinity;

        for (const nb of neighbors) {
          if (nb.neighbor === current) continue; // Don't go back
          const nbPos = vertexPositions.get(nb.neighbor)!;
          const outAngle = Math.atan2(nbPos[1] - nextPos[1], nbPos[0] - nextPos[0]);
          // Angle difference: how far CCW from incoming direction
          let diff = outAngle - incomingAngle;
          while (diff <= 0) diff += 2 * Math.PI;
          while (diff > 2 * Math.PI) diff -= 2 * Math.PI;
          
          if (diff < bestAngleDiff) {
            bestAngleDiff = diff;
            bestNeighbor = nb.neighbor;
          }
        }

        if (!bestNeighbor) { valid = false; break; }

        current = next;
        next = bestNeighbor;
        steps++;
      }

      if (!valid || faceVertices.length < 4) continue; // Need at least 3 unique vertices + closing
      if (faceVertices[faceVertices.length - 1] !== faceVertices[0]) continue; // Not closed

      // Check for degenerate (too large = outer face)
      const uniqueVerts = new Set(faceVertices);
      if (uniqueVerts.size > edges.length) continue; // Outer boundary, skip

      // Compute signed area to filter outer face (negative area = clockwise = outer)
      const coords = faceVertices.map(v => vertexPositions.get(v)!);
      let signedArea = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        signedArea += (coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1]);
      }
      
      // Only keep faces with positive area (CCW orientation = interior face)
      // Skip very large faces (likely the outer boundary)
      if (signedArea > 0 && uniqueVerts.size >= 3 && uniqueVerts.size <= 20) {
        faces.push(faceVertices.slice(0, -1)); // Remove duplicate closing vertex
      }
    }
  }

  return faces;
}

// ============= EDGE SCORING =============

/**
 * Compute a composite score for an edge candidate.
 * Higher score = more likely to be a real structural edge.
 * 
 * score = gradient_strength * length_factor * height_delta * alignment
 */
export function computeEdgeScore(
  start: XY,
  end: XY,
  gradientStrength: number,
  dsmGrid: DSMGrid | null,
  midLat: number
): number {
  // Length factor: longer edges are more reliable (up to a point)
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  const dx = (end[0] - start[0]) * metersPerDegLng;
  const dy = (end[1] - start[1]) * metersPerDegLat;
  const lengthM = Math.sqrt(dx * dx + dy * dy);
  const lengthFactor = Math.min(1, lengthM / 15); // saturates at 15m (~50ft)

  // Height delta across edge
  let heightDelta = 0;
  if (dsmGrid) {
    const profile = getPerpendicularProfile(start, end, dsmGrid, 5, 2, 2);
    heightDelta = Math.min(1, profile.heightDelta / 2); // saturates at 2m delta
  }

  // Gradient strength (already 0-1)
  const gradFactor = Math.min(1, gradientStrength);

  // Composite — all factors must contribute
  return gradFactor * 0.35 + lengthFactor * 0.25 + heightDelta * 0.4;
}

// ============= POINT-TO-SEGMENT DISTANCE =============

export function pointToSegmentDistance(p: XY, a: XY, b: XY): number {
  const A = p[0] - a[0];
  const B = p[1] - a[1];
  const C = b[0] - a[0];
  const D = b[1] - a[1];

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  if (lenSq < 1e-20) return Math.sqrt(A * A + B * B);
  
  const param = Math.max(0, Math.min(1, dot / lenSq));
  const xx = a[0] + param * C;
  const yy = a[1] + param * D;

  return Math.sqrt((p[0] - xx) ** 2 + (p[1] - yy) ** 2);
}

/**
 * Compute angle of an edge segment in radians
 */
export function edgeAngle(start: XY, end: XY): number {
  return Math.atan2(end[1] - start[1], end[0] - start[0]);
}

/**
 * Angular difference between two angles, always returns [0, PI]
 */
export function angleDifference(a: number, b: number): number {
  let diff = Math.abs(a - b) % (2 * Math.PI);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff;
}
