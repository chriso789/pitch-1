/**
 * Document Edge Detection Utility
 * 
 * Pure canvas-based edge detection for finding document boundaries in camera frames.
 * Optimized for mobile performance with downsampled processing.
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
 * Returns corners if a quadrilateral document is found, null otherwise
 */
export function detectDocumentEdges(imageData: ImageData): DetectedCorners | null {
  const { width, height, data } = imageData;
  
  // 1. Convert to grayscale
  const grayscale = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  
  // 2. Apply Gaussian blur (3x3 kernel)
  const blurred = gaussianBlur(grayscale, width, height);
  
  // 3. Sobel edge detection
  const edges = sobelEdgeDetection(blurred, width, height);
  
  // 4. Find contours and detect largest quadrilateral
  const corners = findDocumentQuadrilateral(edges, width, height);
  
  return corners;
}

/**
 * Apply 3x3 Gaussian blur
 */
function gaussianBlur(input: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height);
  const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const kernelSum = 16;
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sum = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          sum += input[(y + ky) * width + (x + kx)] * kernel[ki++];
        }
      }
      output[y * width + x] = Math.round(sum / kernelSum);
    }
  }
  
  return output;
}

/**
 * Sobel edge detection with non-maximum suppression
 */
function sobelEdgeDetection(input: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height);
  
  // Sobel kernels
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  
  // Calculate edge magnitude
  let maxMag = 0;
  const magnitudes = new Float32Array(width * height);
  
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
      magnitudes[y * width + x] = mag;
      if (mag > maxMag) maxMag = mag;
    }
  }
  
  // Normalize and threshold
  const threshold = maxMag * 0.15; // 15% of max as threshold
  for (let i = 0; i < magnitudes.length; i++) {
    output[i] = magnitudes[i] > threshold ? 255 : 0;
  }
  
  return output;
}

/**
 * Find the largest quadrilateral contour in edge image
 */
function findDocumentQuadrilateral(
  edges: Uint8Array, 
  width: number, 
  height: number
): DetectedCorners | null {
  // Find all edge points
  const edgePoints: Point[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x] === 255) {
        edgePoints.push({ x, y });
      }
    }
  }
  
  if (edgePoints.length < 100) {
    return null; // Not enough edge points
  }
  
  // Use convex hull to find outer boundary
  const hull = convexHull(edgePoints);
  
  if (hull.length < 4) {
    return null;
  }
  
  // Simplify hull to 4 corners (Douglas-Peucker-like approach)
  const corners = simplifyToQuadrilateral(hull, width, height);
  
  if (!corners) {
    return null;
  }
  
  // Sort corners: top-left, top-right, bottom-right, bottom-left
  const sorted = sortCorners(corners);
  
  // Calculate confidence based on aspect ratio and coverage
  const confidence = calculateConfidence(sorted, width, height);
  
  if (confidence < 0.3) {
    return null; // Too low confidence
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
 * Simplify convex hull to exactly 4 corners
 */
function simplifyToQuadrilateral(hull: Point[], width: number, height: number): Point[] | null {
  if (hull.length < 4) return null;
  
  // Find 4 points with maximum distance from centroid in different quadrants
  const centroid = {
    x: hull.reduce((s, p) => s + p.x, 0) / hull.length,
    y: hull.reduce((s, p) => s + p.y, 0) / hull.length,
  };
  
  // Divide into quadrants and find farthest point in each
  const quadrants: (Point | null)[] = [null, null, null, null]; // TL, TR, BR, BL
  const distances: number[] = [0, 0, 0, 0];
  
  for (const p of hull) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    let quadrant: number;
    if (dy < 0 && dx < 0) quadrant = 0; // Top-left
    else if (dy < 0 && dx >= 0) quadrant = 1; // Top-right
    else if (dy >= 0 && dx >= 0) quadrant = 2; // Bottom-right
    else quadrant = 3; // Bottom-left
    
    if (dist > distances[quadrant]) {
      distances[quadrant] = dist;
      quadrants[quadrant] = p;
    }
  }
  
  // Check if we found all 4 corners
  if (quadrants.some(q => q === null)) {
    return null;
  }
  
  return quadrants as Point[];
}

/**
 * Sort corners in order: TL, TR, BR, BL
 */
function sortCorners(corners: Point[]): Point[] {
  // Sort by y first (top to bottom), then x
  const sorted = [...corners].sort((a, b) => a.y - b.y || a.x - b.x);
  
  // Top two points (lower y)
  const topPoints = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  // Bottom two points (higher y)
  const bottomPoints = sorted.slice(2).sort((a, b) => a.x - b.x);
  
  return [
    topPoints[0],    // Top-left
    topPoints[1],    // Top-right
    bottomPoints[1], // Bottom-right
    bottomPoints[0], // Bottom-left
  ];
}

/**
 * Calculate detection confidence (0-1)
 */
function calculateConfidence(corners: Point[], width: number, height: number): number {
  // Calculate area covered
  const area = quadrilateralArea(corners);
  const frameArea = width * height;
  const coverageRatio = area / frameArea;
  
  // Ideal coverage is 50-90% of frame
  let coverageScore = 0;
  if (coverageRatio > 0.2 && coverageRatio < 0.95) {
    coverageScore = Math.min(1, coverageRatio / 0.5);
  }
  
  // Check aspect ratio (should be roughly letter/A4: 1:1.3 to 1:1.5)
  const widthTop = distance(corners[0], corners[1]);
  const widthBottom = distance(corners[3], corners[2]);
  const heightLeft = distance(corners[0], corners[3]);
  const heightRight = distance(corners[1], corners[2]);
  
  const avgWidth = (widthTop + widthBottom) / 2;
  const avgHeight = (heightLeft + heightRight) / 2;
  const aspectRatio = avgHeight / avgWidth;
  
  // Ideal aspect ratio for letter paper is ~1.29 (11/8.5)
  const aspectScore = 1 - Math.min(1, Math.abs(aspectRatio - 1.29) / 0.5);
  
  // Check parallelism (opposite sides should be similar length)
  const widthDiff = Math.abs(widthTop - widthBottom) / Math.max(widthTop, widthBottom);
  const heightDiff = Math.abs(heightLeft - heightRight) / Math.max(heightLeft, heightRight);
  const parallelScore = 1 - (widthDiff + heightDiff) / 2;
  
  // Combined score
  return (coverageScore * 0.4 + aspectScore * 0.3 + parallelScore * 0.3);
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
