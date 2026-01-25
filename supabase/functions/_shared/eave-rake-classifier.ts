/**
 * Phase 6: Eave and Rake Boundary Classification
 * Correctly classify perimeter edges as eaves vs rakes
 * Gable-end detection for rake identification
 */

import { haversineDistanceFt, extractVerticesFromWKT } from './vertex-detector.ts';
import { calculateAzimuth, normalizeRidgeAzimuth } from './ridge-detector.ts';

export interface ClassifiedEdge {
  id: string;
  type: 'eave' | 'rake' | 'unknown';
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  lengthFt: number;
  azimuthDegrees: number;
  confidence: number;
  isAtGableEnd: boolean;
  wkt: string;
}

export interface EdgeClassificationResult {
  edges: ClassifiedEdge[];
  totalEaveFt: number;
  totalRakeFt: number;
  gableEndCount: number;
  validationScore: number;
  warnings: string[];
}

export interface EdgeClassificationRules {
  ridgeParallelToleranceDegrees: number;
  ridgePerpendicularToleranceDegrees: number;
  minEdgeLengthFt: number;
}

const DEFAULT_RULES: EdgeClassificationRules = {
  ridgeParallelToleranceDegrees: 20,
  ridgePerpendicularToleranceDegrees: 20,
  minEdgeLengthFt: 3
};

/**
 * Determine if an edge is parallel to the ridge (within tolerance)
 * Eaves are parallel to the ridge
 */
export function isParallelToRidge(
  edgeAzimuth: number,
  ridgeAzimuth: number,
  toleranceDegrees: number = DEFAULT_RULES.ridgeParallelToleranceDegrees
): boolean {
  const normalizedEdge = normalizeRidgeAzimuth(edgeAzimuth);
  const normalizedRidge = normalizeRidgeAzimuth(ridgeAzimuth);

  let diff = Math.abs(normalizedEdge - normalizedRidge);
  if (diff > 90) {
    diff = 180 - diff;
  }

  return diff <= toleranceDegrees;
}

/**
 * Determine if an edge is perpendicular to the ridge (within tolerance)
 * Rakes are perpendicular to the ridge
 */
export function isPerpendicularToRidge(
  edgeAzimuth: number,
  ridgeAzimuth: number,
  toleranceDegrees: number = DEFAULT_RULES.ridgePerpendicularToleranceDegrees
): boolean {
  const normalizedEdge = normalizeRidgeAzimuth(edgeAzimuth);
  const normalizedRidge = normalizeRidgeAzimuth(ridgeAzimuth);

  // Perpendicular means 90° difference
  let diff = Math.abs(normalizedEdge - normalizedRidge);
  if (diff > 90) {
    diff = 180 - diff;
  }
  const perpendicularDiff = Math.abs(diff - 90);

  return perpendicularDiff <= toleranceDegrees;
}

/**
 * Detect gable ends in the roof structure
 * A gable end is a triangular portion at the end of a gable roof
 */
export function detectGableEnds(
  ridges: { startLat: number; startLng: number; endLat: number; endLng: number }[],
  hips: { startLat: number; startLng: number; endLat: number; endLng: number }[],
  perimeterVertices: { lat: number; lng: number }[],
  toleranceFt: number = 3.0
): { lat: number; lng: number; ridgeEndpoint: { lat: number; lng: number } }[] {
  const gableEnds: { lat: number; lng: number; ridgeEndpoint: { lat: number; lng: number } }[] = [];

  for (const ridge of ridges) {
    // Check each ridge endpoint
    const endpoints = [
      { lat: ridge.startLat, lng: ridge.startLng },
      { lat: ridge.endLat, lng: ridge.endLng }
    ];

    for (const endpoint of endpoints) {
      // If a ridge endpoint is NOT connected to any hip, it's likely a gable end
      let hasHipConnection = false;
      for (const hip of hips) {
        const distToHipStart = haversineDistanceFt(endpoint.lat, endpoint.lng, hip.startLat, hip.startLng);
        const distToHipEnd = haversineDistanceFt(endpoint.lat, endpoint.lng, hip.endLat, hip.endLng);

        if (distToHipStart <= toleranceFt || distToHipEnd <= toleranceFt) {
          hasHipConnection = true;
          break;
        }
      }

      if (!hasHipConnection) {
        // Find the nearest perimeter vertex - this is the gable end location
        let nearestVertex: { lat: number; lng: number } | null = null;
        let nearestDistance = Infinity;

        for (const vertex of perimeterVertices) {
          const dist = haversineDistanceFt(endpoint.lat, endpoint.lng, vertex.lat, vertex.lng);
          if (dist < nearestDistance) {
            nearestDistance = dist;
            nearestVertex = vertex;
          }
        }

        if (nearestVertex) {
          gableEnds.push({
            lat: nearestVertex.lat,
            lng: nearestVertex.lng,
            ridgeEndpoint: endpoint
          });
        }
      }
    }
  }

  return gableEnds;
}

/**
 * Extract perimeter edges from footprint WKT
 */
export function extractPerimeterEdges(
  perimeterWKT: string
): { startLat: number; startLng: number; endLat: number; endLng: number }[] {
  const vertices = extractVerticesFromWKT(perimeterWKT);
  const edges: { startLat: number; startLng: number; endLat: number; endLng: number }[] = [];

  for (let i = 0; i < vertices.length; i++) {
    const start = vertices[i];
    const end = vertices[(i + 1) % vertices.length];
    edges.push({
      startLat: start.lat,
      startLng: start.lng,
      endLat: end.lat,
      endLng: end.lng
    });
  }

  return edges;
}

/**
 * Classify perimeter edges as eaves or rakes
 */
export function classifyPerimeterEdges(
  perimeterWKT: string,
  ridgeAzimuth: number,
  gableEnds: { lat: number; lng: number }[],
  rules: Partial<EdgeClassificationRules> = {}
): EdgeClassificationResult {
  const cfg = { ...DEFAULT_RULES, ...rules };
  const edges: ClassifiedEdge[] = [];
  const warnings: string[] = [];

  const perimeterEdges = extractPerimeterEdges(perimeterWKT);

  for (const edge of perimeterEdges) {
    const lengthFt = haversineDistanceFt(edge.startLat, edge.startLng, edge.endLat, edge.endLng);
    const azimuth = calculateAzimuth(edge.startLat, edge.startLng, edge.endLat, edge.endLng);

    // Skip very short edges
    if (lengthFt < cfg.minEdgeLengthFt) {
      continue;
    }

    // Check if edge is at a gable end
    const isAtGable = gableEnds.some(gable => {
      const distToStart = haversineDistanceFt(gable.lat, gable.lng, edge.startLat, edge.startLng);
      const distToEnd = haversineDistanceFt(gable.lat, gable.lng, edge.endLat, edge.endLng);
      return distToStart <= 5 || distToEnd <= 5;
    });

    // Classify based on orientation relative to ridge
    let edgeType: 'eave' | 'rake' | 'unknown' = 'unknown';
    let confidence = 0.5;

    if (isParallelToRidge(azimuth, ridgeAzimuth, cfg.ridgeParallelToleranceDegrees)) {
      edgeType = 'eave';
      confidence = 0.90;
    } else if (isPerpendicularToRidge(azimuth, ridgeAzimuth, cfg.ridgePerpendicularToleranceDegrees)) {
      // Perpendicular edges are rakes only if they're at a gable end
      if (isAtGable) {
        edgeType = 'rake';
        confidence = 0.90;
      } else {
        // Perpendicular edge not at gable - could be a complex roof
        edgeType = 'eave'; // Default to eave for hip roofs
        confidence = 0.70;
      }
    } else {
      // Diagonal edge - likely part of a complex shape
      // Use proximity to gable ends to help classify
      if (isAtGable) {
        edgeType = 'rake';
        confidence = 0.65;
      } else {
        edgeType = 'eave';
        confidence = 0.60;
      }
      warnings.push(`Edge at ${edge.startLat.toFixed(6)},${edge.startLng.toFixed(6)} has ambiguous orientation`);
    }

    const wkt = `LINESTRING(${edge.startLng} ${edge.startLat}, ${edge.endLng} ${edge.endLat})`;

    edges.push({
      id: `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: edgeType,
      startLat: edge.startLat,
      startLng: edge.startLng,
      endLat: edge.endLat,
      endLng: edge.endLng,
      lengthFt,
      azimuthDegrees: azimuth,
      confidence,
      isAtGableEnd: isAtGable,
      wkt
    });
  }

  // Calculate totals
  const totalEaveFt = edges
    .filter(e => e.type === 'eave')
    .reduce((sum, e) => sum + e.lengthFt, 0);

  const totalRakeFt = edges
    .filter(e => e.type === 'rake')
    .reduce((sum, e) => sum + e.lengthFt, 0);

  const gableEndCount = gableEnds.length;

  // Validate: total perimeter should equal sum of eaves + rakes
  const totalPerimeter = edges.reduce((sum, e) => sum + e.lengthFt, 0);
  const classifiedTotal = totalEaveFt + totalRakeFt;
  const unknownEdges = edges.filter(e => e.type === 'unknown');

  if (unknownEdges.length > 0) {
    warnings.push(`${unknownEdges.length} edges could not be classified`);
  }

  // For gable roofs, expect some rakes
  if (gableEndCount > 0 && totalRakeFt === 0) {
    warnings.push('Gable ends detected but no rake edges classified');
  }

  // For pure hip roofs, expect no rakes (all eaves)
  if (gableEndCount === 0 && totalRakeFt > 0) {
    warnings.push('No gable ends detected but rake edges found - verify roof style');
  }

  // Calculate validation score
  let validationScore = 100;
  validationScore -= unknownEdges.length * 10;
  validationScore -= warnings.length * 5;
  validationScore = Math.max(0, validationScore);

  return {
    edges,
    totalEaveFt,
    totalRakeFt,
    gableEndCount,
    validationScore,
    warnings
  };
}

/**
 * Determine roof style from edge classification
 */
export function inferRoofStyle(
  totalEaveFt: number,
  totalRakeFt: number,
  gableEndCount: number,
  hipCount: number
): 'gable' | 'hip' | 'combination' | 'unknown' {
  if (gableEndCount >= 2 && hipCount === 0 && totalRakeFt > 0) {
    return 'gable';
  }

  if (hipCount >= 4 && gableEndCount === 0 && totalRakeFt === 0) {
    return 'hip';
  }

  if (gableEndCount > 0 && hipCount > 0) {
    return 'combination';
  }

  // Complex cases
  if (totalRakeFt > 0 && totalEaveFt > 0) {
    const rakeRatio = totalRakeFt / (totalEaveFt + totalRakeFt);
    if (rakeRatio > 0.3) {
      return 'gable';
    } else if (rakeRatio < 0.1) {
      return 'hip';
    }
    return 'combination';
  }

  return 'unknown';
}

/**
 * Generate comprehensive edge report
 */
export function generateEdgeReport(result: EdgeClassificationResult): string {
  const lines: string[] = [
    '=== PERIMETER EDGE CLASSIFICATION REPORT ===',
    '',
    `Total Eave Length: ${result.totalEaveFt.toFixed(1)} ft`,
    `Total Rake Length: ${result.totalRakeFt.toFixed(1)} ft`,
    `Gable Ends Detected: ${result.gableEndCount}`,
    `Validation Score: ${result.validationScore}%`,
    '',
    '--- Edge Details ---'
  ];

  for (const edge of result.edges) {
    lines.push(`${edge.type.toUpperCase()}: ${edge.lengthFt.toFixed(1)}ft @ ${edge.azimuthDegrees.toFixed(1)}° (conf: ${(edge.confidence * 100).toFixed(0)}%)${edge.isAtGableEnd ? ' [GABLE END]' : ''}`);
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('--- Warnings ---');
    result.warnings.forEach(w => lines.push(`⚠️ ${w}`));
  }

  return lines.join('\n');
}

/**
 * Generate AI prompt for eave/rake classification
 */
export function getEaveRakeClassificationPrompt(): string {
  return `
EAVE AND RAKE EDGE CLASSIFICATION INSTRUCTIONS:

=== EAVES ===
Eaves are the HORIZONTAL edges of the roof that overhang the walls.

IDENTIFICATION CHARACTERISTICS:
1. Eaves run PARALLEL to the ridge direction
2. Eaves are at the LOW edge of roof planes
3. Eaves typically have gutters attached
4. All four edges are eaves on a hip roof

=== RAKES ===
Rakes are the SLOPED edges at gable ends.

IDENTIFICATION CHARACTERISTICS:
1. Rakes run PERPENDICULAR to the ridge direction
2. Rakes are at the SIDE edges of gable roofs
3. Rakes follow the slope of the roof
4. Only present on gable roofs (not on hip roofs)

=== CLASSIFICATION RULES ===
1. For HIP ROOFS: All perimeter edges are EAVES (no rakes)
2. For GABLE ROOFS: Long sides are EAVES, short ends are RAKES
3. For COMBINATION: Check which edges are at gable ends vs hip corners

=== VALIDATION ===
- Total perimeter = sum of all eaves + all rakes
- Eave count typically = 2 (opposite sides of building)
- Rake count = 2 for simple gable, 0 for hip

OUTPUT FORMAT:
For each perimeter edge, provide:
- Type: 'eave' or 'rake'
- Start and end coordinates
- Length in feet
`;
}
