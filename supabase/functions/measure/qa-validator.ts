// Quality Assurance Validator for Roof Measurements
// ENHANCED: Includes topological validation for constrained geometry

type XY = [number, number];

export interface QualityChecks {
  areaMatch: boolean;
  areaErrorPercent: number;
  perimeterMatch: boolean;
  perimeterErrorPercent: number;
  segmentConnectivity: boolean;
  facetsClosed: boolean;
  topologyValid: boolean;
  issues: string[];
  warnings: string[];
}

export interface ValidationResult {
  qualityChecks: QualityChecks;
  manualReviewRecommended: boolean;
  overallScore: number;
  criticalIssues: string[];
}

interface MeasurementData {
  footprint: XY[];
  facets: Array<{
    id: string;
    polygon: XY[];
    area: number;
    planArea: number;
    requiresReview?: boolean;
  }>;
  edges: {
    ridges: Array<{ start: XY; end: XY }>;
    hips: Array<{ start: XY; end: XY }>;
    valleys: Array<{ start: XY; end: XY }>;
    eaves: Array<{ start: XY; end: XY }>;
    rakes: Array<{ start: XY; end: XY }>;
  };
  totals: {
    'roof.total_sqft': number;
    'roof.plan_sqft': number;
    'lf.ridge': number;
    'lf.hip': number;
    'lf.valley': number;
    'lf.eave': number;
    'lf.rake': number;
  };
  googleSolarTotalArea?: number;
}

/**
 * Validate measurement data for quality and consistency
 */
export function validateMeasurements(data: MeasurementData): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  // 1. Area Consistency Check
  const { areaMatch, areaErrorPercent } = checkAreaConsistency(data, issues, warnings);
  if (!areaMatch) score -= 0.2;

  // 2. Perimeter Consistency Check
  const { perimeterMatch, perimeterErrorPercent } = checkPerimeterConsistency(data, issues, warnings);
  if (!perimeterMatch) score -= 0.15;

  // 3. Segment Connectivity Check
  const segmentConnectivity = checkSegmentConnectivity(data.edges, issues, warnings);
  if (!segmentConnectivity) score -= 0.15;

  // 4. Facet Closure Check
  const facetsClosed = checkFacetsClosed(data.facets, issues, warnings);
  if (!facetsClosed) score -= 0.1;

  // 5. NEW: Topological Validation
  const topologyValid = checkTopologicalConstraints(data, issues, warnings);
  if (!topologyValid) score -= 0.25;

  // 6. Check for requiresReview flags
  const reviewFlagsCount = data.facets.filter(f => f.requiresReview).length;
  if (reviewFlagsCount > 0) {
    warnings.push(`${reviewFlagsCount} facet(s) flagged for review`);
    score -= 0.05 * Math.min(reviewFlagsCount, 4);
  }

  const criticalIssues = issues.filter(i => 
    i.includes('exceeds') || 
    i.includes('not closed') || 
    i.includes('disconnected') ||
    i.includes('outside footprint') ||
    i.includes('crossing')
  );
  
  const manualReviewRecommended = 
    criticalIssues.length > 0 || 
    score < 0.7 ||
    reviewFlagsCount > 2;

  return {
    qualityChecks: {
      areaMatch,
      areaErrorPercent,
      perimeterMatch,
      perimeterErrorPercent,
      segmentConnectivity,
      facetsClosed,
      topologyValid,
      issues,
      warnings
    },
    manualReviewRecommended,
    overallScore: Math.max(0, score),
    criticalIssues
  };
}

/**
 * NEW: Check topological constraints for valid roof geometry
 */
function checkTopologicalConstraints(
  data: MeasurementData,
  issues: string[],
  warnings: string[]
): boolean {
  let valid = true;

  // 1. All internal edges must be inside footprint
  const allInternalEdges = [
    ...data.edges.ridges,
    ...data.edges.hips,
    ...data.edges.valleys
  ];

  let outsideCount = 0;
  for (const edge of allInternalEdges) {
    if (!isPointInsideOrNearPolygon(edge.start, data.footprint) ||
        !isPointInsideOrNearPolygon(edge.end, data.footprint)) {
      outsideCount++;
    }
  }

  if (outsideCount > 0) {
    issues.push(`${outsideCount} edge endpoint(s) outside footprint boundary`);
    valid = false;
  }

  // 2. Check for hip crossing (geometrically impossible)
  const hipCrossings = checkForEdgeCrossings(data.edges.hips);
  if (hipCrossings > 0) {
    issues.push(`${hipCrossings} hip crossing(s) detected (geometrically impossible)`);
    valid = false;
  }

  // 3. Ridge length sanity check - should be < building longest dimension
  const footprintBounds = getBoundsFromCoords(data.footprint);
  const maxDimension = Math.max(
    footprintBounds.maxX - footprintBounds.minX,
    footprintBounds.maxY - footprintBounds.minY
  ) * 111320 * 3.28084; // Convert to feet approximately

  const ridgeTotal = data.totals['lf.ridge'];
  if (ridgeTotal > maxDimension * 1.5) {
    warnings.push(`Ridge length (${Math.round(ridgeTotal)}ft) exceeds 150% of building dimension`);
  }
  if (ridgeTotal > maxDimension * 2) {
    issues.push(`Ridge length (${Math.round(ridgeTotal)}ft) exceeds 200% of building dimension - likely error`);
    valid = false;
  }

  // 4. Hip total sanity check - should be reasonable relative to building size
  const hipTotal = data.totals['lf.hip'];
  const expectedHipMax = maxDimension * 4; // 4 hips roughly = 4x the diagonal
  if (hipTotal > expectedHipMax) {
    warnings.push(`Hip length (${Math.round(hipTotal)}ft) seems high for building size`);
  }

  // 5. Eave + rake should approximately equal perimeter
  const perimeterFt = calculatePerimeter(data.footprint);
  const eaveRakeTotal = data.totals['lf.eave'] + data.totals['lf.rake'];
  const perimeterDiff = Math.abs(eaveRakeTotal - perimeterFt) / perimeterFt * 100;
  
  if (perimeterDiff > 20) {
    warnings.push(`Eave+rake (${Math.round(eaveRakeTotal)}ft) differs from perimeter (${Math.round(perimeterFt)}ft) by ${perimeterDiff.toFixed(0)}%`);
  }

  return valid;
}

/**
 * Check if a point is inside or very close to polygon
 */
function isPointInsideOrNearPolygon(point: XY, polygon: XY[], tolerance: number = 0.00005): boolean {
  // First check if inside
  if (pointInPolygon(point, polygon)) return true;
  
  // Then check if very close to any edge
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    
    if (distanceToLineSegment(point, p1, p2) < tolerance) {
      return true;
    }
  }
  
  return false;
}

/**
 * Point in polygon test
 */
function pointInPolygon(point: XY, polygon: XY[]): boolean {
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
  
  return inside;
}

/**
 * Distance from point to line segment
 */
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

/**
 * Check for edge crossings (returns count)
 */
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
 * Check if two edges intersect (not at endpoints)
 */
function edgesIntersect(a1: XY, a2: XY, b1: XY, b2: XY): boolean {
  const d1x = a2[0] - a1[0];
  const d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0];
  const d2y = b2[1] - b1[1];
  
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-12) return false;
  
  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / cross;
  const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / cross;
  
  // Intersection exists if both t and u are strictly between 0 and 1
  // (not at endpoints)
  const epsilon = 0.001;
  return t > epsilon && t < (1 - epsilon) && u > epsilon && u < (1 - epsilon);
}

/**
 * Get bounding box from coordinates
 */
function getBoundsFromCoords(coords: XY[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = coords.map(c => c[0]);
  const ys = coords.map(c => c[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

/**
 * Check if sum of facet areas matches total area
 */
function checkAreaConsistency(
  data: MeasurementData,
  issues: string[],
  warnings: string[]
): { areaMatch: boolean; areaErrorPercent: number } {
  const facetSum = data.facets.reduce((sum, f) => sum + f.area, 0);
  const reportedTotal = data.totals['roof.total_sqft'];
  
  if (reportedTotal === 0) {
    issues.push('Total roof area is zero');
    return { areaMatch: false, areaErrorPercent: 100 };
  }

  const errorPercent = Math.abs((facetSum - reportedTotal) / reportedTotal) * 100;
  
  if (errorPercent > 3) {
    issues.push(`Facet area sum (${Math.round(facetSum)}) differs from total (${Math.round(reportedTotal)}) by ${errorPercent.toFixed(1)}%`);
    return { areaMatch: false, areaErrorPercent: errorPercent };
  }
  
  if (errorPercent > 1) {
    warnings.push(`Minor area discrepancy: ${errorPercent.toFixed(1)}%`);
  }

  if (data.googleSolarTotalArea) {
    const googleError = Math.abs((reportedTotal - data.googleSolarTotalArea) / data.googleSolarTotalArea) * 100;
    if (googleError > 5) {
      warnings.push(`Differs from Google Solar by ${googleError.toFixed(1)}%`);
    }
  }

  return { areaMatch: true, areaErrorPercent: errorPercent };
}

/**
 * Check if eave + rake lengths match footprint perimeter
 */
function checkPerimeterConsistency(
  data: MeasurementData,
  issues: string[],
  warnings: string[]
): { perimeterMatch: boolean; perimeterErrorPercent: number } {
  const edgePerimeter = data.totals['lf.eave'] + data.totals['lf.rake'];
  const footprintPerimeter = calculatePerimeter(data.footprint);
  
  if (footprintPerimeter === 0) {
    issues.push('Footprint perimeter is zero');
    return { perimeterMatch: false, perimeterErrorPercent: 100 };
  }

  const errorPercent = Math.abs((edgePerimeter - footprintPerimeter) / footprintPerimeter) * 100;
  
  if (errorPercent > 5) {
    issues.push(`Perimeter mismatch: edges (${Math.round(edgePerimeter)} ft) vs footprint (${Math.round(footprintPerimeter)} ft) = ${errorPercent.toFixed(1)}%`);
    return { perimeterMatch: false, perimeterErrorPercent: errorPercent };
  }
  
  if (errorPercent > 1) {
    warnings.push(`Minor perimeter discrepancy: ${errorPercent.toFixed(1)}%`);
  }

  return { perimeterMatch: true, perimeterErrorPercent: errorPercent };
}

/**
 * Check that all segments connect properly
 */
function checkSegmentConnectivity(
  edges: MeasurementData['edges'],
  issues: string[],
  warnings: string[]
): boolean {
  const allEdges = [
    ...edges.ridges,
    ...edges.hips,
    ...edges.valleys
  ];

  if (allEdges.length === 0) return true;

  const endpoints: XY[] = [];
  for (const edge of allEdges) {
    endpoints.push(edge.start, edge.end);
  }

  const boundaryPoints = [
    ...edges.eaves.flatMap(e => [e.start, e.end]),
    ...edges.rakes.flatMap(e => [e.start, e.end])
  ];

  let disconnectedCount = 0;
  const tolerance = 0.00005;

  for (const point of endpoints) {
    const connectedToOther = endpoints.some(other => 
      other !== point && distance(point, other) < tolerance
    );
    const connectedToBoundary = boundaryPoints.some(bp => 
      distance(point, bp) < tolerance
    );

    if (!connectedToOther && !connectedToBoundary) {
      disconnectedCount++;
    }
  }

  if (disconnectedCount > 2) {
    issues.push(`${disconnectedCount} disconnected segment endpoints detected`);
    return false;
  }

  if (disconnectedCount > 0) {
    warnings.push(`${disconnectedCount} potentially disconnected endpoint(s)`);
  }

  return true;
}

/**
 * Check that all facet polygons are properly closed
 */
function checkFacetsClosed(
  facets: MeasurementData['facets'],
  issues: string[],
  warnings: string[]
): boolean {
  let unclosedCount = 0;

  for (const facet of facets) {
    if (facet.polygon.length < 3) {
      issues.push(`Facet ${facet.id} has fewer than 3 vertices`);
      unclosedCount++;
      continue;
    }

    const first = facet.polygon[0];
    const last = facet.polygon[facet.polygon.length - 1];
    
    if (distance(first, last) > 0.00001) {
      warnings.push(`Facet ${facet.id} polygon is not closed`);
      unclosedCount++;
    }
  }

  return unclosedCount === 0;
}

// ===== Utility Functions =====

function calculatePerimeter(coords: XY[]): number {
  if (coords.length < 2) return 0;
  
  const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  
  let perimeter = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const dx = (coords[j][0] - coords[i][0]) * metersPerDegLng;
    const dy = (coords[j][1] - coords[i][1]) * metersPerDegLat;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  
  return perimeter * 3.28084;
}

function distance(a: XY, b: XY): number {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
}
