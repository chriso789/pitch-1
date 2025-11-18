import * as turf from '@turf/turf';
import type { SplitLine } from './polygonSplitting';

export type RoofPattern = 'gable' | 'hip' | 'complex' | 'flat' | 'unknown';

export interface RoofPatternResult {
  pattern: RoofPattern;
  confidence: number;
  suggestedSplits: SplitLine[];
  description: string;
}

/**
 * Detect roof pattern based on building shape and linear features
 */
export function detectRoofPattern(
  buildingPolygon: [number, number][],
  linearFeatures?: any
): RoofPatternResult {
  const ridges = linearFeatures?.ridges || [];
  const hips = linearFeatures?.hips || [];
  const valleys = linearFeatures?.valleys || [];

  // Calculate building metrics
  const cornerCount = buildingPolygon.length;
  const polygon = turf.polygon([[...buildingPolygon, buildingPolygon[0]]]);
  const bbox = turf.bbox(polygon);
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  const aspectRatio = Math.max(width, height) / Math.min(width, height);

  // Gable detection: rectangular shape with 1 ridge line
  if (cornerCount === 4 && aspectRatio > 1.3 && ridges.length === 1 && hips.length === 0) {
    const ridge = ridges[0];
    const ridgePoints = ridge.points || [];
    if (ridgePoints.length >= 2) {
      return {
        pattern: 'gable',
        confidence: 0.95,
        suggestedSplits: [{
          start: ridgePoints[0],
          end: ridgePoints[ridgePoints.length - 1],
        }],
        description: 'Simple gable roof with single ridge line parallel to long axis',
      };
    }
  }

  // Hip detection: rectangular shape with multiple converging hip lines
  if (cornerCount === 4 && hips.length >= 2) {
    // Calculate building center
    const centerX = (bbox[0] + bbox[2]) / 2;
    const centerY = (bbox[1] + bbox[3]) / 2;
    const center: [number, number] = [centerX, centerY];

    // Create splits from corners to center
    const suggestedSplits: SplitLine[] = buildingPolygon.map(corner => ({
      start: corner,
      end: center,
    }));

    return {
      pattern: 'hip',
      confidence: 0.85,
      suggestedSplits,
      description: 'Hip roof with converging planes meeting at center',
    };
  }

  // Complex detection: many corners or multiple ridge/valley lines
  if (cornerCount >= 6 || valleys.length >= 2 || (ridges.length + hips.length + valleys.length) >= 4) {
    return {
      pattern: 'complex',
      confidence: 0.80,
      suggestedSplits: [],
      description: 'Complex roof with multiple planes - use manual splitting or linear feature suggestions',
    };
  }

  // Flat detection: simple shape with no significant linear features
  if ((ridges.length + hips.length + valleys.length) === 0) {
    return {
      pattern: 'flat',
      confidence: 0.70,
      suggestedSplits: [],
      description: 'Flat roof or low pitch - no splitting needed',
    };
  }

  // Unknown pattern
  return {
    pattern: 'unknown',
    confidence: 0.50,
    suggestedSplits: [],
    description: 'Unable to determine roof pattern - use manual splitting tools',
  };
}

/**
 * Detect symmetrical split lines using bilateral symmetry
 */
export function detectSymmetricalSplits(
  buildingPolygon: [number, number][]
): SplitLine[] {
  if (buildingPolygon.length < 3) return [];

  // Calculate centroid
  const polygon = turf.polygon([[...buildingPolygon, buildingPolygon[0]]]);
  const centroid = turf.centroid(polygon);
  const center = centroid.geometry.coordinates as [number, number];

  // Calculate bounding box to determine primary axis
  const bbox = turf.bbox(polygon);
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];

  // Primary axis is along the longer dimension
  const isHorizontalPrimary = width > height;

  // Create split line through centroid along primary axis
  const offset = Math.max(width, height) * 0.6; // Extend beyond building
  
  const splitLine: SplitLine = isHorizontalPrimary
    ? {
        start: [center[0] - offset, center[1]],
        end: [center[0] + offset, center[1]],
      }
    : {
        start: [center[0], center[1] - offset],
        end: [center[0], center[1] + offset],
      };

  // Check symmetry by comparing point distances on each side
  const distances = buildingPolygon.map(point => {
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    return Math.sqrt(dx * dx + dy * dy);
  });

  // Calculate symmetry confidence (simple heuristic)
  const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
  const variance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
  const confidence = Math.max(0, Math.min(1, 1 - variance / avgDistance));

  // Only suggest if confidence is high
  if (confidence > 0.85) {
    return [splitLine];
  }

  return [];
}
