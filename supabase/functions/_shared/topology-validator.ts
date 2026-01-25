/**
 * Phase 12: Topological Consistency Validator
 * Ensures all roof geometry follows physically valid topology
 */

import { haversineDistanceFt } from './vertex-detector.ts';

export interface TopologyValidationResult {
  valid: boolean;
  score: number; // 0-100
  errors: TopologyError[];
  warnings: TopologyWarning[];
  repairSuggestions: RepairSuggestion[];
}

export interface TopologyError {
  type: TopologyErrorType;
  severity: 'error' | 'critical';
  description: string;
  affectedFeatureIds: string[];
  location?: { lat: number; lng: number };
}

export interface TopologyWarning {
  type: string;
  description: string;
  affectedFeatureIds: string[];
}

export interface RepairSuggestion {
  action: 'snap' | 'extend' | 'remove' | 'split' | 'merge';
  description: string;
  featureId: string;
  suggestedCoordinates?: { lat: number; lng: number }[];
}

export type TopologyErrorType =
  | 'orphan_line'
  | 'crossing_lines'
  | 'disconnected_hip'
  | 'disconnected_valley'
  | 'ridge_without_hips'
  | 'duplicate_feature'
  | 'invalid_junction'
  | 'incomplete_perimeter';

export interface LinearFeature {
  id: string;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

export interface TopologyRules {
  connectionToleranceFt: number;
  crossingToleranceFt: number;
  duplicateToleranceFt: number;
  requireHipsConnectToRidge: boolean;
  requireHipsConnectToPerimeter: boolean;
  requireValleysConnectToRidge: boolean;
  allowCrossingLines: boolean;
}

const DEFAULT_RULES: TopologyRules = {
  connectionToleranceFt: 2.0,
  crossingToleranceFt: 0.5,
  duplicateToleranceFt: 1.0,
  requireHipsConnectToRidge: true,
  requireHipsConnectToPerimeter: true,
  requireValleysConnectToRidge: true,
  allowCrossingLines: false
};

/**
 * Check if two line segments intersect (cross each other)
 */
export function doLinesIntersect(
  line1: { startLat: number; startLng: number; endLat: number; endLng: number },
  line2: { startLat: number; startLng: number; endLat: number; endLng: number }
): { intersects: boolean; point?: { lat: number; lng: number } } {
  const x1 = line1.startLng, y1 = line1.startLat;
  const x2 = line1.endLng, y2 = line1.endLat;
  const x3 = line2.startLng, y3 = line2.startLat;
  const x4 = line2.endLng, y4 = line2.endLat;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

  if (Math.abs(denom) < 1e-10) {
    return { intersects: false }; // Lines are parallel
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  // Check if intersection is within both line segments (not at endpoints)
  const epsilon = 0.01; // Small buffer to exclude endpoint intersections
  if (t > epsilon && t < 1 - epsilon && u > epsilon && u < 1 - epsilon) {
    return {
      intersects: true,
      point: {
        lat: y1 + t * (y2 - y1),
        lng: x1 + t * (x2 - x1)
      }
    };
  }

  return { intersects: false };
}

/**
 * Check if a point is connected to any endpoint in a set of features
 */
export function isPointConnected(
  point: { lat: number; lng: number },
  features: LinearFeature[],
  excludeId: string,
  toleranceFt: number
): boolean {
  for (const feature of features) {
    if (feature.id === excludeId) continue;

    const distToStart = haversineDistanceFt(point.lat, point.lng, feature.startLat, feature.startLng);
    const distToEnd = haversineDistanceFt(point.lat, point.lng, feature.endLat, feature.endLng);

    if (distToStart <= toleranceFt || distToEnd <= toleranceFt) {
      return true;
    }
  }
  return false;
}

/**
 * Check for duplicate features (same start/end within tolerance)
 */
export function findDuplicates(
  features: LinearFeature[],
  toleranceFt: number
): { feature1Id: string; feature2Id: string }[] {
  const duplicates: { feature1Id: string; feature2Id: string }[] = [];

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const f1 = features[i];
      const f2 = features[j];

      // Check both orientations
      const sameDirection =
        haversineDistanceFt(f1.startLat, f1.startLng, f2.startLat, f2.startLng) <= toleranceFt &&
        haversineDistanceFt(f1.endLat, f1.endLng, f2.endLat, f2.endLng) <= toleranceFt;

      const oppositeDirection =
        haversineDistanceFt(f1.startLat, f1.startLng, f2.endLat, f2.endLng) <= toleranceFt &&
        haversineDistanceFt(f1.endLat, f1.endLng, f2.startLat, f2.startLng) <= toleranceFt;

      if (sameDirection || oppositeDirection) {
        duplicates.push({ feature1Id: f1.id, feature2Id: f2.id });
      }
    }
  }

  return duplicates;
}

/**
 * Validate that all hips connect properly
 */
export function validateHipConnections(
  hips: LinearFeature[],
  ridges: LinearFeature[],
  perimeterCorners: { lat: number; lng: number }[],
  toleranceFt: number
): TopologyError[] {
  const errors: TopologyError[] = [];

  for (const hip of hips) {
    // Check ridge connection
    let ridgeConnected = false;
    for (const ridge of ridges) {
      const startToRidgeStart = haversineDistanceFt(hip.startLat, hip.startLng, ridge.startLat, ridge.startLng);
      const startToRidgeEnd = haversineDistanceFt(hip.startLat, hip.startLng, ridge.endLat, ridge.endLng);
      const endToRidgeStart = haversineDistanceFt(hip.endLat, hip.endLng, ridge.startLat, ridge.startLng);
      const endToRidgeEnd = haversineDistanceFt(hip.endLat, hip.endLng, ridge.endLat, ridge.endLng);

      if (Math.min(startToRidgeStart, startToRidgeEnd, endToRidgeStart, endToRidgeEnd) <= toleranceFt) {
        ridgeConnected = true;
        break;
      }
    }

    if (!ridgeConnected) {
      errors.push({
        type: 'disconnected_hip',
        severity: 'error',
        description: `Hip ${hip.id} is not connected to any ridge endpoint`,
        affectedFeatureIds: [hip.id],
        location: { lat: hip.startLat, lng: hip.startLng }
      });
    }

    // Check perimeter connection
    let perimeterConnected = false;
    for (const corner of perimeterCorners) {
      const startDist = haversineDistanceFt(hip.startLat, hip.startLng, corner.lat, corner.lng);
      const endDist = haversineDistanceFt(hip.endLat, hip.endLng, corner.lat, corner.lng);

      if (startDist <= toleranceFt || endDist <= toleranceFt) {
        perimeterConnected = true;
        break;
      }
    }

    if (!perimeterConnected) {
      errors.push({
        type: 'disconnected_hip',
        severity: 'error',
        description: `Hip ${hip.id} is not connected to any perimeter corner`,
        affectedFeatureIds: [hip.id],
        location: { lat: hip.endLat, lng: hip.endLng }
      });
    }
  }

  return errors;
}

/**
 * Validate that all valleys connect properly
 */
export function validateValleyConnections(
  valleys: LinearFeature[],
  ridges: LinearFeature[],
  hips: LinearFeature[],
  toleranceFt: number
): TopologyError[] {
  const errors: TopologyError[] = [];

  for (const valley of valleys) {
    // Valley should connect to a ridge or hip
    let connected = false;

    // Check connection to ridges (including mid-points for T-intersections)
    for (const ridge of ridges) {
      const distToStart = haversineDistanceFt(valley.endLat, valley.endLng, ridge.startLat, ridge.startLng);
      const distToEnd = haversineDistanceFt(valley.endLat, valley.endLng, ridge.endLat, ridge.endLng);

      // Also check mid-point for T-shaped roofs
      const midLat = (ridge.startLat + ridge.endLat) / 2;
      const midLng = (ridge.startLng + ridge.endLng) / 2;
      const distToMid = haversineDistanceFt(valley.endLat, valley.endLng, midLat, midLng);

      if (Math.min(distToStart, distToEnd, distToMid) <= toleranceFt * 2) {
        connected = true;
        break;
      }
    }

    // Check connection to hips
    if (!connected) {
      for (const hip of hips) {
        const distToStart = haversineDistanceFt(valley.endLat, valley.endLng, hip.startLat, hip.startLng);
        const distToEnd = haversineDistanceFt(valley.endLat, valley.endLng, hip.endLat, hip.endLng);

        if (Math.min(distToStart, distToEnd) <= toleranceFt) {
          connected = true;
          break;
        }
      }
    }

    if (!connected) {
      errors.push({
        type: 'disconnected_valley',
        severity: 'error',
        description: `Valley ${valley.id} is not connected to any ridge or hip`,
        affectedFeatureIds: [valley.id],
        location: { lat: valley.endLat, lng: valley.endLng }
      });
    }
  }

  return errors;
}

/**
 * Check for crossing lines (lines that intersect in their interior)
 */
export function findCrossingLines(
  features: LinearFeature[]
): TopologyError[] {
  const errors: TopologyError[] = [];
  const checked = new Set<string>();

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const key = `${features[i].id}-${features[j].id}`;
      if (checked.has(key)) continue;
      checked.add(key);

      const intersection = doLinesIntersect(features[i], features[j]);

      if (intersection.intersects && intersection.point) {
        errors.push({
          type: 'crossing_lines',
          severity: 'error',
          description: `${features[i].type} and ${features[j].type} cross at interior point`,
          affectedFeatureIds: [features[i].id, features[j].id],
          location: intersection.point
        });
      }
    }
  }

  return errors;
}

/**
 * Find orphan lines (not connected to anything)
 */
export function findOrphanLines(
  features: LinearFeature[],
  perimeterCorners: { lat: number; lng: number }[],
  toleranceFt: number
): TopologyError[] {
  const errors: TopologyError[] = [];

  for (const feature of features) {
    // Exclude perimeter edges (eaves, rakes) from orphan check
    if (feature.type === 'eave' || feature.type === 'rake') continue;

    const startConnected = 
      isPointConnected({ lat: feature.startLat, lng: feature.startLng }, features, feature.id, toleranceFt) ||
      perimeterCorners.some(c => haversineDistanceFt(feature.startLat, feature.startLng, c.lat, c.lng) <= toleranceFt);

    const endConnected = 
      isPointConnected({ lat: feature.endLat, lng: feature.endLng }, features, feature.id, toleranceFt) ||
      perimeterCorners.some(c => haversineDistanceFt(feature.endLat, feature.endLng, c.lat, c.lng) <= toleranceFt);

    if (!startConnected && !endConnected) {
      errors.push({
        type: 'orphan_line',
        severity: 'error',
        description: `${feature.type} ${feature.id} is not connected at either endpoint`,
        affectedFeatureIds: [feature.id],
        location: { lat: feature.startLat, lng: feature.startLng }
      });
    } else if (!startConnected || !endConnected) {
      errors.push({
        type: 'orphan_line',
        severity: 'error',
        description: `${feature.type} ${feature.id} has a dangling endpoint`,
        affectedFeatureIds: [feature.id],
        location: !startConnected 
          ? { lat: feature.startLat, lng: feature.startLng }
          : { lat: feature.endLat, lng: feature.endLng }
      });
    }
  }

  return errors;
}

/**
 * Generate repair suggestions for topology errors
 */
export function generateRepairSuggestions(
  errors: TopologyError[],
  features: LinearFeature[],
  perimeterCorners: { lat: number; lng: number }[],
  toleranceFt: number
): RepairSuggestion[] {
  const suggestions: RepairSuggestion[] = [];

  for (const error of errors) {
    const feature = features.find(f => error.affectedFeatureIds.includes(f.id));
    if (!feature) continue;

    switch (error.type) {
      case 'orphan_line':
      case 'disconnected_hip':
      case 'disconnected_valley':
        // Suggest snapping to nearest valid endpoint
        if (error.location) {
          let nearestPoint: { lat: number; lng: number } | null = null;
          let nearestDist = Infinity;

          // Check other features
          for (const otherFeature of features) {
            if (otherFeature.id === feature.id) continue;
            
            const distToStart = haversineDistanceFt(
              error.location.lat, error.location.lng,
              otherFeature.startLat, otherFeature.startLng
            );
            const distToEnd = haversineDistanceFt(
              error.location.lat, error.location.lng,
              otherFeature.endLat, otherFeature.endLng
            );

            if (distToStart < nearestDist) {
              nearestDist = distToStart;
              nearestPoint = { lat: otherFeature.startLat, lng: otherFeature.startLng };
            }
            if (distToEnd < nearestDist) {
              nearestDist = distToEnd;
              nearestPoint = { lat: otherFeature.endLat, lng: otherFeature.endLng };
            }
          }

          // Check perimeter corners
          for (const corner of perimeterCorners) {
            const dist = haversineDistanceFt(error.location.lat, error.location.lng, corner.lat, corner.lng);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestPoint = corner;
            }
          }

          if (nearestPoint && nearestDist <= toleranceFt * 3) {
            suggestions.push({
              action: 'snap',
              description: `Snap ${feature.type} endpoint to nearby feature (${nearestDist.toFixed(1)}ft away)`,
              featureId: feature.id,
              suggestedCoordinates: [nearestPoint]
            });
          } else {
            suggestions.push({
              action: 'remove',
              description: `Remove orphan ${feature.type} - no valid connection points nearby`,
              featureId: feature.id
            });
          }
        }
        break;

      case 'crossing_lines':
        suggestions.push({
          action: 'split',
          description: `Split crossing lines at intersection point or verify they should meet at a junction`,
          featureId: feature.id,
          suggestedCoordinates: error.location ? [error.location] : undefined
        });
        break;

      case 'duplicate_feature':
        suggestions.push({
          action: 'remove',
          description: `Remove duplicate ${feature.type}`,
          featureId: error.affectedFeatureIds[1] // Remove the second one
        });
        break;
    }
  }

  return suggestions;
}

/**
 * Main topology validation function
 */
export function validateTopology(
  features: LinearFeature[],
  perimeterCorners: { lat: number; lng: number }[],
  rules: Partial<TopologyRules> = {}
): TopologyValidationResult {
  const cfg = { ...DEFAULT_RULES, ...rules };
  const errors: TopologyError[] = [];
  const warnings: TopologyWarning[] = [];

  // Separate features by type
  const ridges = features.filter(f => f.type === 'ridge');
  const hips = features.filter(f => f.type === 'hip');
  const valleys = features.filter(f => f.type === 'valley');

  // Check for duplicates
  const duplicates = findDuplicates(features, cfg.duplicateToleranceFt);
  for (const dup of duplicates) {
    errors.push({
      type: 'duplicate_feature',
      severity: 'error',
      description: `Duplicate features detected`,
      affectedFeatureIds: [dup.feature1Id, dup.feature2Id]
    });
  }

  // Check hip connections
  if (cfg.requireHipsConnectToRidge) {
    const hipErrors = validateHipConnections(hips, ridges, perimeterCorners, cfg.connectionToleranceFt);
    errors.push(...hipErrors);
  }

  // Check valley connections
  if (cfg.requireValleysConnectToRidge) {
    const valleyErrors = validateValleyConnections(valleys, ridges, hips, cfg.connectionToleranceFt);
    errors.push(...valleyErrors);
  }

  // Check for crossing lines
  if (!cfg.allowCrossingLines) {
    const crossingErrors = findCrossingLines(features);
    errors.push(...crossingErrors);
  }

  // Check for orphan lines
  const orphanErrors = findOrphanLines(features, perimeterCorners, cfg.connectionToleranceFt);
  errors.push(...orphanErrors);

  // Check ridge-hip topology for rectangular hip roofs
  if (perimeterCorners.length === 4 && ridges.length === 1 && hips.length !== 4) {
    warnings.push({
      type: 'hip_count_mismatch',
      description: `Rectangular footprint with single ridge should have 4 hips, found ${hips.length}`,
      affectedFeatureIds: hips.map(h => h.id)
    });
  }

  // Generate repair suggestions
  const repairSuggestions = generateRepairSuggestions(
    errors,
    features,
    perimeterCorners,
    cfg.connectionToleranceFt
  );

  // Calculate score
  let score = 100;
  score -= errors.filter(e => e.severity === 'critical').length * 20;
  score -= errors.filter(e => e.severity === 'error').length * 10;
  score -= warnings.length * 5;
  score = Math.max(0, score);

  return {
    valid: errors.length === 0,
    score,
    errors,
    warnings,
    repairSuggestions
  };
}

/**
 * Auto-repair minor topology issues
 */
export function autoRepairTopology(
  features: LinearFeature[],
  perimeterCorners: { lat: number; lng: number }[],
  repairSuggestions: RepairSuggestion[]
): { repairedFeatures: LinearFeature[]; appliedRepairs: string[] } {
  const repairedFeatures = [...features];
  const appliedRepairs: string[] = [];

  for (const suggestion of repairSuggestions) {
    if (suggestion.action === 'snap' && suggestion.suggestedCoordinates?.length === 1) {
      const featureIndex = repairedFeatures.findIndex(f => f.id === suggestion.featureId);
      if (featureIndex >= 0) {
        const feature = repairedFeatures[featureIndex];
        const target = suggestion.suggestedCoordinates[0];

        // Snap the closer endpoint
        const startDist = haversineDistanceFt(feature.startLat, feature.startLng, target.lat, target.lng);
        const endDist = haversineDistanceFt(feature.endLat, feature.endLng, target.lat, target.lng);

        if (startDist < endDist) {
          repairedFeatures[featureIndex] = {
            ...feature,
            startLat: target.lat,
            startLng: target.lng
          };
        } else {
          repairedFeatures[featureIndex] = {
            ...feature,
            endLat: target.lat,
            endLng: target.lng
          };
        }

        appliedRepairs.push(`Snapped ${feature.type} ${feature.id} endpoint to (${target.lat.toFixed(6)}, ${target.lng.toFixed(6)})`);
      }
    } else if (suggestion.action === 'remove') {
      const featureIndex = repairedFeatures.findIndex(f => f.id === suggestion.featureId);
      if (featureIndex >= 0) {
        const removed = repairedFeatures.splice(featureIndex, 1)[0];
        appliedRepairs.push(`Removed duplicate/orphan ${removed.type} ${removed.id}`);
      }
    }
  }

  return { repairedFeatures, appliedRepairs };
}
