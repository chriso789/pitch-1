// ============================================
// TRAINING MASK GENERATOR — Stage 4
// Generates per-class vector masks for training data
// Uses coordinate arrays (not raster bitmaps) for edge function efficiency
// ============================================

import {
  type GroupedGeometry,
  type LineKey,
  LINE_KEYS,
} from './geometry-alignment.ts';

// ============================================
// TYPES
// ============================================

/** A single line mask segment with pixel coordinates */
export interface MaskSegment {
  lineType: LineKey;
  points: number[][];  // [[x1,y1],[x2,y2],...]
  pixelLength: number;
}

/** Per-class mask data in vector format */
export interface LineMasks {
  ridge: MaskSegment[];
  valley: MaskSegment[];
  hip: MaskSegment[];
  eave: MaskSegment[];
  rake: MaskSegment[];
  totalSegments: number;
}

/** Binary footprint mask as polygon coordinates */
export interface FootprintMask {
  polygon: number[][];   // Closed polygon [[x1,y1],...,[x1,y1]]
  areaPx: number;        // Pixel area of the polygon
}

/** Complete training pair data */
export interface TrainingPairData {
  aerialImageUrl: string;
  width: number;
  height: number;
  footprintMask: FootprintMask;
  lineMasks: LineMasks;
  labels: TrainingLabels;
  metadata: TrainingMetadata;
}

export interface TrainingLabels {
  totalAreaSqft: number | null;
  facetCount: number | null;
  predominantPitch: string | null;
  lineLengths: Record<LineKey, number | null>;
}

export interface TrainingMetadata {
  address: string;
  lat: number;
  lng: number;
  vendorSource: string | null;
  alignmentQuality: number;
  confidenceScore: number;
  generatedAt: string;
}

// ============================================
// MASK GENERATION
// ============================================

/**
 * Generate per-class line masks from aligned geometry.
 * Returns vector-format masks (coordinate arrays per segment).
 */
export function generateLineMasks(
  alignedGeometry: GroupedGeometry,
  width: number,
  height: number,
  lineWidth: number = 2,
): LineMasks {
  const masks: LineMasks = {
    ridge: [],
    valley: [],
    hip: [],
    eave: [],
    rake: [],
    totalSegments: 0,
  };

  for (const key of LINE_KEYS) {
    const segments = alignedGeometry[key] || [];
    for (const seg of segments) {
      if (seg.length < 2) continue;

      // Clip to image bounds
      const clipped = clipPolylineToRect(seg, 0, 0, width, height);
      if (clipped.length < 2) continue;

      const length = polylineLength(clipped);
      if (length < 1) continue;

      masks[key].push({
        lineType: key,
        points: clipped.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]),
        pixelLength: Math.round(length * 100) / 100,
      });
      masks.totalSegments++;
    }
  }

  return masks;
}

/**
 * Generate footprint mask from pixel coordinates of the footprint polygon.
 */
export function generateFootprintMask(
  footprintPixels: number[][],
  width: number,
  height: number,
): FootprintMask {
  // Clip polygon to image bounds
  const clipped = footprintPixels.map(pt => [
    Math.max(0, Math.min(width, pt[0])),
    Math.max(0, Math.min(height, pt[1])),
  ]);

  // Close the polygon if not already closed
  if (clipped.length > 0) {
    const first = clipped[0];
    const last = clipped[clipped.length - 1];
    if (Math.abs(first[0] - last[0]) > 0.1 || Math.abs(first[1] - last[1]) > 0.1) {
      clipped.push([first[0], first[1]]);
    }
  }

  // Calculate polygon area using shoelace formula
  const areaPx = Math.abs(shoelaceArea(clipped));

  return {
    polygon: clipped.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]),
    areaPx: Math.round(areaPx),
  };
}

// ============================================
// TRAINING PAIR PACKAGING
// ============================================

/**
 * Assemble a complete training pair record.
 */
export function packTrainingPair(opts: {
  aerialImageUrl: string;
  width: number;
  height: number;
  footprintPixels: number[][];
  alignedGeometry: GroupedGeometry;
  labels: TrainingLabels;
  metadata: TrainingMetadata;
  lineWidth?: number;
}): TrainingPairData {
  const { aerialImageUrl, width, height, footprintPixels, alignedGeometry, labels, metadata, lineWidth = 2 } = opts;

  const footprintMask = generateFootprintMask(footprintPixels, width, height);
  const lineMasks = generateLineMasks(alignedGeometry, width, height, lineWidth);

  return {
    aerialImageUrl,
    width,
    height,
    footprintMask,
    lineMasks,
    labels,
    metadata,
  };
}

// ============================================
// GEOMETRY UTILITIES
// ============================================

function polylineLength(pts: number[][]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

function shoelaceArea(polygon: number[][]): number {
  let area = 0;
  for (let i = 0; i < polygon.length - 1; i++) {
    area += polygon[i][0] * polygon[i + 1][1] - polygon[i + 1][0] * polygon[i][1];
  }
  return area / 2;
}

/**
 * Simple polyline clipping to a rectangle.
 * Keeps segments that have at least one point inside the rect.
 */
function clipPolylineToRect(
  polyline: number[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number[][] {
  if (polyline.length < 2) return polyline;

  const result: number[][] = [];

  for (const pt of polyline) {
    const clipped = [
      Math.max(x1, Math.min(x2, pt[0])),
      Math.max(y1, Math.min(y2, pt[1])),
    ];
    result.push(clipped);
  }

  // Remove degenerate segments (all points collapsed to same location)
  if (result.length >= 2) {
    const totalLen = polylineLength(result);
    if (totalLen < 0.5) return [];
  }

  return result;
}
