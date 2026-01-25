/**
 * Phase 26: Chimney & Obstruction Mapping System
 * Detects and maps all roof obstructions for accurate net area calculation
 * and flashing requirements.
 */

export interface ObstructionDetection {
  id: string;
  type: 'chimney' | 'vent' | 'pipe' | 'hvac' | 'skylight' | 'solar_panel' | 'satellite_dish' | 'turbine' | 'other';
  shape: 'rectangle' | 'circle' | 'polygon';
  centerLat: number;
  centerLng: number;
  widthFt: number;
  depthFt: number;
  areaSqFt: number;
  flashingPerimeterFt: number;
  flashingType: string;
  requiresCricket: boolean;
  cricketAreaSqFt: number;
  confidence: number;
}

export interface ObstructionMappingResult {
  obstructions: ObstructionDetection[];
  totalObstructionArea: number;
  netRoofArea: number;
  totalFlashingPerimeter: number;
  cricketCount: number;
  totalCricketArea: number;
  obstructionsByType: Map<string, number>;
}

/**
 * Obstruction type characteristics
 */
const OBSTRUCTION_SPECS = {
  chimney: {
    typicalWidth: { min: 2, max: 6 },
    typicalDepth: { min: 2, max: 6 },
    flashingType: 'step_and_counter',
    requiresCricketAbove: 30, // inches width
    shape: 'rectangle' as const
  },
  vent: {
    typicalWidth: { min: 0.5, max: 2 },
    typicalDepth: { min: 0.5, max: 2 },
    flashingType: 'pipe_boot',
    requiresCricketAbove: 999, // never
    shape: 'circle' as const
  },
  pipe: {
    typicalWidth: { min: 0.25, max: 1 },
    typicalDepth: { min: 0.25, max: 1 },
    flashingType: 'pipe_boot',
    requiresCricketAbove: 999,
    shape: 'circle' as const
  },
  hvac: {
    typicalWidth: { min: 2, max: 4 },
    typicalDepth: { min: 2, max: 4 },
    flashingType: 'curb_mount',
    requiresCricketAbove: 999,
    shape: 'rectangle' as const
  },
  skylight: {
    typicalWidth: { min: 2, max: 6 },
    typicalDepth: { min: 2, max: 8 },
    flashingType: 'integrated_kit',
    requiresCricketAbove: 48,
    shape: 'rectangle' as const
  },
  solar_panel: {
    typicalWidth: { min: 3, max: 4 },
    typicalDepth: { min: 5, max: 7 },
    flashingType: 'standoff_mount',
    requiresCricketAbove: 999,
    shape: 'rectangle' as const
  },
  satellite_dish: {
    typicalWidth: { min: 1.5, max: 3 },
    typicalDepth: { min: 1.5, max: 3 },
    flashingType: 'pipe_boot',
    requiresCricketAbove: 999,
    shape: 'circle' as const
  },
  turbine: {
    typicalWidth: { min: 1, max: 2 },
    typicalDepth: { min: 1, max: 2 },
    flashingType: 'turbine_base',
    requiresCricketAbove: 999,
    shape: 'circle' as const
  },
  other: {
    typicalWidth: { min: 0.5, max: 10 },
    typicalDepth: { min: 0.5, max: 10 },
    flashingType: 'custom',
    requiresCricketAbove: 36,
    shape: 'rectangle' as const
  }
};

/**
 * Generate AI prompt for obstruction detection
 */
export function getObstructionDetectionPrompt(): string {
  return `Analyze this satellite/aerial image of a roof and identify all obstructions/penetrations.

Look for these obstruction types:
1. CHIMNEYS - Large rectangular/square structures, often brick-colored, with shadows
2. PLUMBING VENTS - Small circular pipes, typically white or black, often in clusters
3. HVAC UNITS - Large rectangular boxes, often gray/silver metal
4. SKYLIGHTS - Rectangular glass/plastic surfaces, may reflect light differently
5. SOLAR PANELS - Dark rectangular panels in arrays, uniform pattern
6. SATELLITE DISHES - Circular dishes, typically on roof edge or near chimney
7. TURBINE VENTS - Round spinning vents, create circular shadows
8. OTHER - Any other penetrations or mounted equipment

For each obstruction, provide:
- Type classification
- Approximate center position
- Estimated width and depth in feet
- Shape (rectangle, circle, or polygon)
- Confidence level (0-1)

Return in JSON format:
{
  "obstructions": [
    {
      "type": "chimney|vent|pipe|hvac|skylight|solar_panel|satellite_dish|turbine|other",
      "centerPosition": {"lat": number, "lng": number},
      "widthFt": number,
      "depthFt": number,
      "shape": "rectangle|circle|polygon",
      "confidence": number
    }
  ],
  "solarPanelCount": number,
  "notes": "any observations"
}`;
}

/**
 * Calculate flashing requirements for an obstruction
 */
export function calculateFlashingRequirements(
  type: ObstructionDetection['type'],
  widthFt: number,
  depthFt: number,
  shape: 'rectangle' | 'circle' | 'polygon'
): {
  perimeterFt: number;
  flashingType: string;
  materialSqFt: number;
} {
  let perimeterFt: number;
  
  if (shape === 'circle') {
    // Diameter is the width
    perimeterFt = Math.PI * widthFt;
  } else {
    // Rectangle perimeter
    perimeterFt = 2 * (widthFt + depthFt);
  }
  
  const specs = OBSTRUCTION_SPECS[type];
  
  // Calculate material square footage (flashing extends beyond perimeter)
  const flashingExtension = 0.5; // 6 inches beyond obstruction
  let materialSqFt: number;
  
  if (shape === 'circle') {
    const radius = widthFt / 2;
    materialSqFt = Math.PI * Math.pow(radius + flashingExtension, 2) - Math.PI * radius * radius;
  } else {
    materialSqFt = perimeterFt * flashingExtension;
  }
  
  return {
    perimeterFt,
    flashingType: specs.flashingType,
    materialSqFt
  };
}

/**
 * Determine if obstruction requires a cricket
 */
export function requiresCricket(
  type: ObstructionDetection['type'],
  widthFt: number,
  roofPitch: string = '6/12'
): {
  required: boolean;
  cricketAreaSqFt: number;
} {
  const specs = OBSTRUCTION_SPECS[type];
  const widthInches = widthFt * 12;
  
  // Parse pitch
  const pitchMatch = roofPitch.match(/(\d+)\/12/);
  const pitchRatio = pitchMatch ? parseInt(pitchMatch[1]) / 12 : 0.5;
  
  // Crickets required for wide obstructions on steeper roofs
  if (widthInches >= specs.requiresCricketAbove && pitchRatio >= 0.25) {
    // Cricket dimensions: width matches obstruction, depth is typically 1/2 width
    const cricketDepth = widthFt / 2;
    const cricketArea = (widthFt * cricketDepth) / 2; // Triangle
    
    return {
      required: true,
      cricketAreaSqFt: cricketArea
    };
  }
  
  return {
    required: false,
    cricketAreaSqFt: 0
  };
}

/**
 * Calculate net roofing area (total minus obstructions)
 */
export function calculateNetRoofArea(
  totalAreaSqFt: number,
  obstructions: ObstructionDetection[]
): {
  netArea: number;
  deductedArea: number;
  deductionPct: number;
} {
  const deductedArea = obstructions.reduce((sum, obs) => sum + obs.areaSqFt, 0);
  const netArea = totalAreaSqFt - deductedArea;
  const deductionPct = (deductedArea / totalAreaSqFt) * 100;
  
  return {
    netArea,
    deductedArea,
    deductionPct
  };
}

/**
 * Classify obstruction from AI detection
 */
export function classifyObstruction(
  detection: any
): { type: ObstructionDetection['type']; confidence: number } {
  const width = detection.widthFt || 1;
  const depth = detection.depthFt || 1;
  const shape = detection.shape || 'rectangle';
  
  // Type from AI
  if (detection.type && OBSTRUCTION_SPECS[detection.type as keyof typeof OBSTRUCTION_SPECS]) {
    return {
      type: detection.type as ObstructionDetection['type'],
      confidence: detection.confidence || 0.7
    };
  }
  
  // Infer from size and shape
  if (shape === 'circle') {
    if (width < 0.5) return { type: 'pipe', confidence: 0.8 };
    if (width < 2) return { type: 'vent', confidence: 0.75 };
    if (width < 3) return { type: 'turbine', confidence: 0.6 };
    return { type: 'satellite_dish', confidence: 0.5 };
  }
  
  // Rectangle/polygon
  if (width > 3 && depth > 5 && width / depth < 1) {
    return { type: 'solar_panel', confidence: 0.7 };
  }
  if (width >= 2 && width <= 6 && Math.abs(width - depth) < 2) {
    return { type: 'chimney', confidence: 0.65 };
  }
  if (width > 2 && depth > 2 && width <= 4) {
    return { type: 'hvac', confidence: 0.6 };
  }
  if (width >= 2 && depth >= 2) {
    return { type: 'skylight', confidence: 0.55 };
  }
  
  return { type: 'other', confidence: 0.4 };
}

/**
 * Main obstruction detection and mapping function
 */
export function detectRoofObstructions(
  aiDetections: any[],
  totalRoofArea: number,
  roofPitch: string = '6/12'
): ObstructionMappingResult {
  const obstructions: ObstructionDetection[] = [];
  let totalObstructionArea = 0;
  let totalFlashingPerimeter = 0;
  let cricketCount = 0;
  let totalCricketArea = 0;
  const obstructionsByType = new Map<string, number>();
  
  for (let i = 0; i < aiDetections.length; i++) {
    const detection = aiDetections[i];
    
    // Classify
    const { type, confidence } = classifyObstruction(detection);
    
    // Dimensions
    const widthFt = detection.widthFt || OBSTRUCTION_SPECS[type].typicalWidth.min * 1.5;
    const depthFt = detection.depthFt || OBSTRUCTION_SPECS[type].typicalDepth.min * 1.5;
    const shape = detection.shape || OBSTRUCTION_SPECS[type].shape;
    
    // Calculate area
    let areaSqFt: number;
    if (shape === 'circle') {
      areaSqFt = Math.PI * Math.pow(widthFt / 2, 2);
    } else {
      areaSqFt = widthFt * depthFt;
    }
    
    // Flashing requirements
    const flashing = calculateFlashingRequirements(type, widthFt, depthFt, shape);
    
    // Cricket check
    const cricket = requiresCricket(type, widthFt, roofPitch);
    
    const obstruction: ObstructionDetection = {
      id: `obs_${i}`,
      type,
      shape,
      centerLat: detection.centerPosition?.lat || 0,
      centerLng: detection.centerPosition?.lng || 0,
      widthFt,
      depthFt,
      areaSqFt,
      flashingPerimeterFt: flashing.perimeterFt,
      flashingType: flashing.flashingType,
      requiresCricket: cricket.required,
      cricketAreaSqFt: cricket.cricketAreaSqFt,
      confidence
    };
    
    obstructions.push(obstruction);
    totalObstructionArea += areaSqFt;
    totalFlashingPerimeter += flashing.perimeterFt;
    
    if (cricket.required) {
      cricketCount++;
      totalCricketArea += cricket.cricketAreaSqFt;
    }
    
    // Count by type
    obstructionsByType.set(type, (obstructionsByType.get(type) || 0) + 1);
  }
  
  return {
    obstructions,
    totalObstructionArea,
    netRoofArea: totalRoofArea - totalObstructionArea,
    totalFlashingPerimeter,
    cricketCount,
    totalCricketArea,
    obstructionsByType
  };
}

/**
 * Generate material list for obstruction flashing
 */
export function generateFlashingMaterialList(
  obstructions: ObstructionDetection[]
): { item: string; quantity: number; unit: string }[] {
  const materials: Map<string, number> = new Map();
  
  for (const obs of obstructions) {
    const key = obs.flashingType;
    const qty = materials.get(key) || 0;
    
    switch (obs.flashingType) {
      case 'pipe_boot':
        materials.set('pipe_boot', qty + 1);
        break;
      case 'step_and_counter':
        // Linear feet of step flashing
        materials.set('step_flashing_lf', (materials.get('step_flashing_lf') || 0) + obs.flashingPerimeterFt);
        break;
      case 'curb_mount':
        materials.set('curb_flashing_kit', qty + 1);
        break;
      case 'integrated_kit':
        materials.set('skylight_flashing_kit', qty + 1);
        break;
      case 'turbine_base':
        materials.set('turbine_base', qty + 1);
        break;
      default:
        materials.set('custom_flashing_sqft', (materials.get('custom_flashing_sqft') || 0) + obs.flashingPerimeterFt * 0.5);
    }
  }
  
  return Array.from(materials.entries()).map(([item, quantity]) => ({
    item,
    quantity,
    unit: item.includes('lf') ? 'linear feet' : item.includes('sqft') ? 'sq ft' : 'each'
  }));
}
