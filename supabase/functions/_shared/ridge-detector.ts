/**
 * Phase 3: Ridge Line Precision Enhancement
 * Enhanced ridge detection with proper length calculation
 * Cross-validation with Solar API and building dimensions
 */

import { haversineDistanceFt } from './vertex-detector.ts';

export interface RidgeDetectionResult {
  ridges: DetectedRidge[];
  totalRidgeFt: number;
  primaryRidgeAzimuth: number;
  validationScore: number;
  warnings: string[];
}

export interface DetectedRidge {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  lengthFt: number;
  azimuthDegrees: number;
  confidence: number;
  isPrimary: boolean;
  connectedHipIds: string[];
  wkt: string;
}

export interface RidgeValidationRules {
  minRidgeLengthFt: number;
  maxRidgeLengthFt: number;
  ridgeToBuildingWidthRatio: { min: number; max: number };
  allowedAzimuthDeviationDegrees: number;
  continuityGapMaxFt: number;
}

const DEFAULT_RULES: RidgeValidationRules = {
  minRidgeLengthFt: 10,
  maxRidgeLengthFt: 100,
  ridgeToBuildingWidthRatio: { min: 0.7, max: 1.3 },
  allowedAzimuthDeviationDegrees: 15,
  continuityGapMaxFt: 1.0
};

/**
 * Calculate azimuth (bearing) between two points in degrees
 */
export function calculateAzimuth(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;

  const x = Math.sin(dLng) * Math.cos(lat2Rad);
  const y = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

  let bearing = Math.atan2(x, y) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Normalize azimuth to 0-180 range (ridges are bidirectional)
 */
export function normalizeRidgeAzimuth(azimuth: number): number {
  const normalized = azimuth % 180;
  return normalized < 0 ? normalized + 180 : normalized;
}

/**
 * Calculate building dimensions from footprint
 */
export function calculateBuildingDimensions(
  footprintVertices: { lat: number; lng: number }[]
): { width: number; length: number; primaryAxis: number } {
  if (footprintVertices.length < 3) {
    return { width: 0, length: 0, primaryAxis: 0 };
  }

  // Find bounding box
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  for (const vertex of footprintVertices) {
    minLat = Math.min(minLat, vertex.lat);
    maxLat = Math.max(maxLat, vertex.lat);
    minLng = Math.min(minLng, vertex.lng);
    maxLng = Math.max(maxLng, vertex.lng);
  }

  // Calculate dimensions in feet
  const nsDistance = haversineDistanceFt(minLat, (minLng + maxLng) / 2, maxLat, (minLng + maxLng) / 2);
  const ewDistance = haversineDistanceFt((minLat + maxLat) / 2, minLng, (minLat + maxLat) / 2, maxLng);

  const length = Math.max(nsDistance, ewDistance);
  const width = Math.min(nsDistance, ewDistance);
  const primaryAxis = nsDistance > ewDistance ? 0 : 90; // 0 = N-S, 90 = E-W

  return { width, length, primaryAxis };
}

/**
 * Validate ridge against building dimensions
 */
export function validateRidgeLength(
  ridgeLengthFt: number,
  buildingLengthFt: number,
  overhangFt: number = 2,
  rules: Partial<RidgeValidationRules> = {}
): { valid: boolean; expectedLength: number; deviation: number; message: string } {
  const cfg = { ...DEFAULT_RULES, ...rules };
  
  // Expected ridge length = building length - 2x overhang (for hip roof)
  // For gable roof, ridge ≈ building length
  const expectedRidgeMin = buildingLengthFt * cfg.ridgeToBuildingWidthRatio.min;
  const expectedRidgeMax = buildingLengthFt * cfg.ridgeToBuildingWidthRatio.max;

  const valid = ridgeLengthFt >= expectedRidgeMin && ridgeLengthFt <= expectedRidgeMax;
  const expectedLength = buildingLengthFt - (2 * overhangFt);
  const deviation = Math.abs(ridgeLengthFt - expectedLength) / expectedLength * 100;

  return {
    valid,
    expectedLength,
    deviation,
    message: valid 
      ? 'Ridge length within expected range'
      : `Ridge length ${ridgeLengthFt.toFixed(1)}ft deviates ${deviation.toFixed(1)}% from expected ${expectedLength.toFixed(1)}ft`
  };
}

/**
 * Validate ridge direction against Solar API azimuth
 */
export function validateRidgeDirection(
  ridgeAzimuth: number,
  solarAzimuth: number,
  toleranceDegrees: number = DEFAULT_RULES.allowedAzimuthDeviationDegrees
): { valid: boolean; deviation: number; message: string } {
  // Solar API gives roof plane azimuth, ridge should be perpendicular
  const expectedRidgeAzimuth = (solarAzimuth + 90) % 180;
  const normalizedRidge = normalizeRidgeAzimuth(ridgeAzimuth);
  
  let deviation = Math.abs(normalizedRidge - expectedRidgeAzimuth);
  if (deviation > 90) {
    deviation = 180 - deviation;
  }

  const valid = deviation <= toleranceDegrees;

  return {
    valid,
    deviation,
    message: valid
      ? 'Ridge direction consistent with Solar API'
      : `Ridge azimuth ${normalizedRidge.toFixed(1)}° deviates ${deviation.toFixed(1)}° from expected ${expectedRidgeAzimuth.toFixed(1)}°`
  };
}

/**
 * Check ridge continuity (no gaps in continuous ridge line)
 */
export function checkRidgeContinuity(
  ridgeSegments: { startLat: number; startLng: number; endLat: number; endLng: number }[],
  maxGapFt: number = DEFAULT_RULES.continuityGapMaxFt
): { continuous: boolean; gaps: { location: { lat: number; lng: number }; gapFt: number }[] } {
  if (ridgeSegments.length <= 1) {
    return { continuous: true, gaps: [] };
  }

  const gaps: { location: { lat: number; lng: number }; gapFt: number }[] = [];

  // Collect all endpoints
  const endpoints: { lat: number; lng: number; isStart: boolean; segmentIndex: number }[] = [];
  ridgeSegments.forEach((seg, idx) => {
    endpoints.push({ lat: seg.startLat, lng: seg.startLng, isStart: true, segmentIndex: idx });
    endpoints.push({ lat: seg.endLat, lng: seg.endLng, isStart: false, segmentIndex: idx });
  });

  // Find unconnected endpoints
  for (let i = 0; i < endpoints.length; i++) {
    let hasConnection = false;
    for (let j = 0; j < endpoints.length; j++) {
      if (i === j || endpoints[i].segmentIndex === endpoints[j].segmentIndex) continue;
      
      const distance = haversineDistanceFt(
        endpoints[i].lat, endpoints[i].lng,
        endpoints[j].lat, endpoints[j].lng
      );
      
      if (distance <= maxGapFt) {
        hasConnection = true;
        break;
      }
    }
    
    if (!hasConnection) {
      // Check if this endpoint should be connected to another segment
      let minDistance = Infinity;
      let closestEndpoint: { lat: number; lng: number } | null = null;
      
      for (let j = 0; j < endpoints.length; j++) {
        if (i === j || endpoints[i].segmentIndex === endpoints[j].segmentIndex) continue;
        
        const distance = haversineDistanceFt(
          endpoints[i].lat, endpoints[i].lng,
          endpoints[j].lat, endpoints[j].lng
        );
        
        if (distance < minDistance) {
          minDistance = distance;
          closestEndpoint = endpoints[j];
        }
      }
      
      if (closestEndpoint && minDistance > maxGapFt && minDistance < 10) {
        gaps.push({
          location: { lat: endpoints[i].lat, lng: endpoints[i].lng },
          gapFt: minDistance
        });
      }
    }
  }

  return {
    continuous: gaps.length === 0,
    gaps
  };
}

/**
 * Enhanced ridge detection with validation
 */
export function detectRidges(
  linearFeaturesWKT: { type: string; wkt: string; confidence?: number }[],
  buildingFootprint: { lat: number; lng: number }[],
  solarApiAzimuth?: number,
  rules: Partial<RidgeValidationRules> = {}
): RidgeDetectionResult {
  const cfg = { ...DEFAULT_RULES, ...rules };
  const warnings: string[] = [];
  const ridges: DetectedRidge[] = [];

  // Filter ridge features
  const ridgeFeatures = linearFeaturesWKT.filter(f => f.type === 'ridge');

  // Calculate building dimensions
  const buildingDims = calculateBuildingDimensions(buildingFootprint);

  for (const feature of ridgeFeatures) {
    const match = feature.wkt.match(/LINESTRING\s*\(([^)]+)\)/i);
    if (!match) continue;

    const coordString = match[1];
    const coordPairs = coordString.split(',').map(s => s.trim());

    if (coordPairs.length < 2) continue;

    const [startLngStr, startLatStr] = coordPairs[0].split(/\s+/);
    const [endLngStr, endLatStr] = coordPairs[coordPairs.length - 1].split(/\s+/);

    const startLat = parseFloat(startLatStr);
    const startLng = parseFloat(startLngStr);
    const endLat = parseFloat(endLatStr);
    const endLng = parseFloat(endLngStr);

    const lengthFt = haversineDistanceFt(startLat, startLng, endLat, endLng);
    const azimuth = calculateAzimuth(startLat, startLng, endLat, endLng);

    // Validate length
    if (lengthFt < cfg.minRidgeLengthFt) {
      warnings.push(`Ridge segment ${lengthFt.toFixed(1)}ft is below minimum ${cfg.minRidgeLengthFt}ft`);
    }
    if (lengthFt > cfg.maxRidgeLengthFt) {
      warnings.push(`Ridge segment ${lengthFt.toFixed(1)}ft exceeds maximum ${cfg.maxRidgeLengthFt}ft`);
    }

    ridges.push({
      id: `ridge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      startLat,
      startLng,
      endLat,
      endLng,
      lengthFt,
      azimuthDegrees: azimuth,
      confidence: feature.confidence || 0.85,
      isPrimary: false,
      connectedHipIds: [],
      wkt: feature.wkt
    });
  }

  // Determine primary ridge (longest)
  if (ridges.length > 0) {
    let maxLength = 0;
    let primaryIndex = 0;
    ridges.forEach((ridge, idx) => {
      if (ridge.lengthFt > maxLength) {
        maxLength = ridge.lengthFt;
        primaryIndex = idx;
      }
    });
    ridges[primaryIndex].isPrimary = true;
  }

  // Calculate total ridge length
  const totalRidgeFt = ridges.reduce((sum, r) => sum + r.lengthFt, 0);

  // Get primary ridge azimuth
  const primaryRidge = ridges.find(r => r.isPrimary);
  const primaryRidgeAzimuth = primaryRidge ? normalizeRidgeAzimuth(primaryRidge.azimuthDegrees) : 0;

  // Cross-validate with building dimensions
  if (primaryRidge && buildingDims.length > 0) {
    const validation = validateRidgeLength(primaryRidge.lengthFt, buildingDims.length);
    if (!validation.valid) {
      warnings.push(validation.message);
    }
  }

  // Cross-validate with Solar API
  if (primaryRidge && solarApiAzimuth !== undefined) {
    const directionValidation = validateRidgeDirection(primaryRidge.azimuthDegrees, solarApiAzimuth);
    if (!directionValidation.valid) {
      warnings.push(directionValidation.message);
    }
  }

  // Check continuity
  const continuity = checkRidgeContinuity(ridges);
  if (!continuity.continuous) {
    continuity.gaps.forEach(gap => {
      warnings.push(`Ridge gap of ${gap.gapFt.toFixed(1)}ft detected at ${gap.location.lat.toFixed(6)}, ${gap.location.lng.toFixed(6)}`);
    });
  }

  // Calculate validation score
  let validationScore = 100;
  if (warnings.length > 0) {
    validationScore -= warnings.length * 5;
  }
  if (!continuity.continuous) {
    validationScore -= 10;
  }
  validationScore = Math.max(0, validationScore);

  return {
    ridges,
    totalRidgeFt,
    primaryRidgeAzimuth,
    validationScore,
    warnings
  };
}

/**
 * Generate AI prompt for enhanced ridge detection
 */
export function getRidgeDetectionPrompt(): string {
  return `
RIDGE LINE DETECTION INSTRUCTIONS:

A ridge is the HIGHEST horizontal line where two roof planes meet at the apex. Follow these rules precisely:

IDENTIFICATION CHARACTERISTICS:
1. Ridge runs PARALLEL to the longest building dimension in most cases
2. Ridge is a HORIZONTAL line at the peak of the roof
3. Ridge connects the apex points of the roof structure
4. Ridge typically casts NO shadow directly below it (shadows fall on either side)

LENGTH VALIDATION:
- Typical residential ridge: 15-60ft
- Ridge rarely under 10ft for buildings over 1000 sqft
- Ridge length ≈ building length minus 2x overhang (for hip roofs)
- For gable roofs: ridge length ≈ building length

COMMON ERRORS TO AVOID:
- Do NOT confuse hip lines with ridge lines (hips are diagonal)
- Do NOT mark rake edges as ridges
- Do NOT split continuous ridges into multiple segments unless there's a real intersection

OUTPUT FORMAT:
For each ridge, provide:
- Start and end coordinates (lat, lng)
- Confidence score (0-1)
- Whether this is the primary (longest) ridge

Return ridges as WKT LINESTRING format.
`;
}
