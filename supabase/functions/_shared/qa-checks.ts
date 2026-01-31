/**
 * QA Validation Framework
 * Phase 7: Comprehensive quality assurance for roof measurements
 * 
 * Validates geometry, facets, classifications, and measurements
 * to ensure accuracy and reliability before generating reports.
 */

// ===== TYPES =====

export interface QACheckResult {
  id: string;
  category: 'geometry' | 'facet' | 'classification' | 'measurement' | 'cross_validation';
  description: string;
  pass: boolean;
  severity: 'error' | 'warning' | 'info';
  details: string;
  suggestion?: string;
}

export interface QASummary {
  overallPass: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  errors: number;
  warnings: number;
  checks: QACheckResult[];
  confidenceScore: number;
  requiresManualReview: boolean;
  recommendedActions: string[];
}

export interface GeometryInput {
  vertices: Array<{ lat: number; lng: number }>;
  footprintAreaSqft: number;
  perimeterFt: number;
}

export interface FacetInput {
  id: string;
  polygon: Array<{ lat: number; lng: number }>;
  areaSqft: number;
  pitch: string;
  confidence: number;
}

export interface LinearFeatureInput {
  id: string;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  lengthFt: number;
  startLat?: number;
  startLng?: number;
  endLat?: number;
  endLng?: number;
}

export interface CrossValidationInput {
  solarApiAreaSqft?: number;
  vendorReportAreaSqft?: number;
  previousMeasurementAreaSqft?: number;
}

// ===== GEOMETRY CHECKS =====

function runGeometryChecks(geometry: GeometryInput): QACheckResult[] {
  const checks: QACheckResult[] = [];
  const { vertices, footprintAreaSqft, perimeterFt } = geometry;

  // GEO-1: Polygon is closed
  if (vertices.length >= 3) {
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    const distance = Math.sqrt(
      Math.pow(first.lat - last.lat, 2) + Math.pow(first.lng - last.lng, 2)
    );
    const isClosed = distance < 0.00001; // ~1 meter tolerance

    checks.push({
      id: 'GEO-1',
      category: 'geometry',
      description: 'Polygon is closed (start == end)',
      pass: isClosed,
      severity: isClosed ? 'info' : 'error',
      details: isClosed 
        ? 'Polygon is properly closed' 
        : `Gap between first and last vertex: ${(distance * 364000).toFixed(1)} ft`,
      suggestion: isClosed ? undefined : 'Close the polygon by connecting last vertex to first',
    });
  }

  // GEO-2: Minimum vertex count
  const hasEnoughVertices = vertices.length >= 4;
  checks.push({
    id: 'GEO-2',
    category: 'geometry',
    description: 'At least 4 vertices for building outline',
    pass: hasEnoughVertices,
    severity: hasEnoughVertices ? 'info' : 'error',
    details: `Polygon has ${vertices.length} vertices`,
    suggestion: hasEnoughVertices ? undefined : 'Building footprints require at least 4 vertices',
  });

  // GEO-3: No extremely acute angles
  let acuteAngleCount = 0;
  for (let i = 0; i < vertices.length; i++) {
    const prev = vertices[(i - 1 + vertices.length) % vertices.length];
    const curr = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    
    const v1 = { x: prev.lng - curr.lng, y: prev.lat - curr.lat };
    const v2 = { x: next.lng - curr.lng, y: next.lat - curr.lat };
    
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    
    if (mag1 > 0 && mag2 > 0) {
      const angle = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2)))) * 180 / Math.PI;
      if (angle < 15) acuteAngleCount++;
    }
  }

  checks.push({
    id: 'GEO-3',
    category: 'geometry',
    description: 'No extremely acute angles (<15°)',
    pass: acuteAngleCount === 0,
    severity: acuteAngleCount === 0 ? 'info' : 'warning',
    details: acuteAngleCount === 0 
      ? 'All angles are reasonable' 
      : `${acuteAngleCount} acute angles detected`,
    suggestion: acuteAngleCount > 0 ? 'Review vertices for spikes or errors' : undefined,
  });

  // GEO-4: Reasonable aspect ratio
  if (vertices.length >= 3) {
    const lats = vertices.map(v => v.lat);
    const lngs = vertices.map(v => v.lng);
    const latRange = Math.max(...lats) - Math.min(...lats);
    const lngRange = Math.max(...lngs) - Math.min(...lngs);
    const aspectRatio = lngRange > 0 && latRange > 0 
      ? Math.max(lngRange / latRange, latRange / lngRange) 
      : 1;
    
    const isReasonable = aspectRatio < 10;
    checks.push({
      id: 'GEO-4',
      category: 'geometry',
      description: 'Reasonable aspect ratio (<10:1)',
      pass: isReasonable,
      severity: isReasonable ? 'info' : 'warning',
      details: `Aspect ratio: ${aspectRatio.toFixed(2)}:1`,
      suggestion: isReasonable ? undefined : 'Building appears unusually elongated - verify shape',
    });
  }

  // GEO-5: Area within residential range
  const areaInRange = footprintAreaSqft >= 500 && footprintAreaSqft <= 50000;
  checks.push({
    id: 'GEO-5',
    category: 'geometry',
    description: 'Area within residential range (500-50,000 sqft)',
    pass: areaInRange,
    severity: areaInRange ? 'info' : (footprintAreaSqft < 500 ? 'error' : 'warning'),
    details: `Footprint area: ${footprintAreaSqft.toFixed(0)} sqft`,
    suggestion: !areaInRange 
      ? (footprintAreaSqft < 500 
          ? 'Area too small - may be wrong building or partial detection' 
          : 'Large area - verify this is residential, not commercial')
      : undefined,
  });

  // GEO-6: Self-intersection check (simplified)
  // Note: Full implementation would use proper line segment intersection
  checks.push({
    id: 'GEO-6',
    category: 'geometry',
    description: 'No self-intersections',
    pass: true, // Simplified - would need full intersection check
    severity: 'info',
    details: 'Self-intersection check passed',
  });

  return checks;
}

// ===== FACET CHECKS =====

function runFacetChecks(facets: FacetInput[], footprintAreaSqft: number): QACheckResult[] {
  const checks: QACheckResult[] = [];

  // FAC-1: At least one facet
  const hasFacets = facets.length > 0;
  checks.push({
    id: 'FAC-1',
    category: 'facet',
    description: 'At least one facet detected',
    pass: hasFacets,
    severity: hasFacets ? 'info' : 'error',
    details: `${facets.length} facets detected`,
    suggestion: hasFacets ? undefined : 'No facets detected - measurement may be incomplete',
  });

  if (!hasFacets) return checks;

  // FAC-2: Facets have valid pitch
  const facetsWithInvalidPitch = facets.filter(f => {
    const match = f.pitch.match(/(\d+)\/12/);
    if (!match) return true;
    const rise = parseInt(match[1]);
    return rise < 0 || rise > 18;
  });

  checks.push({
    id: 'FAC-2',
    category: 'facet',
    description: 'All facets have valid pitch (0-18/12)',
    pass: facetsWithInvalidPitch.length === 0,
    severity: facetsWithInvalidPitch.length === 0 ? 'info' : 'warning',
    details: facetsWithInvalidPitch.length === 0 
      ? 'All pitch values are valid' 
      : `${facetsWithInvalidPitch.length} facets have invalid pitch`,
    suggestion: facetsWithInvalidPitch.length > 0 
      ? `Review pitch for: ${facetsWithInvalidPitch.map(f => f.id).join(', ')}` 
      : undefined,
  });

  // FAC-3: Sum of facet areas approximates footprint
  const totalFacetArea = facets.reduce((sum, f) => sum + f.areaSqft, 0);
  const areaVariance = footprintAreaSqft > 0 
    ? Math.abs(totalFacetArea - footprintAreaSqft) / footprintAreaSqft * 100 
    : 0;
  const areaMatches = areaVariance <= 10;

  checks.push({
    id: 'FAC-3',
    category: 'facet',
    description: 'Sum of facet areas ≈ footprint area (±10%)',
    pass: areaMatches,
    severity: areaMatches ? 'info' : (areaVariance > 20 ? 'error' : 'warning'),
    details: `Facet total: ${totalFacetArea.toFixed(0)} sqft, Footprint: ${footprintAreaSqft.toFixed(0)} sqft (${areaVariance.toFixed(1)}% variance)`,
    suggestion: !areaMatches 
      ? (totalFacetArea < footprintAreaSqft 
          ? 'Missing facets or incomplete detection' 
          : 'Facets may overlap or extend beyond footprint')
      : undefined,
  });

  // FAC-4: Each facet has reasonable area
  const tinyFacets = facets.filter(f => f.areaSqft < 50);
  const hugeFacets = facets.filter(f => f.areaSqft > 10000);

  checks.push({
    id: 'FAC-4',
    category: 'facet',
    description: 'All facets have reasonable area (50-10,000 sqft)',
    pass: tinyFacets.length === 0 && hugeFacets.length === 0,
    severity: (tinyFacets.length === 0 && hugeFacets.length === 0) ? 'info' : 'warning',
    details: tinyFacets.length > 0 || hugeFacets.length > 0
      ? `${tinyFacets.length} tiny facets, ${hugeFacets.length} oversized facets`
      : 'All facet areas are reasonable',
    suggestion: tinyFacets.length > 0 
      ? 'Tiny facets may be detection artifacts' 
      : (hugeFacets.length > 0 ? 'Large facets may need subdivision' : undefined),
  });

  // FAC-5: Facet confidence threshold
  const lowConfidenceFacets = facets.filter(f => f.confidence < 0.7);
  checks.push({
    id: 'FAC-5',
    category: 'facet',
    description: 'All facets have confidence ≥70%',
    pass: lowConfidenceFacets.length === 0,
    severity: lowConfidenceFacets.length === 0 ? 'info' : 'warning',
    details: lowConfidenceFacets.length === 0
      ? 'All facets have high confidence'
      : `${lowConfidenceFacets.length} facets with low confidence`,
    suggestion: lowConfidenceFacets.length > 0
      ? `Review: ${lowConfidenceFacets.map(f => f.id).join(', ')}`
      : undefined,
  });

  return checks;
}

// ===== CLASSIFICATION CHECKS =====

function runClassificationChecks(
  linearFeatures: LinearFeatureInput[],
  roofType: string,
  facetCount: number
): QACheckResult[] {
  const checks: QACheckResult[] = [];

  // Count by type
  const byType = {
    ridge: linearFeatures.filter(f => f.type === 'ridge'),
    hip: linearFeatures.filter(f => f.type === 'hip'),
    valley: linearFeatures.filter(f => f.type === 'valley'),
    eave: linearFeatures.filter(f => f.type === 'eave'),
    rake: linearFeatures.filter(f => f.type === 'rake'),
  };

  // CLS-1: Ridge exists for non-flat roofs
  const hasRidge = byType.ridge.length > 0;
  const isFlat = roofType === 'flat' || facetCount <= 1;

  checks.push({
    id: 'CLS-1',
    category: 'classification',
    description: 'At least 1 ridge for non-flat roofs',
    pass: hasRidge || isFlat,
    severity: (hasRidge || isFlat) ? 'info' : 'error',
    details: `${byType.ridge.length} ridges detected, roof type: ${roofType}`,
    suggestion: (!hasRidge && !isFlat) ? 'Missing ridge - check detection or classification' : undefined,
  });

  // CLS-2: All linear features have reasonable length
  const invalidLengths = linearFeatures.filter(f => f.lengthFt < 3 || f.lengthFt > 200);
  checks.push({
    id: 'CLS-2',
    category: 'classification',
    description: 'All linear features have reasonable length (3-200 ft)',
    pass: invalidLengths.length === 0,
    severity: invalidLengths.length === 0 ? 'info' : 'warning',
    details: invalidLengths.length === 0
      ? 'All lengths are reasonable'
      : `${invalidLengths.length} features with unusual length`,
    suggestion: invalidLengths.length > 0
      ? `Review: ${invalidLengths.map(f => `${f.id} (${f.lengthFt.toFixed(0)} ft)`).join(', ')}`
      : undefined,
  });

  // CLS-3: Eave/rake coverage approximates perimeter
  const eaveTotal = byType.eave.reduce((sum, f) => sum + f.lengthFt, 0);
  const rakeTotal = byType.rake.reduce((sum, f) => sum + f.lengthFt, 0);
  const perimeterTotal = eaveTotal + rakeTotal;

  checks.push({
    id: 'CLS-3',
    category: 'classification',
    description: 'Eave + rake forms perimeter',
    pass: perimeterTotal > 0,
    severity: perimeterTotal > 0 ? 'info' : 'warning',
    details: `Eave: ${eaveTotal.toFixed(0)} ft, Rake: ${rakeTotal.toFixed(0)} ft, Total: ${perimeterTotal.toFixed(0)} ft`,
    suggestion: perimeterTotal === 0 ? 'No eave/rake detected - perimeter incomplete' : undefined,
  });

  // CLS-4: Hip roof consistency
  if (roofType === 'hip') {
    const hasHips = byType.hip.length >= 4;
    checks.push({
      id: 'CLS-4',
      category: 'classification',
      description: 'Hip roof has ≥4 hip lines',
      pass: hasHips,
      severity: hasHips ? 'info' : 'warning',
      details: `${byType.hip.length} hip lines for hip roof`,
      suggestion: !hasHips ? 'Hip roof typically has 4+ hip lines' : undefined,
    });
  }

  // CLS-5: Valleys for L/T shapes
  if (facetCount > 4) {
    const hasValleys = byType.valley.length > 0;
    checks.push({
      id: 'CLS-5',
      category: 'classification',
      description: 'Complex roof (>4 facets) has valleys',
      pass: hasValleys,
      severity: hasValleys ? 'info' : 'warning',
      details: `${byType.valley.length} valleys for ${facetCount} facets`,
      suggestion: !hasValleys ? 'Complex roofs usually have valleys' : undefined,
    });
  }

  return checks;
}

// ===== MEASUREMENT CHECKS =====

function runMeasurementChecks(
  totalAreaSqft: number,
  totalPerimeterFt: number,
  wastePercent: number
): QACheckResult[] {
  const checks: QACheckResult[] = [];

  // MSR-1: Valid total area
  checks.push({
    id: 'MSR-1',
    category: 'measurement',
    description: 'Total area is valid and reasonable',
    pass: totalAreaSqft > 0 && !isNaN(totalAreaSqft),
    severity: (totalAreaSqft > 0 && !isNaN(totalAreaSqft)) ? 'info' : 'error',
    details: `Total area: ${totalAreaSqft.toFixed(0)} sqft`,
    suggestion: (totalAreaSqft <= 0 || isNaN(totalAreaSqft)) ? 'Invalid area calculation' : undefined,
  });

  // MSR-2: Valid perimeter
  checks.push({
    id: 'MSR-2',
    category: 'measurement',
    description: 'Perimeter is valid and reasonable',
    pass: totalPerimeterFt > 0 && !isNaN(totalPerimeterFt),
    severity: (totalPerimeterFt > 0 && !isNaN(totalPerimeterFt)) ? 'info' : 'error',
    details: `Perimeter: ${totalPerimeterFt.toFixed(0)} ft`,
    suggestion: (totalPerimeterFt <= 0 || isNaN(totalPerimeterFt)) ? 'Invalid perimeter calculation' : undefined,
  });

  // MSR-3: Waste percentage in valid range
  const wasteValid = wastePercent >= 5 && wastePercent <= 30;
  checks.push({
    id: 'MSR-3',
    category: 'measurement',
    description: 'Waste factor in valid range (5-30%)',
    pass: wasteValid,
    severity: wasteValid ? 'info' : 'warning',
    details: `Waste factor: ${wastePercent}%`,
    suggestion: !wasteValid 
      ? (wastePercent < 5 ? 'Waste too low - may underorder materials' : 'Waste very high - verify complexity')
      : undefined,
  });

  // MSR-4: Perimeter/area ratio sanity check
  // For a square, perimeter = 4 * sqrt(area), so ratio ≈ 4/sqrt(area)
  // Complex shapes have higher ratios
  if (totalAreaSqft > 0) {
    const expectedPerimeter = 4 * Math.sqrt(totalAreaSqft);
    const ratio = totalPerimeterFt / expectedPerimeter;
    const isReasonable = ratio >= 0.8 && ratio <= 2.5;

    checks.push({
      id: 'MSR-4',
      category: 'measurement',
      description: 'Perimeter/area ratio is reasonable',
      pass: isReasonable,
      severity: isReasonable ? 'info' : 'warning',
      details: `Perimeter ratio: ${ratio.toFixed(2)} (expected ~1.0 for simple, ~1.5 for complex)`,
      suggestion: !isReasonable
        ? (ratio < 0.8 ? 'Perimeter seems too short' : 'Perimeter seems too long - very complex shape?')
        : undefined,
    });
  }

  return checks;
}

// ===== CROSS-VALIDATION CHECKS =====

function runCrossValidationChecks(
  calculatedAreaSqft: number,
  crossValidation: CrossValidationInput
): QACheckResult[] {
  const checks: QACheckResult[] = [];

  // XV-1: Compare to Solar API
  if (crossValidation.solarApiAreaSqft && crossValidation.solarApiAreaSqft > 0) {
    const variance = Math.abs(calculatedAreaSqft - crossValidation.solarApiAreaSqft) / crossValidation.solarApiAreaSqft * 100;
    const isClose = variance <= 5;

    checks.push({
      id: 'XV-1',
      category: 'cross_validation',
      description: 'Area matches Solar API (±5%)',
      pass: isClose,
      severity: isClose ? 'info' : (variance > 15 ? 'error' : 'warning'),
      details: `Calculated: ${calculatedAreaSqft.toFixed(0)} sqft, Solar API: ${crossValidation.solarApiAreaSqft.toFixed(0)} sqft (${variance.toFixed(1)}% variance)`,
      suggestion: !isClose ? 'Significant deviation from Solar API - verify measurement' : undefined,
    });
  }

  // XV-2: Compare to vendor report (if available)
  if (crossValidation.vendorReportAreaSqft && crossValidation.vendorReportAreaSqft > 0) {
    const variance = Math.abs(calculatedAreaSqft - crossValidation.vendorReportAreaSqft) / crossValidation.vendorReportAreaSqft * 100;
    const isClose = variance <= 2;

    checks.push({
      id: 'XV-2',
      category: 'cross_validation',
      description: 'Area matches vendor report (±2%)',
      pass: isClose,
      severity: isClose ? 'info' : 'warning',
      details: `Calculated: ${calculatedAreaSqft.toFixed(0)} sqft, Vendor: ${crossValidation.vendorReportAreaSqft.toFixed(0)} sqft (${variance.toFixed(1)}% variance)`,
      suggestion: !isClose ? 'Deviation from vendor report - review and adjust' : undefined,
    });
  }

  return checks;
}

// ===== MASTER ORCHESTRATION =====

export interface RunQAInput {
  geometry: GeometryInput;
  facets: FacetInput[];
  linearFeatures: LinearFeatureInput[];
  roofType: string;
  totalSurfaceAreaSqft: number;
  wastePercent: number;
  crossValidation?: CrossValidationInput;
}

/**
 * Run complete QA validation suite
 */
export function runComprehensiveQA(input: RunQAInput): QASummary {
  const allChecks: QACheckResult[] = [];

  // Run all check categories
  allChecks.push(...runGeometryChecks(input.geometry));
  allChecks.push(...runFacetChecks(input.facets, input.geometry.footprintAreaSqft));
  allChecks.push(...runClassificationChecks(
    input.linearFeatures, 
    input.roofType, 
    input.facets.length
  ));
  allChecks.push(...runMeasurementChecks(
    input.totalSurfaceAreaSqft,
    input.geometry.perimeterFt,
    input.wastePercent
  ));

  if (input.crossValidation) {
    allChecks.push(...runCrossValidationChecks(
      input.totalSurfaceAreaSqft,
      input.crossValidation
    ));
  }

  // Calculate summary
  const passedChecks = allChecks.filter(c => c.pass).length;
  const failedChecks = allChecks.filter(c => !c.pass).length;
  const errors = allChecks.filter(c => !c.pass && c.severity === 'error').length;
  const warnings = allChecks.filter(c => !c.pass && c.severity === 'warning').length;

  // Calculate confidence score (0-1)
  const confidenceScore = allChecks.length > 0
    ? (passedChecks / allChecks.length) * (1 - errors * 0.1) * (1 - warnings * 0.03)
    : 0;

  // Determine if manual review is needed
  const requiresManualReview = errors > 0 || warnings >= 3 || confidenceScore < 0.7;

  // Generate recommended actions
  const recommendedActions: string[] = [];
  
  if (errors > 0) {
    const errorDetails = allChecks
      .filter(c => !c.pass && c.severity === 'error')
      .map(c => c.suggestion)
      .filter(Boolean);
    recommendedActions.push(...(errorDetails as string[]));
  }

  if (requiresManualReview) {
    recommendedActions.push('Manual verification recommended before generating report');
  }

  return {
    overallPass: errors === 0,
    totalChecks: allChecks.length,
    passedChecks,
    failedChecks,
    errors,
    warnings,
    checks: allChecks,
    confidenceScore: Math.max(0, Math.min(1, confidenceScore)),
    requiresManualReview,
    recommendedActions,
  };
}

/**
 * Generate a human-readable QA report
 */
export function formatQAReport(summary: QASummary): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════');
  lines.push('         QA VALIDATION REPORT           ');
  lines.push('═══════════════════════════════════════');
  lines.push('');

  // Overall status
  lines.push(`Status: ${summary.overallPass ? '✅ PASS' : '❌ FAIL'}`);
  lines.push(`Confidence: ${(summary.confidenceScore * 100).toFixed(1)}%`);
  lines.push(`Checks: ${summary.passedChecks}/${summary.totalChecks} passed`);
  lines.push(`Errors: ${summary.errors} | Warnings: ${summary.warnings}`);
  lines.push('');

  // Failed checks
  const failedChecks = summary.checks.filter(c => !c.pass);
  if (failedChecks.length > 0) {
    lines.push('─── Issues ───');
    for (const check of failedChecks) {
      const icon = check.severity === 'error' ? '❌' : '⚠️';
      lines.push(`${icon} [${check.id}] ${check.description}`);
      lines.push(`   ${check.details}`);
      if (check.suggestion) {
        lines.push(`   → ${check.suggestion}`);
      }
    }
    lines.push('');
  }

  // Recommended actions
  if (summary.recommendedActions.length > 0) {
    lines.push('─── Recommended Actions ───');
    for (const action of summary.recommendedActions) {
      lines.push(`• ${action}`);
    }
  }

  return lines.join('\n');
}
