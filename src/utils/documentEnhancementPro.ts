/**
 * Professional Document Enhancement Pipeline
 * 
 * Advanced image processing for scanned documents:
 * - Illumination normalization (shadow removal)
 * - White background enforcement
 * - Edge-preserving sharpening
 * - High-quality output
 */

import type { DetectedCorners, Point } from './documentEdgeDetection';

export interface ProEnhancementOptions {
  mode: 'color' | 'bw';
  /** Enable illumination normalization (shadow removal) */
  illuminationCorrection: boolean;
  /** Enforce white background */
  whiteBackground: boolean;
  /** Apply sharpening */
  sharpen: boolean;
  /** Output dimensions (for letter: 2550x3300 at 300dpi) */
  outputWidth?: number;
  outputHeight?: number;
}

const DEFAULT_OPTIONS: ProEnhancementOptions = {
  mode: 'bw',
  illuminationCorrection: true,
  whiteBackground: true,
  sharpen: true,
  outputWidth: 2550,
  outputHeight: 3300,
};

/**
 * Apply professional enhancement pipeline
 */
export function enhanceDocumentPro(
  sourceCanvas: HTMLCanvasElement,
  corners: DetectedCorners,
  options: Partial<ProEnhancementOptions> = {}
): HTMLCanvasElement {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Step 1: Perspective transform to rectangular output
  const rectified = applyPerspectiveTransformPro(
    sourceCanvas,
    corners,
    opts.outputWidth!,
    opts.outputHeight!
  );
  
  // Step 2: Get image data for processing
  const ctx = rectified.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, rectified.width, rectified.height);
  
  // Create a copy of the data that we can modify
  let processedData: Uint8ClampedArray = new Uint8ClampedArray(imageData.data.length);
  for (let i = 0; i < imageData.data.length; i++) {
    processedData[i] = imageData.data[i];
  }
  
  // Step 3: Illumination normalization (fixes shadows)
  if (opts.illuminationCorrection) {
    const normalized = normalizeIllumination(processedData, rectified.width, rectified.height);
    processedData = new Uint8ClampedArray(normalized);
  }
  
  // Step 4: Mode-specific processing
  if (opts.mode === 'bw') {
    // Apply Sauvola binarization for crisp B&W
    const binarized = sauvolaBinarizationPro(processedData, rectified.width, rectified.height);
    processedData = new Uint8ClampedArray(binarized);
  } else {
    // Color mode: white background + contrast + sharpen
    if (opts.whiteBackground) {
      const whiteBg = enforceWhiteBackground(processedData, rectified.width, rectified.height);
      processedData = new Uint8ClampedArray(whiteBg);
    }
    
    // Contrast enhancement
    const contrasted = enhanceContrastPro(processedData, 1.2);
    processedData = new Uint8ClampedArray(contrasted);
    
    // Sharpening
    if (opts.sharpen) {
      const sharpened = unsharpMaskPro(processedData, rectified.width, rectified.height, 0.4);
      processedData = new Uint8ClampedArray(sharpened);
    }
  }
  
  // Write processed data back
  for (let i = 0; i < processedData.length; i++) {
    imageData.data[i] = processedData[i];
  }
  ctx.putImageData(imageData, 0, 0);
  
  return rectified;
}

/**
 * Apply perspective transform with high-quality bilinear interpolation
 */
function applyPerspectiveTransformPro(
  sourceCanvas: HTMLCanvasElement,
  corners: DetectedCorners,
  outputWidth: number,
  outputHeight: number
): HTMLCanvasElement {
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const ctx = outputCanvas.getContext('2d')!;
  
  const srcCtx = sourceCanvas.getContext('2d')!;
  const srcData = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const dstData = ctx.createImageData(outputWidth, outputHeight);
  
  // Source corners
  const src: Point[] = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
  
  // Destination corners (rectangular)
  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: outputWidth - 1, y: 0 },
    { x: outputWidth - 1, y: outputHeight - 1 },
    { x: 0, y: outputHeight - 1 },
  ];
  
  // Calculate inverse homography matrix
  const H = calculateHomography(dst, src);
  
  // Transform each pixel with bilinear interpolation
  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      const srcPos = applyHomography(H, x, y);
      const pixel = bilinearInterpolatePro(srcData, srcPos.x, srcPos.y);
      
      const dstIdx = (y * outputWidth + x) * 4;
      dstData.data[dstIdx] = pixel.r;
      dstData.data[dstIdx + 1] = pixel.g;
      dstData.data[dstIdx + 2] = pixel.b;
      dstData.data[dstIdx + 3] = 255;
    }
  }
  
  ctx.putImageData(dstData, 0, 0);
  return outputCanvas;
}

/**
 * Calculate 3x3 homography matrix using DLT algorithm
 */
function calculateHomography(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  
  for (let i = 0; i < 4; i++) {
    const sx = src[i].x, sy = src[i].y;
    const dx = dst[i].x, dy = dst[i].y;
    
    A.push([-sx, -sy, -1, 0, 0, 0, dx * sx, dx * sy, dx]);
    A.push([0, 0, 0, -sx, -sy, -1, dy * sx, dy * sy, dy]);
  }
  
  return solveHomographySystem(A);
}

/**
 * Solve 8x8 system for homography
 */
function solveHomographySystem(A: number[][]): number[] {
  const n = 8;
  const matrix: number[][] = [];
  const vector: number[] = [];
  
  for (let i = 0; i < 8; i++) {
    matrix.push(A[i].slice(0, 8));
    vector.push(-A[i][8]);
  }
  
  // Gaussian elimination with partial pivoting
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(matrix[k][i]) > Math.abs(matrix[maxRow][i])) {
        maxRow = k;
      }
    }
    [matrix[i], matrix[maxRow]] = [matrix[maxRow], matrix[i]];
    [vector[i], vector[maxRow]] = [vector[maxRow], vector[i]];
    
    for (let k = i + 1; k < n; k++) {
      const c = matrix[k][i] / matrix[i][i];
      for (let j = i; j < n; j++) {
        matrix[k][j] -= c * matrix[i][j];
      }
      vector[k] -= c * vector[i];
    }
  }
  
  // Back substitution
  const solution = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    solution[i] = vector[i];
    for (let j = i + 1; j < n; j++) {
      solution[i] -= matrix[i][j] * solution[j];
    }
    solution[i] /= matrix[i][i];
  }
  
  return [...solution, 1];
}

/**
 * Apply homography transformation to a point
 */
function applyHomography(H: number[], x: number, y: number): Point {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  };
}

/**
 * Bilinear interpolation for smooth sampling
 */
function bilinearInterpolatePro(
  imageData: ImageData,
  x: number,
  y: number
): { r: number; g: number; b: number } {
  const { width, height, data } = imageData;
  
  x = Math.max(0, Math.min(width - 1, x));
  y = Math.max(0, Math.min(height - 1, y));
  
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  
  const xWeight = x - x0;
  const yWeight = y - y0;
  
  const getPixel = (px: number, py: number) => {
    const idx = (py * width + px) * 4;
    return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
  };
  
  const p00 = getPixel(x0, y0);
  const p10 = getPixel(x1, y0);
  const p01 = getPixel(x0, y1);
  const p11 = getPixel(x1, y1);
  
  const interpolate = (c00: number, c10: number, c01: number, c11: number) => {
    return Math.round(
      c00 * (1 - xWeight) * (1 - yWeight) +
      c10 * xWeight * (1 - yWeight) +
      c01 * (1 - xWeight) * yWeight +
      c11 * xWeight * yWeight
    );
  };
  
  return {
    r: interpolate(p00.r, p10.r, p01.r, p11.r),
    g: interpolate(p00.g, p10.g, p01.g, p11.g),
    b: interpolate(p00.b, p10.b, p01.b, p11.b),
  };
}

/**
 * Normalize illumination using morphological background estimation
 * This is the key fix for shadow removal
 */
function normalizeIllumination(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  
  // Convert to grayscale for illumination estimation
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }
  
  // Estimate background illumination using large-kernel blur (morphological open approximation)
  const blockSize = Math.max(31, Math.floor(Math.min(width, height) / 15));
  const halfBlock = Math.floor(blockSize / 2);
  const background = new Float32Array(width * height);
  
  // Compute block means for background estimation
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      
      for (let by = Math.max(0, y - halfBlock); by < Math.min(height, y + halfBlock + 1); by += 3) {
        for (let bx = Math.max(0, x - halfBlock); bx < Math.min(width, x + halfBlock + 1); bx += 3) {
          sum += gray[by * width + bx];
          count++;
        }
      }
      
      background[y * width + x] = sum / count;
    }
  }
  
  // Normalize: output = (original / background) * target_brightness
  const targetBrightness = 230;
  
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const bg = Math.max(background[i], 1); // Avoid division by zero
    const scale = targetBrightness / bg;
    
    result[idx] = Math.min(255, Math.max(0, Math.round(data[idx] * scale)));
    result[idx + 1] = Math.min(255, Math.max(0, Math.round(data[idx + 1] * scale)));
    result[idx + 2] = Math.min(255, Math.max(0, Math.round(data[idx + 2] * scale)));
    result[idx + 3] = 255;
  }
  
  return result;
}

/**
 * Enforce white background by normalizing border samples
 */
function enforceWhiteBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  
  // Sample border regions (top 5%, bottom 5%, left 5%, right 5%)
  const samples: number[] = [];
  const margin = 0.05;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isEdge = 
        x < width * margin || x > width * (1 - margin) ||
        y < height * margin || y > height * (1 - margin);
      
      if (isEdge) {
        const idx = (y * width + x) * 4;
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        samples.push(brightness);
      }
    }
  }
  
  // Calculate median background brightness
  samples.sort((a, b) => a - b);
  const medianBg = samples[Math.floor(samples.length * 0.75)]; // Use 75th percentile (lighter values)
  
  // Normalize so background becomes ~248
  const targetBg = 248;
  const scale = medianBg > 20 ? targetBg / medianBg : 1;
  
  for (let i = 0; i < data.length; i += 4) {
    result[i] = Math.min(255, Math.round(data[i] * scale));
    result[i + 1] = Math.min(255, Math.round(data[i + 1] * scale));
    result[i + 2] = Math.min(255, Math.round(data[i + 2] * scale));
    result[i + 3] = 255;
  }
  
  return result;
}

/**
 * Enhanced Sauvola binarization with tuned parameters
 */
function sauvolaBinarizationPro(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  k: number = 0.15,
  windowSize: number = 21
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  const halfWindow = Math.floor(windowSize / 2);
  const R = 128;
  
  // Convert to grayscale
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
  }
  
  // Calculate integral images for fast local stats
  const integral = new Float64Array((width + 1) * (height + 1));
  const integralSq = new Float64Array((width + 1) * (height + 1));
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const val = gray[y * width + x];
      const idx = (y + 1) * (width + 1) + (x + 1);
      integral[idx] = val + integral[idx - 1] + integral[idx - width - 1] - integral[idx - width - 2];
      integralSq[idx] = val * val + integralSq[idx - 1] + integralSq[idx - width - 1] - integralSq[idx - width - 2];
    }
  }
  
  // Apply Sauvola threshold
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - halfWindow);
      const y1 = Math.max(0, y - halfWindow);
      const x2 = Math.min(width - 1, x + halfWindow);
      const y2 = Math.min(height - 1, y + halfWindow);
      
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      
      const sum = integral[(y2 + 1) * (width + 1) + (x2 + 1)]
                - integral[(y2 + 1) * (width + 1) + x1]
                - integral[y1 * (width + 1) + (x2 + 1)]
                + integral[y1 * (width + 1) + x1];
      
      const sumSq = integralSq[(y2 + 1) * (width + 1) + (x2 + 1)]
                  - integralSq[(y2 + 1) * (width + 1) + x1]
                  - integralSq[y1 * (width + 1) + (x2 + 1)]
                  + integralSq[y1 * (width + 1) + x1];
      
      const mean = sum / count;
      const variance = (sumSq / count) - (mean * mean);
      const stdDev = Math.sqrt(Math.max(0, variance));
      
      const threshold = mean * (1 + k * ((stdDev / R) - 1));
      
      const idx = (y * width + x) * 4;
      const pixelValue = gray[y * width + x] > threshold ? 255 : 0;
      
      result[idx] = pixelValue;
      result[idx + 1] = pixelValue;
      result[idx + 2] = pixelValue;
      result[idx + 3] = 255;
    }
  }
  
  return result;
}

/**
 * Enhanced contrast using S-curve
 */
function enhanceContrastPro(data: Uint8ClampedArray, factor: number): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const normalized = data[i + c] / 255;
      const enhanced = 1 / (1 + Math.exp(-factor * 4 * (normalized - 0.5)));
      result[i + c] = Math.min(255, Math.max(0, Math.round(enhanced * 255)));
    }
    result[i + 3] = 255;
  }
  
  return result;
}

/**
 * Unsharp mask for edge-preserving sharpening
 */
function unsharpMaskPro(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  
  // Create blurred version (3x3 Gaussian)
  const blurred = new Uint8ClampedArray(data.length);
  const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const kernelSum = 16;
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let ki = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            sum += data[((y + ky) * width + (x + kx)) * 4 + c] * kernel[ki++];
          }
        }
        blurred[(y * width + x) * 4 + c] = sum / kernelSum;
      }
      blurred[(y * width + x) * 4 + 3] = 255;
    }
  }
  
  // Apply unsharp mask
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = data[i + c] - blurred[i + c];
      result[i + c] = Math.min(255, Math.max(0, Math.round(data[i + c] + amount * diff)));
    }
    result[i + 3] = 255;
  }
  
  return result;
}
