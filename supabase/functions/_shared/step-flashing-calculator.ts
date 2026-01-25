/**
 * Phase 28: Step Flashing Length Calculator
 * Accurately calculates step flashing requirements where roof meets vertical walls.
 */

export interface WallRoofIntersection {
  id: string;
  type: 'sidewall' | 'headwall' | 'endwall' | 'counter' | 'apron';
  lengthFt: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  pitchAtIntersection: string;
  flashingHeightInches: number;
  materialSqFt: number;
  confidence: number;
}

export interface StepFlashingResult {
  intersections: WallRoofIntersection[];
  totalSidewallFt: number;
  totalHeadwallFt: number;
  totalCounterFlashingFt: number;
  totalApronFt: number;
  totalMaterialSqFt: number;
  stepFlashingPieces: number;
}

const EARTH_RADIUS_FT = 20902231;

function haversineDistanceFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 + 
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  return 2 * EARTH_RADIUS_FT * Math.asin(Math.sqrt(a));
}

/**
 * Standard step flashing dimensions
 */
const FLASHING_SPECS = {
  stepFlashing: {
    standardLength: 0.833, // 10 inches per piece
    heightInches: 4,
    legInches: 4,
    overlapInches: 3
  },
  counterFlashing: {
    heightInches: 5,
    legInches: 3
  },
  apron: {
    heightInches: 6,
    legInches: 4
  },
  headwall: {
    heightInches: 5,
    legInches: 4
  }
};

/**
 * Generate AI prompt for wall-roof intersection detection
 */
export function getWallIntersectionPrompt(): string {
  return `Analyze this satellite/aerial image to detect where the roof meets vertical walls.

Look for these intersection types:
1. SIDEWALL - Where sloped roof meets vertical wall running parallel to slope (requires step flashing)
2. HEADWALL - Where lower roof meets upper wall perpendicular to slope (requires continuous flashing)
3. ENDWALL - Where roof terminates against vertical wall at gable end
4. CHIMNEY WALLS - Where roof meets chimney on all sides

Detection tips:
- Look for shadow lines where roof meets walls
- Two-story sections create sidewall conditions on lower roof
- Dormers create headwall at back and sidewalls on sides
- Changes in roof elevation indicate wall intersections

For each intersection, provide:
- Type classification
- Start and end positions
- Approximate length
- Which side of intersection is higher

Return in JSON format:
{
  "intersections": [
    {
      "type": "sidewall|headwall|endwall|counter|apron",
      "startLat": number,
      "startLng": number,
      "endLat": number,
      "endLng": number,
      "lengthFt": number,
      "upperSide": "left|right|above|below",
      "confidence": number
    }
  ],
  "chimneyCount": number,
  "twoStoryTransitions": number,
  "notes": "observations"
}`;
}

/**
 * Detect wall-roof intersections from imagery analysis
 */
export function detectWallRoofIntersections(
  aiDetections: any[],
  roofPitch: string = '6/12'
): WallRoofIntersection[] {
  const intersections: WallRoofIntersection[] = [];
  
  for (let i = 0; i < aiDetections.length; i++) {
    const detection = aiDetections[i];
    
    const lengthFt = detection.lengthFt || haversineDistanceFt(
      detection.startLat || 0,
      detection.startLng || 0,
      detection.endLat || 0,
      detection.endLng || 0
    );
    
    // Calculate material requirements
    const flashingHeight = getFlashingHeight(detection.type || 'sidewall');
    const materialSqFt = calculateFlashingMaterial(
      detection.type || 'sidewall',
      lengthFt,
      flashingHeight
    );
    
    intersections.push({
      id: `intersection_${i}`,
      type: detection.type || 'sidewall',
      lengthFt,
      startLat: detection.startLat || 0,
      startLng: detection.startLng || 0,
      endLat: detection.endLat || 0,
      endLng: detection.endLng || 0,
      pitchAtIntersection: roofPitch,
      flashingHeightInches: flashingHeight,
      materialSqFt,
      confidence: detection.confidence || 0.7
    });
  }
  
  return intersections;
}

/**
 * Get flashing height for intersection type
 */
function getFlashingHeight(type: WallRoofIntersection['type']): number {
  switch (type) {
    case 'sidewall':
      return FLASHING_SPECS.stepFlashing.heightInches;
    case 'headwall':
      return FLASHING_SPECS.headwall.heightInches;
    case 'counter':
      return FLASHING_SPECS.counterFlashing.heightInches;
    case 'apron':
      return FLASHING_SPECS.apron.heightInches;
    case 'endwall':
      return FLASHING_SPECS.stepFlashing.heightInches;
    default:
      return 4;
  }
}

/**
 * Calculate step flashing length based on pitch and run
 */
export function calculateStepFlashingLength(
  horizontalRunFt: number,
  pitchStr: string
): number {
  // Parse pitch
  const match = pitchStr.match(/(\d+)\/12/);
  const pitchRatio = match ? parseInt(match[1]) / 12 : 0.5;
  
  // Actual length along slope
  const slopeMultiplier = Math.sqrt(1 + pitchRatio * pitchRatio);
  return horizontalRunFt * slopeMultiplier;
}

/**
 * Calculate number of step flashing pieces needed
 */
export function calculateStepFlashingPieces(lengthFt: number): number {
  const specs = FLASHING_SPECS.stepFlashing;
  const effectiveLength = specs.standardLength - (specs.overlapInches / 12);
  return Math.ceil(lengthFt / effectiveLength);
}

/**
 * Calculate flashing material square footage
 */
function calculateFlashingMaterial(
  type: WallRoofIntersection['type'],
  lengthFt: number,
  heightInches: number
): number {
  const heightFt = heightInches / 12;
  const legFt = 4 / 12; // Standard 4-inch leg
  
  // Total material width (height + leg)
  const totalWidthFt = heightFt + legFt;
  
  // Add waste factor
  const wasteFactor = 1.1;
  
  return lengthFt * totalWidthFt * wasteFactor;
}

/**
 * Calculate counter flashing requirements
 */
export function calculateCounterFlashingLength(
  intersectionLength: number,
  cornersCount: number = 0
): {
  linearFt: number;
  cornerPieces: number;
  materialSqFt: number;
} {
  const specs = FLASHING_SPECS.counterFlashing;
  const heightFt = specs.heightInches / 12;
  const legFt = specs.legInches / 12;
  
  return {
    linearFt: intersectionLength,
    cornerPieces: cornersCount,
    materialSqFt: intersectionLength * (heightFt + legFt) * 1.1 // 10% waste
  };
}

/**
 * Classify intersection type from geometry
 */
export function classifyIntersectionType(
  roofEdgeAngle: number, // degrees from north
  wallAngle: number,
  roofPitch: string
): WallRoofIntersection['type'] {
  // Angle between roof edge and wall
  const angleDiff = Math.abs(roofEdgeAngle - wallAngle);
  const normalizedDiff = Math.min(angleDiff, 180 - angleDiff);
  
  // Parse pitch for additional context
  const match = roofPitch.match(/(\d+)\/12/);
  const pitchRatio = match ? parseInt(match[1]) / 12 : 0.5;
  
  if (normalizedDiff < 15) {
    // Wall nearly parallel to roof slope direction = sidewall
    return 'sidewall';
  } else if (normalizedDiff > 75 && normalizedDiff < 105) {
    // Wall perpendicular to slope = headwall or apron
    // Apron is at bottom (water flows toward it)
    return 'headwall';
  } else {
    // Angled intersection
    return 'endwall';
  }
}

/**
 * Main step flashing calculation function
 */
export function calculateStepFlashing(
  aiDetections: any[],
  roofPitch: string = '6/12'
): StepFlashingResult {
  const intersections = detectWallRoofIntersections(aiDetections, roofPitch);
  
  let totalSidewallFt = 0;
  let totalHeadwallFt = 0;
  let totalCounterFlashingFt = 0;
  let totalApronFt = 0;
  let totalMaterialSqFt = 0;
  let totalStepPieces = 0;
  
  for (const intersection of intersections) {
    totalMaterialSqFt += intersection.materialSqFt;
    
    switch (intersection.type) {
      case 'sidewall':
        totalSidewallFt += intersection.lengthFt;
        totalStepPieces += calculateStepFlashingPieces(intersection.lengthFt);
        // Sidewalls also need counter flashing
        totalCounterFlashingFt += intersection.lengthFt;
        break;
      case 'headwall':
        totalHeadwallFt += intersection.lengthFt;
        break;
      case 'counter':
        totalCounterFlashingFt += intersection.lengthFt;
        break;
      case 'apron':
        totalApronFt += intersection.lengthFt;
        break;
      case 'endwall':
        // Treat similar to sidewall
        totalSidewallFt += intersection.lengthFt;
        totalStepPieces += calculateStepFlashingPieces(intersection.lengthFt);
        break;
    }
  }
  
  return {
    intersections,
    totalSidewallFt,
    totalHeadwallFt,
    totalCounterFlashingFt,
    totalApronFt,
    totalMaterialSqFt,
    stepFlashingPieces: totalStepPieces
  };
}

/**
 * Generate step flashing material list
 */
export function generateStepFlashingMaterialList(
  result: StepFlashingResult
): { item: string; quantity: number; unit: string; notes: string }[] {
  const materials: { item: string; quantity: number; unit: string; notes: string }[] = [];
  
  if (result.stepFlashingPieces > 0) {
    materials.push({
      item: 'Step flashing pieces (4" x 4" x 10")',
      quantity: result.stepFlashingPieces,
      unit: 'pieces',
      notes: 'For sidewall/endwall intersections'
    });
  }
  
  if (result.totalCounterFlashingFt > 0) {
    materials.push({
      item: 'Counter flashing',
      quantity: Math.ceil(result.totalCounterFlashingFt / 10),
      unit: 'pieces (10ft)',
      notes: 'Reglet or surface-mounted'
    });
  }
  
  if (result.totalHeadwallFt > 0) {
    materials.push({
      item: 'Headwall flashing',
      quantity: Math.ceil(result.totalHeadwallFt / 10),
      unit: 'pieces (10ft)',
      notes: 'Continuous L-shaped flashing'
    });
  }
  
  if (result.totalApronFt > 0) {
    materials.push({
      item: 'Apron flashing',
      quantity: Math.ceil(result.totalApronFt / 10),
      unit: 'pieces (10ft)',
      notes: 'For bottom of walls'
    });
  }
  
  // Sealant
  materials.push({
    item: 'Flashing sealant',
    quantity: Math.ceil((result.totalSidewallFt + result.totalHeadwallFt) / 20),
    unit: 'tubes',
    notes: 'Urethane or silicone based'
  });
  
  // Roofing cement
  materials.push({
    item: 'Roofing cement',
    quantity: Math.ceil(result.totalMaterialSqFt / 100),
    unit: 'gallons',
    notes: 'For sealing step flashing'
  });
  
  return materials;
}
