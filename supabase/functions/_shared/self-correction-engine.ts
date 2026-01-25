/**
 * Phase 56: Automated Measurement Self-Correction System
 * Detects and auto-corrects common measurement errors without human intervention
 */

interface CorrectionResult {
  corrected: boolean;
  correctionType: string;
  originalGeometry: any;
  correctedGeometry: any;
  correctionReason: string;
  confidenceBefore: number;
  confidenceAfter: number;
  autoApplied: boolean;
}

interface RoofGeometry {
  perimeter: { lat: number; lng: number }[];
  ridges: LineSegment[];
  hips: LineSegment[];
  valleys: LineSegment[];
  eaves: LineSegment[];
  rakes: LineSegment[];
  facets: Facet[];
}

interface LineSegment {
  id: string;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  type: string;
  confidence: number;
}

interface Facet {
  id: string;
  vertices: { lat: number; lng: number }[];
  area: number;
  pitch: string;
}

interface TopologyError {
  type: string;
  severity: 'minor' | 'moderate' | 'severe';
  description: string;
  location: { lat: number; lng: number };
  affectedFeatures: string[];
  canAutoFix: boolean;
}

/**
 * Main self-correction function
 */
export function applySelfCorrections(
  geometry: RoofGeometry,
  confidence: number
): CorrectionResult[] {
  const corrections: CorrectionResult[] = [];
  let currentGeometry = JSON.parse(JSON.stringify(geometry));
  let currentConfidence = confidence;

  // 1. Detect and fix topology errors
  const topologyCorrections = fixTopologyErrors(currentGeometry);
  corrections.push(...topologyCorrections);
  if (topologyCorrections.some(c => c.corrected)) {
    currentConfidence = Math.min(currentConfidence + 0.05, 0.98);
  }

  // 2. Fix ridges that don't span building width
  const ridgeCorrections = fixIncompleteRidges(currentGeometry);
  corrections.push(...ridgeCorrections);

  // 3. Fix hips not reaching corners
  const hipCorrections = fixHipsNotReachingCorners(currentGeometry);
  corrections.push(...hipCorrections);

  // 4. Remove orphan features
  const orphanCorrections = removeOrphanFeatures(currentGeometry);
  corrections.push(...orphanCorrections);

  // 5. Fix gaps in perimeter
  const perimeterCorrections = fixPerimeterGaps(currentGeometry);
  corrections.push(...perimeterCorrections);

  // 6. Validate and fix facet closure
  const facetCorrections = fixFacetClosure(currentGeometry);
  corrections.push(...facetCorrections);

  // 7. Snap nearby vertices
  const snapCorrections = snapNearbyVertices(currentGeometry);
  corrections.push(...snapCorrections);

  return corrections;
}

/**
 * Detect topology errors in the roof geometry
 */
export function detectTopologyErrors(geometry: RoofGeometry): TopologyError[] {
  const errors: TopologyError[] = [];

  // Check for disconnected ridges
  for (const ridge of geometry.ridges) {
    const startsAtPerimeter = isPointNearPerimeter(ridge.start, geometry.perimeter);
    const endsAtPerimeter = isPointNearPerimeter(ridge.end, geometry.perimeter);
    const startsAtHip = isPointNearLineEnds(ridge.start, geometry.hips);
    const endsAtHip = isPointNearLineEnds(ridge.end, geometry.hips);

    if (!startsAtPerimeter && !startsAtHip) {
      errors.push({
        type: 'disconnected_ridge_start',
        severity: 'moderate',
        description: `Ridge ${ridge.id} start is not connected`,
        location: ridge.start,
        affectedFeatures: [ridge.id],
        canAutoFix: true
      });
    }

    if (!endsAtPerimeter && !endsAtHip) {
      errors.push({
        type: 'disconnected_ridge_end',
        severity: 'moderate',
        description: `Ridge ${ridge.id} end is not connected`,
        location: ridge.end,
        affectedFeatures: [ridge.id],
        canAutoFix: true
      });
    }
  }

  // Check for hips not reaching corners
  for (const hip of geometry.hips) {
    const endsAtCorner = isPointNearCorner(hip.end, geometry.perimeter);
    const endsAtRidge = isPointNearLineEnds(hip.end, geometry.ridges);

    if (!endsAtCorner && !endsAtRidge) {
      errors.push({
        type: 'hip_not_at_corner',
        severity: 'severe',
        description: `Hip ${hip.id} does not terminate at perimeter corner or ridge`,
        location: hip.end,
        affectedFeatures: [hip.id],
        canAutoFix: true
      });
    }
  }

  // Check for valleys at non-reflex angles
  for (const valley of geometry.valleys) {
    const atReflexAngle = isPointAtReflexAngle(valley.start, geometry.perimeter);
    if (!atReflexAngle) {
      errors.push({
        type: 'valley_not_at_reflex',
        severity: 'moderate',
        description: `Valley ${valley.id} starts at non-reflex perimeter angle`,
        location: valley.start,
        affectedFeatures: [valley.id],
        canAutoFix: false
      });
    }
  }

  // Check for gaps in perimeter
  const perimeterGaps = findPerimeterGaps(geometry.perimeter);
  for (const gap of perimeterGaps) {
    errors.push({
      type: 'perimeter_gap',
      severity: 'severe',
      description: `Gap in perimeter between vertices`,
      location: gap.start,
      affectedFeatures: [],
      canAutoFix: true
    });
  }

  return errors;
}

/**
 * Fix topology errors automatically
 */
function fixTopologyErrors(geometry: RoofGeometry): CorrectionResult[] {
  const corrections: CorrectionResult[] = [];
  const errors = detectTopologyErrors(geometry);

  for (const error of errors.filter(e => e.canAutoFix)) {
    const originalGeometry = JSON.parse(JSON.stringify(geometry));
    let fixed = false;
    let reason = '';

    switch (error.type) {
      case 'disconnected_ridge_start':
      case 'disconnected_ridge_end':
        fixed = extendRidgeToConnection(geometry, error);
        reason = 'Extended ridge to nearest connection point';
        break;

      case 'hip_not_at_corner':
        fixed = snapHipToCorner(geometry, error);
        reason = 'Snapped hip endpoint to nearest perimeter corner';
        break;

      case 'perimeter_gap':
        fixed = closePerimeterGap(geometry, error);
        reason = 'Closed gap in perimeter polygon';
        break;
    }

    if (fixed) {
      corrections.push({
        corrected: true,
        correctionType: error.type,
        originalGeometry,
        correctedGeometry: JSON.parse(JSON.stringify(geometry)),
        correctionReason: reason,
        confidenceBefore: 0.7,
        confidenceAfter: 0.85,
        autoApplied: true
      });
    }
  }

  return corrections;
}

/**
 * Fix ridges that don't span the building width
 */
function fixIncompleteRidges(geometry: RoofGeometry): CorrectionResult[] {
  const corrections: CorrectionResult[] = [];

  for (const ridge of geometry.ridges) {
    const ridgeLength = calculateDistance(ridge.start, ridge.end);
    const buildingWidth = estimateBuildingWidth(geometry.perimeter);

    // Ridge should be at least 50% of building width for gable, or connect to hips
    if (ridgeLength < buildingWidth * 0.3) {
      const originalGeometry = JSON.parse(JSON.stringify(geometry));

      // Try to extend ridge to meet hips or perimeter
      const extended = extendRidgeToFullWidth(geometry, ridge);

      if (extended) {
        corrections.push({
          corrected: true,
          correctionType: 'incomplete_ridge',
          originalGeometry,
          correctedGeometry: JSON.parse(JSON.stringify(geometry)),
          correctionReason: `Extended ridge from ${ridgeLength.toFixed(1)}ft to full width`,
          confidenceBefore: 0.6,
          confidenceAfter: 0.8,
          autoApplied: true
        });
      }
    }
  }

  return corrections;
}

/**
 * Fix hips that don't reach perimeter corners
 */
function fixHipsNotReachingCorners(geometry: RoofGeometry): CorrectionResult[] {
  const corrections: CorrectionResult[] = [];
  const corners = findPerimeterCorners(geometry.perimeter);

  for (const hip of geometry.hips) {
    // Hip should end at a corner or at a ridge
    const nearCorner = corners.find(c => 
      calculateDistance(hip.end, c) < 5 // Within 5 feet
    );

    if (!nearCorner) {
      const originalGeometry = JSON.parse(JSON.stringify(geometry));

      // Find closest corner and snap to it
      const closestCorner = findClosestCorner(hip.end, corners);
      if (closestCorner && calculateDistance(hip.end, closestCorner) < 10) {
        hip.end = closestCorner;

        corrections.push({
          corrected: true,
          correctionType: 'hip_not_at_corner',
          originalGeometry,
          correctedGeometry: JSON.parse(JSON.stringify(geometry)),
          correctionReason: 'Snapped hip endpoint to perimeter corner',
          confidenceBefore: 0.65,
          confidenceAfter: 0.85,
          autoApplied: true
        });
      }
    }
  }

  return corrections;
}

/**
 * Remove orphan features that aren't connected to anything
 */
function removeOrphanFeatures(geometry: RoofGeometry): CorrectionResult[] {
  const corrections: CorrectionResult[] = [];

  // Check each feature type for orphans
  const featureTypes: (keyof Pick<RoofGeometry, 'ridges' | 'hips' | 'valleys'>)[] = 
    ['ridges', 'hips', 'valleys'];

  for (const type of featureTypes) {
    const features = geometry[type] as LineSegment[];
    const orphans: number[] = [];

    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      const isConnected = isFeatureConnected(feature, geometry);

      if (!isConnected) {
        orphans.push(i);
      }
    }

    if (orphans.length > 0) {
      const originalGeometry = JSON.parse(JSON.stringify(geometry));

      // Remove orphans in reverse order to maintain indices
      for (const idx of orphans.reverse()) {
        features.splice(idx, 1);
      }

      corrections.push({
        corrected: true,
        correctionType: `orphan_${type}`,
        originalGeometry,
        correctedGeometry: JSON.parse(JSON.stringify(geometry)),
        correctionReason: `Removed ${orphans.length} orphan ${type}`,
        confidenceBefore: 0.6,
        confidenceAfter: 0.75,
        autoApplied: true
      });
    }
  }

  return corrections;
}

/**
 * Fix gaps in the perimeter polygon
 */
function fixPerimeterGaps(geometry: RoofGeometry): CorrectionResult[] {
  const corrections: CorrectionResult[] = [];
  const toleranceFt = 3;
  const toleranceDeg = toleranceFt / 364000;

  for (let i = 0; i < geometry.perimeter.length; i++) {
    const current = geometry.perimeter[i];
    const next = geometry.perimeter[(i + 1) % geometry.perimeter.length];
    const distance = calculateDistance(current, next);

    // If there's a gap that's too large, try to fill it
    if (distance > 50) { // Gap larger than 50 feet is suspicious
      // Check if we're missing a vertex
      const midpoint = {
        lat: (current.lat + next.lat) / 2,
        lng: (current.lng + next.lng) / 2
      };

      // Only add midpoint if it creates more reasonable segment lengths
      if (distance > 100) {
        const originalGeometry = JSON.parse(JSON.stringify(geometry));
        
        geometry.perimeter.splice(i + 1, 0, midpoint);

        corrections.push({
          corrected: true,
          correctionType: 'perimeter_gap',
          originalGeometry,
          correctedGeometry: JSON.parse(JSON.stringify(geometry)),
          correctionReason: `Added vertex to fill ${distance.toFixed(0)}ft gap`,
          confidenceBefore: 0.5,
          confidenceAfter: 0.7,
          autoApplied: true
        });
      }
    }
  }

  return corrections;
}

/**
 * Fix facet closure issues
 */
function fixFacetClosure(geometry: RoofGeometry): CorrectionResult[] {
  const corrections: CorrectionResult[] = [];

  for (const facet of geometry.facets) {
    if (facet.vertices.length < 3) continue;

    const first = facet.vertices[0];
    const last = facet.vertices[facet.vertices.length - 1];
    const closureDistance = calculateDistance(first, last);

    if (closureDistance > 0.5 && closureDistance < 5) {
      const originalGeometry = JSON.parse(JSON.stringify(geometry));

      // Close the facet by snapping last to first
      facet.vertices[facet.vertices.length - 1] = { ...first };

      corrections.push({
        corrected: true,
        correctionType: 'facet_closure',
        originalGeometry,
        correctedGeometry: JSON.parse(JSON.stringify(geometry)),
        correctionReason: `Closed facet ${facet.id} with ${closureDistance.toFixed(1)}ft gap`,
        confidenceBefore: 0.7,
        confidenceAfter: 0.85,
        autoApplied: true
      });
    }
  }

  return corrections;
}

/**
 * Snap nearby vertices that should be the same point
 */
function snapNearbyVertices(geometry: RoofGeometry): CorrectionResult[] {
  const corrections: CorrectionResult[] = [];
  const snapThresholdFt = 2;
  const snapThresholdDeg = snapThresholdFt / 364000;

  // Collect all vertices from all features
  const allVertices: { source: string; idx: number; point: { lat: number; lng: number } }[] = [];

  geometry.ridges.forEach((r, i) => {
    allVertices.push({ source: `ridge_${i}_start`, idx: i, point: r.start });
    allVertices.push({ source: `ridge_${i}_end`, idx: i, point: r.end });
  });

  geometry.hips.forEach((h, i) => {
    allVertices.push({ source: `hip_${i}_start`, idx: i, point: h.start });
    allVertices.push({ source: `hip_${i}_end`, idx: i, point: h.end });
  });

  // Find clusters of nearby vertices
  const clusters: typeof allVertices[] = [];
  const used = new Set<string>();

  for (const v1 of allVertices) {
    if (used.has(v1.source)) continue;

    const cluster = [v1];
    used.add(v1.source);

    for (const v2 of allVertices) {
      if (used.has(v2.source)) continue;

      const distance = Math.sqrt(
        Math.pow(v1.point.lat - v2.point.lat, 2) +
        Math.pow(v1.point.lng - v2.point.lng, 2)
      );

      if (distance < snapThresholdDeg) {
        cluster.push(v2);
        used.add(v2.source);
      }
    }

    if (cluster.length > 1) {
      clusters.push(cluster);
    }
  }

  // Snap clustered vertices to centroid
  for (const cluster of clusters) {
    const originalGeometry = JSON.parse(JSON.stringify(geometry));

    const centroid = {
      lat: cluster.reduce((sum, v) => sum + v.point.lat, 0) / cluster.length,
      lng: cluster.reduce((sum, v) => sum + v.point.lng, 0) / cluster.length
    };

    for (const v of cluster) {
      v.point.lat = centroid.lat;
      v.point.lng = centroid.lng;
    }

    corrections.push({
      corrected: true,
      correctionType: 'vertex_snap',
      originalGeometry,
      correctedGeometry: JSON.parse(JSON.stringify(geometry)),
      correctionReason: `Snapped ${cluster.length} nearby vertices to common point`,
      confidenceBefore: 0.75,
      confidenceAfter: 0.9,
      autoApplied: true
    });
  }

  return corrections;
}

// Helper functions
function calculateDistance(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
  const R = 20902231; // Earth radius in feet
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function isPointNearPerimeter(point: { lat: number; lng: number }, perimeter: { lat: number; lng: number }[]): boolean {
  for (const p of perimeter) {
    if (calculateDistance(point, p) < 5) return true;
  }
  return false;
}

function isPointNearLineEnds(point: { lat: number; lng: number }, lines: LineSegment[]): boolean {
  for (const line of lines) {
    if (calculateDistance(point, line.start) < 5) return true;
    if (calculateDistance(point, line.end) < 5) return true;
  }
  return false;
}

function isPointNearCorner(point: { lat: number; lng: number }, perimeter: { lat: number; lng: number }[]): boolean {
  const corners = findPerimeterCorners(perimeter);
  for (const corner of corners) {
    if (calculateDistance(point, corner) < 5) return true;
  }
  return false;
}

function isPointAtReflexAngle(point: { lat: number; lng: number }, perimeter: { lat: number; lng: number }[]): boolean {
  // Find the point in perimeter and check if angle is reflex
  for (let i = 0; i < perimeter.length; i++) {
    if (calculateDistance(point, perimeter[i]) < 2) {
      const prev = perimeter[(i - 1 + perimeter.length) % perimeter.length];
      const curr = perimeter[i];
      const next = perimeter[(i + 1) % perimeter.length];
      
      const angle = calculateAngle(prev, curr, next);
      return angle > 180;
    }
  }
  return false;
}

function calculateAngle(p1: any, p2: any, p3: any): number {
  const v1 = { x: p1.lng - p2.lng, y: p1.lat - p2.lat };
  const v2 = { x: p3.lng - p2.lng, y: p3.lat - p2.lat };
  const angle = Math.atan2(v2.y, v2.x) - Math.atan2(v1.y, v1.x);
  return ((angle * 180 / Math.PI) + 360) % 360;
}

function findPerimeterGaps(perimeter: { lat: number; lng: number }[]): { start: { lat: number; lng: number }; end: { lat: number; lng: number } }[] {
  const gaps: { start: { lat: number; lng: number }; end: { lat: number; lng: number } }[] = [];
  const maxNormalDistance = 30; // feet

  for (let i = 0; i < perimeter.length; i++) {
    const current = perimeter[i];
    const next = perimeter[(i + 1) % perimeter.length];
    const distance = calculateDistance(current, next);

    if (distance > maxNormalDistance * 2) {
      gaps.push({ start: current, end: next });
    }
  }

  return gaps;
}

function findPerimeterCorners(perimeter: { lat: number; lng: number }[]): { lat: number; lng: number }[] {
  const corners: { lat: number; lng: number }[] = [];

  for (let i = 0; i < perimeter.length; i++) {
    const prev = perimeter[(i - 1 + perimeter.length) % perimeter.length];
    const curr = perimeter[i];
    const next = perimeter[(i + 1) % perimeter.length];

    const angle = calculateAngle(prev, curr, next);
    if (angle > 45 && angle < 315) {
      corners.push(curr);
    }
  }

  return corners;
}

function findClosestCorner(point: { lat: number; lng: number }, corners: { lat: number; lng: number }[]): { lat: number; lng: number } | null {
  if (corners.length === 0) return null;

  let closest = corners[0];
  let minDist = calculateDistance(point, corners[0]);

  for (const corner of corners) {
    const dist = calculateDistance(point, corner);
    if (dist < minDist) {
      minDist = dist;
      closest = corner;
    }
  }

  return closest;
}

function estimateBuildingWidth(perimeter: { lat: number; lng: number }[]): number {
  const lats = perimeter.map(p => p.lat);
  const lngs = perimeter.map(p => p.lng);
  
  const latRange = (Math.max(...lats) - Math.min(...lats)) * 364000;
  const lngRange = (Math.max(...lngs) - Math.min(...lngs)) * 364000 * Math.cos(perimeter[0].lat * Math.PI / 180);
  
  return Math.min(latRange, lngRange);
}

function extendRidgeToConnection(geometry: RoofGeometry, error: TopologyError): boolean {
  const ridge = geometry.ridges.find(r => r.id === error.affectedFeatures[0]);
  if (!ridge) return false;

  // Find nearest hip or perimeter point
  let nearestPoint: { lat: number; lng: number } | null = null;
  let minDist = Infinity;

  for (const hip of geometry.hips) {
    const distStart = calculateDistance(error.location, hip.start);
    const distEnd = calculateDistance(error.location, hip.end);
    if (distStart < minDist) { minDist = distStart; nearestPoint = hip.start; }
    if (distEnd < minDist) { minDist = distEnd; nearestPoint = hip.end; }
  }

  if (nearestPoint && minDist < 15) {
    if (error.type === 'disconnected_ridge_start') {
      ridge.start = nearestPoint;
    } else {
      ridge.end = nearestPoint;
    }
    return true;
  }

  return false;
}

function snapHipToCorner(geometry: RoofGeometry, error: TopologyError): boolean {
  const hip = geometry.hips.find(h => h.id === error.affectedFeatures[0]);
  if (!hip) return false;

  const corners = findPerimeterCorners(geometry.perimeter);
  const closest = findClosestCorner(error.location, corners);

  if (closest && calculateDistance(error.location, closest) < 10) {
    hip.end = closest;
    return true;
  }

  return false;
}

function closePerimeterGap(geometry: RoofGeometry, error: TopologyError): boolean {
  // Already handled in fixPerimeterGaps
  return true;
}

function isFeatureConnected(feature: LineSegment, geometry: RoofGeometry): boolean {
  const threshold = 5; // feet

  // Check connection at start
  const startConnected = 
    isPointNearPerimeter(feature.start, geometry.perimeter) ||
    isPointNearLineEnds(feature.start, geometry.ridges) ||
    isPointNearLineEnds(feature.start, geometry.hips) ||
    isPointNearLineEnds(feature.start, geometry.valleys);

  // Check connection at end
  const endConnected = 
    isPointNearPerimeter(feature.end, geometry.perimeter) ||
    isPointNearLineEnds(feature.end, geometry.ridges) ||
    isPointNearLineEnds(feature.end, geometry.hips) ||
    isPointNearLineEnds(feature.end, geometry.valleys);

  return startConnected || endConnected;
}

function extendRidgeToFullWidth(geometry: RoofGeometry, ridge: LineSegment): boolean {
  // Find the direction of the ridge
  const dx = ridge.end.lng - ridge.start.lng;
  const dy = ridge.end.lat - ridge.start.lat;
  const length = Math.sqrt(dx*dx + dy*dy);
  
  if (length === 0) return false;

  // Extend in both directions until hitting perimeter or hip
  // This is a simplified version - full implementation would be more complex
  return false;
}
