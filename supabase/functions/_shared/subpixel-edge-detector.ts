/**
 * Phase 48: Sub-Pixel Edge Detection Algorithm
 * Achieves sub-pixel accuracy in edge detection for maximum precision
 */

interface SubPixelEdge {
  x: number;
  y: number;
  gradientMagnitude: number;
  gradientDirection: number;
  confidence: number;
  subPixelOffset: { dx: number; dy: number };
}

interface EdgeDetectionResult {
  edges: SubPixelEdge[];
  edgeChains: EdgeChain[];
  overallQuality: number;
  processingTimeMs: number;
}

interface EdgeChain {
  id: string;
  points: SubPixelEdge[];
  length: number;
  averageConfidence: number;
  isClosed: boolean;
  lineType: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'unknown';
}

interface ImageData {
  width: number;
  height: number;
  data: number[]; // Grayscale values 0-255
}

// Sobel kernels for gradient computation
const SOBEL_X = [
  [-1, 0, 1],
  [-2, 0, 2],
  [-1, 0, 1]
];

const SOBEL_Y = [
  [-1, -2, -1],
  [0, 0, 0],
  [1, 2, 1]
];

// Gaussian kernel for smoothing
const GAUSSIAN_3x3 = [
  [1/16, 2/16, 1/16],
  [2/16, 4/16, 2/16],
  [1/16, 2/16, 1/16]
];

const GAUSSIAN_5x5 = [
  [1/256, 4/256, 6/256, 4/256, 1/256],
  [4/256, 16/256, 24/256, 16/256, 4/256],
  [6/256, 24/256, 36/256, 24/256, 6/256],
  [4/256, 16/256, 24/256, 16/256, 4/256],
  [1/256, 4/256, 6/256, 4/256, 1/256]
];

/**
 * Main sub-pixel edge detection function
 */
export function detectSubPixelEdges(
  imageData: ImageData,
  options: {
    lowThreshold?: number;
    highThreshold?: number;
    gaussianSigma?: number;
    minChainLength?: number;
  } = {}
): EdgeDetectionResult {
  const startTime = Date.now();
  
  const {
    lowThreshold = 30,
    highThreshold = 100,
    gaussianSigma = 1.4,
    minChainLength = 10
  } = options;
  
  // Step 1: Gaussian smoothing
  const smoothed = applyGaussianSmoothing(imageData, gaussianSigma);
  
  // Step 2: Compute gradients using Sobel
  const { gx, gy, magnitude, direction } = computeGradients(smoothed);
  
  // Step 3: Non-maximum suppression with sub-pixel interpolation
  const suppressedEdges = nonMaximumSuppressionSubPixel(magnitude, direction, gx, gy);
  
  // Step 4: Double threshold hysteresis
  const edges = hysteresisThresholding(suppressedEdges, lowThreshold, highThreshold);
  
  // Step 5: Chain edge points into continuous edges
  const edgeChains = chainEdgePoints(edges, minChainLength);
  
  // Step 6: Refine sub-pixel positions
  const refinedEdges = refineSubPixelPositions(edges, gx, gy, magnitude);
  
  // Calculate overall quality
  const overallQuality = calculateEdgeQuality(refinedEdges, edgeChains);
  
  return {
    edges: refinedEdges,
    edgeChains,
    overallQuality,
    processingTimeMs: Date.now() - startTime
  };
}

/**
 * Apply Gaussian smoothing to reduce noise
 */
function applyGaussianSmoothing(image: ImageData, sigma: number): ImageData {
  const kernel = sigma <= 1 ? GAUSSIAN_3x3 : GAUSSIAN_5x5;
  const kernelSize = kernel.length;
  const halfKernel = Math.floor(kernelSize / 2);
  
  const result: number[] = new Array(image.width * image.height).fill(0);
  
  for (let y = halfKernel; y < image.height - halfKernel; y++) {
    for (let x = halfKernel; x < image.width - halfKernel; x++) {
      let sum = 0;
      
      for (let ky = 0; ky < kernelSize; ky++) {
        for (let kx = 0; kx < kernelSize; kx++) {
          const px = x + kx - halfKernel;
          const py = y + ky - halfKernel;
          sum += image.data[py * image.width + px] * kernel[ky][kx];
        }
      }
      
      result[y * image.width + x] = sum;
    }
  }
  
  return { width: image.width, height: image.height, data: result };
}

/**
 * Compute image gradients using Sobel operator
 */
function computeGradients(image: ImageData): {
  gx: number[];
  gy: number[];
  magnitude: number[];
  direction: number[];
} {
  const gx: number[] = new Array(image.width * image.height).fill(0);
  const gy: number[] = new Array(image.width * image.height).fill(0);
  const magnitude: number[] = new Array(image.width * image.height).fill(0);
  const direction: number[] = new Array(image.width * image.height).fill(0);
  
  for (let y = 1; y < image.height - 1; y++) {
    for (let x = 1; x < image.width - 1; x++) {
      let sumX = 0;
      let sumY = 0;
      
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 3; kx++) {
          const px = x + kx - 1;
          const py = y + ky - 1;
          const pixel = image.data[py * image.width + px];
          sumX += pixel * SOBEL_X[ky][kx];
          sumY += pixel * SOBEL_Y[ky][kx];
        }
      }
      
      const idx = y * image.width + x;
      gx[idx] = sumX;
      gy[idx] = sumY;
      magnitude[idx] = Math.sqrt(sumX * sumX + sumY * sumY);
      direction[idx] = Math.atan2(sumY, sumX);
    }
  }
  
  return { gx, gy, magnitude, direction };
}

/**
 * Non-maximum suppression with sub-pixel edge localization
 */
function nonMaximumSuppressionSubPixel(
  magnitude: number[],
  direction: number[],
  gx: number[],
  gy: number[]
): SubPixelEdge[] {
  const width = Math.sqrt(magnitude.length);
  const height = width;
  const edges: SubPixelEdge[] = [];
  
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * width + x;
      const mag = magnitude[idx];
      
      if (mag < 10) continue; // Skip very weak edges
      
      // Get gradient direction and quantize to 4 directions
      const angle = direction[idx];
      const { neighbor1, neighbor2 } = getNeighborIndices(x, y, angle, width);
      
      // Check if current pixel is local maximum
      if (mag >= magnitude[neighbor1] && mag >= magnitude[neighbor2]) {
        // Calculate sub-pixel offset using parabolic interpolation
        const subPixelOffset = calculateSubPixelOffset(
          magnitude[neighbor1], mag, magnitude[neighbor2], angle
        );
        
        edges.push({
          x: x + subPixelOffset.dx,
          y: y + subPixelOffset.dy,
          gradientMagnitude: mag,
          gradientDirection: angle,
          confidence: calculateEdgeConfidence(mag, gx[idx], gy[idx]),
          subPixelOffset
        });
      }
    }
  }
  
  return edges;
}

/**
 * Get neighboring pixel indices based on gradient direction
 */
function getNeighborIndices(
  x: number,
  y: number,
  angle: number,
  width: number
): { neighbor1: number; neighbor2: number } {
  // Normalize angle to 0-180 degrees
  let degrees = (angle * 180 / Math.PI + 180) % 180;
  
  let dx1, dy1, dx2, dy2;
  
  if (degrees < 22.5 || degrees >= 157.5) {
    // Horizontal
    dx1 = 1; dy1 = 0; dx2 = -1; dy2 = 0;
  } else if (degrees < 67.5) {
    // Diagonal /
    dx1 = 1; dy1 = -1; dx2 = -1; dy2 = 1;
  } else if (degrees < 112.5) {
    // Vertical
    dx1 = 0; dy1 = 1; dx2 = 0; dy2 = -1;
  } else {
    // Diagonal \
    dx1 = 1; dy1 = 1; dx2 = -1; dy2 = -1;
  }
  
  return {
    neighbor1: (y + dy1) * width + (x + dx1),
    neighbor2: (y + dy2) * width + (x + dx2)
  };
}

/**
 * Calculate sub-pixel offset using parabolic interpolation
 */
function calculateSubPixelOffset(
  m1: number,
  m2: number,
  m3: number,
  angle: number
): { dx: number; dy: number } {
  // Parabolic interpolation for sub-pixel accuracy
  const denom = 2 * (m1 - 2 * m2 + m3);
  
  if (Math.abs(denom) < 0.001) {
    return { dx: 0, dy: 0 };
  }
  
  const offset = (m1 - m3) / denom;
  
  // Clamp offset to reasonable range
  const clampedOffset = Math.max(-0.5, Math.min(0.5, offset));
  
  // Convert offset to x,y based on gradient direction
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  
  return {
    dx: clampedOffset * cos,
    dy: clampedOffset * sin
  };
}

/**
 * Calculate edge confidence based on gradient properties
 */
function calculateEdgeConfidence(magnitude: number, gx: number, gy: number): number {
  // Higher magnitude = higher confidence
  const magnitudeScore = Math.min(1, magnitude / 255);
  
  // Consistent gradient direction = higher confidence
  const gradientConsistency = Math.abs(gx) + Math.abs(gy) > 0 
    ? Math.max(Math.abs(gx), Math.abs(gy)) / (Math.abs(gx) + Math.abs(gy))
    : 0;
  
  return magnitudeScore * 0.7 + gradientConsistency * 0.3;
}

/**
 * Apply double threshold hysteresis
 */
function hysteresisThresholding(
  edges: SubPixelEdge[],
  lowThreshold: number,
  highThreshold: number
): SubPixelEdge[] {
  // Classify edges as strong, weak, or suppressed
  const strongEdges = edges.filter(e => e.gradientMagnitude >= highThreshold);
  const weakEdges = edges.filter(e => 
    e.gradientMagnitude >= lowThreshold && e.gradientMagnitude < highThreshold
  );
  
  // Keep weak edges that are connected to strong edges
  const result = [...strongEdges];
  const strongSet = new Set(strongEdges.map(e => `${Math.round(e.x)},${Math.round(e.y)}`));
  
  for (const weak of weakEdges) {
    // Check 8-neighborhood for strong edge
    const x = Math.round(weak.x);
    const y = Math.round(weak.y);
    
    let hasStrongNeighbor = false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (strongSet.has(`${x + dx},${y + dy}`)) {
          hasStrongNeighbor = true;
          break;
        }
      }
      if (hasStrongNeighbor) break;
    }
    
    if (hasStrongNeighbor) {
      result.push(weak);
      strongSet.add(`${x},${y}`);
    }
  }
  
  return result;
}

/**
 * Chain edge points into continuous edge segments
 */
function chainEdgePoints(edges: SubPixelEdge[], minLength: number): EdgeChain[] {
  const chains: EdgeChain[] = [];
  const used = new Set<number>();
  
  // Create spatial index for efficient neighbor lookup
  const spatialIndex = new Map<string, number>();
  edges.forEach((e, i) => {
    const key = `${Math.round(e.x)},${Math.round(e.y)}`;
    spatialIndex.set(key, i);
  });
  
  for (let startIdx = 0; startIdx < edges.length; startIdx++) {
    if (used.has(startIdx)) continue;
    
    const chain: SubPixelEdge[] = [edges[startIdx]];
    used.add(startIdx);
    
    // Grow chain in both directions
    let currentEdge = edges[startIdx];
    
    // Forward direction
    while (true) {
      const nextIdx = findNextEdge(currentEdge, edges, spatialIndex, used);
      if (nextIdx === -1) break;
      
      chain.push(edges[nextIdx]);
      used.add(nextIdx);
      currentEdge = edges[nextIdx];
    }
    
    // Backward direction
    currentEdge = edges[startIdx];
    while (true) {
      const prevIdx = findNextEdge(currentEdge, edges, spatialIndex, used, true);
      if (prevIdx === -1) break;
      
      chain.unshift(edges[prevIdx]);
      used.add(prevIdx);
      currentEdge = edges[prevIdx];
    }
    
    if (chain.length >= minLength) {
      const length = calculateChainLength(chain);
      const avgConfidence = chain.reduce((sum, e) => sum + e.confidence, 0) / chain.length;
      
      // Check if chain is closed (first and last points are close)
      const first = chain[0];
      const last = chain[chain.length - 1];
      const isClosed = Math.hypot(first.x - last.x, first.y - last.y) < 3;
      
      chains.push({
        id: `chain_${chains.length}`,
        points: chain,
        length,
        averageConfidence: avgConfidence,
        isClosed,
        lineType: classifyLineType(chain)
      });
    }
  }
  
  return chains;
}

/**
 * Find the next edge point in the chain
 */
function findNextEdge(
  current: SubPixelEdge,
  edges: SubPixelEdge[],
  spatialIndex: Map<string, number>,
  used: Set<number>,
  reverse: boolean = false
): number {
  const x = Math.round(current.x);
  const y = Math.round(current.y);
  
  // Expected next position based on gradient direction
  const direction = reverse 
    ? current.gradientDirection + Math.PI 
    : current.gradientDirection;
  
  // Check neighbors in expected direction first
  const candidates: { idx: number; score: number }[] = [];
  
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      
      const key = `${x + dx},${y + dy}`;
      const idx = spatialIndex.get(key);
      
      if (idx !== undefined && !used.has(idx)) {
        const edge = edges[idx];
        
        // Score based on direction consistency and distance
        const distance = Math.hypot(dx, dy);
        const expectedAngle = Math.atan2(dy, dx);
        const angleDiff = Math.abs(normalizeAngle(expectedAngle - direction));
        
        const directionScore = Math.cos(angleDiff);
        const distanceScore = 1 / distance;
        
        candidates.push({
          idx,
          score: directionScore * 0.7 + distanceScore * 0.3
        });
      }
    }
  }
  
  if (candidates.length === 0) return -1;
  
  // Return best candidate
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].idx;
}

function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

function calculateChainLength(chain: SubPixelEdge[]): number {
  let length = 0;
  for (let i = 1; i < chain.length; i++) {
    length += Math.hypot(
      chain[i].x - chain[i-1].x,
      chain[i].y - chain[i-1].y
    );
  }
  return length;
}

/**
 * Classify line type based on chain properties
 */
function classifyLineType(chain: SubPixelEdge[]): EdgeChain['lineType'] {
  if (chain.length < 5) return 'unknown';
  
  // Calculate average direction
  let sumCos = 0;
  let sumSin = 0;
  for (const edge of chain) {
    sumCos += Math.cos(edge.gradientDirection);
    sumSin += Math.sin(edge.gradientDirection);
  }
  const avgDirection = Math.atan2(sumSin, sumCos);
  
  // Calculate straightness (variance in direction)
  let directionVariance = 0;
  for (const edge of chain) {
    const diff = normalizeAngle(edge.gradientDirection - avgDirection);
    directionVariance += diff * diff;
  }
  directionVariance /= chain.length;
  
  // Very straight lines are likely ridges or eaves
  if (directionVariance < 0.1) {
    // Horizontal-ish = eave or ridge
    if (Math.abs(avgDirection) < 0.3 || Math.abs(avgDirection - Math.PI) < 0.3) {
      return 'eave';
    }
    return 'ridge';
  }
  
  // Diagonal lines are likely hips or valleys
  if (directionVariance < 0.3) {
    return 'hip';
  }
  
  return 'unknown';
}

/**
 * Refine sub-pixel positions using gradient fitting
 */
function refineSubPixelPositions(
  edges: SubPixelEdge[],
  gx: number[],
  gy: number[],
  magnitude: number[]
): SubPixelEdge[] {
  const width = Math.sqrt(magnitude.length);
  
  return edges.map(edge => {
    const x = Math.round(edge.x);
    const y = Math.round(edge.y);
    const idx = y * width + x;
    
    // Use gradient to refine position
    const totalGrad = Math.sqrt(gx[idx] * gx[idx] + gy[idx] * gy[idx]);
    if (totalGrad < 1) return edge;
    
    // Normal direction to edge
    const nx = -gy[idx] / totalGrad;
    const ny = gx[idx] / totalGrad;
    
    // Sample along normal
    const samples: { offset: number; mag: number }[] = [];
    for (let t = -1; t <= 1; t += 0.25) {
      const sx = x + t * nx;
      const sy = y + t * ny;
      const si = Math.round(sy) * width + Math.round(sx);
      if (si >= 0 && si < magnitude.length) {
        samples.push({ offset: t, mag: magnitude[si] });
      }
    }
    
    // Find peak using parabolic fit
    let maxMag = 0;
    let maxOffset = 0;
    for (let i = 1; i < samples.length - 1; i++) {
      if (samples[i].mag > maxMag) {
        maxMag = samples[i].mag;
        maxOffset = samples[i].offset;
        
        // Parabolic refinement
        const a = samples[i-1].mag;
        const b = samples[i].mag;
        const c = samples[i+1].mag;
        const denom = 2 * (a - 2*b + c);
        if (Math.abs(denom) > 0.001) {
          maxOffset += (a - c) / denom * 0.25;
        }
      }
    }
    
    return {
      ...edge,
      x: edge.x + maxOffset * nx,
      y: edge.y + maxOffset * ny,
      subPixelOffset: {
        dx: edge.subPixelOffset.dx + maxOffset * nx,
        dy: edge.subPixelOffset.dy + maxOffset * ny
      }
    };
  });
}

/**
 * Calculate overall edge detection quality
 */
function calculateEdgeQuality(edges: SubPixelEdge[], chains: EdgeChain[]): number {
  if (edges.length === 0) return 0;
  
  // Average confidence of edges
  const avgConfidence = edges.reduce((sum, e) => sum + e.confidence, 0) / edges.length;
  
  // Percentage of edges in chains
  const chainedEdges = chains.reduce((sum, c) => sum + c.points.length, 0);
  const chainRatio = chainedEdges / edges.length;
  
  // Average chain length
  const avgChainLength = chains.length > 0
    ? chains.reduce((sum, c) => sum + c.length, 0) / chains.length
    : 0;
  const lengthScore = Math.min(1, avgChainLength / 50);
  
  return avgConfidence * 0.4 + chainRatio * 0.3 + lengthScore * 0.3;
}

/**
 * Convert pixel coordinates to geographic coordinates
 */
export function pixelToGeo(
  pixelX: number,
  pixelY: number,
  imageBounds: { north: number; south: number; east: number; west: number },
  imageWidth: number,
  imageHeight: number
): { lat: number; lng: number } {
  const lat = imageBounds.north - (pixelY / imageHeight) * (imageBounds.north - imageBounds.south);
  const lng = imageBounds.west + (pixelX / imageWidth) * (imageBounds.east - imageBounds.west);
  return { lat, lng };
}

/**
 * Convert edge chains to geographic line segments
 */
export function edgeChainsToGeoSegments(
  chains: EdgeChain[],
  imageBounds: { north: number; south: number; east: number; west: number },
  imageWidth: number,
  imageHeight: number
): { type: string; points: { lat: number; lng: number }[]; confidence: number }[] {
  return chains.map(chain => ({
    type: chain.lineType,
    points: chain.points.map(p => pixelToGeo(p.x, p.y, imageBounds, imageWidth, imageHeight)),
    confidence: chain.averageConfidence
  }));
}
