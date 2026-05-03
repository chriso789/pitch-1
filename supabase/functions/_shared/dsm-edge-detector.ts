/**
 * DSM Edge Detector v2 — Hessian curvature-based ridge/valley detection
 * 
 * KEY FIX: v1 used non-maximum suppression on raw elevation, which fails on
 * smooth slopes (a pixel is never a local max on a planar surface).
 * 
 * v2 uses the Hessian matrix (second derivatives) to detect curvature:
 *   Ridge = negative curvature (concave DOWN in cross-section)
 *   Valley = positive curvature (concave UP in cross-section)
 * 
 * Pipeline:
 *   1. Smooth DSM with Gaussian to suppress noise
 *   2. Compute Hessian eigenvalues at each pixel
 *   3. Ridge pixels: min eigenvalue < -threshold (strong negative curvature)
 *   4. Valley pixels: max eigenvalue > threshold (strong positive curvature)
 *   5. Connected component analysis → line fit → geographic edges
 */

import type { DSMGrid, MaskedDSMGrid } from "./dsm-analyzer.ts";
import { pixelToGeo } from "./dsm-analyzer.ts";

type XY = [number, number];

export interface DSMEdgeCandidate {
  start: XY;            // [lng, lat]
  end: XY;              // [lng, lat]
  startPx: [number, number];
  endPx: [number, number];
  type: 'ridge' | 'valley';
  dsm_score: number;    // 0–1
  pixelCount: number;
  avgGradientMag: number;
}

export interface EdgeDetectionResult {
  ridges: DSMEdgeCandidate[];
  valleys: DSMEdgeCandidate[];
  stats: {
    gridSize: string;
    roofPixels: number;
    ridgePixels: number;
    valleyPixels: number;
    ridgeCandidates: number;
    valleyCandidates: number;
    processingMs: number;
    elevRange: string;
    curvatureRange: string;
  };
}

// ============= GAUSSIAN SMOOTHING =============

/**
 * Apply 5x5 Gaussian blur to reduce noise before computing second derivatives.
 * Only operates on valid (non-noData) pixels; output inherits noData.
 */
function gaussianSmooth(
  data: Float32Array,
  width: number,
  height: number,
  noData: number,
  mask: Uint8Array | null
): Float32Array {
  // 5x5 Gaussian kernel (sigma ≈ 1.0)
  const k = [
    1, 4, 7, 4, 1,
    4, 16, 26, 16, 4,
    7, 26, 41, 26, 7,
    4, 16, 26, 16, 4,
    1, 4, 7, 4, 1,
  ];
  const kSum = 273;
  const r = 2; // radius

  const out = new Float32Array(data.length);
  out.fill(noData);

  for (let y = r; y < height - r; y++) {
    for (let x = r; x < width - r; x++) {
      const idx = y * width + x;
      if (mask && mask[idx] === 0) continue;
      if (data[idx] === noData || isNaN(data[idx])) continue;

      let sum = 0, wSum = 0;
      for (let ky = -r; ky <= r; ky++) {
        for (let kx = -r; kx <= r; kx++) {
          const ni = (y + ky) * width + (x + kx);
          const v = data[ni];
          if (v === noData || isNaN(v)) continue;
          if (mask && mask[ni] === 0) continue;
          const w = k[(ky + r) * 5 + (kx + r)];
          sum += v * w;
          wSum += w;
        }
      }
      if (wSum > 0) out[idx] = sum / wSum;
    }
  }
  return out;
}

// ============= HESSIAN (SECOND DERIVATIVES) =============

/**
 * Compute Hessian eigenvalues at each pixel.
 * Hxx = d²z/dx², Hyy = d²z/dy², Hxy = d²z/dxdy
 * Returns min and max eigenvalues (lambda1 <= lambda2).
 * 
 * Ridge: lambda1 << 0 (strong negative curvature perpendicular to ridge)
 * Valley: lambda2 >> 0 (strong positive curvature perpendicular to valley)
 */
function computeHessianEigenvalues(
  data: Float32Array,
  width: number,
  height: number,
  noData: number,
  mask: Uint8Array | null
): { minEig: Float32Array; maxEig: Float32Array } {
  const len = width * height;
  const minEig = new Float32Array(len); // lambda1 (most negative)
  const maxEig = new Float32Array(len); // lambda2 (most positive)

  const valid = (x: number, y: number): number | null => {
    if (x < 0 || x >= width || y < 0 || y >= height) return null;
    const idx = y * width + x;
    if (mask && mask[idx] === 0) return null;
    const v = data[idx];
    if (v === noData || isNaN(v)) return null;
    return v;
  };

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (mask && mask[idx] === 0) continue;
      
      const c = valid(x, y);
      const l = valid(x - 1, y);
      const r = valid(x + 1, y);
      const t = valid(x, y - 1);
      const b = valid(x, y + 1);
      const tl = valid(x - 1, y - 1);
      const tr = valid(x + 1, y - 1);
      const bl = valid(x - 1, y + 1);
      const br = valid(x + 1, y + 1);

      if (c === null || l === null || r === null || t === null || b === null) continue;

      // Second derivatives
      const Hxx = l - 2 * c + r;
      const Hyy = t - 2 * c + b;

      // Mixed partial: use Sobel-style cross derivative if all corners valid
      let Hxy = 0;
      if (tl !== null && tr !== null && bl !== null && br !== null) {
        Hxy = (br - bl - tr + tl) / 4;
      }

      // Eigenvalues of 2x2 symmetric matrix [[Hxx, Hxy], [Hxy, Hyy]]
      const trace = Hxx + Hyy;
      const det = Hxx * Hyy - Hxy * Hxy;
      const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));

      minEig[idx] = trace / 2 - disc;
      maxEig[idx] = trace / 2 + disc;
    }
  }

  return { minEig, maxEig };
}

// ============= STRUCTURAL PIXEL DETECTION =============

function detectStructuralPixels(
  minEig: Float32Array,
  maxEig: Float32Array,
  width: number,
  height: number,
  mask: Uint8Array | null,
  type: 'ridge' | 'valley'
): Uint8Array {
  const result = new Uint8Array(width * height);

  // Collect curvature values to compute adaptive threshold
  const curvatureValues: number[] = [];
  for (let i = 0; i < minEig.length; i++) {
    if (mask && mask[i] === 0) continue;
    if (type === 'ridge' && minEig[i] < 0) {
      curvatureValues.push(-minEig[i]); // magnitude
    } else if (type === 'valley' && maxEig[i] > 0) {
      curvatureValues.push(maxEig[i]);
    }
  }

  if (curvatureValues.length < 10) return result;

  curvatureValues.sort((a, b) => a - b);

  // Use top 5% as strong curvature threshold for candidate pixels
  // This captures only the strongest curvature changes (actual ridges/valleys)
  const pctIdx = Math.floor(curvatureValues.length * 0.92);
  const threshold = curvatureValues[pctIdx] || 0.001;

  let count = 0;
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * width + x;
      if (mask && mask[idx] === 0) continue;

      if (type === 'ridge') {
        // Ridge: strong negative curvature (surface curves DOWN from this point)
        if (-minEig[idx] >= threshold) {
          result[idx] = 1;
          count++;
        }
      } else {
        // Valley: strong positive curvature (surface curves UP from this point)
        if (maxEig[idx] >= threshold) {
          result[idx] = 1;
          count++;
        }
      }
    }
  }

  return result;
}

// ============= NON-MAXIMUM SUPPRESSION ON CURVATURE =============

/**
 * Thin detected pixels to 1-pixel wide lines by suppressing non-maxima
 * along the curvature gradient direction.
 */
function nonMaximumSuppression(
  bitmap: Uint8Array,
  curvature: Float32Array,
  width: number,
  height: number
): Uint8Array {
  const result = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (bitmap[idx] === 0) continue;

      const val = Math.abs(curvature[idx]);
      
      // Check 8 neighbors — keep only if this is the local max of curvature magnitude
      let isMax = true;
      // Only suppress along the gradient of curvature (approximate with 4-connectivity)
      const neighbors = [
        curvature[(y - 1) * width + x],
        curvature[(y + 1) * width + x],
        curvature[y * width + (x - 1)],
        curvature[y * width + (x + 1)],
      ];

      // Simple: keep if stronger than at least 2 of the 4 cardinal neighbors
      let strongerCount = 0;
      for (const n of neighbors) {
        if (val >= Math.abs(n)) strongerCount++;
      }
      if (strongerCount >= 2) {
        result[idx] = 1;
      }
    }
  }

  return result;
}

// ============= CONNECTED COMPONENTS =============

interface Component {
  pixels: Array<[number, number]>;
  sumX: number;
  sumY: number;
  sumXX: number;
  sumXY: number;
  sumYY: number;
  avgCurvature: number;
}

function extractConnectedComponents(
  bitmap: Uint8Array,
  curvature: Float32Array,
  width: number,
  height: number,
  minPixels: number
): Component[] {
  const visited = new Uint8Array(width * height);
  const components: Component[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (bitmap[idx] === 0 || visited[idx]) continue;

      const queue: Array<[number, number]> = [[x, y]];
      const pixels: Array<[number, number]> = [];
      let sumCurv = 0;
      visited[idx] = 1;

      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!;
        pixels.push([cx, cy]);
        sumCurv += Math.abs(curvature[cy * width + cx]);

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const nidx = ny * width + nx;
            if (bitmap[nidx] > 0 && !visited[nidx]) {
              visited[nidx] = 1;
              queue.push([nx, ny]);
            }
          }
        }
      }

      if (pixels.length < minPixels) continue;

      let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0, sumYY = 0;
      for (const [px, py] of pixels) {
        sumX += px;
        sumY += py;
        sumXX += px * px;
        sumXY += px * py;
        sumYY += py * py;
      }

      components.push({
        pixels,
        sumX, sumY, sumXX, sumXY, sumYY,
        avgCurvature: sumCurv / pixels.length,
      });
    }
  }

  return components;
}

// ============= LEAST-SQUARES LINE FIT =============

function fitLineToComponent(
  comp: Component
): { startPx: [number, number]; endPx: [number, number]; fitness: number } | null {
  const n = comp.pixels.length;
  if (n < 3) return null;

  const mx = comp.sumX / n;
  const my = comp.sumY / n;

  const cxx = comp.sumXX / n - mx * mx;
  const cxy = comp.sumXY / n - mx * my;
  const cyy = comp.sumYY / n - my * my;

  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const lambda1 = trace / 2 + disc;
  const lambda2 = trace / 2 - disc;

  const fitness = lambda1 > 0 ? 1 - (lambda2 / lambda1) : 0;
  if (fitness < 0.3) return null; // Too blobby

  let dx: number, dy: number;
  if (Math.abs(cxy) > 1e-10) {
    dx = lambda1 - cyy;
    dy = cxy;
  } else {
    dx = cxx >= cyy ? 1 : 0;
    dy = cxx >= cyy ? 0 : 1;
  }
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return null;
  dx /= len;
  dy /= len;

  let minT = Infinity, maxT = -Infinity;
  for (const [px, py] of comp.pixels) {
    const t = (px - mx) * dx + (py - my) * dy;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }

  return {
    startPx: [Math.round(mx + minT * dx), Math.round(my + minT * dy)],
    endPx: [Math.round(mx + maxT * dx), Math.round(my + maxT * dy)],
    fitness,
  };
}

// ============= MAIN DETECTION =============

export function detectStructuralEdges(
  dsmGrid: DSMGrid,
  mask: Uint8Array | null = null
): EdgeDetectionResult {
  const startMs = Date.now();
  const { data, width, height, noDataValue } = dsmGrid;

  let roofPixels = 0;
  let elevMin = Infinity, elevMax = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const inRoof = mask ? mask[i] > 0 : (data[i] !== noDataValue && !isNaN(data[i]));
    if (inRoof) {
      roofPixels++;
      if (data[i] < elevMin) elevMin = data[i];
      if (data[i] > elevMax) elevMax = data[i];
    }
  }

  console.log(`[DSM_EDGE_DETECTOR] Grid ${width}x${height}, ${roofPixels} roof pixels, elev range: ${elevMin.toFixed(2)}-${elevMax.toFixed(2)}m (${(elevMax - elevMin).toFixed(2)}m)`);

  if (roofPixels < 50 || (elevMax - elevMin) < 0.1) {
    console.log(`[DSM_EDGE_DETECTOR] Insufficient data: ${roofPixels} pixels, ${(elevMax - elevMin).toFixed(2)}m range`);
    return emptyResult(width, height, roofPixels, Date.now() - startMs);
  }

  // Step 1: Gaussian smooth to reduce noise
  const smoothed = gaussianSmooth(data, width, height, noDataValue, mask);

  // Step 2: Compute Hessian eigenvalues (curvature)
  const { minEig, maxEig } = computeHessianEigenvalues(smoothed, width, height, noDataValue, mask);

  // Log curvature statistics
  let curvMin = 0, curvMax = 0;
  for (let i = 0; i < minEig.length; i++) {
    if (mask && mask[i] === 0) continue;
    if (minEig[i] < curvMin) curvMin = minEig[i];
    if (maxEig[i] > curvMax) curvMax = maxEig[i];
  }
  console.log(`[DSM_EDGE_DETECTOR] Curvature range: min_eig=${curvMin.toFixed(6)}, max_eig=${curvMax.toFixed(6)}`);

  // Step 3: Detect ridge and valley pixels from curvature
  const ridgeBitmapRaw = detectStructuralPixels(minEig, maxEig, width, height, mask, 'ridge');
  const valleyBitmapRaw = detectStructuralPixels(minEig, maxEig, width, height, mask, 'valley');

  // Step 4: Non-maximum suppression to thin to 1-pixel lines
  const ridgeBitmap = nonMaximumSuppression(ridgeBitmapRaw, minEig, width, height);
  const valleyBitmap = nonMaximumSuppression(valleyBitmapRaw, maxEig, width, height);

  let ridgePixelCount = 0, valleyPixelCount = 0;
  for (let i = 0; i < ridgeBitmap.length; i++) {
    if (ridgeBitmap[i]) ridgePixelCount++;
    if (valleyBitmap[i]) valleyPixelCount++;
  }

  console.log(`[DSM_EDGE_DETECTOR] Ridge pixels: ${ridgePixelCount}, Valley pixels: ${valleyPixelCount}`);

  // Step 5: Connected components with minimum size
  // At ~0.1m/pixel, a 3m ridge is ~30 pixels. Use 1% of smallest dimension.
  const minComponentPixels = Math.max(5, Math.floor(Math.min(width, height) * 0.01));
  const ridgeComponents = extractConnectedComponents(ridgeBitmap, minEig, width, height, minComponentPixels);
  const valleyComponents = extractConnectedComponents(valleyBitmap, maxEig, width, height, minComponentPixels);

  console.log(`[DSM_EDGE_DETECTOR] Components: ${ridgeComponents.length} ridge, ${valleyComponents.length} valley (min ${minComponentPixels}px)`);

  // Step 6: Line fit and convert to geographic
  const ridges: DSMEdgeCandidate[] = [];
  const valleys: DSMEdgeCandidate[] = [];

  let maxCurv = 0;
  for (const c of [...ridgeComponents, ...valleyComponents]) {
    if (c.avgCurvature > maxCurv) maxCurv = c.avgCurvature;
  }
  if (maxCurv === 0) maxCurv = 1;

  for (const comp of ridgeComponents) {
    const line = fitLineToComponent(comp);
    if (!line) continue;

    const start = pixelToGeo(line.startPx[0], line.startPx[1], dsmGrid);
    const end = pixelToGeo(line.endPx[0], line.endPx[1], dsmGrid);

    const curvScore = Math.min(1, comp.avgCurvature / maxCurv);
    const dsmScore = 0.4 * curvScore + 0.3 * line.fitness + 0.3 * Math.min(1, comp.pixels.length / 50);

    ridges.push({
      start, end,
      startPx: line.startPx,
      endPx: line.endPx,
      type: 'ridge',
      dsm_score: dsmScore,
      pixelCount: comp.pixels.length,
      avgGradientMag: comp.avgCurvature,
    });
  }

  for (const comp of valleyComponents) {
    const line = fitLineToComponent(comp);
    if (!line) continue;

    const start = pixelToGeo(line.startPx[0], line.startPx[1], dsmGrid);
    const end = pixelToGeo(line.endPx[0], line.endPx[1], dsmGrid);

    const curvScore = Math.min(1, comp.avgCurvature / maxCurv);
    const dsmScore = 0.4 * curvScore + 0.3 * line.fitness + 0.3 * Math.min(1, comp.pixels.length / 50);

    valleys.push({
      start, end,
      startPx: line.startPx,
      endPx: line.endPx,
      type: 'valley',
      dsm_score: dsmScore,
      pixelCount: comp.pixels.length,
      avgGradientMag: comp.avgCurvature,
    });
  }

  ridges.sort((a, b) => b.dsm_score - a.dsm_score);
  valleys.sort((a, b) => b.dsm_score - a.dsm_score);

  const processingMs = Date.now() - startMs;

  console.log(`[DSM_EDGE_DETECTOR] Found ${ridges.length} ridges, ${valleys.length} valleys in ${processingMs}ms`);

  return {
    ridges,
    valleys,
    stats: {
      gridSize: `${width}x${height}`,
      roofPixels,
      ridgePixels: ridgePixelCount,
      valleyPixels: valleyPixelCount,
      ridgeCandidates: ridges.length,
      valleyCandidates: valleys.length,
      processingMs,
      elevRange: `${elevMin.toFixed(2)}-${elevMax.toFixed(2)}m`,
      curvatureRange: `${curvMin.toFixed(6)} to ${curvMax.toFixed(6)}`,
    },
  };
}

function emptyResult(width: number, height: number, roofPixels: number, ms: number): EdgeDetectionResult {
  return {
    ridges: [],
    valleys: [],
    stats: {
      gridSize: `${width}x${height}`,
      roofPixels,
      ridgePixels: 0,
      valleyPixels: 0,
      ridgeCandidates: 0,
      valleyCandidates: 0,
      processingMs: ms,
      elevRange: 'N/A',
      curvatureRange: 'N/A',
    },
  };
}
