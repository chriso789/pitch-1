/**
 * Document Edge Detection Utility
 *
 * Advanced edge detection for finding document boundaries in camera frames.
 * Uses color analysis, adaptive thresholding, and rectangle validation
 * to accurately detect documents against complex backgrounds.
 */

export interface Point {
  x: number;
  y: number;
}

export interface DetectedCorners {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  bottomRight: Point;
  confidence: number;
}

/**
 * Detect document edges in an image
 * Uses multi-stage detection: color analysis → edge detection → line finding → rectangle validation
 */
export function detectDocumentEdges(imageData: ImageData): DetectedCorners | null {
  const { width, height, data } = imageData;

  // Stage 1: Find bright regions (documents are typically white/light colored)
  const brightnessMask = findBrightRegions(data, width, height);

  // Stage 2: Apply morphological operations to clean up the mask
  const cleanedMask = morphologicalClose(brightnessMask, width, height, 3);

  // Stage 3: Find edges of the bright region
  const edges = findMaskEdges(cleanedMask, width, height);

  // Stage 4: Find the largest rectangular contour
  const corners = findLargestRectangle(edges, width, height);

  if (!corners) {
    // Fallback: Try pure edge detection for low-contrast documents
    return fallbackEdgeDetection(data, width, height);
  }

  // Sort corners: top-left, top-right, bottom-right, bottom-left
  const sorted = sortCorners(corners);

  // Calculate confidence based on shape quality
  const confidence = calculateConfidence(sorted, width, height, brightnessMask);

  if (confidence < 0.5) {
    return null;
  }

  return {
    topLeft: sorted[0],
    topRight: sorted[1],
    bottomRight: sorted[2],
    bottomLeft: sorted[3],
    confidence,
  };
}

/**
 * Find bright (document-like) regions in the image
 * Documents are typically white/off-white paper
 */
function findBrightRegions(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);

  // Calculate brightness histogram to find adaptive threshold
  const histogram = new Uint32Array(256);
  const brightnessValues = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    // Use perceived brightness
    const brightness = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    brightnessValues[i] = brightness;
    histogram[brightness]++;
  }

  // Find Otsu's threshold for automatic brightness separation
  const threshold = otsuThreshold(histogram, width * height);

  // Also check for low saturation (documents are usually not colorful)
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const brightness = brightnessValues[i];

    // Calculate saturation
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;

    // Document pixels: bright AND low saturation (white/gray paper)
    // Use a slightly lower threshold to capture document edges
    const adjustedThreshold = Math.max(threshold - 30, 100);
    if (brightness > adjustedThreshold && saturation < 0.4) {
      mask[i] = 255;
    }
  }

  return mask;
}

/**
 * Otsu's method for automatic threshold selection
 */
function otsuThreshold(histogram: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVariance = 0;
  let threshold = 0;

  for (let i = 0; i < 256; i++) {
    wB += histogram[i];
    if (wB === 0) continue;

    wF = total - wB;
    if (wF === 0) break;

    sumB += i * histogram[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;

    const variance = wB * wF * (mB - mF) * (mB - mF);

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = i;
    }
  }

  return threshold;
}

/**
 * Morphological closing to fill gaps in the mask
 */
function morphologicalClose(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  // Dilate then erode
  const dilated = dilate(mask, width, height, radius);
  return erode(dilated, width, height, radius);
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const output = new Uint8Array(width * height);

  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      let hasWhite = false;
      for (let dy = -radius; dy <= radius && !hasWhite; dy++) {
        for (let dx = -radius; dx <= radius && !hasWhite; dx++) {
          if (mask[(y + dy) * width + (x + dx)] === 255) {
            hasWhite = true;
          }
        }
      }
      output[y * width + x] = hasWhite ? 255 : 0;
    }
  }

  return output;
}

function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const output = new Uint8Array(width * height);

  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      let allWhite = true;
      for (let dy = -radius; dy <= radius && allWhite; dy++) {
        for (let dx = -radius; dx <= radius && allWhite; dx++) {
          if (mask[(y + dy) * width + (x + dx)] !== 255) {
            allWhite = false;
          }
        }
      }
      output[y * width + x] = allWhite ? 255 : 0;
    }
  }

  return output;
}

/**
 * Find edges of a binary mask
 */
function findMaskEdges(mask: Uint8Array, width: number, height: number): Uint8Array {
  const edges = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (mask[idx] === 255) {
        // Check if this is an edge pixel (has a non-white neighbor)
        const hasBlackNeighbor =
          mask[idx - 1] === 0 ||
          mask[idx + 1] === 0 ||
          mask[idx - width] === 0 ||
          mask[idx + width] === 0;

        if (hasBlackNeighbor) {
          edges[idx] = 255;
        }
      }
    }
  }

  return edges;
}

/**
 * Find the largest rectangle in edge points using contour analysis
 */
function findLargestRectangle(edges: Uint8Array, width: number, height: number): Point[] | null {
  // Collect edge points
  const edgePoints: Point[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x] === 255) {
        edgePoints.push({ x, y });
      }
    }
  }

  // Need enough points to form a meaningful shape
  if (edgePoints.length < 100) {
    return null;
  }

  // Find convex hull
  const hull = convexHull(edgePoints);

  if (hull.length < 4) {
    return null;
  }

  // Simplify to quadrilateral using Douglas-Peucker
  const simplified = douglasPeucker(hull, 10);

  // Find the best 4 corners
  const corners = extractFourCorners(simplified, width, height);

  if (!corners || !isValidRectangle(corners, width, height)) {
    return null;
  }

  return corners;
}

/**
 * Douglas-Peucker line simplification
 */
function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;

  // Find the point with maximum distance from the line between first and last
  let maxDist = 0;
  let maxIdx = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) return distance(point, lineStart);

  const t = Math.max(0, Math.min(1,
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (len * len)
  ));

  const projection = {
    x: lineStart.x + t * dx,
    y: lineStart.y + t * dy,
  };

  return distance(point, projection);
}

/**
 * Extract exactly 4 corners from a simplified polygon
 */
function extractFourCorners(polygon: Point[], width: number, height: number): Point[] | null {
  if (polygon.length < 4) return null;

  if (polygon.length === 4) return polygon;

  // Find the 4 points with the sharpest angles (most corner-like)
  const angles: { point: Point; angle: number; idx: number }[] = [];

  for (let i = 0; i < polygon.length; i++) {
    const prev = polygon[(i - 1 + polygon.length) % polygon.length];
    const curr = polygon[i];
    const next = polygon[(i + 1) % polygon.length];

    const angle = calculateAngle(prev, curr, next);
    angles.push({ point: curr, angle, idx: i });
  }

  // Sort by angle (smaller angles = sharper corners)
  angles.sort((a, b) => a.angle - b.angle);

  // Take the 4 sharpest corners
  const corners = angles.slice(0, 4).map(a => a.point);

  return corners;
}

function calculateAngle(a: Point, b: Point, c: Point): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };

  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

  if (mag1 === 0 || mag2 === 0) return Math.PI;

  const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return Math.acos(cosAngle);
}

/**
 * Validate that corners form a reasonable rectangle
 */
function isValidRectangle(corners: Point[], width: number, height: number): boolean {
  if (corners.length !== 4) return false;

  const sorted = sortCorners(corners);

  // Check minimum size (at least 15% of frame in each dimension)
  const minWidth = width * 0.15;
  const minHeight = height * 0.15;

  const topWidth = distance(sorted[0], sorted[1]);
  const bottomWidth = distance(sorted[3], sorted[2]);
  const leftHeight = distance(sorted[0], sorted[3]);
  const rightHeight = distance(sorted[1], sorted[2]);

  if (topWidth < minWidth || bottomWidth < minWidth) return false;
  if (leftHeight < minHeight || rightHeight < minHeight) return false;

  // Check that opposite sides are roughly parallel (within 30%)
  const widthRatio = Math.min(topWidth, bottomWidth) / Math.max(topWidth, bottomWidth);
  const heightRatio = Math.min(leftHeight, rightHeight) / Math.max(leftHeight, rightHeight);

  if (widthRatio < 0.7 || heightRatio < 0.7) return false;

  // Check aspect ratio (should be roughly document-like: 0.5 to 2.0)
  const avgWidth = (topWidth + bottomWidth) / 2;
  const avgHeight = (leftHeight + rightHeight) / 2;
  const aspectRatio = avgHeight / avgWidth;

  if (aspectRatio < 0.5 || aspectRatio > 2.0) return false;

  // Check that all corners are within the frame
  for (const corner of sorted) {
    if (corner.x < 0 || corner.x > width || corner.y < 0 || corner.y > height) {
      return false;
    }
  }

  return true;
}

/**
 * Fallback edge detection for low-contrast documents
 */
function fallbackEdgeDetection(data: Uint8ClampedArray, width: number, height: number): DetectedCorners | null {
  // Convert to grayscale
  const grayscale = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Apply stronger blur to reduce noise
  const blurred = gaussianBlur5x5(grayscale, width, height);

  // Canny-style edge detection with hysteresis
  const edges = cannyEdgeDetection(blurred, width, height);

  // Find quadrilateral
  const corners = findLargestRectangle(edges, width, height);

  if (!corners) return null;

  const sorted = sortCorners(corners);
  const confidence = calculateConfidence(sorted, width, height, null);

  if (confidence < 0.45) return null;

  return {
    topLeft: sorted[0],
    topRight: sorted[1],
    bottomRight: sorted[2],
    bottomLeft: sorted[3],
    confidence: confidence * 0.9, // Slightly lower confidence for fallback
  };
}

/**
 * 5x5 Gaussian blur for stronger noise reduction
 */
function gaussianBlur5x5(input: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height);
  const kernel = [
    1, 4, 7, 4, 1,
    4, 16, 26, 16, 4,
    7, 26, 41, 26, 7,
    4, 16, 26, 16, 4,
    1, 4, 7, 4, 1,
  ];
  const kernelSum = 273;

  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      let sum = 0;
      let ki = 0;
      for (let ky = -2; ky <= 2; ky++) {
        for (let kx = -2; kx <= 2; kx++) {
          sum += input[(y + ky) * width + (x + kx)] * kernel[ki++];
        }
      }
      output[y * width + x] = Math.round(sum / kernelSum);
    }
  }

  return output;
}

/**
 * Canny-style edge detection with gradient direction and hysteresis
 */
function cannyEdgeDetection(input: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height);

  // Sobel kernels
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  const magnitudes = new Float32Array(width * height);
  const directions = new Float32Array(width * height);
  let maxMag = 0;

  // Calculate gradient magnitude and direction
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0;
      let ki = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const val = input[(y + ky) * width + (x + kx)];
          gx += val * sobelX[ki];
          gy += val * sobelY[ki];
          ki++;
        }
      }

      const mag = Math.sqrt(gx * gx + gy * gy);
      const idx = y * width + x;
      magnitudes[idx] = mag;
      directions[idx] = Math.atan2(gy, gx);
      if (mag > maxMag) maxMag = mag;
    }
  }

  // Non-maximum suppression
  const suppressed = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const mag = magnitudes[idx];
      const dir = directions[idx];

      // Get neighbors based on gradient direction
      let neighbor1 = 0, neighbor2 = 0;
      const angle = ((dir * 180 / Math.PI) + 180) % 180;

      if (angle < 22.5 || angle >= 157.5) {
        neighbor1 = magnitudes[idx - 1];
        neighbor2 = magnitudes[idx + 1];
      } else if (angle < 67.5) {
        neighbor1 = magnitudes[idx - width + 1];
        neighbor2 = magnitudes[idx + width - 1];
      } else if (angle < 112.5) {
        neighbor1 = magnitudes[idx - width];
        neighbor2 = magnitudes[idx + width];
      } else {
        neighbor1 = magnitudes[idx - width - 1];
        neighbor2 = magnitudes[idx + width + 1];
      }

      if (mag >= neighbor1 && mag >= neighbor2) {
        suppressed[idx] = mag;
      }
    }
  }

  // Hysteresis thresholding
  const highThreshold = maxMag * 0.15;
  const lowThreshold = maxMag * 0.05;

  // First pass: mark strong edges
  for (let i = 0; i < suppressed.length; i++) {
    if (suppressed[i] >= highThreshold) {
      output[i] = 255;
    }
  }

  // Second pass: extend edges to connected weak edges
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (output[idx] === 0 && suppressed[idx] >= lowThreshold) {
          // Check if connected to a strong edge
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (output[idx + dy * width + dx] === 255) {
                output[idx] = 255;
                changed = true;
                break;
              }
            }
            if (output[idx] === 255) break;
          }
        }
      }
    }
  }

  return output;
}

/**
 * Compute convex hull using Graham scan
 */
function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return points;

  // Find lowest point
  let lowest = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].y > points[lowest].y ||
        (points[i].y === points[lowest].y && points[i].x < points[lowest].x)) {
      lowest = i;
    }
  }

  const pivot = points[lowest];

  // Sort by polar angle
  const sorted = points
    .filter((_, i) => i !== lowest)
    .map(p => ({
      point: p,
      angle: Math.atan2(p.y - pivot.y, p.x - pivot.x),
    }))
    .sort((a, b) => a.angle - b.angle)
    .map(p => p.point);

  const hull: Point[] = [pivot];

  for (const p of sorted) {
    while (hull.length > 1 && crossProduct(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
      hull.pop();
    }
    hull.push(p);
  }

  return hull;
}

function crossProduct(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Sort corners in order: TL, TR, BR, BL
 */
function sortCorners(corners: Point[]): Point[] {
  // Find centroid
  const centroid = {
    x: corners.reduce((s, p) => s + p.x, 0) / corners.length,
    y: corners.reduce((s, p) => s + p.y, 0) / corners.length,
  };

  // Sort by angle from centroid
  const withAngles = corners.map(p => ({
    point: p,
    angle: Math.atan2(p.y - centroid.y, p.x - centroid.x),
  }));

  // Sort clockwise starting from top-left (angle around -3π/4)
  withAngles.sort((a, b) => a.angle - b.angle);

  // Find the top-left corner (smallest y, if tie then smallest x)
  const sorted = withAngles.map(a => a.point);

  // Reorder to start from top-left
  let topLeftIdx = 0;
  let minSum = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const sum = sorted[i].x + sorted[i].y;
    if (sum < minSum) {
      minSum = sum;
      topLeftIdx = i;
    }
  }

  // Rotate array to start from top-left
  const result = [...sorted.slice(topLeftIdx), ...sorted.slice(0, topLeftIdx)];

  return result;
}

/**
 * Calculate detection confidence (0-1)
 */
function calculateConfidence(
  corners: Point[],
  width: number,
  height: number,
  brightnessMask: Uint8Array | null
): number {
  // Calculate area covered
  const area = quadrilateralArea(corners);
  const frameArea = width * height;
  const coverageRatio = area / frameArea;

  // Ideal coverage is 20-80% of frame
  let coverageScore = 0;
  if (coverageRatio > 0.15 && coverageRatio < 0.85) {
    if (coverageRatio > 0.25 && coverageRatio < 0.75) {
      coverageScore = 1.0;
    } else {
      coverageScore = 0.7;
    }
  }

  // Check aspect ratio (should be roughly letter/A4: 1:1.3 to 1:1.5)
  const widthTop = distance(corners[0], corners[1]);
  const widthBottom = distance(corners[3], corners[2]);
  const heightLeft = distance(corners[0], corners[3]);
  const heightRight = distance(corners[1], corners[2]);

  const avgWidth = (widthTop + widthBottom) / 2;
  const avgHeight = (heightLeft + heightRight) / 2;
  const aspectRatio = avgHeight / avgWidth;

  // Accept wider range of aspect ratios (0.7 to 1.6)
  let aspectScore = 0;
  if (aspectRatio >= 0.7 && aspectRatio <= 1.6) {
    // Ideal is around 1.29 for letter paper
    aspectScore = 1 - Math.min(1, Math.abs(aspectRatio - 1.29) / 0.6);
  }

  // Check parallelism (opposite sides should be similar length)
  const widthDiff = Math.abs(widthTop - widthBottom) / Math.max(widthTop, widthBottom);
  const heightDiff = Math.abs(heightLeft - heightRight) / Math.max(heightLeft, heightRight);
  const parallelScore = 1 - Math.min(1, (widthDiff + heightDiff));

  // Check that the detected region is actually bright (if mask available)
  let brightnessScore = 0.7; // Default if no mask
  if (brightnessMask) {
    // Sample points inside the quadrilateral
    let brightPixels = 0;
    let totalSamples = 0;

    const minX = Math.floor(Math.min(corners[0].x, corners[3].x));
    const maxX = Math.ceil(Math.max(corners[1].x, corners[2].x));
    const minY = Math.floor(Math.min(corners[0].y, corners[1].y));
    const maxY = Math.ceil(Math.max(corners[2].y, corners[3].y));

    for (let y = minY; y < maxY; y += 5) {
      for (let x = minX; x < maxX; x += 5) {
        if (isPointInQuadrilateral({ x, y }, corners)) {
          totalSamples++;
          if (brightnessMask[y * width + x] === 255) {
            brightPixels++;
          }
        }
      }
    }

    if (totalSamples > 0) {
      brightnessScore = brightPixels / totalSamples;
    }
  }

  // Combined score with weighted factors
  return (
    coverageScore * 0.25 +
    aspectScore * 0.25 +
    parallelScore * 0.25 +
    brightnessScore * 0.25
  );
}

function isPointInQuadrilateral(point: Point, quad: Point[]): boolean {
  // Use cross products to check if point is on the same side of all edges
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const cross = crossProduct(quad[i], quad[j], point);
    if (cross < 0) return false;
  }
  return true;
}

function quadrilateralArea(corners: Point[]): number {
  // Shoelace formula
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += corners[i].x * corners[j].y;
    area -= corners[j].x * corners[i].y;
  }
  return Math.abs(area) / 2;
}

function distance(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}
