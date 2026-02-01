/**
 * Geometry Confidence Scorer
 * 
 * Calculates overall confidence in roof geometry from multiple data sources.
 * Used to determine what level of detail to show in the diagram.
 */

export type GeometrySource = 'manual' | 'validated' | 'reconstructed' | 'estimated';

export interface GeometrySourceResult {
  source: GeometrySource;
  confidence: number;
  shouldShowFacets: boolean;
  shouldShowLinearFeatures: boolean;
  warningMessage: string | null;
}

/**
 * Determine the geometry source and confidence level from measurement data.
 * Implements strict priority hierarchy:
 * 
 * 1. Manual Override (user-drawn/corrected) - confidence 1.0
 * 2. AI-detected linear_features_wkt (validated) - confidence based on footprint_confidence
 * 3. Reconstructed from authoritative footprint - medium confidence
 * 4. OSM/estimated (show warning, hide facets) - low confidence
 */
export function getGeometrySource(measurement: any): GeometrySourceResult {
  if (!measurement) {
    return {
      source: 'estimated',
      confidence: 0,
      shouldShowFacets: false,
      shouldShowLinearFeatures: false,
      warningMessage: 'No measurement data available',
    };
  }

  const footprintConfidence = measurement.footprint_confidence || 0;
  const footprintSource = measurement.footprint_source || '';
  const hasLinearFeatures = Array.isArray(measurement.linear_features_wkt || measurement.linear_features) && 
                            (measurement.linear_features_wkt || measurement.linear_features).length > 0;
  const hasManualPerimeter = !!measurement.manual_perimeter_wkt;
  const detectionMethod = measurement.detection_method || '';

  // Priority 1: Manual override takes highest priority
  if (hasManualPerimeter) {
    return {
      source: 'manual',
      confidence: 1.0,
      shouldShowFacets: true,
      shouldShowLinearFeatures: true,
      warningMessage: null,
    };
  }

  // Priority 2: High-confidence footprint with validated linear features
  if (footprintConfidence >= 0.9 && hasLinearFeatures) {
    return {
      source: 'validated',
      confidence: footprintConfidence,
      shouldShowFacets: true,
      shouldShowLinearFeatures: true,
      warningMessage: null,
    };
  }

  // Priority 3: Medium confidence - show lines but not facets
  if (footprintConfidence >= 0.7 && hasLinearFeatures) {
    return {
      source: 'reconstructed',
      confidence: footprintConfidence,
      shouldShowFacets: false,
      shouldShowLinearFeatures: true,
      warningMessage: 'Facets hidden - geometry requires verification',
    };
  }

  // Check for known low-quality sources
  const isLowQualitySource = 
    footprintSource === 'osm_overpass' ||
    footprintSource === 'solar_bbox_fallback' ||
    detectionMethod === 'solar_bbox_fallback' ||
    footprintConfidence < 0.5;

  // Priority 4: Low confidence - perimeter only with strong warning
  if (isLowQualitySource || !hasLinearFeatures) {
    return {
      source: 'estimated',
      confidence: footprintConfidence || 0.3,
      shouldShowFacets: false,
      shouldShowLinearFeatures: footprintConfidence >= 0.5,
      warningMessage: 'Geometry estimated from satellite - measurements are approximate',
    };
  }

  // Default fallback
  return {
    source: 'estimated',
    confidence: footprintConfidence || 0.5,
    shouldShowFacets: false,
    shouldShowLinearFeatures: hasLinearFeatures,
    warningMessage: footprintConfidence < 0.7 ? 'Low confidence geometry - verify measurements' : null,
  };
}

/**
 * Get a human-readable label for the geometry source
 */
export function getSourceLabel(source: GeometrySource): string {
  switch (source) {
    case 'manual': return 'Manual Verification';
    case 'validated': return 'AI Validated';
    case 'reconstructed': return 'AI Reconstructed';
    case 'estimated': return 'Estimated';
    default: return 'Unknown';
  }
}

/**
 * Get the appropriate badge color for a geometry source
 */
export function getSourceBadgeColor(source: GeometrySource): {
  bg: string;
  text: string;
  border: string;
} {
  switch (source) {
    case 'manual':
      return { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' };
    case 'validated':
      return { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' };
    case 'reconstructed':
      return { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' };
    case 'estimated':
      return { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-300' };
  }
}

/**
 * Calculate the overall quality score for a measurement
 * Combines multiple factors into a single 0-100 score
 */
export function calculateQualityScore(measurement: any): {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  factors: Record<string, number>;
} {
  const factors: Record<string, number> = {
    footprintConfidence: (measurement.footprint_confidence || 0) * 100,
    hasLinearFeatures: measurement.linear_features_wkt?.length > 0 ? 100 : 0,
    hasFacets: measurement.facets_json?.length > 0 ? 100 : 0,
    hasPitch: measurement.predominant_pitch ? 100 : 0,
    isVerified: measurement.manual_perimeter_wkt ? 100 : 0,
  };

  // Weighted average
  const weights = {
    footprintConfidence: 0.3,
    hasLinearFeatures: 0.25,
    hasFacets: 0.2,
    hasPitch: 0.15,
    isVerified: 0.1,
  };

  const score = Object.entries(factors).reduce((sum, [key, value]) => {
    return sum + value * (weights[key as keyof typeof weights] || 0);
  }, 0);

  const grade: 'A' | 'B' | 'C' | 'D' | 'F' = 
    score >= 90 ? 'A' :
    score >= 80 ? 'B' :
    score >= 70 ? 'C' :
    score >= 60 ? 'D' : 'F';

  return { score: Math.round(score), grade, factors };
}
