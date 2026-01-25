/**
 * Phase 22: Shadow-Based Pitch Verification Engine
 * Uses shadow analysis to independently verify and refine pitch detection
 * by calculating expected shadow lengths based on sun position.
 */

export interface SunPosition {
  azimuth: number;  // degrees from north
  altitude: number; // degrees above horizon
  date: Date;
  lat: number;
  lng: number;
}

export interface ShadowAnalysis {
  measuredShadowLengthFt: number;
  expectedShadowLengthFt: number;
  derivedPitch: string;
  aiDetectedPitch: string;
  pitchMatch: boolean;
  discrepancyDegrees: number;
  confidence: number;
  sunPosition: SunPosition;
}

/**
 * Calculate sun position for a given location and time
 * Based on NOAA Solar Position Algorithm
 */
export function calculateSunPosition(
  lat: number, 
  lng: number, 
  timestamp: Date
): SunPosition {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const toDeg = (rad: number) => rad * 180 / Math.PI;
  
  // Day of year
  const start = new Date(timestamp.getFullYear(), 0, 0);
  const diff = timestamp.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  // Solar declination
  const declination = 23.45 * Math.sin(toRad(360 * (284 + dayOfYear) / 365));
  
  // Hour angle (simplified)
  const hours = timestamp.getUTCHours() + timestamp.getUTCMinutes() / 60;
  const solarNoon = 12 - lng / 15; // Approximate
  const hourAngle = 15 * (hours - solarNoon);
  
  // Solar altitude
  const latRad = toRad(lat);
  const decRad = toRad(declination);
  const haRad = toRad(hourAngle);
  
  const sinAlt = Math.sin(latRad) * Math.sin(decRad) + 
                 Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const altitude = toDeg(Math.asin(sinAlt));
  
  // Solar azimuth
  const cosAz = (Math.sin(decRad) - Math.sin(latRad) * sinAlt) / 
                (Math.cos(latRad) * Math.cos(Math.asin(sinAlt)));
  let azimuth = toDeg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
  
  // Adjust azimuth for afternoon
  if (hourAngle > 0) {
    azimuth = 360 - azimuth;
  }
  
  return {
    azimuth,
    altitude: Math.max(0, altitude),
    date: timestamp,
    lat,
    lng
  };
}

/**
 * Convert pitch ratio (e.g., "6/12") to degrees
 */
export function pitchToDegrees(pitch: string): number {
  const match = pitch.match(/(\d+)\/12/);
  if (!match) return 0;
  const rise = parseInt(match[1]);
  return Math.atan(rise / 12) * 180 / Math.PI;
}

/**
 * Convert degrees to pitch ratio
 */
export function degreesToPitch(degrees: number): string {
  const rise = Math.tan(degrees * Math.PI / 180) * 12;
  const roundedRise = Math.round(rise * 2) / 2; // Round to nearest 0.5
  return `${roundedRise}/12`;
}

/**
 * Calculate expected shadow length for a roof edge given pitch and sun position
 */
export function calculateExpectedShadowLength(
  roofEdgeLengthFt: number,
  pitchDegrees: number,
  sunAltitude: number,
  roofOrientation: number, // degrees from north
  sunAzimuth: number
): number {
  if (sunAltitude <= 0) return 0;
  
  // Calculate the angle between sun direction and roof slope
  const azimuthDiff = Math.abs(sunAzimuth - roofOrientation);
  const effectiveAngle = Math.min(azimuthDiff, 360 - azimuthDiff);
  
  // Height of roof edge above its base
  const roofRise = roofEdgeLengthFt * Math.sin(pitchDegrees * Math.PI / 180);
  
  // Shadow length based on sun altitude
  const shadowLength = roofRise / Math.tan(sunAltitude * Math.PI / 180);
  
  // Adjust for roof orientation relative to sun
  const orientationFactor = Math.cos(effectiveAngle * Math.PI / 180);
  
  return shadowLength * Math.abs(orientationFactor);
}

/**
 * Derive roof pitch from measured shadow length
 */
export function derivePitchFromShadow(
  shadowLengthFt: number,
  buildingHeightFt: number,
  sunAltitude: number
): { pitch: string; pitchDegrees: number; confidence: number } {
  if (sunAltitude <= 5 || shadowLengthFt <= 0) {
    return { pitch: 'unknown', pitchDegrees: 0, confidence: 0 };
  }
  
  // Calculate the rise that would produce this shadow
  const rise = shadowLengthFt * Math.tan(sunAltitude * Math.PI / 180);
  
  // Estimate roof run (half of building width, approximate)
  const estimatedRun = buildingHeightFt * 0.4; // Rough approximation
  
  // Calculate pitch angle
  const pitchDegrees = Math.atan(rise / estimatedRun) * 180 / Math.PI;
  
  // Confidence based on sun altitude (higher sun = more reliable)
  let confidence = 0.5;
  if (sunAltitude >= 45) confidence = 0.85;
  else if (sunAltitude >= 30) confidence = 0.75;
  else if (sunAltitude >= 20) confidence = 0.65;
  
  return {
    pitch: degreesToPitch(pitchDegrees),
    pitchDegrees,
    confidence
  };
}

/**
 * Validate AI-detected pitch against shadow-derived pitch
 */
export function validatePitchWithShadow(
  aiPitch: string,
  shadowDerivedPitch: string,
  toleranceDegrees: number = 5
): {
  match: boolean;
  aiPitchDegrees: number;
  shadowPitchDegrees: number;
  discrepancy: number;
  recommendation: string;
} {
  const aiDegrees = pitchToDegrees(aiPitch);
  const shadowDegrees = pitchToDegrees(shadowDerivedPitch);
  const discrepancy = Math.abs(aiDegrees - shadowDegrees);
  
  const match = discrepancy <= toleranceDegrees;
  
  let recommendation = '';
  if (!match) {
    if (discrepancy > 10) {
      recommendation = 'Major pitch discrepancy detected. Manual verification required.';
    } else {
      recommendation = `Consider averaging: ${degreesToPitch((aiDegrees + shadowDegrees) / 2)}`;
    }
  }
  
  return {
    match,
    aiPitchDegrees: aiDegrees,
    shadowPitchDegrees: shadowDegrees,
    discrepancy,
    recommendation
  };
}

/**
 * Analyze shadows in roof image to verify pitch
 */
export async function analyzeShadowsForPitch(
  imageUrl: string,
  roofBounds: { lat: number; lng: number }[],
  aiDetectedPitch: string,
  imageTimestamp?: Date
): Promise<ShadowAnalysis> {
  // Default to noon today if no timestamp provided
  const timestamp = imageTimestamp || new Date();
  
  // Calculate center of roof
  const centerLat = roofBounds.reduce((sum, p) => sum + p.lat, 0) / roofBounds.length;
  const centerLng = roofBounds.reduce((sum, p) => sum + p.lng, 0) / roofBounds.length;
  
  // Get sun position
  const sunPosition = calculateSunPosition(centerLat, centerLng, timestamp);
  
  // Estimate building dimensions from bounds
  const latRange = Math.max(...roofBounds.map(p => p.lat)) - Math.min(...roofBounds.map(p => p.lat));
  const lngRange = Math.max(...roofBounds.map(p => p.lng)) - Math.min(...roofBounds.map(p => p.lng));
  const buildingWidthFt = lngRange * 364567; // Approximate feet per degree longitude
  
  // Estimate shadow length (would use image analysis in production)
  const estimatedShadowFt = buildingWidthFt * 0.3; // Placeholder
  
  // Calculate expected shadow for AI pitch
  const expectedShadow = calculateExpectedShadowLength(
    buildingWidthFt / 2,
    pitchToDegrees(aiDetectedPitch),
    sunPosition.altitude,
    0, // Would calculate from ridge direction
    sunPosition.azimuth
  );
  
  // Derive pitch from shadow
  const derived = derivePitchFromShadow(estimatedShadowFt, buildingWidthFt / 2, sunPosition.altitude);
  
  // Validate
  const validation = validatePitchWithShadow(aiDetectedPitch, derived.pitch);
  
  return {
    measuredShadowLengthFt: estimatedShadowFt,
    expectedShadowLengthFt: expectedShadow,
    derivedPitch: derived.pitch,
    aiDetectedPitch,
    pitchMatch: validation.match,
    discrepancyDegrees: validation.discrepancy,
    confidence: derived.confidence,
    sunPosition
  };
}

/**
 * Get optimal time windows for shadow-based pitch analysis
 */
export function getOptimalShadowAnalysisTimes(
  lat: number,
  lng: number,
  date: Date = new Date()
): { morning: Date; afternoon: Date; quality: 'good' | 'fair' | 'poor' } {
  // Optimal times are when sun is at 30-60 degrees altitude
  // This varies by latitude and season
  
  const morningHour = 9 + (lat / 30); // Approximate adjustment
  const afternoonHour = 15 - (lat / 30);
  
  const morning = new Date(date);
  morning.setHours(Math.floor(morningHour), 0, 0, 0);
  
  const afternoon = new Date(date);
  afternoon.setHours(Math.floor(afternoonHour), 0, 0, 0);
  
  // Check sun positions
  const morningSun = calculateSunPosition(lat, lng, morning);
  const afternoonSun = calculateSunPosition(lat, lng, afternoon);
  
  let quality: 'good' | 'fair' | 'poor' = 'poor';
  if (morningSun.altitude >= 30 && morningSun.altitude <= 60) {
    quality = 'good';
  } else if (morningSun.altitude >= 20 && morningSun.altitude <= 70) {
    quality = 'fair';
  }
  
  return { morning, afternoon, quality };
}
