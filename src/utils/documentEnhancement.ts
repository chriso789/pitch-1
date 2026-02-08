/**
 * Document Enhancement Utility
 * 
 * Professional-grade image enhancement for scanned documents.
 * Includes shadow removal, contrast enhancement, and sharpening.
 */

import type { DetectedCorners, Point } from './documentEdgeDetection';

export interface EnhancementOptions {
  mode: 'color' | 'grayscale' | 'bw';
  shadowRemoval: boolean;
  contrastBoost: number; // 1.0 = normal, 1.3 = recommended
  brightnessNormalize: boolean;
  sharpen: boolean;
}

/**
 * Apply perspective transform to correct document angle
 */
export function applyPerspectiveTransform(
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
  
  // Transform each pixel
  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      // Apply inverse homography to find source position
      const srcPos = applyHomography(H, x, y);
      
      // Bilinear interpolation
      const pixel = bilinearInterpolate(srcData, srcPos.x, srcPos.y);
      
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
  // Build matrix A for Ax = 0
  const A: number[][] = [];
  
  for (let i = 0; i < 4; i++) {
    const sx = src[i].x, sy = src[i].y;
    const dx = dst[i].x, dy = dst[i].y;
    
    A.push([-sx, -sy, -1, 0, 0, 0, dx * sx, dx * sy, dx]);
    A.push([0, 0, 0, -sx, -sy, -1, dy * sx, dy * sy, dy]);
  }
  
  // Solve using SVD (simplified - least squares approach)
  const H = solveHomographyLeastSquares(A);
  
  return H;
}

/**
 * Simplified least squares solution for homography
 */
function solveHomographyLeastSquares(A: number[][]): number[] {
  // Use simplified approach: assume last element is 1
  // Solve 8x8 system for first 8 elements
  
  // For simplicity, use a direct matrix solution
  // This is a simplified implementation that works for most document cases
  
  const n = 8;
  const matrix: number[][] = [];
  const vector: number[] = [];
  
  for (let i = 0; i < 8; i++) {
    matrix.push(A[i].slice(0, 8));
    vector.push(-A[i][8]);
  }
  
  // Gaussian elimination
  for (let i = 0; i < n; i++) {
    // Pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(matrix[k][i]) > Math.abs(matrix[maxRow][i])) {
        maxRow = k;
      }
    }
    [matrix[i], matrix[maxRow]] = [matrix[maxRow], matrix[i]];
    [vector[i], vector[maxRow]] = [vector[maxRow], vector[i]];
    
    // Eliminate
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
  
  // Return 3x3 matrix (row-major)
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
function bilinearInterpolate(
  imageData: ImageData, 
  x: number, 
  y: number
): { r: number; g: number; b: number } {
  const { width, height, data } = imageData;
  
  // Clamp to valid range
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
 * Main enhancement function
 */
export function enhanceDocument(
  canvas: HTMLCanvasElement,
  options: EnhancementOptions
): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const width = canvas.width;
  const height = canvas.height;
  
  // Process through pipeline, each step takes and returns Uint8ClampedArray
  let processedData: Uint8ClampedArray;
  
  // Start with copy of original data
  const initialData = new Uint8ClampedArray(imageData.data.length);
  initialData.set(imageData.data);
  
  // 1. Shadow removal (adaptive background normalization)
  const afterShadow = options.shadowRemoval 
    ? adaptiveShadowRemoval(initialData, width, height)
    : initialData;
  
  // 2. Mode-specific processing
  let afterMode: Uint8ClampedArray;
  if (options.mode === 'bw') {
    // Apply binarization then clean up noise
    const binarized = sauvolaBinarization(afterShadow, width, height);
    afterMode = removeNoiseFromBW(binarized, width, height);
  } else if (options.mode === 'grayscale') {
    afterMode = convertToGrayscale(afterShadow);
  } else {
    afterMode = afterShadow;
  }
  
  // 3. Contrast enhancement (skip for B&W)
  const afterContrast = (options.contrastBoost > 1 && options.mode !== 'bw')
    ? enhanceContrast(afterMode, options.contrastBoost)
    : afterMode;
  
  // 4. Brightness normalization
  const afterBrightness = (options.brightnessNormalize && options.mode !== 'bw')
    ? normalizeBrightness(afterContrast)
    : afterContrast;
  
  // 5. Sharpening (skip for B&W, it's already sharp)
  processedData = (options.sharpen && options.mode !== 'bw')
    ? unsharpMask(afterBrightness, width, height, 0.5)
    : afterBrightness;
  
  // Create output canvas
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext('2d')!;
  
  const outputData = outputCtx.createImageData(width, height);
  // Copy processed data to output
  outputData.data.set(processedData);
  outputCtx.putImageData(outputData, 0, 0);
  
  return outputCanvas;
}

/**
 * Adaptive shadow removal using local mean normalization
 */
function adaptiveShadowRemoval(
  data: Uint8ClampedArray, 
  width: number, 
  height: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  const blockSize = 15; // 15x15 pixel blocks
  
  // Calculate local mean for each block
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      // Calculate local mean brightness in surrounding block
      let sum = 0;
      let count = 0;
      
      const halfBlock = Math.floor(blockSize / 2);
      for (let by = Math.max(0, y - halfBlock); by < Math.min(height, y + halfBlock + 1); by++) {
        for (let bx = Math.max(0, x - halfBlock); bx < Math.min(width, x + halfBlock + 1); bx++) {
          const bidx = (by * width + bx) * 4;
          const brightness = (data[bidx] + data[bidx + 1] + data[bidx + 2]) / 3;
          sum += brightness;
          count++;
        }
      }
      
      const localMean = sum / count;
      const globalTarget = 200; // Target white level
      
      // Normalize pixel relative to local background
      const scale = localMean > 20 ? globalTarget / localMean : 1;
      
      result[idx] = Math.min(255, Math.round(data[idx] * scale));
      result[idx + 1] = Math.min(255, Math.round(data[idx + 1] * scale));
      result[idx + 2] = Math.min(255, Math.round(data[idx + 2] * scale));
      result[idx + 3] = 255;
    }
  }
  
  return result;
}

/**
 * Sauvola binarization for crisp B&W output
 * Handles shadows and uneven lighting better than simple thresholding
 * Improved parameters for better document text readability
 */
function sauvolaBinarization(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  k: number = 0.15 // Lower k = more black pixels = better for faint text
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  const windowSize = 25; // Larger window for more stable local statistics
  const halfWindow = Math.floor(windowSize / 2);
  const R = 128; // Dynamic range
  
  // Convert to grayscale first
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
  }
  
  // Calculate integral image and squared integral image for fast local stats
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
      
      // Get sum from integral image
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
      
      // Sauvola threshold formula
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
 * Remove small noise spots from B&W image
 * Uses median filter logic: isolated black/white pixels are removed
 */
function removeNoiseFromBW(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  result.set(data);

  // Remove isolated black pixels (noise in white areas)
  // and isolated white pixels (holes in text)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const current = data[idx]; // 0 = black, 255 = white

      // Count neighbors of same color
      let sameColorCount = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nidx = ((y + dy) * width + (x + dx)) * 4;
          if (data[nidx] === current) {
            sameColorCount++;
          }
        }
      }

      // If pixel is isolated (less than 2 neighbors of same color), flip it
      if (sameColorCount < 2) {
        const newValue = current === 0 ? 255 : 0;
        result[idx] = newValue;
        result[idx + 1] = newValue;
        result[idx + 2] = newValue;
      }
    }
  }

  return result;
}

/**
 * Convert to grayscale
 */
function convertToGrayscale(data: Uint8ClampedArray): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    result[i] = gray;
    result[i + 1] = gray;
    result[i + 2] = gray;
    result[i + 3] = 255;
  }

  return result;
}

/**
 * Enhance contrast using S-curve
 */
function enhanceContrast(data: Uint8ClampedArray, factor: number): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  
  // Apply S-curve contrast with given factor
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const normalized = data[i + c] / 255;
      // S-curve: output = 1 / (1 + exp(-factor * (input - 0.5)))
      const enhanced = 1 / (1 + Math.exp(-factor * 4 * (normalized - 0.5)));
      result[i + c] = Math.min(255, Math.max(0, Math.round(enhanced * 255)));
    }
    result[i + 3] = 255;
  }
  
  return result;
}

/**
 * Normalize brightness to use full range
 */
function normalizeBrightness(data: Uint8ClampedArray): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  
  // Find min and max
  let min = 255, max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    min = Math.min(min, brightness);
    max = Math.max(max, brightness);
  }
  
  const range = max - min;
  if (range < 10) {
    // Already normalized or uniform
    return data;
  }
  
  // Stretch to 0-255
  const scale = 255 / range;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      result[i + c] = Math.min(255, Math.max(0, Math.round((data[i + c] - min) * scale)));
    }
    result[i + 3] = 255;
  }
  
  return result;
}

/**
 * Unsharp mask for sharpening
 */
function unsharpMask(
  data: Uint8ClampedArray, 
  width: number, 
  height: number,
  amount: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  
  // First, create blurred version (3x3 Gaussian)
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
  
  // Apply unsharp mask: output = original + amount * (original - blurred)
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = data[i + c] - blurred[i + c];
      result[i + c] = Math.min(255, Math.max(0, Math.round(data[i + c] + amount * diff)));
    }
    result[i + 3] = 255;
  }
  
  return result;
}
