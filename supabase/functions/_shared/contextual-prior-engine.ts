/**
 * Phase 53: Contextual Prior Engine
 * Neighborhood-aware measurement priors based on surrounding properties.
 */

export interface PropertyContext {
  latitude: number;
  longitude: number;
  propertyType?: string;
  yearBuilt?: number;
  squareFootage?: number;
  neighborhoodName?: string;
  tractId?: string;
}

export interface NeighborhoodPriors {
  predominantRoofType: string;
  averagePitch: number;
  averageArea: number;
  areaStdDev: number;
  commonMaterials: string[];
  tractHomePattern: boolean;
  styleConsistency: number; // 0-100, how uniform the neighborhood is
  sampleSize: number;
}

export interface ContextualExpectation {
  expectedRoofType: string;
  expectedPitch: { min: number; max: number; most_likely: number };
  expectedArea: { min: number; max: number; most_likely: number };
  confidence: number;
  reasoning: string[];
}

/**
 * Building type priors based on property classification
 */
const BUILDING_TYPE_PRIORS: Record<string, {
  roofTypes: Record<string, number>;
  pitchRange: { min: number; max: number };
  areaRange: { min: number; max: number };
}> = {
  'single_family_residential': {
    roofTypes: { 'hip': 0.4, 'gable': 0.35, 'dutch_hip': 0.1, 'complex': 0.15 },
    pitchRange: { min: 4, max: 12 },
    areaRange: { min: 1200, max: 5000 },
  },
  'townhouse': {
    roofTypes: { 'gable': 0.6, 'hip': 0.25, 'flat': 0.1, 'shed': 0.05 },
    pitchRange: { min: 4, max: 9 },
    areaRange: { min: 800, max: 2500 },
  },
  'apartment_building': {
    roofTypes: { 'flat': 0.6, 'hip': 0.2, 'gable': 0.15, 'mansard': 0.05 },
    pitchRange: { min: 0, max: 6 },
    areaRange: { min: 5000, max: 50000 },
  },
  'commercial': {
    roofTypes: { 'flat': 0.7, 'low_slope': 0.2, 'gable': 0.1 },
    pitchRange: { min: 0, max: 4 },
    areaRange: { min: 3000, max: 100000 },
  },
  'industrial': {
    roofTypes: { 'flat': 0.5, 'gable': 0.3, 'shed': 0.15, 'sawtooth': 0.05 },
    pitchRange: { min: 0, max: 6 },
    areaRange: { min: 10000, max: 500000 },
  },
};

/**
 * Regional style patterns
 */
const REGIONAL_PATTERNS: Record<string, {
  preferredRoofTypes: string[];
  preferredPitch: number;
  reason: string;
}> = {
  'florida': {
    preferredRoofTypes: ['hip', 'dutch_hip'],
    preferredPitch: 5,
    reason: 'Hurricane resistance - hip roofs handle wind better',
  },
  'northeast': {
    preferredRoofTypes: ['gable', 'gambrel'],
    preferredPitch: 9,
    reason: 'Snow load - steeper pitches for snow shedding',
  },
  'southwest': {
    preferredRoofTypes: ['flat', 'low_slope', 'tile'],
    preferredPitch: 3,
    reason: 'Desert climate - flat/low pitch with tile common',
  },
  'midwest': {
    preferredRoofTypes: ['gable', 'hip'],
    preferredPitch: 7,
    reason: 'Mixed climate - moderate pitch for rain and snow',
  },
  'pacific_northwest': {
    preferredRoofTypes: ['gable', 'shed'],
    preferredPitch: 8,
    reason: 'Heavy rainfall - steeper pitch for water runoff',
  },
};

/**
 * Determine regional pattern from coordinates
 */
function getRegionalPattern(latitude: number, longitude: number): string | null {
  // Simplified regional detection
  if (latitude >= 25 && latitude <= 31 && longitude >= -88 && longitude <= -79) {
    return 'florida';
  }
  if (latitude >= 40 && latitude <= 47 && longitude >= -80 && longitude <= -66) {
    return 'northeast';
  }
  if (latitude >= 31 && latitude <= 37 && longitude >= -118 && longitude <= -103) {
    return 'southwest';
  }
  if (latitude >= 37 && latitude <= 49 && longitude >= -103 && longitude <= -80) {
    return 'midwest';
  }
  if (latitude >= 42 && latitude <= 49 && longitude >= -125 && longitude <= -117) {
    return 'pacific_northwest';
  }
  return null;
}

/**
 * Generate contextual expectations for a property
 */
export function generateContextualExpectation(
  context: PropertyContext,
  neighborhoodPriors?: NeighborhoodPriors
): ContextualExpectation {
  const reasoning: string[] = [];
  let expectedRoofType = 'hip';
  let expectedPitch = { min: 4, max: 12, most_likely: 6 };
  let expectedArea = { min: 1500, max: 4000, most_likely: 2500 };
  let confidence = 50;

  // Apply building type priors
  const buildingType = context.propertyType || 'single_family_residential';
  const typePriors = BUILDING_TYPE_PRIORS[buildingType] || BUILDING_TYPE_PRIORS['single_family_residential'];
  
  // Get most likely roof type from priors
  const sortedTypes = Object.entries(typePriors.roofTypes)
    .sort((a, b) => b[1] - a[1]);
  expectedRoofType = sortedTypes[0][0];
  reasoning.push(`Building type (${buildingType}) suggests ${expectedRoofType} roof (${(sortedTypes[0][1] * 100).toFixed(0)}% probability)`);
  
  expectedPitch = {
    min: typePriors.pitchRange.min,
    max: typePriors.pitchRange.max,
    most_likely: Math.round((typePriors.pitchRange.min + typePriors.pitchRange.max) / 2),
  };
  
  expectedArea = {
    min: typePriors.areaRange.min,
    max: typePriors.areaRange.max,
    most_likely: Math.round((typePriors.areaRange.min + typePriors.areaRange.max) / 2),
  };
  
  confidence += 10;

  // Apply regional patterns
  const region = getRegionalPattern(context.latitude, context.longitude);
  if (region) {
    const pattern = REGIONAL_PATTERNS[region];
    if (pattern.preferredRoofTypes.includes(expectedRoofType)) {
      confidence += 15;
      reasoning.push(`Regional pattern (${region}) confirms ${expectedRoofType} roof preference`);
    } else if (pattern.preferredRoofTypes.length > 0) {
      expectedRoofType = pattern.preferredRoofTypes[0];
      reasoning.push(`Regional pattern (${region}) suggests ${expectedRoofType} roof: ${pattern.reason}`);
      confidence += 10;
    }
    expectedPitch.most_likely = pattern.preferredPitch;
    reasoning.push(`Regional pitch expectation: ${pattern.preferredPitch}/12`);
  }

  // Apply neighborhood priors if available
  if (neighborhoodPriors && neighborhoodPriors.sampleSize >= 5) {
    confidence += Math.min(20, neighborhoodPriors.styleConsistency * 0.2);
    
    if (neighborhoodPriors.styleConsistency >= 70) {
      expectedRoofType = neighborhoodPriors.predominantRoofType;
      expectedPitch.most_likely = neighborhoodPriors.averagePitch;
      expectedArea = {
        min: Math.round(neighborhoodPriors.averageArea - neighborhoodPriors.areaStdDev * 2),
        max: Math.round(neighborhoodPriors.averageArea + neighborhoodPriors.areaStdDev * 2),
        most_likely: Math.round(neighborhoodPriors.averageArea),
      };
      reasoning.push(`Tract home pattern detected - ${neighborhoodPriors.styleConsistency}% style consistency`);
      reasoning.push(`Neighborhood average: ${neighborhoodPriors.averageArea.toFixed(0)} sq ft, ${neighborhoodPriors.averagePitch}/12 pitch`);
    }
    
    if (neighborhoodPriors.tractHomePattern) {
      confidence += 15;
      reasoning.push('Strong tract home pattern - expecting uniform construction');
    }
  }

  // Apply year built adjustments
  if (context.yearBuilt) {
    if (context.yearBuilt >= 2000) {
      reasoning.push('Modern construction - likely meets current building codes');
      confidence += 5;
    } else if (context.yearBuilt < 1960) {
      reasoning.push('Older construction - may have non-standard features');
      confidence -= 10;
    }
  }

  // Cap confidence
  confidence = Math.min(95, Math.max(30, confidence));

  return {
    expectedRoofType,
    expectedPitch,
    expectedArea,
    confidence,
    reasoning,
  };
}

/**
 * Compare measurement against contextual expectations
 */
export function validateAgainstContext(
  measurement: {
    roofType: string;
    pitch: number;
    totalArea: number;
  },
  expectation: ContextualExpectation
): {
  isPlausible: boolean;
  deviations: string[];
  adjustedConfidence: number;
} {
  const deviations: string[] = [];
  let confidenceAdjustment = 0;

  // Check roof type
  if (measurement.roofType !== expectation.expectedRoofType) {
    deviations.push(
      `Roof type (${measurement.roofType}) differs from expected (${expectation.expectedRoofType})`
    );
    confidenceAdjustment -= 10;
  }

  // Check pitch
  if (measurement.pitch < expectation.expectedPitch.min - 2) {
    deviations.push(
      `Pitch (${measurement.pitch}/12) below expected range (${expectation.expectedPitch.min}-${expectation.expectedPitch.max}/12)`
    );
    confidenceAdjustment -= 15;
  } else if (measurement.pitch > expectation.expectedPitch.max + 2) {
    deviations.push(
      `Pitch (${measurement.pitch}/12) above expected range`
    );
    confidenceAdjustment -= 15;
  }

  // Check area
  const areaDeviation = Math.abs(measurement.totalArea - expectation.expectedArea.most_likely) / expectation.expectedArea.most_likely;
  if (measurement.totalArea < expectation.expectedArea.min * 0.7) {
    deviations.push(
      `Area (${measurement.totalArea} sq ft) significantly below expected minimum (${expectation.expectedArea.min} sq ft)`
    );
    confidenceAdjustment -= 20;
  } else if (measurement.totalArea > expectation.expectedArea.max * 1.3) {
    deviations.push(
      `Area (${measurement.totalArea} sq ft) significantly above expected maximum (${expectation.expectedArea.max} sq ft)`
    );
    confidenceAdjustment -= 20;
  } else if (areaDeviation > 0.3) {
    deviations.push(
      `Area deviates ${(areaDeviation * 100).toFixed(0)}% from expected`
    );
    confidenceAdjustment -= 10;
  }

  const adjustedConfidence = Math.max(
    20,
    expectation.confidence + confidenceAdjustment
  );

  return {
    isPlausible: deviations.length === 0 || adjustedConfidence >= 50,
    deviations,
    adjustedConfidence,
  };
}

/**
 * Detect tract home patterns from measurement batch
 */
export function detectTractHomePattern(
  measurements: Array<{ roofType: string; pitch: number; area: number }>
): {
  isTractPattern: boolean;
  consistency: number;
  commonPattern?: { roofType: string; pitch: number; avgArea: number };
} {
  if (measurements.length < 5) {
    return { isTractPattern: false, consistency: 0 };
  }

  // Calculate roof type frequency
  const typeFreq: Record<string, number> = {};
  measurements.forEach(m => {
    typeFreq[m.roofType] = (typeFreq[m.roofType] || 0) + 1;
  });
  const dominantType = Object.entries(typeFreq).sort((a, b) => b[1] - a[1])[0];
  const typeConsistency = dominantType[1] / measurements.length;

  // Calculate pitch variation
  const pitches = measurements.map(m => m.pitch);
  const avgPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
  const pitchVariance = pitches.reduce((sum, p) => sum + Math.pow(p - avgPitch, 2), 0) / pitches.length;
  const pitchStdDev = Math.sqrt(pitchVariance);
  const pitchConsistency = pitchStdDev < 1.5 ? 1 : pitchStdDev < 3 ? 0.7 : 0.3;

  // Calculate area variation
  const areas = measurements.map(m => m.area);
  const avgArea = areas.reduce((a, b) => a + b, 0) / areas.length;
  const areaVariance = areas.reduce((sum, a) => sum + Math.pow(a - avgArea, 2), 0) / areas.length;
  const areaStdDev = Math.sqrt(areaVariance);
  const areaCoeffVar = areaStdDev / avgArea;
  const areaConsistency = areaCoeffVar < 0.1 ? 1 : areaCoeffVar < 0.2 ? 0.7 : 0.3;

  const overallConsistency = (typeConsistency * 0.4 + pitchConsistency * 0.3 + areaConsistency * 0.3) * 100;

  return {
    isTractPattern: overallConsistency >= 70,
    consistency: Math.round(overallConsistency),
    commonPattern: overallConsistency >= 50 ? {
      roofType: dominantType[0],
      pitch: Math.round(avgPitch),
      avgArea: Math.round(avgArea),
    } : undefined,
  };
}
