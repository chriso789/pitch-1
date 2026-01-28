/**
 * Document Corner Stability Filter
 * 
 * Provides smooth, stable corner tracking by averaging detections
 * over a rolling window and calculating jitter scores.
 */

import type { DetectedCorners, Point } from './documentEdgeDetection';

export interface StabilityResult {
  /** Whether corners are stable enough for auto-capture */
  stable: boolean;
  /** Averaged corners (null if not enough data) */
  averagedCorners: DetectedCorners | null;
  /** Jitter score (0 = perfectly stable, higher = more jitter) */
  jitterScore: number;
  /** Number of frames since corners became stable */
  framesSinceStable: number;
  /** Average confidence across buffer */
  averageConfidence: number;
}

export interface StabilityConfig {
  /** Number of frames to buffer */
  bufferSize: number;
  /** Maximum pixel deviation for stability */
  jitterThreshold: number;
  /** Minimum frames needed for stable detection */
  minStableFrames: number;
  /** Minimum confidence required */
  minConfidence: number;
}

const DEFAULT_CONFIG: StabilityConfig = {
  bufferSize: 8,
  jitterThreshold: 20,
  minStableFrames: 5,
  minConfidence: 0.5,
};

/**
 * Corner Stability Buffer
 * Maintains a rolling window of detected corners and provides stability metrics
 */
export class CornerStabilityBuffer {
  private buffer: DetectedCorners[] = [];
  private config: StabilityConfig;
  private stableFrameCount = 0;
  
  constructor(config: Partial<StabilityConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Add a new detection frame to the buffer
   */
  addFrame(corners: DetectedCorners | null): StabilityResult {
    if (!corners) {
      // Reset on null detection
      this.buffer = [];
      this.stableFrameCount = 0;
      return {
        stable: false,
        averagedCorners: null,
        jitterScore: Infinity,
        framesSinceStable: 0,
        averageConfidence: 0,
      };
    }
    
    // Add to buffer
    this.buffer.push(corners);
    
    // Trim buffer to max size
    while (this.buffer.length > this.config.bufferSize) {
      this.buffer.shift();
    }
    
    // Need minimum frames for stability calculation
    if (this.buffer.length < 3) {
      return {
        stable: false,
        averagedCorners: null,
        jitterScore: Infinity,
        framesSinceStable: 0,
        averageConfidence: corners.confidence,
      };
    }
    
    // Calculate average corners
    const averaged = this.calculateAveragedCorners();
    
    // Calculate jitter (standard deviation of corner positions)
    const jitter = this.calculateJitter(averaged);
    
    // Calculate average confidence
    const avgConfidence = this.buffer.reduce((sum, c) => sum + c.confidence, 0) / this.buffer.length;
    
    // Check stability conditions
    const isStableFrame = 
      jitter <= this.config.jitterThreshold &&
      avgConfidence >= this.config.minConfidence;
    
    if (isStableFrame) {
      this.stableFrameCount++;
    } else {
      this.stableFrameCount = 0;
    }
    
    const stable = this.stableFrameCount >= this.config.minStableFrames;
    
    return {
      stable,
      averagedCorners: averaged,
      jitterScore: jitter,
      framesSinceStable: stable ? this.stableFrameCount - this.config.minStableFrames : 0,
      averageConfidence: avgConfidence,
    };
  }
  
  /**
   * Calculate averaged corner positions
   */
  private calculateAveragedCorners(): DetectedCorners {
    const n = this.buffer.length;
    
    const avgCorner = (getter: (c: DetectedCorners) => Point): Point => ({
      x: this.buffer.reduce((sum, c) => sum + getter(c).x, 0) / n,
      y: this.buffer.reduce((sum, c) => sum + getter(c).y, 0) / n,
    });
    
    return {
      topLeft: avgCorner(c => c.topLeft),
      topRight: avgCorner(c => c.topRight),
      bottomRight: avgCorner(c => c.bottomRight),
      bottomLeft: avgCorner(c => c.bottomLeft),
      confidence: this.buffer.reduce((sum, c) => sum + c.confidence, 0) / n,
    };
  }
  
  /**
   * Calculate jitter (max standard deviation across all corners)
   */
  private calculateJitter(averaged: DetectedCorners): number {
    const stdDev = (getter: (c: DetectedCorners) => Point, avgPoint: Point): number => {
      const varX = this.buffer.reduce((sum, c) => {
        const diff = getter(c).x - avgPoint.x;
        return sum + diff * diff;
      }, 0) / this.buffer.length;
      
      const varY = this.buffer.reduce((sum, c) => {
        const diff = getter(c).y - avgPoint.y;
        return sum + diff * diff;
      }, 0) / this.buffer.length;
      
      return Math.sqrt(varX + varY);
    };
    
    // Return max jitter across all corners
    return Math.max(
      stdDev(c => c.topLeft, averaged.topLeft),
      stdDev(c => c.topRight, averaged.topRight),
      stdDev(c => c.bottomRight, averaged.bottomRight),
      stdDev(c => c.bottomLeft, averaged.bottomLeft)
    );
  }
  
  /**
   * Get current stability result without adding a frame
   */
  getResult(): StabilityResult {
    if (this.buffer.length < 3) {
      return {
        stable: false,
        averagedCorners: null,
        jitterScore: Infinity,
        framesSinceStable: 0,
        averageConfidence: 0,
      };
    }
    
    const averaged = this.calculateAveragedCorners();
    const jitter = this.calculateJitter(averaged);
    const avgConfidence = this.buffer.reduce((sum, c) => sum + c.confidence, 0) / this.buffer.length;
    const stable = this.stableFrameCount >= this.config.minStableFrames;
    
    return {
      stable,
      averagedCorners: averaged,
      jitterScore: jitter,
      framesSinceStable: stable ? this.stableFrameCount - this.config.minStableFrames : 0,
      averageConfidence: avgConfidence,
    };
  }
  
  /**
   * Reset the buffer
   */
  reset(): void {
    this.buffer = [];
    this.stableFrameCount = 0;
  }
  
  /**
   * Get buffer size
   */
  get size(): number {
    return this.buffer.length;
  }
}

/**
 * Validate a quadrilateral for safety checks
 */
export function validateQuadrilateral(
  corners: DetectedCorners,
  frameWidth: number,
  frameHeight: number
): { valid: boolean; reason?: string } {
  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  
  // Check convexity (self-crossing check)
  if (!isConvexPolygon(points)) {
    return { valid: false, reason: 'Invalid shape (self-crossing)' };
  }
  
  // Calculate area
  const area = quadrilateralArea(points);
  const frameArea = frameWidth * frameHeight;
  
  // Too large check (>95% of frame = probably capturing whole view)
  if (area / frameArea > 0.95) {
    return { valid: false, reason: 'Document too close to frame edges' };
  }
  
  // Too small check (<10% of frame)
  if (area / frameArea < 0.10) {
    return { valid: false, reason: 'Document too small or far away' };
  }
  
  return { valid: true };
}

/**
 * Check if polygon is convex
 */
function isConvexPolygon(points: Point[]): boolean {
  const n = points.length;
  let sign = 0;
  
  for (let i = 0; i < n; i++) {
    const dx1 = points[(i + 1) % n].x - points[i].x;
    const dy1 = points[(i + 1) % n].y - points[i].y;
    const dx2 = points[(i + 2) % n].x - points[(i + 1) % n].x;
    const dy2 = points[(i + 2) % n].y - points[(i + 1) % n].y;
    
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
 * Calculate quadrilateral area using shoelace formula
 */
function quadrilateralArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}
