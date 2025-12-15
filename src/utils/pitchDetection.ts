/**
 * Pitch Detection Utilities for Roof Measurements
 * Uses shadow analysis and geometric calculations
 */

// Industry-standard pitch multipliers for roof area adjustment
export const PITCH_MULTIPLIERS: Record<string, number> = {
  'flat': 1.000,
  '1/12': 1.003,
  '2/12': 1.014,
  '3/12': 1.031,
  '4/12': 1.054,
  '5/12': 1.083,
  '6/12': 1.118,
  '7/12': 1.158,
  '8/12': 1.202,
  '9/12': 1.250,
  '10/12': 1.302,
  '11/12': 1.357,
  '12/12': 1.414,
  '13/12': 1.474,
  '14/12': 1.537,
  '15/12': 1.601,
  '16/12': 1.667,
  '17/12': 1.734,
  '18/12': 1.803,
};

// Pitch to angle conversion
export const PITCH_ANGLES: Record<string, number> = {
  'flat': 0,
  '1/12': 4.76,
  '2/12': 9.46,
  '3/12': 14.04,
  '4/12': 18.43,
  '5/12': 22.62,
  '6/12': 26.57,
  '7/12': 30.26,
  '8/12': 33.69,
  '9/12': 36.87,
  '10/12': 39.81,
  '11/12': 42.51,
  '12/12': 45.00,
};

/**
 * Convert pitch string to multiplier
 */
export function getPitchMultiplier(pitch: string): number {
  const normalized = pitch.toLowerCase().trim();
  return PITCH_MULTIPLIERS[normalized] || 1.0;
}

/**
 * Convert angle in degrees to pitch string
 */
export function angleToPitch(angleDegrees: number): string {
  const rise = Math.tan(angleDegrees * Math.PI / 180) * 12;
  const roundedRise = Math.round(rise);
  
  if (roundedRise <= 0) return 'flat';
  if (roundedRise > 18) return '18/12';
  
  return `${roundedRise}/12`;
}

/**
 * Calculate pitch from shadow length ratio
 * shadowRatio = shadow length / building height
 */
export function estimatePitchFromShadow(
  shadowLength: number,
  buildingHeight: number,
  sunElevation: number = 45
): string {
  // Calculate roof angle based on shadow geometry
  const shadowRatio = shadowLength / buildingHeight;
  const sunAngleRad = sunElevation * Math.PI / 180;
  
  // Estimate roof pitch from shadow distortion
  const estimatedAngle = Math.atan(1 / shadowRatio) * 180 / Math.PI - (90 - sunElevation);
  
  return angleToPitch(Math.abs(estimatedAngle));
}

/**
 * Calculate pitch from roof line endpoints
 * Analyzes the slope of visible roof edges
 */
export function estimatePitchFromRoofLines(
  point1: { x: number; y: number },
  point2: { x: number; y: number },
  metersPerPixel: number
): string {
  const dx = Math.abs(point2.x - point1.x) * metersPerPixel;
  const dy = Math.abs(point2.y - point1.y) * metersPerPixel;
  
  // Calculate apparent angle from image perspective
  const apparentAngle = Math.atan2(dy, dx) * 180 / Math.PI;
  
  // Adjust for typical viewing angle (nadir satellite view)
  // Most satellite imagery has ~15-20 degree off-nadir angle
  const estimatedPitchAngle = apparentAngle * 1.5; // Rough adjustment factor
  
  return angleToPitch(estimatedPitchAngle);
}

/**
 * Group facets by similar pitch for zone analysis
 */
export function groupFacetsByPitch(
  facets: Array<{ id: string; pitch: string }>
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  
  for (const facet of facets) {
    const pitch = facet.pitch || 'unknown';
    if (!groups[pitch]) {
      groups[pitch] = [];
    }
    groups[pitch].push(facet.id);
  }
  
  return groups;
}

/**
 * Calculate adjusted area with pitch multiplier
 */
export function calculatePitchAdjustedArea(
  flatArea: number,
  pitch: string
): number {
  const multiplier = getPitchMultiplier(pitch);
  return flatArea * multiplier;
}

/**
 * Detect predominant pitch from multiple facet measurements
 */
export function detectPredominantPitch(
  facets: Array<{ area: number; pitch: string }>
): string {
  if (facets.length === 0) return '6/12';
  
  // Weight by area
  const pitchWeights: Record<string, number> = {};
  let totalArea = 0;
  
  for (const facet of facets) {
    const pitch = facet.pitch || '6/12';
    pitchWeights[pitch] = (pitchWeights[pitch] || 0) + facet.area;
    totalArea += facet.area;
  }
  
  // Find pitch with highest area coverage
  let predominant = '6/12';
  let maxWeight = 0;
  
  for (const [pitch, weight] of Object.entries(pitchWeights)) {
    if (weight > maxWeight) {
      maxWeight = weight;
      predominant = pitch;
    }
  }
  
  return predominant;
}

/**
 * Validate pitch string format
 */
export function isValidPitch(pitch: string): boolean {
  return pitch in PITCH_MULTIPLIERS;
}

/**
 * Get pitch description for display
 */
export function getPitchDescription(pitch: string): string {
  const angle = PITCH_ANGLES[pitch];
  if (angle === undefined) return pitch;
  
  if (pitch === 'flat') return 'Flat (0°)';
  return `${pitch} (${angle.toFixed(1)}°)`;
}
