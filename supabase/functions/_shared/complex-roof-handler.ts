// =====================================================
// Phase 95: Complex Roof Handler
// Specialized handling for non-standard roof types
// =====================================================

export type ComplexRoofType = 
  | 'gambrel'
  | 'mansard'
  | 'geodesic'
  | 'butterfly'
  | 'sawtooth'
  | 'a_frame'
  | 'barrel'
  | 'bonnet'
  | 'dutch_gable'
  | 'jerkinhead';

export interface ComplexRoofAnalysis {
  roofType: ComplexRoofType;
  confidence: number;
  characteristics: RoofCharacteristics;
  measurementAdjustments: MeasurementAdjustments;
  specialConsiderations: string[];
  estimatingNotes: string[];
}

export interface RoofCharacteristics {
  hasMultiplePitches: boolean;
  pitchCount: number;
  pitches: PitchInfo[];
  hasCurvedSections: boolean;
  hasVerticalWalls: boolean;
  symmetry: 'symmetric' | 'asymmetric' | 'none';
  complexity: 'high' | 'very_high' | 'extreme';
}

export interface PitchInfo {
  pitch: string;
  pitchDegrees: number;
  approximateArea: number;
  location: 'upper' | 'lower' | 'main' | 'dormer';
}

export interface MeasurementAdjustments {
  areaMultiplier: number;
  wasteFactorAdjustment: number;
  laborDifficultyMultiplier: number;
  materialTypeRecommendation: string;
  specialEquipmentRequired: boolean;
}

// Detection patterns for complex roof types
const COMPLEX_ROOF_PATTERNS: Record<ComplexRoofType, {
  description: string;
  detectionPrompt: string;
  pitchPattern: string;
  wasteFactorBase: number;
  laborMultiplier: number;
}> = {
  gambrel: {
    description: 'Barn-style roof with two pitches on each side - steep lower, shallow upper',
    detectionPrompt: `
      Look for GAMBREL (barn-style) roof characteristics:
      1. Two distinct slopes on each side of the ridge
      2. Lower slope is steeper (typically 60-70°)
      3. Upper slope is shallower (typically 20-30°)
      4. Creates "barn-like" profile
      5. Often has dormer windows
    `,
    pitchPattern: 'steep-lower, shallow-upper',
    wasteFactorBase: 15,
    laborMultiplier: 1.4,
  },
  mansard: {
    description: 'French-style roof with steep sides and flat or low-pitched top',
    detectionPrompt: `
      Look for MANSARD (French) roof characteristics:
      1. Four sides all have two slopes
      2. Lower slope is nearly vertical (70-80°)
      3. Upper slope is almost flat or very low pitch
      4. Creates usable attic/floor space
      5. Often has dormer windows in lower slope
    `,
    pitchPattern: 'near-vertical lower, flat upper',
    wasteFactorBase: 18,
    laborMultiplier: 1.6,
  },
  geodesic: {
    description: 'Dome-shaped roof made of triangular facets',
    detectionPrompt: `
      Look for GEODESIC DOME roof characteristics:
      1. Spherical or hemispherical shape
      2. Made of many triangular facets
      3. No traditional ridge or hip lines
      4. Framework visible as triangular pattern
      5. Unusual architectural structure
    `,
    pitchPattern: 'variable-continuous',
    wasteFactorBase: 25,
    laborMultiplier: 2.5,
  },
  butterfly: {
    description: 'Inverted V-shape with two surfaces angling down toward center',
    detectionPrompt: `
      Look for BUTTERFLY roof characteristics:
      1. Two surfaces slope INWARD toward center
      2. Valley in the middle (not ridge)
      3. Higher at edges, lower in center
      4. Modern/contemporary design
      5. Requires special drainage
    `,
    pitchPattern: 'inverted-v',
    wasteFactorBase: 15,
    laborMultiplier: 1.5,
  },
  sawtooth: {
    description: 'Industrial roof with alternating slopes, one vertical for windows',
    detectionPrompt: `
      Look for SAWTOOTH roof characteristics:
      1. Repeated pattern of two different slopes
      2. One slope is vertical or near-vertical (often glass)
      3. Creates "teeth" profile from side view
      4. Typically on industrial buildings
      5. Designed for north-facing skylights
    `,
    pitchPattern: 'repeated-asymmetric',
    wasteFactorBase: 20,
    laborMultiplier: 1.8,
  },
  a_frame: {
    description: 'Roof extends from near ground to peak, forming walls and roof as one',
    detectionPrompt: `
      Look for A-FRAME roof characteristics:
      1. Roof extends from ground (or near ground) to peak
      2. Very steep pitch (typically 45-60°)
      3. Roof IS the walls of the building
      4. Triangular profile
      5. Often on cabins or vacation homes
    `,
    pitchPattern: 'extreme-steep',
    wasteFactorBase: 12,
    laborMultiplier: 1.4,
  },
  barrel: {
    description: 'Curved/rounded roof like half a cylinder',
    detectionPrompt: `
      Look for BARREL (curved) roof characteristics:
      1. Continuously curved surface
      2. No distinct ridge line
      3. Semicircular or arched profile
      4. May have metal standing seam
      5. Smooth rounded appearance
    `,
    pitchPattern: 'continuous-curve',
    wasteFactorBase: 22,
    laborMultiplier: 2.0,
  },
  bonnet: {
    description: 'Hip roof with lower slope extending beyond walls, like a porch roof attached',
    detectionPrompt: `
      Look for BONNET roof characteristics:
      1. Upper section is standard hip
      2. Lower section flares out at gentler slope
      3. Creates covered porch/overhang
      4. "Double slope" appearance
      5. French Colonial or Creole style
    `,
    pitchPattern: 'steep-upper, gentle-lower',
    wasteFactorBase: 14,
    laborMultiplier: 1.3,
  },
  dutch_gable: {
    description: 'Hip roof with gable at the top (combining hip and gable)',
    detectionPrompt: `
      Look for DUTCH GABLE roof characteristics:
      1. Hip roof at bottom section
      2. Gable "mini-roof" at top/peak
      3. Combination hip-gable style
      4. Often has decorative gable end
      5. Traditional European style
    `,
    pitchPattern: 'hip-with-gable-top',
    wasteFactorBase: 16,
    laborMultiplier: 1.5,
  },
  jerkinhead: {
    description: 'Gable roof with clipped/hipped ends',
    detectionPrompt: `
      Look for JERKINHEAD (clipped gable) roof characteristics:
      1. Primarily gable roof
      2. Gable ends are "clipped" at top
      3. Creates small hip at peak of gable
      4. Reduces wind vulnerability
      5. Also called "clipped gable"
    `,
    pitchPattern: 'gable-with-clipped-ends',
    wasteFactorBase: 13,
    laborMultiplier: 1.25,
  },
};

export class ComplexRoofHandler {
  // Detect complex roof type from characteristics
  detectComplexRoofType(
    pitches: PitchInfo[],
    hasVerticalSections: boolean,
    hasCurvedSections: boolean,
    facetCount: number,
    buildingProfile?: 'triangular' | 'rectangular' | 'rounded' | 'irregular'
  ): { type: ComplexRoofType | null; confidence: number } {
    // Check for geodesic (many triangular facets)
    if (facetCount > 20 && buildingProfile === 'rounded') {
      return { type: 'geodesic', confidence: 0.8 };
    }
    
    // Check for barrel (curved sections)
    if (hasCurvedSections) {
      return { type: 'barrel', confidence: 0.75 };
    }
    
    // Check for A-frame (extreme pitch, triangular)
    if (buildingProfile === 'triangular' && pitches.some(p => p.pitchDegrees > 50)) {
      return { type: 'a_frame', confidence: 0.85 };
    }
    
    // Check for mansard/gambrel (multiple pitches per side)
    if (pitches.length >= 4) {
      const upperPitches = pitches.filter(p => p.location === 'upper');
      const lowerPitches = pitches.filter(p => p.location === 'lower');
      
      if (upperPitches.length > 0 && lowerPitches.length > 0) {
        const avgUpperPitch = upperPitches.reduce((s, p) => s + p.pitchDegrees, 0) / upperPitches.length;
        const avgLowerPitch = lowerPitches.reduce((s, p) => s + p.pitchDegrees, 0) / lowerPitches.length;
        
        // Mansard has near-vertical lower and flat upper
        if (avgLowerPitch > 65 && avgUpperPitch < 20) {
          return { type: 'mansard', confidence: 0.8 };
        }
        
        // Gambrel has steep lower and moderate upper
        if (avgLowerPitch > 55 && avgUpperPitch < 35 && avgUpperPitch > 15) {
          return { type: 'gambrel', confidence: 0.8 };
        }
        
        // Bonnet has steep upper and gentle lower
        if (avgUpperPitch > avgLowerPitch && avgLowerPitch < 20) {
          return { type: 'bonnet', confidence: 0.7 };
        }
      }
    }
    
    // Check for butterfly (inverted pattern)
    // Would need valley-at-center detection
    
    return { type: null, confidence: 0 };
  }

  // Analyze complex roof and provide handling guidance
  analyzeComplexRoof(
    roofType: ComplexRoofType,
    baseMeasurements: {
      totalArea: number;
      ridgeLength: number;
      valleyLength: number;
      facetCount: number;
    }
  ): ComplexRoofAnalysis {
    const pattern = COMPLEX_ROOF_PATTERNS[roofType];
    
    // Calculate adjusted measurements
    const adjustments = this.calculateAdjustments(roofType, baseMeasurements);
    
    // Build characteristics
    const characteristics: RoofCharacteristics = {
      hasMultiplePitches: ['gambrel', 'mansard', 'bonnet'].includes(roofType),
      pitchCount: this.estimatePitchCount(roofType),
      pitches: [],
      hasCurvedSections: ['geodesic', 'barrel'].includes(roofType),
      hasVerticalWalls: ['mansard', 'sawtooth'].includes(roofType),
      symmetry: this.getSymmetry(roofType),
      complexity: this.getComplexity(roofType),
    };
    
    // Special considerations
    const specialConsiderations = this.getSpecialConsiderations(roofType);
    
    // Estimating notes
    const estimatingNotes = this.getEstimatingNotes(roofType, adjustments);
    
    return {
      roofType,
      confidence: 0.8,
      characteristics,
      measurementAdjustments: adjustments,
      specialConsiderations,
      estimatingNotes,
    };
  }

  private calculateAdjustments(
    roofType: ComplexRoofType,
    measurements: any
  ): MeasurementAdjustments {
    const pattern = COMPLEX_ROOF_PATTERNS[roofType];
    
    return {
      areaMultiplier: this.getAreaMultiplier(roofType),
      wasteFactorAdjustment: pattern.wasteFactorBase,
      laborDifficultyMultiplier: pattern.laborMultiplier,
      materialTypeRecommendation: this.getMaterialRecommendation(roofType),
      specialEquipmentRequired: pattern.laborMultiplier > 1.5,
    };
  }

  private getAreaMultiplier(roofType: ComplexRoofType): number {
    switch (roofType) {
      case 'geodesic':
        return 1.15; // Triangular facets have some overlap
      case 'barrel':
        return 1.1; // Curved surface is slightly longer
      case 'mansard':
        return 1.2; // Vertical walls add area
      default:
        return 1.0;
    }
  }

  private getMaterialRecommendation(roofType: ComplexRoofType): string {
    switch (roofType) {
      case 'geodesic':
        return 'Specialty panels or single-ply membrane';
      case 'barrel':
        return 'Standing seam metal or single-ply membrane';
      case 'mansard':
        return 'Architectural shingles or slate/tile for vertical sections';
      case 'sawtooth':
        return 'Metal panels with integrated glazing';
      default:
        return 'Consult with manufacturer for specialty application';
    }
  }

  private estimatePitchCount(roofType: ComplexRoofType): number {
    switch (roofType) {
      case 'gambrel':
      case 'mansard':
        return 4; // Two per side
      case 'geodesic':
        return 20; // Many varied pitches
      default:
        return 2;
    }
  }

  private getSymmetry(roofType: ComplexRoofType): 'symmetric' | 'asymmetric' | 'none' {
    switch (roofType) {
      case 'gambrel':
      case 'mansard':
      case 'geodesic':
      case 'a_frame':
        return 'symmetric';
      case 'sawtooth':
      case 'butterfly':
        return 'asymmetric';
      default:
        return 'none';
    }
  }

  private getComplexity(roofType: ComplexRoofType): 'high' | 'very_high' | 'extreme' {
    switch (roofType) {
      case 'geodesic':
        return 'extreme';
      case 'mansard':
      case 'barrel':
      case 'sawtooth':
        return 'very_high';
      default:
        return 'high';
    }
  }

  private getSpecialConsiderations(roofType: ComplexRoofType): string[] {
    const considerations: string[] = [];
    
    switch (roofType) {
      case 'gambrel':
        considerations.push('Transition flashing required at pitch change');
        considerations.push('Consider ice dam prevention at lower slope');
        break;
      case 'mansard':
        considerations.push('Vertical sections may require wall cladding material');
        considerations.push('Special flashing at pitch transitions');
        considerations.push('Dormer integration typically required');
        break;
      case 'geodesic':
        considerations.push('Specialty contractor may be required');
        considerations.push('Custom panel fabrication likely needed');
        considerations.push('Standard measurement methods may not apply');
        break;
      case 'butterfly':
        considerations.push('Central valley drainage is critical');
        considerations.push('Waterproofing at low point essential');
        break;
      case 'barrel':
        considerations.push('Curved panels or flexible membrane required');
        considerations.push('Specialty installation skills needed');
        break;
    }
    
    return considerations;
  }

  private getEstimatingNotes(
    roofType: ComplexRoofType,
    adjustments: MeasurementAdjustments
  ): string[] {
    const notes: string[] = [];
    
    notes.push(`Apply ${adjustments.wasteFactorAdjustment}% waste factor (vs. standard 10%)`);
    notes.push(`Labor difficulty multiplier: ${adjustments.laborDifficultyMultiplier}x`);
    
    if (adjustments.specialEquipmentRequired) {
      notes.push('Include staging/scaffolding for difficult access');
    }
    
    notes.push(`Recommended material: ${adjustments.materialTypeRecommendation}`);
    
    return notes;
  }

  // Get detection prompt for AI model
  getDetectionPrompt(roofType: ComplexRoofType): string {
    return COMPLEX_ROOF_PATTERNS[roofType]?.detectionPrompt || '';
  }
}

export default ComplexRoofHandler;
