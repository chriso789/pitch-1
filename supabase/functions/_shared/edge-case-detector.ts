/**
 * Phase 60: Edge Case Detector
 * Unusual roof pattern detection for specialized routing.
 */

export interface EdgeCaseDetection {
  isEdgeCase: boolean;
  detectedPatterns: EdgeCasePattern[];
  recommendedPipeline: 'standard' | 'specialized' | 'manual';
  confidenceAdjustment: number;
  specialConsiderations: string[];
}

export interface EdgeCasePattern {
  pattern: string;
  confidence: number;
  description: string;
  handlingNotes: string[];
}

/**
 * Edge case pattern definitions
 */
const EDGE_CASE_PATTERNS: Record<string, {
  indicators: string[];
  geometryTests: ((geom: RoofGeometry) => boolean)[];
  description: string;
  handling: string[];
}> = {
  'gambrel': {
    indicators: ['barn_style', 'dual_slope_per_side', 'steep_lower_shallow_upper'],
    geometryTests: [
      (g) => g.facetCount >= 4 && g.facetCount % 2 === 0,
      (g) => hasDualPitchPattern(g),
    ],
    description: 'Gambrel roof with two different slopes per side',
    handling: [
      'Calculate each slope section separately',
      'Use dual pitch factor',
      'Verify knee wall transition point',
    ],
  },
  'mansard': {
    indicators: ['four_sided_double_slope', 'steep_sides_flat_top', 'french_style'],
    geometryTests: [
      (g) => g.facetCount >= 8,
      (g) => hasPerimeterSteepSlopes(g),
    ],
    description: 'Mansard roof with steep perimeter and flat/low center',
    handling: [
      'Identify steep wall sections vs flat top',
      'Calculate each section with appropriate pitch',
      'Check for dormers on steep sections',
    ],
  },
  'geodesic_dome': {
    indicators: ['triangular_facets', 'curved_appearance', 'buckminster_style'],
    geometryTests: [
      (g) => g.facetCount >= 20,
      (g) => hasTriangularFacetPattern(g),
    ],
    description: 'Geodesic dome with triangular facet pattern',
    handling: [
      'Standard ridge/hip analysis does not apply',
      'Calculate surface area from sphere approximation',
      'Require manual verification of facet count',
    ],
  },
  'butterfly': {
    indicators: ['inward_sloping', 'center_valley', 'v_shape'],
    geometryTests: [
      (g) => g.valleyCount === 1 && isCenterValley(g),
      (g) => g.facetCount === 2,
    ],
    description: 'Butterfly roof with center valley drainage',
    handling: [
      'Unusual drainage - verify gutter capacity',
      'Valley at center, not perimeter',
      'May require special waterproofing',
    ],
  },
  'multi_level_complex': {
    indicators: ['multiple_heights', 'step_flashing', 'addition_visible'],
    geometryTests: [
      (g) => g.heightLevels >= 3,
      (g) => hasDisconnectedSections(g),
    ],
    description: 'Multi-level complex with separate roof sections',
    handling: [
      'Analyze each section independently',
      'Calculate step flashing at transitions',
      'Sum areas with appropriate connections',
    ],
  },
  'turret_tower': {
    indicators: ['conical_section', 'polygonal_tower', 'castle_style'],
    geometryTests: [
      (g) => hasConicalSection(g),
      (g) => g.facetCount > 6 && hasCircularFootprint(g),
    ],
    description: 'Turret or tower with conical/polygonal top',
    handling: [
      'Separate from main roof calculation',
      'Use cone/pyramid area formula',
      'Special flashing at base junction',
    ],
  },
  'sawtooth': {
    indicators: ['repeating_pattern', 'industrial_skylights', 'factory_roof'],
    geometryTests: [
      (g) => hasRepeatingRidgePattern(g),
      (g) => g.ridgeCount >= 3 && areRidgesParallel(g),
    ],
    description: 'Sawtooth industrial roof with repeating peaks',
    handling: [
      'Identify pattern repeat unit',
      'Calculate one section and multiply',
      'Account for glazing areas',
    ],
  },
  'clerestory': {
    indicators: ['raised_center_section', 'high_windows', 'split_level_ridge'],
    geometryTests: [
      (g) => g.heightLevels === 2 && hasCenterElevation(g),
    ],
    description: 'Clerestory with raised center section for windows',
    handling: [
      'Calculate lower and upper sections',
      'Measure vertical wall transition',
      'Include window headers in material calc',
    ],
  },
};

interface RoofGeometry {
  facetCount: number;
  ridgeCount: number;
  hipCount: number;
  valleyCount: number;
  pitches: number[];
  heightLevels: number;
  footprintVertices: { x: number; y: number }[];
  ridges: { start: { x: number; y: number }; end: { x: number; y: number } }[];
}

// Helper functions for geometry tests
function hasDualPitchPattern(g: RoofGeometry): boolean {
  if (g.pitches.length < 2) return false;
  const uniquePitches = [...new Set(g.pitches)];
  return uniquePitches.length >= 2 && 
    Math.max(...uniquePitches) - Math.min(...uniquePitches) >= 4;
}

function hasPerimeterSteepSlopes(g: RoofGeometry): boolean {
  // Check if outer facets have steeper pitch than center
  return g.pitches.some(p => p >= 12) && g.pitches.some(p => p <= 4);
}

function hasTriangularFacetPattern(g: RoofGeometry): boolean {
  // Geodesic domes have many small triangular facets
  return g.facetCount >= 20;
}

function isCenterValley(g: RoofGeometry): boolean {
  // Valley runs through center of footprint
  return g.valleyCount === 1;
}

function hasDisconnectedSections(g: RoofGeometry): boolean {
  return g.heightLevels >= 2;
}

function hasConicalSection(g: RoofGeometry): boolean {
  return g.facetCount >= 6;
}

function hasCircularFootprint(g: RoofGeometry): boolean {
  // Many vertices approximating a circle
  return g.footprintVertices.length >= 8;
}

function hasRepeatingRidgePattern(g: RoofGeometry): boolean {
  return g.ridgeCount >= 3;
}

function areRidgesParallel(g: RoofGeometry): boolean {
  if (g.ridges.length < 2) return false;
  // Simplified: check if ridges have similar angles
  return true;
}

function hasCenterElevation(g: RoofGeometry): boolean {
  return g.heightLevels >= 2;
}

/**
 * Detect edge cases in roof geometry
 */
export function detectEdgeCases(
  geometry: RoofGeometry,
  imageFeatures?: string[]
): EdgeCaseDetection {
  const detectedPatterns: EdgeCasePattern[] = [];
  const specialConsiderations: string[] = [];
  
  for (const [patternName, config] of Object.entries(EDGE_CASE_PATTERNS)) {
    let matchScore = 0;
    let totalTests = 0;
    
    // Check image feature indicators
    if (imageFeatures) {
      const indicatorMatches = config.indicators.filter(
        ind => imageFeatures.some(f => f.toLowerCase().includes(ind))
      );
      matchScore += indicatorMatches.length * 20;
      totalTests += config.indicators.length;
    }
    
    // Run geometry tests
    const passedTests = config.geometryTests.filter(test => {
      try {
        return test(geometry);
      } catch {
        return false;
      }
    });
    matchScore += passedTests.length * 30;
    totalTests += config.geometryTests.length;
    
    const confidence = totalTests > 0 ? Math.min(100, matchScore / (totalTests * 0.5)) : 0;
    
    if (confidence >= 50) {
      detectedPatterns.push({
        pattern: patternName,
        confidence,
        description: config.description,
        handlingNotes: config.handling,
      });
      specialConsiderations.push(...config.handling);
    }
  }
  
  // Determine recommended pipeline
  let recommendedPipeline: 'standard' | 'specialized' | 'manual' = 'standard';
  let confidenceAdjustment = 0;
  
  if (detectedPatterns.length > 0) {
    const maxConfidence = Math.max(...detectedPatterns.map(p => p.confidence));
    
    if (maxConfidence >= 80) {
      recommendedPipeline = 'specialized';
      confidenceAdjustment = -20;
    } else if (maxConfidence >= 60) {
      recommendedPipeline = 'specialized';
      confidenceAdjustment = -10;
    } else {
      confidenceAdjustment = -5;
    }
    
    // Multiple edge cases = likely manual review needed
    if (detectedPatterns.length >= 2) {
      recommendedPipeline = 'manual';
      confidenceAdjustment = -30;
    }
  }
  
  return {
    isEdgeCase: detectedPatterns.length > 0,
    detectedPatterns,
    recommendedPipeline,
    confidenceAdjustment,
    specialConsiderations: [...new Set(specialConsiderations)],
  };
}

/**
 * Get specialized handling instructions for detected edge case
 */
export function getEdgeCaseInstructions(pattern: string): {
  calculationMethod: string;
  verificationSteps: string[];
  commonErrors: string[];
} {
  const instructions: Record<string, {
    calculationMethod: string;
    verificationSteps: string[];
    commonErrors: string[];
  }> = {
    'gambrel': {
      calculationMethod: 'Split each side into upper and lower sections. Apply separate pitch factors to each.',
      verificationSteps: [
        'Identify transition line between upper and lower slopes',
        'Measure width of each section',
        'Apply 4/12 to upper section, 12/12 to lower section (typical)',
        'Sum areas with their respective pitch multipliers',
      ],
      commonErrors: [
        'Using single averaged pitch instead of dual calculation',
        'Missing the knee wall transition line',
        'Incorrect facet count (should be 4 or 6, not 2)',
      ],
    },
    'mansard': {
      calculationMethod: 'Calculate steep perimeter walls separately from flat/low-slope top.',
      verificationSteps: [
        'Identify steep wall sections (typically 70°+ or 18/12+)',
        'Measure perimeter length and wall height',
        'Calculate flat top area separately',
        'Check for dormers requiring additional calculation',
      ],
      commonErrors: [
        'Treating as simple hip roof',
        'Missing dormers in wall sections',
        'Incorrect steep section pitch estimation',
      ],
    },
    'geodesic_dome': {
      calculationMethod: 'Use spherical surface area formula: A = 2πr × h (for partial sphere)',
      verificationSteps: [
        'Estimate dome diameter from footprint',
        'Estimate dome height from imagery',
        'Calculate surface area using sphere segment formula',
        'Verify with approximate triangle count',
      ],
      commonErrors: [
        'Applying standard roof calculations to curved surface',
        'Incorrect height estimation',
        'Using flat footprint area instead of curved surface',
      ],
    },
    'multi_level_complex': {
      calculationMethod: 'Identify each separate roof section and calculate independently, then sum.',
      verificationSteps: [
        'Count distinct roof levels/sections',
        'Draw boundary for each section',
        'Calculate each with appropriate pitch',
        'Add step flashing linear footage',
      ],
      commonErrors: [
        'Missing a hidden or lower section',
        'Double-counting overlap areas',
        'Incorrect step flashing measurement',
      ],
    },
  };
  
  return instructions[pattern] || {
    calculationMethod: 'Requires specialized analysis - manual review recommended',
    verificationSteps: ['Review satellite imagery carefully', 'Consider requesting ground photos'],
    commonErrors: ['Applying standard calculations to non-standard roof type'],
  };
}

/**
 * Analyze image for visual edge case indicators
 */
export function analyzeImageForEdgeCases(
  imageAnalysis: {
    detectedShapes: string[];
    shadowPatterns: string[];
    colorVariations: string[];
    texturePatterns: string[];
  }
): string[] {
  const indicators: string[] = [];
  
  // Check for gambrel/mansard indicators
  if (imageAnalysis.shadowPatterns.includes('dual_angle_shadow') ||
      imageAnalysis.shadowPatterns.includes('knee_wall_shadow')) {
    indicators.push('dual_slope_per_side');
  }
  
  // Check for geodesic dome
  if (imageAnalysis.detectedShapes.includes('circular') &&
      imageAnalysis.texturePatterns.includes('triangular_grid')) {
    indicators.push('triangular_facets');
    indicators.push('curved_appearance');
  }
  
  // Check for sawtooth
  if (imageAnalysis.shadowPatterns.includes('repeating_triangular') ||
      imageAnalysis.detectedShapes.includes('parallel_ridges')) {
    indicators.push('repeating_pattern');
    indicators.push('industrial_skylights');
  }
  
  // Check for multi-level
  if (imageAnalysis.shadowPatterns.includes('multiple_shadow_heights') ||
      imageAnalysis.colorVariations.includes('distinct_roof_sections')) {
    indicators.push('multiple_heights');
    indicators.push('step_flashing');
  }
  
  return indicators;
}
