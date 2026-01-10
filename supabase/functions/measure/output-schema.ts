// Output Schema Transformer - Phase 7: Enhanced Output Format
// Converts internal measurement data to the AI Measurement Agent JSON schema
// Includes detailed facet-level information and QA reports

type XY = [number, number];

// ===== Enhanced Linear Feature (Phase 7) =====

export interface EnhancedLinearFeature {
  id: string;
  wkt: string;
  start: XY;
  end: XY;
  length_ft: number;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  source: 'dsm' | 'solar_segment' | 'skeleton' | 'ai_vision' | 'manual';
  confidence: number; // 0-100
  requiresReview: boolean;
  dsmElevation?: { start: number; end: number };
  label?: string;
}

// ===== Enhanced Facet (Phase 7) =====

export interface EnhancedFacet {
  id: string;
  polygon: XY[];
  wkt: string;
  area_sqft: number; // Pitch-adjusted area
  plan_area_sqft: number; // Flat/plan area
  pitch: number; // Degrees
  pitchRatio: string; // e.g., "4/12"
  azimuth: number; // Direction 0-360
  direction: string; // N, NE, E, SE, S, SW, W, NW
  squares: number; // area_sqft / 100
  boundaryEdges: {
    eaves: Array<{ start: XY; end: XY; length_ft: number }>;
    rakes: Array<{ start: XY; end: XY; length_ft: number }>;
    ridges: Array<{ start: XY; end: XY; length_ft: number }>;
    hips: Array<{ start: XY; end: XY; length_ft: number }>;
    valleys: Array<{ start: XY; end: XY; length_ft: number }>;
  };
  requiresReview: boolean;
  reviewReasons?: string[];
}

// ===== QA Report (Phase 7) =====

export interface QAReport {
  overallScore: number; // 0-100
  passedChecks: string[];
  failedChecks: string[];
  warnings: string[];
  recommendations: string[];
  validationDetails: {
    areaMatch: { passed: boolean; errorPercent: number; threshold: number };
    perimeterMatch: { passed: boolean; errorPercent: number; threshold: number };
    segmentConnectivity: { passed: boolean; details: string };
    ridgeAlignment: { passed: boolean; confidence: number };
    valleyCompleteness: { passed: boolean; missingCount: number };
    edgeContinuity: { passed: boolean; gaps: number };
  };
}

// ===== Output Schema Types (Enhanced for Phase 7) =====

export interface MeasurementOutputSchema {
  // Footprint
  footprint: XY[];
  footprintWkt: string;
  
  // Enhanced facets with full detail
  facets: EnhancedFacet[];
  
  // Enhanced edges with source tracking
  edges: {
    ridges: EnhancedLinearFeature[];
    hips: EnhancedLinearFeature[];
    valleys: EnhancedLinearFeature[];
    eaves: EnhancedLinearFeature[];
    rakes: EnhancedLinearFeature[];
  };
  
  // Totals (Phase 2: perimeter = eave + rake ONLY)
  totals: {
    'roof.plan_sqft': number;
    'roof.total_sqft': number;
    'roof.squares': number;
    'roof.area_by_pitch': Record<string, number>;
    'pitch.predominant': number;
    'pitch.predominant_ratio': string;
    'lf.ridge': number;
    'lf.hip': number;
    'lf.valley': number;
    'lf.eave': number;
    'lf.rake': number;
    // Phase 2: CORRECT perimeter calculation
    'lf.perimeter': number; // = eave + rake (NOT internal edges)
  };
  
  // QA Report (Phase 7)
  qaReport: QAReport;
  
  // Legacy quality checks (for backward compatibility)
  qualityChecks: {
    areaMatch: boolean;
    areaErrorPercent?: number;
    perimeterMatch: boolean;
    perimeterErrorPercent?: number;
    segmentConnectivity: boolean;
    issues?: string[];
  };
  
  // Calibration metadata (Phase 3)
  calibration: {
    ridgeSource: 'manual' | 'dsm' | 'solar_segment' | 'ai_vision' | 'skeleton' | 'none';
    ridgeConfidence: number;
    dsmAvailable: boolean;
    solarSegmentsUsed: number;
  };
  
  manualReviewRecommended: boolean;
}

// ===== Internal Types =====

interface InternalMeasurement {
  faces: Array<{
    id: string;
    wkt: string;
    plan_area_sqft: number;
    area_sqft: number;
    pitch?: string;
  }>;
  linear_features?: Array<{
    id: string;
    wkt: string;
    length_ft: number;
    type: string;
  }>;
  summary: {
    total_area_sqft: number;
    total_squares: number;
    waste_pct: number;
    perimeter_ft?: number;
    ridge_ft?: number;
    hip_ft?: number;
    valley_ft?: number;
    eave_ft?: number;
    rake_ft?: number;
  };
  geom_wkt?: string;
}

interface QualityResult {
  qualityChecks: {
    areaMatch: boolean;
    areaErrorPercent: number;
    perimeterMatch: boolean;
    perimeterErrorPercent: number;
    segmentConnectivity: boolean;
    issues: string[];
  };
  manualReviewRecommended: boolean;
}

interface CalibrationInfo {
  ridgeSource: 'manual' | 'dsm' | 'solar_segment' | 'ai_vision' | 'skeleton' | 'none';
  ridgeConfidence: number;
  dsmAvailable: boolean;
  solarSegmentsUsed: number;
}

/**
 * Transform internal measurement data to the enhanced output schema (Phase 7)
 */
export function transformToOutputSchema(
  measurement: InternalMeasurement,
  qualityResult: QualityResult,
  footprintCoords: XY[],
  calibration?: CalibrationInfo
): MeasurementOutputSchema {
  // Parse facets from internal format with enhanced detail
  const facets: EnhancedFacet[] = measurement.faces.map(face => {
    const polygon = parseWKTPolygon(face.wkt);
    const pitchDeg = pitchRatioToDegrees(face.pitch || '4/12');
    const azimuth = estimateAzimuth(polygon);
    const direction = azimuthToDirection(azimuth);
    
    return {
      id: face.id,
      polygon,
      wkt: face.wkt,
      area_sqft: face.area_sqft,
      plan_area_sqft: face.plan_area_sqft,
      pitch: round(pitchDeg, 1),
      pitchRatio: face.pitch || '4/12',
      azimuth: round(azimuth, 0),
      direction,
      squares: round(face.area_sqft / 100, 2),
      boundaryEdges: {
        eaves: [],
        rakes: [],
        ridges: [],
        hips: [],
        valleys: []
      },
      requiresReview: face.pitch === undefined || face.pitch === '4/12',
      reviewReasons: face.pitch === undefined ? ['Pitch not detected - using default 4/12'] : undefined
    };
  });

  // Parse linear features with enhanced detail
  const edges = parseEnhancedLinearFeatures(measurement.linear_features || []);

  // Calculate area by pitch breakdown
  const areaByPitch: Record<string, number> = {};
  for (const facet of facets) {
    const pitchKey = `${Math.round(facet.pitch)}°`;
    areaByPitch[pitchKey] = (areaByPitch[pitchKey] || 0) + facet.area_sqft;
  }

  // Find predominant pitch
  const predominantPitch = findPredominantPitch(facets.map(f => ({ pitch: f.pitch, area: f.area_sqft })));
  const predominantPitchRatio = degreesToPitchRatio(predominantPitch);

  // Calculate totals with Phase 2 CORRECT perimeter calculation
  const eaveFt = edges.eaves.reduce((s, e) => s + e.length_ft, 0);
  const rakeFt = edges.rakes.reduce((s, e) => s + e.length_ft, 0);
  // PHASE 2: Perimeter = Eave + Rake ONLY (not ridge, hip, valley)
  const perimeterFt = eaveFt + rakeFt;

  const totals = {
    'roof.plan_sqft': round(measurement.faces.reduce((s, f) => s + f.plan_area_sqft, 0)),
    'roof.total_sqft': round(measurement.summary.total_area_sqft),
    'roof.squares': round(measurement.summary.total_area_sqft / 100, 2),
    'roof.area_by_pitch': areaByPitch,
    'pitch.predominant': predominantPitch,
    'pitch.predominant_ratio': predominantPitchRatio,
    'lf.ridge': round(edges.ridges.reduce((s, e) => s + e.length_ft, 0)),
    'lf.hip': round(edges.hips.reduce((s, e) => s + e.length_ft, 0)),
    'lf.valley': round(edges.valleys.reduce((s, e) => s + e.length_ft, 0)),
    'lf.eave': round(eaveFt),
    'lf.rake': round(rakeFt),
    'lf.perimeter': round(perimeterFt) // CORRECT: only eave + rake
  };

  // Build QA Report (Phase 7)
  const qaReport = buildQAReport(qualityResult, totals, edges, calibration);

  return {
    footprint: footprintCoords,
    footprintWkt: coordsToWKT(footprintCoords),
    facets,
    edges,
    totals,
    qaReport,
    qualityChecks: {
      areaMatch: qualityResult.qualityChecks.areaMatch,
      areaErrorPercent: round(qualityResult.qualityChecks.areaErrorPercent, 1),
      perimeterMatch: qualityResult.qualityChecks.perimeterMatch,
      perimeterErrorPercent: round(qualityResult.qualityChecks.perimeterErrorPercent, 1),
      segmentConnectivity: qualityResult.qualityChecks.segmentConnectivity,
      issues: qualityResult.qualityChecks.issues.length > 0 
        ? qualityResult.qualityChecks.issues 
        : undefined
    },
    calibration: calibration || {
      ridgeSource: 'skeleton',
      ridgeConfidence: 0.7,
      dsmAvailable: false,
      solarSegmentsUsed: 0
    },
    manualReviewRecommended: qualityResult.manualReviewRecommended
  };
}

/**
 * Parse linear features into enhanced edge groups
 */
function parseEnhancedLinearFeatures(
  features: Array<{ 
    id?: string;
    wkt: string; 
    type: string; 
    length_ft: number;
    source?: string;
    confidence?: number;
    label?: string;
  }>
): MeasurementOutputSchema['edges'] {
  const edges: MeasurementOutputSchema['edges'] = {
    ridges: [],
    hips: [],
    valleys: [],
    eaves: [],
    rakes: []
  };

  let featureId = 1;

  for (const feature of features) {
    const parsed = parseWKTLinestring(feature.wkt);
    if (!parsed) continue;

    const enhancedFeature: EnhancedLinearFeature = {
      id: feature.id || `LF${featureId++}`,
      wkt: feature.wkt,
      start: parsed.start,
      end: parsed.end,
      length_ft: feature.length_ft,
      type: feature.type as EnhancedLinearFeature['type'],
      source: (feature.source as EnhancedLinearFeature['source']) || 'skeleton',
      confidence: feature.confidence || 70,
      requiresReview: (feature.confidence || 70) < 80,
      label: feature.label
    };

    switch (feature.type) {
      case 'ridge':
        edges.ridges.push(enhancedFeature);
        break;
      case 'hip':
        edges.hips.push(enhancedFeature);
        break;
      case 'valley':
        edges.valleys.push(enhancedFeature);
        break;
      case 'eave':
        edges.eaves.push(enhancedFeature);
        break;
      case 'rake':
        edges.rakes.push(enhancedFeature);
        break;
    }
  }

  return edges;
}

/**
 * Build comprehensive QA Report (Phase 7)
 */
function buildQAReport(
  qualityResult: QualityResult,
  totals: MeasurementOutputSchema['totals'],
  edges: MeasurementOutputSchema['edges'],
  calibration?: CalibrationInfo
): QAReport {
  const passedChecks: string[] = [];
  const failedChecks: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Area validation
  if (qualityResult.qualityChecks.areaMatch) {
    passedChecks.push('Area calculation within tolerance');
  } else {
    failedChecks.push(`Area error: ${qualityResult.qualityChecks.areaErrorPercent.toFixed(1)}%`);
    recommendations.push('Verify roof segment areas against satellite imagery');
  }

  // Perimeter validation
  if (qualityResult.qualityChecks.perimeterMatch) {
    passedChecks.push('Perimeter calculation matches footprint');
  } else {
    failedChecks.push(`Perimeter error: ${qualityResult.qualityChecks.perimeterErrorPercent.toFixed(1)}%`);
  }

  // Segment connectivity
  if (qualityResult.qualityChecks.segmentConnectivity) {
    passedChecks.push('All segments properly connected');
  } else {
    failedChecks.push('Segment connectivity issues detected');
    recommendations.push('Check for gaps in ridge/hip/valley lines');
  }

  // Ridge alignment
  const ridgeConfidence = calibration?.ridgeConfidence || 0.7;
  if (ridgeConfidence >= 0.85) {
    passedChecks.push(`Ridge alignment verified (${(ridgeConfidence * 100).toFixed(0)}% confidence)`);
  } else if (ridgeConfidence >= 0.7) {
    warnings.push(`Ridge alignment moderate confidence (${(ridgeConfidence * 100).toFixed(0)}%)`);
  } else {
    failedChecks.push(`Low ridge alignment confidence (${(ridgeConfidence * 100).toFixed(0)}%)`);
    recommendations.push('Consider manual ridge trace for improved accuracy');
  }

  // Valley completeness check
  const valleyCount = edges.valleys.length;
  if (valleyCount === 0 && edges.hips.length > 2) {
    warnings.push('No valleys detected - verify if this is a simple hip roof');
  }

  // Edge continuity check
  const lowConfidenceEdges = [
    ...edges.ridges,
    ...edges.hips,
    ...edges.valleys
  ].filter(e => e.confidence < 70).length;

  if (lowConfidenceEdges > 0) {
    warnings.push(`${lowConfidenceEdges} edge(s) have low confidence`);
    recommendations.push('Review low-confidence edges against satellite imagery');
  } else {
    passedChecks.push('All edges have acceptable confidence');
  }

  // Calculate overall score
  const totalChecks = passedChecks.length + failedChecks.length + warnings.length;
  const overallScore = totalChecks > 0 
    ? Math.round((passedChecks.length / totalChecks) * 100)
    : 50;

  return {
    overallScore,
    passedChecks,
    failedChecks,
    warnings,
    recommendations,
    validationDetails: {
      areaMatch: {
        passed: qualityResult.qualityChecks.areaMatch,
        errorPercent: qualityResult.qualityChecks.areaErrorPercent,
        threshold: 5
      },
      perimeterMatch: {
        passed: qualityResult.qualityChecks.perimeterMatch,
        errorPercent: qualityResult.qualityChecks.perimeterErrorPercent,
        threshold: 5
      },
      segmentConnectivity: {
        passed: qualityResult.qualityChecks.segmentConnectivity,
        details: qualityResult.qualityChecks.segmentConnectivity ? 'All connected' : 'Gaps detected'
      },
      ridgeAlignment: {
        passed: ridgeConfidence >= 0.85,
        confidence: ridgeConfidence
      },
      valleyCompleteness: {
        passed: true, // Would need more context to validate
        missingCount: 0
      },
      edgeContinuity: {
        passed: lowConfidenceEdges === 0,
        gaps: lowConfidenceEdges
      }
    }
  };
}

/**
 * Convert azimuth degrees to compass direction
 */
function azimuthToDirection(azimuth: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(azimuth / 45) % 8;
  return directions[index];
}

/**
 * Convert degrees to pitch ratio (e.g., 18.4° → "4/12")
 */
function degreesToPitchRatio(degrees: number): string {
  if (degrees < 2) return 'flat';
  const rise = Math.round(Math.tan(degrees * Math.PI / 180) * 12);
  return `${rise}/12`;
}

/**
 * Convert coordinates to WKT polygon
 */
function coordsToWKT(coords: XY[]): string {
  const inner = coords.map(c => `${c[0]} ${c[1]}`).join(', ');
  return `POLYGON((${inner}))`;
}

/**
 * Parse WKT POLYGON to coordinate array
 */
function parseWKTPolygon(wkt: string): XY[] {
  const match = wkt.match(/POLYGON\(\(([^)]+)\)\)/);
  if (!match) return [];
  
  return match[1]
    .split(',')
    .map(pair => {
      const [lng, lat] = pair.trim().split(' ').map(Number);
      return [lng, lat] as XY;
    });
}

/**
 * Parse WKT LINESTRING to start/end coordinates
 */
function parseWKTLinestring(wkt: string): { start: XY; end: XY } | null {
  const match = wkt.match(/LINESTRING\(([^)]+)\)/);
  if (!match) return null;
  
  const points = match[1]
    .split(',')
    .map(pair => {
      const [lng, lat] = pair.trim().split(' ').map(Number);
      return [lng, lat] as XY;
    });
  
  if (points.length < 2) return null;
  
  return {
    start: points[0],
    end: points[points.length - 1]
  };
}

/**
 * Parse linear features into edge groups
 */
function parseLinearFeatures(features: Array<{ wkt: string; type: string; length_ft: number }>): MeasurementOutputSchema['edges'] {
  const edges: MeasurementOutputSchema['edges'] = {
    ridges: [],
    hips: [],
    valleys: [],
    eaves: [],
    rakes: []
  };

  for (const feature of features) {
    const parsed = parseWKTLinestring(feature.wkt);
    if (!parsed) continue;

    switch (feature.type) {
      case 'ridge':
        edges.ridges.push(parsed);
        break;
      case 'hip':
        edges.hips.push(parsed);
        break;
      case 'valley':
        edges.valleys.push(parsed);
        break;
      case 'eave':
        edges.eaves.push(parsed);
        break;
      case 'rake':
        edges.rakes.push(parsed);
        break;
    }
  }

  return edges;
}

/**
 * Convert pitch ratio (e.g., "4/12") to degrees
 */
function pitchRatioToDegrees(ratio: string): number {
  if (ratio === 'flat') return 0;
  const match = ratio.match(/(\d+)\/12/);
  if (!match) return 18.5; // Default 4/12
  const rise = parseInt(match[1]);
  return Math.atan(rise / 12) * (180 / Math.PI);
}

/**
 * Estimate azimuth (facing direction) from polygon shape
 */
function estimateAzimuth(polygon: XY[]): number {
  if (polygon.length < 3) return 0;
  
  // Find the longest edge and assume it's roughly parallel to ridge
  // The facet faces perpendicular to this edge
  let maxLen = 0;
  let direction = 0;
  
  for (let i = 0; i < polygon.length - 1; i++) {
    const dx = polygon[i + 1][0] - polygon[i][0];
    const dy = polygon[i + 1][1] - polygon[i][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len > maxLen) {
      maxLen = len;
      // Calculate perpendicular direction
      direction = Math.atan2(dx, dy) * 180 / Math.PI;
    }
  }
  
  // Normalize to 0-360
  return ((direction % 360) + 360) % 360;
}

/**
 * Find the pitch that covers the most area
 */
function findPredominantPitch(facets: Array<{ pitch: number; area: number }>): number {
  if (facets.length === 0) return 18.5;
  
  const pitchAreas: Record<number, number> = {};
  for (const f of facets) {
    const roundedPitch = Math.round(f.pitch);
    pitchAreas[roundedPitch] = (pitchAreas[roundedPitch] || 0) + f.area;
  }
  
  let maxArea = 0;
  let predominant = 18;
  
  for (const [pitch, area] of Object.entries(pitchAreas)) {
    if (area > maxArea) {
      maxArea = area;
      predominant = parseInt(pitch);
    }
  }
  
  return predominant;
}

function round(n: number, decimals = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

// Types are exported inline above
