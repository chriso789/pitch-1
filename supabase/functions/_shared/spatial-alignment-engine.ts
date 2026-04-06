// ============================================
// SPATIAL ALIGNMENT ENGINE — Stage 4
// Affine transform for vendor diagram → aerial image registration
// using roof footprint as the shared anchor.
// ============================================

import {
  type GroupedGeometry,
  type LineKey,
  LINE_KEYS,
} from './geometry-alignment.ts';

// ============================================
// TYPES
// ============================================

/** 2x3 affine matrix stored row-major: [[a, b, c], [d, e, f]] */
export type AffineMatrix = [[number, number, number], [number, number, number]];

export interface ImageBounds {
  topLeft: { lat: number; lng: number };
  topRight: { lat: number; lng: number };
  bottomLeft: { lat: number; lng: number };
  bottomRight: { lat: number; lng: number };
}

export interface ImageDims {
  width: number;
  height: number;
}

export interface SpatialAlignmentResult {
  alignedGeometry: GroupedGeometry;
  affineMatrix: AffineMatrix;
  srcPoints: number[][];
  dstPoints: number[][];
  residualError: number;
  quality: AlignmentQuality;
}

export interface AlignmentQuality {
  meanPointError: number;
  maxPointError: number;
  normalizedError: number; // error / footprint perimeter
  grade: 'good' | 'acceptable' | 'poor';
}

// ============================================
// GEO ↔ PIXEL CONVERSION
// ============================================

/**
 * Convert geographic coordinates (lat/lng) to pixel coordinates
 * on the aerial image, using the image bounds from Mapbox static API.
 */
export function geoToPixel(
  lat: number,
  lng: number,
  bounds: ImageBounds,
  dims: ImageDims,
): [number, number] {
  // Linear interpolation within the bounding box
  const minLng = bounds.topLeft.lng;
  const maxLng = bounds.topRight.lng;
  const maxLat = bounds.topLeft.lat;   // top = higher latitude
  const minLat = bounds.bottomLeft.lat; // bottom = lower latitude

  const x = ((lng - minLng) / (maxLng - minLng)) * dims.width;
  const y = ((maxLat - lat) / (maxLat - minLat)) * dims.height; // y flipped

  return [x, y];
}

/**
 * Convert pixel coordinates back to geographic coordinates.
 */
export function pixelToGeo(
  px: number,
  py: number,
  bounds: ImageBounds,
  dims: ImageDims,
): [number, number] {
  const minLng = bounds.topLeft.lng;
  const maxLng = bounds.topRight.lng;
  const maxLat = bounds.topLeft.lat;
  const minLat = bounds.bottomLeft.lat;

  const lng = minLng + (px / dims.width) * (maxLng - minLng);
  const lat = maxLat - (py / dims.height) * (maxLat - minLat);

  return [lat, lng];
}

// ============================================
// FOOTPRINT → PIXEL COORDS
// ============================================

/**
 * Convert resolved footprint vertices (geo coords [lng, lat])
 * to aerial image pixel coordinates.
 */
export function extractFootprintPixelCoords(
  footprintVertices: [number, number][],
  bounds: ImageBounds,
  dims: ImageDims,
): number[][] {
  if (!footprintVertices || !Array.isArray(footprintVertices)) return [];
  return footprintVertices
    .filter((v): v is [number, number] => Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number')
    .map(([lng, lat]) => {
      const [px, py] = geoToPixel(lat, lng, bounds, dims);
      return [px, py];
    });
}

// ============================================
// VENDOR PERIMETER EXTRACTION
// ============================================

/**
 * Extract the outermost perimeter polygon from vendor geometry
 * by chaining eave and rake segments into a closed polygon.
 * Falls back to convex hull of all points if chaining fails.
 */
export function extractVendorPerimeter(vendorGeometry: GroupedGeometry): number[][] {
  // Collect all eave and rake segment endpoints
  const perimeterSegments: number[][][] = [];
  for (const key of ['eave', 'rake'] as LineKey[]) {
    for (const seg of vendorGeometry[key] || []) {
      if (seg.length >= 2) {
        perimeterSegments.push(seg);
      }
    }
  }

  if (perimeterSegments.length === 0) {
    // Fallback: use all geometry points and compute convex hull
    return convexHullFromGeometry(vendorGeometry);
  }

  // Chain segments by nearest-endpoint linking
  const chained = chainSegments(perimeterSegments);
  if (chained.length >= 3) {
    return chained;
  }

  // Fallback to convex hull
  return convexHullFromGeometry(vendorGeometry);
}

/**
 * Chain line segments into a polygon by connecting nearest endpoints.
 */
function chainSegments(segments: number[][][]): number[][] {
  if (segments.length === 0) return [];

  const used = new Set<number>();
  const chain: number[][] = [];

  // Start with first segment
  used.add(0);
  chain.push(segments[0][0], segments[0][segments[0].length - 1]);

  while (used.size < segments.length) {
    const lastPt = chain[chain.length - 1];
    let bestIdx = -1;
    let bestDist = Infinity;
    let bestReverse = false;

    for (let i = 0; i < segments.length; i++) {
      if (used.has(i)) continue;
      const seg = segments[i];
      const startPt = seg[0];
      const endPt = seg[seg.length - 1];

      const dStart = dist2d(lastPt, startPt);
      const dEnd = dist2d(lastPt, endPt);

      if (dStart < bestDist) {
        bestDist = dStart;
        bestIdx = i;
        bestReverse = false;
      }
      if (dEnd < bestDist) {
        bestDist = dEnd;
        bestIdx = i;
        bestReverse = true;
      }
    }

    if (bestIdx === -1) break;
    used.add(bestIdx);

    const seg = segments[bestIdx];
    if (bestReverse) {
      // Add points in reverse, skipping first (which is the connection point)
      for (let i = seg.length - 1; i >= 0; i--) {
        chain.push(seg[i]);
      }
    } else {
      for (const pt of seg) {
        chain.push(pt);
      }
    }
  }

  // Simplify: Douglas-Peucker to extract corners
  return douglasPeucker(chain, 3.0);
}

// ============================================
// AFFINE TRANSFORM COMPUTATION
// ============================================

/**
 * Compute 2D affine transform matrix from source→destination point pairs.
 * Solves the overdetermined system using least squares:
 *   [x'] = [a b c] * [x]
 *   [y']   [d e f]   [y]
 *                     [1]
 *
 * Requires minimum 3 non-collinear point pairs.
 */
export function computeAffineTransform(
  srcPoints: number[][],
  dstPoints: number[][],
): AffineMatrix {
  const n = Math.min(srcPoints.length, dstPoints.length);
  if (n < 3) {
    throw new Error(`Need at least 3 point pairs for affine transform, got ${n}`);
  }

  // Build the system: A * params = b
  // For each point pair (x,y) → (x',y'):
  //   x' = a*x + b*y + c
  //   y' = d*x + e*y + f
  // Stack into two separate systems for [a,b,c] and [d,e,f]

  // Using least squares via normal equations: A^T A * x = A^T b
  // A is Nx3 matrix [[x1,y1,1],[x2,y2,1],...]

  const A: number[][] = [];
  const bx: number[] = [];
  const by: number[] = [];

  for (let i = 0; i < n; i++) {
    A.push([srcPoints[i][0], srcPoints[i][1], 1]);
    bx.push(dstPoints[i][0]);
    by.push(dstPoints[i][1]);
  }

  // Solve A * [a,b,c]^T = bx  and  A * [d,e,f]^T = by
  const abc = solveLeastSquares3(A, bx);
  const def_ = solveLeastSquares3(A, by);

  return [
    [abc[0], abc[1], abc[2]],
    [def_[0], def_[1], def_[2]],
  ];
}

/**
 * Solve a least-squares system with 3 unknowns.
 * Computes (A^T A)^{-1} A^T b via explicit 3x3 inverse.
 */
function solveLeastSquares3(A: number[][], b: number[]): [number, number, number] {
  const n = A.length;

  // Compute A^T A (3x3)
  const AtA = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const Atb = [0, 0, 0];

  for (let i = 0; i < n; i++) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        AtA[r][c] += A[i][r] * A[i][c];
      }
      Atb[r] += A[i][r] * b[i];
    }
  }

  // Invert 3x3 matrix
  const inv = invert3x3(AtA);
  if (!inv) {
    // Degenerate (collinear points) — return identity-ish
    return [1, 0, 0];
  }

  // Multiply inv * Atb
  const result: [number, number, number] = [0, 0, 0];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      result[r] += inv[r][c] * Atb[c];
    }
  }
  return result;
}

/**
 * Invert a 3x3 matrix. Returns null if singular.
 */
function invert3x3(m: number[][]): number[][] | null {
  const [a, b, c] = [m[0][0], m[0][1], m[0][2]];
  const [d, e, f] = [m[1][0], m[1][1], m[1][2]];
  const [g, h, k] = [m[2][0], m[2][1], m[2][2]];

  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1 / det;
  return [
    [(e * k - f * h) * invDet, (c * h - b * k) * invDet, (b * f - c * e) * invDet],
    [(f * g - d * k) * invDet, (a * k - c * g) * invDet, (c * d - a * f) * invDet],
    [(d * h - e * g) * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet],
  ];
}

// ============================================
// TRANSFORM APPLICATION
// ============================================

/**
 * Apply affine transform to a single point.
 */
export function applyAffineToPoint(pt: number[], M: AffineMatrix): number[] {
  return [
    M[0][0] * pt[0] + M[0][1] * pt[1] + M[0][2],
    M[1][0] * pt[0] + M[1][1] * pt[1] + M[1][2],
  ];
}

/**
 * Apply affine transform to a polyline.
 */
export function applyAffineToPolyline(polyline: number[][], M: AffineMatrix): number[][] {
  return polyline.map(pt => applyAffineToPoint(pt, M));
}

/**
 * Apply affine transform to all geometry groups.
 */
export function applyAffineToGeometry(
  geometry: GroupedGeometry,
  M: AffineMatrix,
): GroupedGeometry {
  const out = {} as GroupedGeometry;
  for (const key of LINE_KEYS) {
    out[key] = (geometry[key] || []).map(seg => applyAffineToPolyline(seg, M));
  }
  return out;
}

// ============================================
// ALIGNMENT QUALITY
// ============================================

/**
 * Compute alignment quality by measuring how well the transformed
 * vendor perimeter matches the authoritative footprint.
 */
export function computeAlignmentQuality(
  alignedVendorPerimeter: number[][],
  footprintPixels: number[][],
): AlignmentQuality {
  if (alignedVendorPerimeter.length === 0 || footprintPixels.length === 0) {
    return { meanPointError: Infinity, maxPointError: Infinity, normalizedError: 1, grade: 'poor' };
  }

  // For each aligned vendor perimeter point, find distance to nearest footprint edge
  let totalError = 0;
  let maxError = 0;

  for (const pt of alignedVendorPerimeter) {
    let minDist = Infinity;
    for (let i = 0; i < footprintPixels.length; i++) {
      const j = (i + 1) % footprintPixels.length;
      const d = pointToSegmentDistance(pt, footprintPixels[i], footprintPixels[j]);
      if (d < minDist) minDist = d;
    }
    totalError += minDist;
    if (minDist > maxError) maxError = minDist;
  }

  const meanError = totalError / alignedVendorPerimeter.length;

  // Compute footprint perimeter for normalization
  let perimeterLength = 0;
  for (let i = 0; i < footprintPixels.length; i++) {
    const j = (i + 1) % footprintPixels.length;
    perimeterLength += dist2d(footprintPixels[i], footprintPixels[j]);
  }

  const normalizedError = perimeterLength > 0 ? meanError / perimeterLength : 1;

  let grade: AlignmentQuality['grade'] = 'poor';
  if (normalizedError < 0.03) grade = 'good';
  else if (normalizedError < 0.08) grade = 'acceptable';

  return { meanPointError: meanError, maxPointError: maxError, normalizedError, grade };
}

// ============================================
// ALIGNMENT PREVIEW
// ============================================

/**
 * Generate SVG overlay data for visual QA of alignment.
 */
export function generateAlignmentPreview(
  alignedGeometry: GroupedGeometry,
  footprintPixels: number[][],
  dims: ImageDims,
): Record<string, unknown> {
  const lineColors: Record<LineKey, string> = {
    ridge: '#00ff00',
    valley: '#ff0000',
    hip: '#00ffff',
    eave: '#ffff00',
    rake: '#ff00ff',
  };

  const layers: Record<string, unknown>[] = [];

  // Footprint polygon
  layers.push({
    type: 'polygon',
    points: footprintPixels,
    color: '#ffffff',
    strokeWidth: 2,
    opacity: 0.6,
    label: 'footprint',
  });

  // Line layers
  for (const key of LINE_KEYS) {
    for (const seg of alignedGeometry[key] || []) {
      layers.push({
        type: 'polyline',
        points: seg,
        color: lineColors[key],
        strokeWidth: 2,
        label: key,
      });
    }
  }

  return {
    width: dims.width,
    height: dims.height,
    layers,
  };
}

// ============================================
// ORCHESTRATOR
// ============================================

/**
 * Full alignment pipeline: vendor geometry → aligned aerial pixel space.
 *
 * 1. Extract vendor perimeter from eave/rake segments
 * 2. Convert footprint geo-coords to aerial pixel coords
 * 3. Match vendor perimeter corners to footprint corners
 * 4. Compute affine transform
 * 5. Apply to all vendor geometry
 * 6. Score alignment quality
 */
export function alignVendorToAerial(opts: {
  vendorGeometry: GroupedGeometry;
  footprintVertices: [number, number][];
  imageBounds: ImageBounds;
  imageDims: ImageDims;
}): SpatialAlignmentResult {
  const { vendorGeometry, footprintVertices, imageBounds, imageDims } = opts;

  // Step A: Extract vendor perimeter
  const vendorPerimeter = extractVendorPerimeter(vendorGeometry);

  // Step B: Convert footprint to pixel coords
  const footprintPixels = extractFootprintPixelCoords(
    footprintVertices,
    imageBounds,
    imageDims,
  );

  // Step C: Match corners (use simplified versions for point correspondence)
  const vendorCorners = douglasPeucker(vendorPerimeter, 5.0);
  const footprintCorners = douglasPeucker(footprintPixels, 5.0);

  // Match by ordering: align bounding box corners first, then use
  // nearest-neighbor matching for the correspondence.
  const { srcPts, dstPts } = matchCorners(vendorCorners, footprintCorners);

  if (srcPts.length < 3) {
    // Not enough correspondences — fall back to bbox-based alignment
    return bboxFallbackAlignment(vendorGeometry, vendorPerimeter, footprintPixels, imageDims);
  }

  // Step D: Compute affine transform
  const M = computeAffineTransform(srcPts, dstPts);

  // Step E: Apply to all geometry
  const alignedGeometry = applyAffineToGeometry(vendorGeometry, M);

  // Step F: Quality assessment
  const alignedPerimeter = applyAffineToPolyline(vendorPerimeter, M);
  const quality = computeAlignmentQuality(alignedPerimeter, footprintPixels);

  // Compute residual error
  let residual = 0;
  for (let i = 0; i < srcPts.length; i++) {
    const transformed = applyAffineToPoint(srcPts[i], M);
    residual += dist2d(transformed, dstPts[i]);
  }
  residual /= srcPts.length;

  return {
    alignedGeometry,
    affineMatrix: M,
    srcPoints: srcPts,
    dstPoints: dstPts,
    residualError: residual,
    quality,
  };
}

// ============================================
// CORNER MATCHING
// ============================================

/**
 * Match vendor corners to footprint corners using bbox-normalized
 * nearest-neighbor correspondence.
 */
function matchCorners(
  vendorCorners: number[][],
  footprintCorners: number[][],
): { srcPts: number[][]; dstPts: number[][] } {
  if (vendorCorners.length < 3 || footprintCorners.length < 3) {
    return { srcPts: [], dstPts: [] };
  }

  // Normalize both sets to [0,1] using their respective bounding boxes
  const vBbox = computeBBox(vendorCorners);
  const fBbox = computeBBox(footprintCorners);

  const normalizeV = (pt: number[]) => normalizeToBBox(pt, vBbox);
  const normalizeF = (pt: number[]) => normalizeToBBox(pt, fBbox);

  const vNorm = vendorCorners.map(normalizeV);
  const fNorm = footprintCorners.map(normalizeF);

  // Greedy nearest-neighbor matching in normalized space
  const srcPts: number[][] = [];
  const dstPts: number[][] = [];
  const usedF = new Set<number>();

  for (let i = 0; i < vNorm.length; i++) {
    let bestJ = -1;
    let bestDist = Infinity;
    for (let j = 0; j < fNorm.length; j++) {
      if (usedF.has(j)) continue;
      const d = dist2d(vNorm[i], fNorm[j]);
      if (d < bestDist) {
        bestDist = d;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && bestDist < 0.5) {
      srcPts.push(vendorCorners[i]);
      dstPts.push(footprintCorners[bestJ]);
      usedF.add(bestJ);
    }
  }

  return { srcPts, dstPts };
}

// ============================================
// BBOX FALLBACK
// ============================================

/**
 * When corner matching fails, fall back to bounding box alignment.
 * Maps vendor bbox corners to footprint bbox corners.
 */
function bboxFallbackAlignment(
  vendorGeometry: GroupedGeometry,
  vendorPerimeter: number[][],
  footprintPixels: number[][],
  imageDims: ImageDims,
): SpatialAlignmentResult {
  const vBbox = computeBBox(vendorPerimeter);
  const fBbox = computeBBox(footprintPixels);

  // Use 4 bbox corners as correspondences
  const srcPts = [
    [vBbox.minX, vBbox.minY],
    [vBbox.maxX, vBbox.minY],
    [vBbox.maxX, vBbox.maxY],
    [vBbox.minX, vBbox.maxY],
  ];
  const dstPts = [
    [fBbox.minX, fBbox.minY],
    [fBbox.maxX, fBbox.minY],
    [fBbox.maxX, fBbox.maxY],
    [fBbox.minX, fBbox.maxY],
  ];

  const M = computeAffineTransform(srcPts, dstPts);
  const alignedGeometry = applyAffineToGeometry(vendorGeometry, M);
  const alignedPerimeter = applyAffineToPolyline(vendorPerimeter, M);
  const quality = computeAlignmentQuality(alignedPerimeter, footprintPixels);

  let residual = 0;
  for (let i = 0; i < 4; i++) {
    const t = applyAffineToPoint(srcPts[i], M);
    residual += dist2d(t, dstPts[i]);
  }
  residual /= 4;

  return {
    alignedGeometry,
    affineMatrix: M,
    srcPoints: srcPts,
    dstPoints: dstPts,
    residualError: residual,
    quality,
  };
}

// ============================================
// GEOMETRY UTILITIES
// ============================================

function dist2d(a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDistance(pt: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist2d(pt, a);

  let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const proj = [a[0] + t * dx, a[1] + t * dy];
  return dist2d(pt, proj);
}

interface BBoxRect {
  minX: number; minY: number; maxX: number; maxY: number;
}

function computeBBox(points: number[][]): BBoxRect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

function normalizeToBBox(pt: number[], bbox: BBoxRect): number[] {
  const w = bbox.maxX - bbox.minX || 1;
  const h = bbox.maxY - bbox.minY || 1;
  return [(pt[0] - bbox.minX) / w, (pt[1] - bbox.minY) / h];
}

/**
 * Collect all points from all geometry line groups.
 */
function convexHullFromGeometry(geometry: GroupedGeometry): number[][] {
  const allPts: number[][] = [];
  for (const key of LINE_KEYS) {
    for (const seg of geometry[key] || []) {
      for (const pt of seg) {
        if (Array.isArray(pt) && pt.length >= 2) {
          allPts.push([pt[0], pt[1]]);
        }
      }
    }
  }
  if (allPts.length < 3) return allPts;
  return convexHull(allPts);
}

/**
 * Simple convex hull (Graham scan).
 */
function convexHull(points: number[][]): number[][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;

  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: number[][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: number[][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove last point of each half because it's repeated
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Douglas-Peucker line simplification.
 */
function douglasPeucker(points: number[][], epsilon: number): number[][] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegmentDistance(points[i], start, end);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }

  return [start, end];
}
