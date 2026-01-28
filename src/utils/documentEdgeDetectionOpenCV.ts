/**
 * OpenCV.js-based Document Edge Detection
 * 
 * Uses Canny edge detection + contour finding for robust document boundary detection.
 * Lazy-loaded to avoid 8MB bundle impact on main app.
 */

import type { DetectedCorners, Point } from './documentEdgeDetection';

// OpenCV instance (lazy loaded)
let cv: any = null;
let cvLoadingPromise: Promise<void> | null = null;
let cvLoadFailed = false;

/**
 * Lazy load OpenCV.js from CDN
 */
export async function loadOpenCV(): Promise<boolean> {
  if (cv) return true;
  if (cvLoadFailed) return false;
  
  if (cvLoadingPromise) {
    await cvLoadingPromise;
    return cv !== null;
  }
  
  cvLoadingPromise = new Promise<void>((resolve, reject) => {
    // Check if already loaded globally
    if ((window as any).cv && (window as any).cv.Mat) {
      cv = (window as any).cv;
      console.log('[OpenCV] Already loaded globally');
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;
    
    const timeout = setTimeout(() => {
      cvLoadFailed = true;
      reject(new Error('OpenCV load timeout'));
    }, 30000); // 30 second timeout
    
    script.onload = () => {
      // OpenCV.js uses Module.onRuntimeInitialized
      const checkReady = () => {
        if ((window as any).cv && (window as any).cv.Mat) {
          clearTimeout(timeout);
          cv = (window as any).cv;
          console.log('[OpenCV] Loaded successfully');
          resolve();
        } else {
          // Wait for runtime initialization
          setTimeout(checkReady, 100);
        }
      };
      
      // Set callback for when OpenCV is ready
      if ((window as any).cv) {
        (window as any).cv.onRuntimeInitialized = () => {
          clearTimeout(timeout);
          cv = (window as any).cv;
          console.log('[OpenCV] Runtime initialized');
          resolve();
        };
      }
      
      // Also poll as fallback
      checkReady();
    };
    
    script.onerror = () => {
      clearTimeout(timeout);
      cvLoadFailed = true;
      console.warn('[OpenCV] Failed to load from CDN');
      reject(new Error('OpenCV failed to load'));
    };
    
    document.head.appendChild(script);
  });
  
  try {
    await cvLoadingPromise;
    return true;
  } catch (e) {
    console.warn('[OpenCV] Load failed:', e);
    return false;
  }
}

/**
 * Check if OpenCV is available
 */
export function isOpenCVAvailable(): boolean {
  return cv !== null;
}

/**
 * Detect document edges using OpenCV.js
 * Returns corners if a quadrilateral document is found, null otherwise
 */
export async function detectDocumentEdgesOpenCV(imageData: ImageData): Promise<DetectedCorners | null> {
  if (!cv) {
    const loaded = await loadOpenCV();
    if (!loaded) return null;
  }
  
  const { width, height, data } = imageData;
  
  let src: any = null;
  let gray: any = null;
  let blurred: any = null;
  let edges: any = null;
  let contours: any = null;
  let hierarchy: any = null;
  
  try {
    // Create Mat from ImageData
    src = cv.matFromImageData(imageData);
    
    // Convert to grayscale
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    
    // Apply Gaussian blur
    blurred = new cv.Mat();
    const ksize = new cv.Size(5, 5);
    cv.GaussianBlur(gray, blurred, ksize, 0);
    
    // Calculate median for adaptive Canny thresholds
    const median = calculateMedian(blurred);
    const lowThresh = Math.max(0, (1 - 0.33) * median);
    const highThresh = Math.min(255, (1 + 0.33) * median);
    
    // Canny edge detection
    edges = new cv.Mat();
    cv.Canny(blurred, edges, lowThresh, highThresh);
    
    // Morphological operations to close gaps
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 2);
    cv.erode(edges, edges, kernel, new cv.Point(-1, -1), 1);
    kernel.delete();
    
    // Find contours
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    
    // Find best quadrilateral contour
    let bestContour: any = null;
    let bestScore = 0;
    const frameArea = width * height;
    
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      
      // Skip too small or too large contours
      if (area < frameArea * 0.10 || area > frameArea * 0.95) {
        continue;
      }
      
      // Approximate to polygon
      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * peri, true);
      
      // Check if it's a quadrilateral
      if (approx.rows === 4) {
        const score = scoreQuadrilateral(approx, area, frameArea, width, height);
        if (score > bestScore) {
          if (bestContour) bestContour.delete();
          bestContour = approx;
          bestScore = score;
        } else {
          approx.delete();
        }
      } else {
        approx.delete();
      }
    }
    
    if (!bestContour || bestScore < 0.4) {
      if (bestContour) bestContour.delete();
      return null;
    }
    
    // Extract corners
    const corners: Point[] = [];
    for (let i = 0; i < 4; i++) {
      corners.push({
        x: bestContour.data32S[i * 2],
        y: bestContour.data32S[i * 2 + 1],
      });
    }
    
    bestContour.delete();
    
    // Sort corners: TL, TR, BR, BL
    const sorted = sortCornersOpenCV(corners);
    
    return {
      topLeft: sorted[0],
      topRight: sorted[1],
      bottomRight: sorted[2],
      bottomLeft: sorted[3],
      confidence: bestScore,
    };
    
  } catch (e) {
    console.warn('[OpenCV] Detection error:', e);
    return null;
  } finally {
    // Clean up Mats
    if (src) src.delete();
    if (gray) gray.delete();
    if (blurred) blurred.delete();
    if (edges) edges.delete();
    if (contours) contours.delete();
    if (hierarchy) hierarchy.delete();
  }
}

/**
 * Calculate median pixel value of a grayscale Mat
 */
function calculateMedian(mat: any): number {
  const data = mat.data;
  const values = Array.from(data as Uint8Array).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 !== 0
    ? values[mid]
    : (values[mid - 1] + values[mid]) / 2;
}

/**
 * Score a quadrilateral contour for how likely it is to be a document
 */
function scoreQuadrilateral(
  approx: any,
  area: number,
  frameArea: number,
  width: number,
  height: number
): number {
  // Get corners
  const corners: Point[] = [];
  for (let i = 0; i < 4; i++) {
    corners.push({
      x: approx.data32S[i * 2],
      y: approx.data32S[i * 2 + 1],
    });
  }
  
  // Check convexity
  if (!isConvex(corners)) {
    return 0;
  }
  
  // Coverage score: prefer 30-70% of frame
  const coverageRatio = area / frameArea;
  let coverageScore = 0;
  if (coverageRatio > 0.15 && coverageRatio < 0.85) {
    coverageScore = coverageRatio > 0.3 && coverageRatio < 0.7 ? 1.0 : 0.7;
  }
  
  // Aspect ratio score (letter: 1.29, A4: 1.41)
  const sorted = sortCornersOpenCV(corners);
  const widthTop = distance(sorted[0], sorted[1]);
  const widthBottom = distance(sorted[3], sorted[2]);
  const heightLeft = distance(sorted[0], sorted[3]);
  const heightRight = distance(sorted[1], sorted[2]);
  
  const avgWidth = (widthTop + widthBottom) / 2;
  const avgHeight = (heightLeft + heightRight) / 2;
  const aspectRatio = avgHeight / avgWidth;
  
  // Ideal range: 1.2 - 1.5 (covers letter and A4)
  const aspectScore = 1 - Math.min(1, Math.abs(aspectRatio - 1.35) / 0.5);
  
  // Parallelism score
  const widthDiff = Math.abs(widthTop - widthBottom) / Math.max(widthTop, widthBottom);
  const heightDiff = Math.abs(heightLeft - heightRight) / Math.max(heightLeft, heightRight);
  const parallelScore = 1 - (widthDiff + heightDiff) / 2;
  
  // Edge proximity penalty (corners too close to frame edge are suspicious)
  const margin = 0.03; // 3% of frame
  let edgePenalty = 0;
  for (const corner of corners) {
    if (corner.x < width * margin || corner.x > width * (1 - margin) ||
        corner.y < height * margin || corner.y > height * (1 - margin)) {
      edgePenalty += 0.1;
    }
  }
  
  const score = (coverageScore * 0.3 + aspectScore * 0.35 + parallelScore * 0.35) - edgePenalty;
  return Math.max(0, Math.min(1, score));
}

/**
 * Check if polygon is convex
 */
function isConvex(corners: Point[]): boolean {
  const n = corners.length;
  let sign = 0;
  
  for (let i = 0; i < n; i++) {
    const dx1 = corners[(i + 1) % n].x - corners[i].x;
    const dy1 = corners[(i + 1) % n].y - corners[i].y;
    const dx2 = corners[(i + 2) % n].x - corners[(i + 1) % n].x;
    const dy2 = corners[(i + 2) % n].y - corners[(i + 1) % n].y;
    
    const cross = dx1 * dy2 - dy1 * dx2;
    
    if (cross !== 0) {
      if (sign === 0) {
        sign = cross > 0 ? 1 : -1;
      } else if ((cross > 0 ? 1 : -1) !== sign) {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Sort corners in order: TL, TR, BR, BL
 */
function sortCornersOpenCV(corners: Point[]): Point[] {
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
 * Calculate distance between two points
 */
function distance(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}
