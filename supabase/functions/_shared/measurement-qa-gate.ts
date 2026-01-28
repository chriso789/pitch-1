// Unified Measurement QA Gate
// Consolidates all quality checks before persistence
// Validates area, perimeter, topology, and Solar data consistency

import { PLANIMETER_THRESHOLDS } from './roof-analysis-helpers.ts';
import type { RoofTopology, XY } from './roof-topology-builder.ts';
import type { AreaCalculationResult } from './facet-area-calculator.ts';

export interface QAGateResult {
  passed: boolean;
  overallScore: number; // 0-1
  checks: {
    areaWithinTolerance: boolean;
    perimeterWithinTolerance: boolean;
    noFloatingEndpoints: boolean;
    noCrossingHips: boolean;
    ridgeLengthReasonable: boolean;
    facetsClosed: boolean;
  };
  warnings: string[];
  errors: string[];
  requiresManualReview: boolean;
}

export interface SolarAPIData {
  available?: boolean;
  buildingFootprintSqft?: number;
  estimatedPerimeterFt?: number;
  roofSegments?: any[];
}

// Calculate distance between two points
function distance(p1: XY, p2: XY): number {
  return Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2);
}

// Calculate perimeter in feet
function calculatePerimeterFt(coords: XY[]): number {
  let perimeter = 0;
  for (let i = 0; i < coords.length; i++) {
    const start = coords[i];
    const end = coords[(i + 1) % coords.length];
    const midLat = (start[1] + end[1]) / 2;
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
    const dx = (end[0] - start[0]) * metersPerDegLng;
    const dy = (end[1] - start[1]) * metersPerDegLat;
    perimeter += Math.sqrt(dx * dx + dy * dy) * 3.28084;
  }
  return perimeter;
}

// Get bounding box dimensions in feet
function getBoundingBoxDimensions(coords: XY[]): { widthFt: number; heightFt: number; maxDimensionFt: number } {
  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  
  const midLat = (minLat + maxLat) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  
  const widthFt = (maxLng - minLng) * metersPerDegLng * 3.28084;
  const heightFt = (maxLat - minLat) * metersPerDegLat * 3.28084;
  
  return {
    widthFt,
    heightFt,
    maxDimensionFt: Math.max(widthFt, heightFt)
  };
}

// Check if point is inside or near polygon
function isPointInsideOrNearPolygon(point: XY, polygon: XY[], toleranceDeg: number = 0.00005): boolean {
  // Point in polygon test
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    
    if (((yi > point[1]) !== (yj > point[1])) &&
        (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  if (inside) return true;
  
  // Check if near any edge
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    
    const dist = distanceToLineSegment(point, p1, p2);
    if (dist < toleranceDeg) return true;
  }
  
  return false;
}

// Distance from point to line segment
function distanceToLineSegment(point: XY, p1: XY, p2: XY): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const lenSq = dx * dx + dy * dy;
  
  if (lenSq === 0) return distance(point, p1);
  
  let t = ((point[0] - p1[0]) * dx + (point[1] - p1[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  
  const closest: XY = [p1[0] + t * dx, p1[1] + t * dy];
  return distance(point, closest);
}

// Check if two line segments intersect (not at endpoints)
function edgesIntersect(a1: XY, a2: XY, b1: XY, b2: XY): boolean {
  const d1x = a2[0] - a1[0];
  const d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0];
  const d2y = b2[1] - b1[1];
  
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-12) return false;
  
  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / cross;
  const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / cross;
  
  const epsilon = 0.001;
  return t > epsilon && t < (1 - epsilon) && u > epsilon && u < (1 - epsilon);
}

// Find floating endpoints (not connected to perimeter or other lines)
function findFloatingEndpoints(
  skeleton: Array<{ start: XY; end: XY; type: string }>,
  footprint: XY[]
): XY[] {
  const floating: XY[] = [];
  const tolerance = 0.00008; // ~3 feet in degrees
  
  // Collect all valid connection targets
  const allEndpoints = skeleton.flatMap(e => [e.start, e.end]);
  const allTargets = [...footprint, ...allEndpoints];
  
  for (const edge of skeleton) {
    for (const endpoint of [edge.start, edge.end]) {
      // Check if this endpoint connects to anything else
      const connectedToOther = allTargets.some(target => 
        target !== endpoint && distance(endpoint, target) < tolerance
      );
      
      if (!connectedToOther) {
        // Check if near polygon edge (not just vertex)
        const nearEdge = isPointInsideOrNearPolygon(endpoint, footprint, tolerance);
        if (!nearEdge) {
          floating.push(endpoint);
        }
      }
    }
  }
  
  return floating;
}

// Count edge crossings (geometrically impossible for hips)
function checkForEdgeCrossings(edges: Array<{ start: XY; end: XY }>): number {
  let crossings = 0;
  
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (edgesIntersect(edges[i].start, edges[i].end, edges[j].start, edges[j].end)) {
        crossings++;
      }
    }
  }
  
  return crossings;
}

/**
 * Run QA gate on measurement results
 * Returns pass/fail status with detailed checks
 */
export function runQAGate(
  topology: RoofTopology,
  areaResult: AreaCalculationResult,
  solarData?: SolarAPIData
): QAGateResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let score = 1.0;
  
  // Check 1: Area within tolerance of Solar (±3% per spec)
  let areaWithinTolerance = true;
  if (solarData?.buildingFootprintSqft && solarData.buildingFootprintSqft > 0) {
    const diff = Math.abs(areaResult.totals.planAreaSqft - solarData.buildingFootprintSqft);
    const pct = diff / solarData.buildingFootprintSqft;
    
    if (pct > PLANIMETER_THRESHOLDS.AREA_TOLERANCE) {
      areaWithinTolerance = false;
      errors.push(`Area differs from Solar by ${(pct * 100).toFixed(1)}% (tolerance: ±${(PLANIMETER_THRESHOLDS.AREA_TOLERANCE * 100).toFixed(0)}%)`);
      score -= 0.2;
    } else if (pct > 0.02) {
      warnings.push(`Area close to tolerance: ${(pct * 100).toFixed(1)}% difference from Solar`);
    }
  }
  
  // Check 2: Perimeter match (eave + rake = footprint perimeter ±1%)
  let perimeterWithinTolerance = true;
  const footprintPerimeter = calculatePerimeterFt(topology.footprintCoords);
  const classifiedPerimeter = areaResult.linearTotals.eaveFt + areaResult.linearTotals.rakeFt;
  const perimeterDiff = footprintPerimeter > 0 
    ? Math.abs(classifiedPerimeter - footprintPerimeter) / footprintPerimeter 
    : 0;
  
  if (perimeterDiff > 0.01) {
    perimeterWithinTolerance = false;
    warnings.push(`Perimeter mismatch: ${(perimeterDiff * 100).toFixed(1)}% (eave+rake: ${Math.round(classifiedPerimeter)}ft, footprint: ${Math.round(footprintPerimeter)}ft)`);
    score -= 0.1;
  }
  
  // Check 3: No floating endpoints
  const floatingEndpoints = findFloatingEndpoints(topology.skeleton, topology.footprintCoords);
  const noFloatingEndpoints = floatingEndpoints.length === 0;
  
  if (!noFloatingEndpoints) {
    errors.push(`${floatingEndpoints.length} floating endpoint(s) - lines not properly connected`);
    score -= 0.15;
  }
  
  // Check 4: No crossing hips
  const hipEdges = topology.skeleton.filter(e => e.type === 'hip');
  const hipCrossings = checkForEdgeCrossings(hipEdges);
  const noCrossingHips = hipCrossings === 0;
  
  if (!noCrossingHips) {
    errors.push(`${hipCrossings} hip crossing(s) - geometrically impossible`);
    score -= 0.25;
  }
  
  // Check 5: Ridge length sanity
  const { maxDimensionFt } = getBoundingBoxDimensions(topology.footprintCoords);
  let ridgeLengthReasonable = true;
  
  if (areaResult.linearTotals.ridgeFt > maxDimensionFt * 2) {
    ridgeLengthReasonable = false;
    errors.push(`Ridge length (${Math.round(areaResult.linearTotals.ridgeFt)}ft) exceeds 200% of building dimension`);
    score -= 0.2;
  } else if (areaResult.linearTotals.ridgeFt > maxDimensionFt * 1.5) {
    warnings.push(`Ridge length (${Math.round(areaResult.linearTotals.ridgeFt)}ft) exceeds 150% of building dimension`);
  }
  
  // Check 6: Facets are closed polygons (assumed true if they were successfully created)
  const facetsClosed = areaResult.facets.every(f => f.polygon.length >= 3);
  if (!facetsClosed && areaResult.facets.length > 0) {
    errors.push('Some facets have invalid geometry');
    score -= 0.1;
  }
  
  // Add review reasons from area calculation
  if (areaResult.requiresManualReview) {
    warnings.push(...areaResult.reviewReasons);
  }
  
  // Add topology warnings
  if (topology.warnings.length > 0) {
    warnings.push(...topology.warnings);
  }
  
  // Determine if manual review is required
  const requiresManualReview = 
    errors.length > 0 || 
    score < 0.7 ||
    areaResult.requiresManualReview ||
    topology.isComplexShape;
  
  return {
    passed: errors.length === 0,
    overallScore: Math.max(0, score),
    checks: {
      areaWithinTolerance,
      perimeterWithinTolerance,
      noFloatingEndpoints,
      noCrossingHips,
      ridgeLengthReasonable,
      facetsClosed
    },
    warnings,
    errors,
    requiresManualReview
  };
}
