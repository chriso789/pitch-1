// Output Schema Transformer
// Converts internal measurement data to the AI Measurement Agent JSON schema

type XY = [number, number];

// ===== Output Schema Types (as specified in the AI Agent prompt) =====

export interface MeasurementOutputSchema {
  footprint: XY[];
  
  facets: Array<{
    id: string;
    polygon: XY[];
    area: number; // Sloped sq ft
    pitch: number; // Degrees
    azimuth: number; // Direction 0-360
    requiresReview?: boolean;
  }>;
  
  edges: {
    ridges: Array<{ start: XY; end: XY; requiresReview?: boolean }>;
    hips: Array<{ start: XY; end: XY; requiresReview?: boolean }>;
    valleys: Array<{ start: XY; end: XY; requiresReview?: boolean }>;
    eaves: Array<{ start: XY; end: XY }>;
    rakes: Array<{ start: XY; end: XY }>;
  };
  
  totals: {
    'roof.plan_sqft': number;
    'roof.total_sqft': number;
    'roof.area_by_pitch': Record<string, number>;
    'pitch.predominant': number;
    'lf.ridge': number;
    'lf.hip': number;
    'lf.valley': number;
    'lf.eave': number;
    'lf.rake': number;
  };
  
  qualityChecks: {
    areaMatch: boolean;
    areaErrorPercent?: number;
    perimeterMatch: boolean;
    perimeterErrorPercent?: number;
    segmentConnectivity: boolean;
    issues?: string[];
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

/**
 * Transform internal measurement data to the output schema
 */
export function transformToOutputSchema(
  measurement: InternalMeasurement,
  qualityResult: QualityResult,
  footprintCoords: XY[]
): MeasurementOutputSchema {
  // Parse facets from internal format
  const facets = measurement.faces.map(face => {
    const polygon = parseWKTPolygon(face.wkt);
    const pitchDeg = pitchRatioToDegrees(face.pitch || '4/12');
    const azimuth = estimateAzimuth(polygon);
    
    return {
      id: face.id,
      polygon,
      area: face.area_sqft,
      pitch: round(pitchDeg, 1),
      azimuth: round(azimuth, 0),
      requiresReview: face.pitch === undefined || face.pitch === '4/12'
    };
  });

  // Parse linear features from internal format
  const edges = parseLinearFeatures(measurement.linear_features || []);

  // Calculate area by pitch breakdown
  const areaByPitch: Record<string, number> = {};
  for (const facet of facets) {
    const pitchKey = `${Math.round(facet.pitch)}°`;
    areaByPitch[pitchKey] = (areaByPitch[pitchKey] || 0) + facet.area;
  }

  // Find predominant pitch
  const predominantPitch = findPredominantPitch(facets);

  // Build totals
  const totals = {
    'roof.plan_sqft': round(measurement.faces.reduce((s, f) => s + f.plan_area_sqft, 0)),
    'roof.total_sqft': round(measurement.summary.total_area_sqft),
    'roof.area_by_pitch': areaByPitch,
    'pitch.predominant': predominantPitch,
    'lf.ridge': round(measurement.summary.ridge_ft || 0),
    'lf.hip': round(measurement.summary.hip_ft || 0),
    'lf.valley': round(measurement.summary.valley_ft || 0),
    'lf.eave': round(measurement.summary.eave_ft || 0),
    'lf.rake': round(measurement.summary.rake_ft || 0)
  };

  return {
    footprint: footprintCoords,
    facets,
    edges,
    totals,
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
    manualReviewRecommended: qualityResult.manualReviewRecommended
  };
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

export { transformToOutputSchema, MeasurementOutputSchema };
