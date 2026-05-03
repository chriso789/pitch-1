/**
 * DSM Edge Detector — Gradient-based ridge/valley/hip detection at any angle
 * 
 * Step 2 of the corrected pipeline:
 *   - Sobel gradient on DSM → detect local height maxima (ridges) and minima (valleys)
 *   - Connected-component analysis groups gradient-response pixels into line segments
 *   - Least-squares fit through each component → candidate structural edges at any angle
 *   - Edges scored by DSM gradient strength
 * 
 * This replaces the old axis-aligned findLinearRuns() which only found horizontal/vertical lines.
 */

import type { DSMGrid, MaskedDSMGrid } from "./dsm-analyzer.ts";
import { pixelToGeo } from "./dsm-analyzer.ts";

type XY = [number, number];

export interface DSMEdgeCandidate {
  start: XY;            // [lng, lat]
  end: XY;              // [lng, lat]
  startPx: [number, number]; // [x, y] in DSM pixel coords
  endPx: [number, number];
  type: 'ridge' | 'valley';
  dsm_score: number;    // 0–1 confidence from gradient strength
  pixelCount: number;   // how many pixels in the connected component
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
  };
}

// ============= SOBEL GRADIENT =============

/**
 * Compute Sobel gradient magnitude and direction for each pixel.
 * Returns { gx, gy, mag } arrays (flat, row-major).
 */
function sobelGradient(
  data: Float32Array,
  width: number,
  height: number,
  noData: number
): { gx: Float32Array; gy: Float32Array; mag: Float32Array } {
  const len = width * height;
  const gx = new Float32Array(len);
  const gy = new Float32Array(len);
  const mag = new Float32Array(len);

  // Get pixel value, substituting center value for noData neighbors
  // so roof-edge pixels aren't zeroed out by off-roof noData
  const getOrCenter = (x: number, y: number, center: number): number => {
    if (x < 0 || x >= width || y < 0 || y >= height) return center;
    const v = data[y * width + x];
    return (v === noData || isNaN(v)) ? center : v;
  };

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const centerVal = data[y * width + x];
      // Skip if center is noData
      if (centerVal === noData || isNaN(centerVal)) continue;

      // Get 3x3 neighborhood — noData neighbors get center value (zero gradient contribution)
      const tl = getOrCenter(x - 1, y - 1, centerVal);
      const tc = getOrCenter(x, y - 1, centerVal);
      const tr = getOrCenter(x + 1, y - 1, centerVal);
      const ml = getOrCenter(x - 1, y, centerVal);
      const mr = getOrCenter(x + 1, y, centerVal);
      const bl = getOrCenter(x - 1, y + 1, centerVal);
      const bc = getOrCenter(x, y + 1, centerVal);
      const br = getOrCenter(x + 1, y + 1, centerVal);

      const idx = y * width + x;
      gx[idx] = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      gy[idx] = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      mag[idx] = Math.sqrt(gx[idx] * gx[idx] + gy[idx] * gy[idx]);
    }
  }

  return { gx, gy, mag };
}

// ============= RIDGE/VALLEY PIXEL DETECTION =============

/**
 * Detect ridge pixels: local height maxima along the gradient direction.
 * A pixel is a ridge pixel if its elevation is higher than both neighbors
 * along the gradient direction (non-maximum suppression on elevation).
 */
function detectStructuralPixels(
  data: Float32Array,
  gx: Float32Array,
  gy: Float32Array,
  mag: Float32Array,
  width: number,
  height: number,
  noData: number,
  mask: Uint8Array | null,
  type: 'ridge' | 'valley'
): Uint8Array {
  const result = new Uint8Array(width * height);

  // Compute gradient magnitude threshold (adaptive: top 20% of gradient values)
  const validMags: number[] = [];
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] > 0 && data[i] !== noData && (!mask || mask[i] > 0)) {
      validMags.push(mag[i]);
    }
  }
  if (validMags.length < 10) return result;

  validMags.sort((a, b) => a - b);
  const gradThreshold = validMags[Math.floor(validMags.length * 0.15)] || 0.05;

  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * width + x;
      if (mask && mask[idx] === 0) continue;
      if (data[idx] === noData || isNaN(data[idx])) continue;
      if (mag[idx] < gradThreshold) continue;

      // Gradient direction
      const angle = Math.atan2(gy[idx], gx[idx]);
      // Sample perpendicular to the gradient for ridge/valley detection
      // Ridge: max elevation perpendicular to gradient → the gradient points
      //        away from the ridge on both sides
      // Valley: min elevation perpendicular to gradient

      // Step along gradient direction to check if this is a local max/min
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);

      // Sample 2 pixels in each direction along gradient
      const x1 = Math.round(x + dx);
      const y1 = Math.round(y + dy);
      const x2 = Math.round(x - dx);
      const y2 = Math.round(y - dy);

      if (x1 < 0 || x1 >= width || y1 < 0 || y1 >= height) continue;
      if (x2 < 0 || x2 >= width || y2 < 0 || y2 >= height) continue;

      const v0 = data[idx];
      const v1 = data[y1 * width + x1];
      const v2 = data[y2 * width + x2];

      if (v1 === noData || v2 === noData) continue;

      if (type === 'ridge') {
        // Ridge: this pixel is higher than both neighbors along gradient
        if (v0 > v1 && v0 > v2) {
          result[idx] = 1;
        }
      } else {
        // Valley: this pixel is lower than both neighbors along gradient
        if (v0 < v1 && v0 < v2) {
          result[idx] = 1;
        }
      }
    }
  }

  return result;
}

// ============= CONNECTED COMPONENTS =============

interface Component {
  pixels: Array<[number, number]>; // [x, y]
  sumX: number;
  sumY: number;
  sumXX: number;
  sumXY: number;
  sumYY: number;
  avgGradMag: number;
}

/**
 * Extract connected components from a binary pixel map using 8-connectivity.
 * Returns components with at least minPixels pixels.
 */
function extractConnectedComponents(
  bitmap: Uint8Array,
  width: number,
  height: number,
  mag: Float32Array,
  minPixels: number = 3
): Component[] {
  const visited = new Uint8Array(width * height);
  const components: Component[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (bitmap[idx] === 0 || visited[idx]) continue;

      // BFS flood fill
      const queue: Array<[number, number]> = [[x, y]];
      const pixels: Array<[number, number]> = [];
      let sumGrad = 0;
      visited[idx] = 1;

      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!;
        pixels.push([cx, cy]);
        sumGrad += mag[cy * width + cx];

        // 8-connectivity
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

      // Compute statistics for least-squares line fit
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
        sumX,
        sumY,
        sumXX,
        sumXY,
        sumYY,
        avgGradMag: sumGrad / pixels.length,
      });
    }
  }

  return components;
}

// ============= LEAST-SQUARES LINE FIT =============

/**
 * Fit a line to a connected component using PCA (principal axis).
 * Returns the two extreme points projected onto the principal axis.
 */
function fitLineToComponent(
  comp: Component
): { startPx: [number, number]; endPx: [number, number]; fitness: number } | null {
  const n = comp.pixels.length;
  if (n < 3) return null;

  const mx = comp.sumX / n;
  const my = comp.sumY / n;

  // Covariance matrix
  const cxx = comp.sumXX / n - mx * mx;
  const cxy = comp.sumXY / n - mx * my;
  const cyy = comp.sumYY / n - my * my;

  // Principal eigenvector via analytic formula for 2x2 symmetric matrix
  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const lambda1 = trace / 2 + disc;
  const lambda2 = trace / 2 - disc;

  // Fitness: how "line-like" is the component (ratio of eigenvalues)
  const fitness = lambda1 > 0 ? 1 - (lambda2 / lambda1) : 0;
  if (fitness < 0.5) return null; // Too blobby, not a line

  // Principal direction
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

  // Project all pixels onto principal axis
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

// ============= MAIN DETECTION FUNCTION =============

/**
 * Detect structural edges (ridges and valleys) from DSM using gradient analysis.
 * Works at any angle — no axis-aligned restriction.
 * 
 * Pipeline:
 *   1. Sobel gradient on DSM
 *   2. Non-maximum suppression to find ridge/valley pixels
 *   3. Connected component analysis
 *   4. Least-squares line fit per component
 *   5. Convert pixel coords to geographic coords
 *   6. Score by gradient magnitude and line fitness
 */
export function detectStructuralEdges(
  dsmGrid: DSMGrid,
  mask: Uint8Array | null = null
): EdgeDetectionResult {
  const startMs = Date.now();
  const { data, width, height, noDataValue } = dsmGrid;

  // Count roof pixels
  let roofPixels = 0;
  if (mask) {
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] > 0) roofPixels++;
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== noDataValue && !isNaN(data[i])) roofPixels++;
    }
  }

  console.log(`[DSM_EDGE_DETECTOR] Grid ${width}x${height}, ${roofPixels} roof pixels`);

  // Step 1: Sobel gradient
  const { gx, gy, mag } = sobelGradient(data, width, height, noDataValue);

  // Step 2: Detect ridge and valley pixels
  const ridgeBitmap = detectStructuralPixels(data, gx, gy, mag, width, height, noDataValue, mask, 'ridge');
  const valleyBitmap = detectStructuralPixels(data, gx, gy, mag, width, height, noDataValue, mask, 'valley');

  let ridgePixelCount = 0, valleyPixelCount = 0;
  for (let i = 0; i < ridgeBitmap.length; i++) {
    if (ridgeBitmap[i]) ridgePixelCount++;
    if (valleyBitmap[i]) valleyPixelCount++;
  }

  // Step 3: Connected components
  const minComponentPixels = Math.max(3, Math.floor(Math.min(width, height) * 0.05));
  const ridgeComponents = extractConnectedComponents(ridgeBitmap, width, height, mag, minComponentPixels);
  const valleyComponents = extractConnectedComponents(valleyBitmap, width, height, mag, minComponentPixels);

  // Step 4 & 5: Line fit and convert to geographic
  const ridges: DSMEdgeCandidate[] = [];
  const valleys: DSMEdgeCandidate[] = [];

  // Compute max gradient for normalization
  let maxGrad = 0;
  for (const c of [...ridgeComponents, ...valleyComponents]) {
    if (c.avgGradMag > maxGrad) maxGrad = c.avgGradMag;
  }
  if (maxGrad === 0) maxGrad = 1;

  for (const comp of ridgeComponents) {
    const line = fitLineToComponent(comp);
    if (!line) continue;

    const start = pixelToGeo(line.startPx[0], line.startPx[1], dsmGrid);
    const end = pixelToGeo(line.endPx[0], line.endPx[1], dsmGrid);

    // DSM score: combination of gradient magnitude and line fitness
    const gradScore = Math.min(1, comp.avgGradMag / maxGrad);
    const dsmScore = 0.5 * gradScore + 0.5 * line.fitness;

    ridges.push({
      start, end,
      startPx: line.startPx,
      endPx: line.endPx,
      type: 'ridge',
      dsm_score: dsmScore,
      pixelCount: comp.pixels.length,
      avgGradientMag: comp.avgGradMag,
    });
  }

  for (const comp of valleyComponents) {
    const line = fitLineToComponent(comp);
    if (!line) continue;

    const start = pixelToGeo(line.startPx[0], line.startPx[1], dsmGrid);
    const end = pixelToGeo(line.endPx[0], line.endPx[1], dsmGrid);

    const gradScore = Math.min(1, comp.avgGradMag / maxGrad);
    const dsmScore = 0.5 * gradScore + 0.5 * line.fitness;

    valleys.push({
      start, end,
      startPx: line.startPx,
      endPx: line.endPx,
      type: 'valley',
      dsm_score: dsmScore,
      pixelCount: comp.pixels.length,
      avgGradientMag: comp.avgGradMag,
    });
  }

  // Sort by score descending
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
    },
  };
}
