// =====================================================
// Phase 80: Property Type Classifier
// Specialized detection models for different building types
// =====================================================

export type PropertyType = 
  | 'residential_hip'
  | 'residential_gable'
  | 'residential_complex'
  | 'commercial_flat'
  | 'commercial_sloped'
  | 'industrial'
  | 'historic'
  | 'unknown';

export interface PropertyClassification {
  primaryType: PropertyType;
  confidence: number;
  secondaryType?: PropertyType;
  features: PropertyFeatures;
  recommendedModels: string[];
}

export interface PropertyFeatures {
  estimatedArea: number;
  roofComplexity: 'simple' | 'moderate' | 'complex';
  hasMultipleLevels: boolean;
  hasDormers: boolean;
  hasAttachedStructures: boolean;
  predominantShape: 'rectangular' | 'l-shaped' | 't-shaped' | 'irregular';
  buildingHeight: 'single_story' | 'two_story' | 'multi_story';
}

// Classification prompts for each property type
export const PROPERTY_TYPE_PROMPTS: Record<PropertyType, string> = {
  residential_hip: `
    You are analyzing a RESIDENTIAL HIP ROOF property.
    Hip roofs have slopes on all four sides that meet at a ridge.
    
    Key detection priorities:
    1. Identify all hip lines (diagonal lines from corners to ridge)
    2. Measure the main ridge line
    3. Calculate each facet separately
    4. Look for dormers or bump-outs
    
    Common characteristics:
    - 4 sloping sides
    - Rectangular or square footprint
    - Typical pitch range: 4/12 to 8/12
  `,
  
  residential_gable: `
    You are analyzing a RESIDENTIAL GABLE ROOF property.
    Gable roofs have two sloping sides that meet at a ridge.
    
    Key detection priorities:
    1. Identify the main ridge line
    2. Measure both rake edges accurately
    3. Calculate two main facet areas
    4. Look for gable end details
    
    Common characteristics:
    - 2 sloping sides
    - Triangular gable ends
    - Simple geometry
    - Typical pitch range: 4/12 to 12/12
  `,
  
  residential_complex: `
    You are analyzing a COMPLEX RESIDENTIAL ROOF property.
    Complex roofs have multiple roof sections, levels, and features.
    
    Key detection priorities:
    1. Break roof into distinct sections
    2. Identify all valleys and hips
    3. Measure each section independently
    4. Account for step flashing at transitions
    5. Identify all dormers and their types
    
    Common characteristics:
    - Multiple roof sections
    - Various pitches
    - Valleys and hips
    - Dormers and bump-outs
    - L, T, or irregular footprint
  `,
  
  commercial_flat: `
    You are analyzing a COMMERCIAL FLAT ROOF property.
    Flat roofs have minimal slope for drainage.
    
    Key detection priorities:
    1. Measure total roof area accurately
    2. Identify parapet walls
    3. Map HVAC units and penetrations
    4. Calculate drainage areas
    5. Note any rooftop equipment
    
    Common characteristics:
    - Near-zero pitch (<1/12)
    - Parapet walls
    - Multiple penetrations
    - Large uninterrupted areas
    - TPO/EPDM membrane systems
  `,
  
  commercial_sloped: `
    You are analyzing a COMMERCIAL SLOPED ROOF property.
    Commercial sloped roofs often have metal panels or built-up systems.
    
    Key detection priorities:
    1. Measure large facet areas
    2. Calculate pitch accurately
    3. Identify panel seams if visible
    4. Map gutters and drains
    5. Note any skylights
    
    Common characteristics:
    - Low to moderate pitch (1/12 to 4/12)
    - Metal panel or built-up roofing
    - Long ridge lines
    - Industrial appearance
  `,
  
  industrial: `
    You are analyzing an INDUSTRIAL ROOF property.
    Industrial roofs are large-scale with specialized features.
    
    Key detection priorities:
    1. Measure large area sections
    2. Identify different roof systems
    3. Map exhaust vents and equipment
    4. Calculate drainage zones
    5. Note any skylights or light wells
    
    Common characteristics:
    - Very large area
    - Multiple roof sections
    - Many penetrations
    - Specialized equipment
  `,
  
  historic: `
    You are analyzing a HISTORIC/UNIQUE ROOF property.
    Historic roofs have non-standard geometries.
    
    Key detection priorities:
    1. Identify roof type (mansard, gambrel, turret, etc.)
    2. Measure each unique section
    3. Account for complex curves if present
    4. Calculate decorative features
    5. Note restoration requirements
    
    Common characteristics:
    - Gambrel (barn-style)
    - Mansard (French)
    - Turrets and towers
    - Decorative elements
    - Non-standard pitches
  `,
  
  unknown: `
    You are analyzing a roof with UNKNOWN property type.
    Take a general approach and identify characteristics.
    
    Key detection priorities:
    1. Determine overall roof shape
    2. Measure total footprint
    3. Identify predominant pitch
    4. Count distinct roof sections
    5. Note any unusual features
  `,
};

// Property classifier class
export class PropertyTypeClassifier {
  // Classify property from image analysis
  async classifyProperty(
    footprintArea: number,
    aspectRatio: number,
    roofComplexity: number,
    buildingContext: {
      isResidential?: boolean;
      neighborhood?: string;
      yearBuilt?: number;
      stories?: number;
    }
  ): Promise<PropertyClassification> {
    // Determine primary type based on features
    let primaryType: PropertyType = 'unknown';
    let confidence = 0.5;
    const features: PropertyFeatures = {
      estimatedArea: footprintArea,
      roofComplexity: roofComplexity < 3 ? 'simple' : roofComplexity < 6 ? 'moderate' : 'complex',
      hasMultipleLevels: false,
      hasDormers: false,
      hasAttachedStructures: false,
      predominantShape: aspectRatio < 1.5 ? 'rectangular' : 'l-shaped',
      buildingHeight: buildingContext.stories === 1 ? 'single_story' : 
                      buildingContext.stories === 2 ? 'two_story' : 'multi_story',
    };
    
    // Classification logic
    if (buildingContext.isResidential !== false) {
      // Residential classification
      if (footprintArea < 4000) {
        if (roofComplexity < 3) {
          primaryType = aspectRatio > 1.8 ? 'residential_gable' : 'residential_hip';
          confidence = 0.8;
        } else {
          primaryType = 'residential_complex';
          confidence = 0.75;
        }
      } else {
        // Larger residential
        primaryType = 'residential_complex';
        confidence = 0.7;
      }
    } else {
      // Commercial classification
      if (footprintArea > 10000) {
        primaryType = 'industrial';
        confidence = 0.7;
      } else if (roofComplexity < 2) {
        primaryType = 'commercial_flat';
        confidence = 0.75;
      } else {
        primaryType = 'commercial_sloped';
        confidence = 0.7;
      }
    }
    
    // Historic detection
    if (buildingContext.yearBuilt && buildingContext.yearBuilt < 1920) {
      primaryType = 'historic';
      confidence = 0.65;
    }
    
    // Recommend models based on type
    const recommendedModels = this.getRecommendedModels(primaryType);
    
    return {
      primaryType,
      confidence,
      features,
      recommendedModels,
    };
  }
  
  private getRecommendedModels(type: PropertyType): string[] {
    switch (type) {
      case 'residential_hip':
      case 'residential_gable':
        return ['gemini-flash', 'gpt-4o-mini'];
      case 'residential_complex':
        return ['gemini-pro', 'gemini-flash', 'gpt-4o-mini'];
      case 'commercial_flat':
      case 'commercial_sloped':
      case 'industrial':
        return ['gemini-pro', 'gpt-4o'];
      case 'historic':
        return ['gemini-pro', 'gpt-4o', 'claude-3-opus'];
      default:
        return ['gemini-flash', 'gpt-4o-mini'];
    }
  }
  
  // Get specialized prompt for property type
  getPromptForType(type: PropertyType): string {
    return PROPERTY_TYPE_PROMPTS[type] || PROPERTY_TYPE_PROMPTS.unknown;
  }
  
  // Enhance base prompt with type-specific guidance
  enhancePrompt(basePrompt: string, classification: PropertyClassification): string {
    const typePrompt = this.getPromptForType(classification.primaryType);
    
    return `
${typePrompt}

Classification confidence: ${(classification.confidence * 100).toFixed(0)}%
Estimated area: ${classification.features.estimatedArea.toFixed(0)} sq ft
Complexity: ${classification.features.roofComplexity}
Shape: ${classification.features.predominantShape}

${basePrompt}
    `.trim();
  }
}

export default PropertyTypeClassifier;
