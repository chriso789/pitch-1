// Quality Assurance Validator for Roof Measurements
// Validates area consistency, perimeter matching, and segment connectivity

type XY = [number, number];

export interface QualityChecks {
  areaMatch: boolean;
  areaErrorPercent: number;
  perimeterMatch: boolean;
  perimeterErrorPercent: number;
  segmentConnectivity: boolean;
  facetsClosed: boolean;
  issues: string[];
  warnings: string[];
}

export interface ValidationResult {
  qualityChecks: QualityChecks;
  manualReviewRecommended: boolean;
  overallScore: number; // 0-1
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
  googleSolarTotalArea?: number; // Reference value from Google
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

  // 5. Check for requiresReview flags
  const reviewFlagsCount = data.facets.filter(f => f.requiresReview).length;
  if (reviewFlagsCount > 0) {
    warnings.push(`${reviewFlagsCount} facet(s) flagged for review`);
    score -= 0.05 * Math.min(reviewFlagsCount, 4);
  }

  // Determine if manual review is recommended
  const criticalIssues = issues.filter(i => 
    i.includes('exceeds') || 
    i.includes('not closed') || 
    i.includes('disconnected')
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
      issues,
      warnings
    },
    manualReviewRecommended,
    overallScore: Math.max(0, score),
    criticalIssues
  };
}

/**
 * Check if sum of facet areas matches total area
 * Tolerance: ±3%
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

  // Also check against Google Solar reference if available
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
 * Tolerance: ±1%
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
 * Check that all segments connect properly (no dangling ends)
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

  if (allEdges.length === 0) {
    // No internal edges to check - might be a simple roof
    return true;
  }

  // Collect all endpoints
  const endpoints: XY[] = [];
  for (const edge of allEdges) {
    endpoints.push(edge.start, edge.end);
  }

  // Check that each endpoint connects to at least one other edge or boundary
  const boundaryPoints = [
    ...edges.eaves.flatMap(e => [e.start, e.end]),
    ...edges.rakes.flatMap(e => [e.start, e.end])
  ];

  let disconnectedCount = 0;
  const tolerance = 0.00005; // ~5 meters

  for (const point of endpoints) {
    // Check if point connects to another endpoint or boundary
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

  if (unclosedCount > 0) {
    return false;
  }

  return true;
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
  
  return perimeter * 3.28084; // Convert to feet
}

function distance(a: XY, b: XY): number {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
}
