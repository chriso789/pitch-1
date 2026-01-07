/**
 * Structure Analyzer
 * 
 * AI-powered analysis to detect:
 * - Driveway/garage location for house orientation
 * - L/T/U-shaped footprints with multiple wings
 * - Screen enclosures to exclude from measurements
 * - Primary ridge direction based on shape
 */

export interface StructureAnalysis {
  houseOrientation: {
    frontFacing: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' | 'unknown';
    drivewayPosition: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' | 'unknown';
    garagePosition: 'front-left' | 'front-right' | 'side-left' | 'side-right' | 'attached-side' | 'detached' | 'none' | 'unknown';
    confidence: number;
  };
  footprintShape: 'rectangular' | 'L-shaped' | 'T-shaped' | 'U-shaped' | 'H-shaped' | 'complex';
  mainStructure: {
    bounds: { minX: number; minY: number; maxX: number; maxY: number }; // Percent of image
    ridgeDirection: 'east-west' | 'north-south';
    estimatedWidthFt: number;
    estimatedDepthFt: number;
  };
  extensions: Array<{
    type: 'garage-wing' | 'bedroom-wing' | 'sunroom' | 'porch' | 'addition' | 'unknown';
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    attachmentSide: 'N' | 'S' | 'E' | 'W';
    ridgeDirection: 'east-west' | 'north-south';
  }>;
  exclusions: Array<{
    type: 'screen-enclosure' | 'pool-cage' | 'patio-cover' | 'carport' | 'detached-structure';
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    estimatedAreaSqft: number;
  }>;
  ridgeTopology: {
    primaryRidgeCount: number;
    hasMultipleRidgeDirections: boolean;
    junctionPoints: number;
  };
  overallConfidence: 'high' | 'medium' | 'low';
}

export interface SolarSegmentOrientation {
  primaryRidgeDirection: 'east-west' | 'north-south';
  hasMultipleRidges: boolean;
  segmentGroups: {
    north: { count: number; totalArea: number };
    south: { count: number; totalArea: number };
    east: { count: number; totalArea: number };
    west: { count: number; totalArea: number };
  };
  suggestedShape: 'rectangular' | 'L-shaped' | 'T-shaped' | 'complex';
  confidence: number;
}

/**
 * Analyze Solar API segments to determine ridge orientation and shape
 */
export function analyzeSegmentOrientation(
  segments: Array<{ azimuthDegrees: number; areaMeters2?: number }>
): SolarSegmentOrientation {
  if (!segments || segments.length === 0) {
    return {
      primaryRidgeDirection: 'east-west',
      hasMultipleRidges: false,
      segmentGroups: { north: { count: 0, totalArea: 0 }, south: { count: 0, totalArea: 0 }, east: { count: 0, totalArea: 0 }, west: { count: 0, totalArea: 0 } },
      suggestedShape: 'rectangular',
      confidence: 0
    };
  }
  
  // Group segments by cardinal direction
  const groups = {
    north: { count: 0, totalArea: 0 },
    south: { count: 0, totalArea: 0 },
    east: { count: 0, totalArea: 0 },
    west: { count: 0, totalArea: 0 }
  };
  
  segments.forEach(segment => {
    const azimuth = ((segment.azimuthDegrees % 360) + 360) % 360;
    const area = (segment.areaMeters2 || 0) * 10.764; // sqft
    
    if (azimuth >= 315 || azimuth < 45) {
      groups.north.count++;
      groups.north.totalArea += area;
    } else if (azimuth >= 45 && azimuth < 135) {
      groups.east.count++;
      groups.east.totalArea += area;
    } else if (azimuth >= 135 && azimuth < 225) {
      groups.south.count++;
      groups.south.totalArea += area;
    } else {
      groups.west.count++;
      groups.west.totalArea += area;
    }
  });
  
  // Determine primary ridge direction
  const nsTotal = groups.north.count + groups.south.count;
  const ewTotal = groups.east.count + groups.west.count;
  
  // If most segments face N/S, ridge runs E-W. If most face E/W, ridge runs N-S
  const primaryRidgeDirection = nsTotal >= ewTotal ? 'east-west' : 'north-south';
  
  // Check for L-shape: significant segments in all 4 directions with distinct groupings
  const hasNS = groups.north.count >= 1 && groups.south.count >= 1;
  const hasEW = groups.east.count >= 1 && groups.west.count >= 1;
  const hasMultipleRidges = hasNS && hasEW && segments.length >= 4;
  
  // Suggest shape based on segment distribution
  let suggestedShape: 'rectangular' | 'L-shaped' | 'T-shaped' | 'complex' = 'rectangular';
  if (hasMultipleRidges) {
    // L-shape has perpendicular ridges with unequal areas
    const nsArea = groups.north.totalArea + groups.south.totalArea;
    const ewArea = groups.east.totalArea + groups.west.totalArea;
    const areaRatio = Math.max(nsArea, ewArea) / Math.min(nsArea, ewArea);
    
    if (areaRatio > 1.5 && areaRatio < 3) {
      suggestedShape = 'L-shaped';
    } else if (areaRatio >= 3) {
      suggestedShape = 'T-shaped';
    } else {
      suggestedShape = 'complex';
    }
  }
  
  // Calculate confidence
  const totalSegments = segments.length;
  const confidence = Math.min(0.95, 0.5 + (totalSegments * 0.1));
  
  console.log(`🧭 Segment orientation: ${primaryRidgeDirection} ridge, ${suggestedShape} shape, ${hasMultipleRidges ? 'multi-ridge' : 'single-ridge'}`);
  console.log(`   N: ${groups.north.count} (${groups.north.totalArea.toFixed(0)} sqft), S: ${groups.south.count}, E: ${groups.east.count}, W: ${groups.west.count}`);
  
  return {
    primaryRidgeDirection,
    hasMultipleRidges,
    segmentGroups: groups,
    suggestedShape,
    confidence
  };
}

/**
 * Check if address is in Florida (for screen enclosure detection)
 */
export function isFloridaAddress(address: string): boolean {
  if (!address) return false;
  const normalized = address.toUpperCase();
  return normalized.includes(', FL') || 
         normalized.includes(' FL ') || 
         normalized.includes('FLORIDA');
}

/**
 * Create AI prompt for structure analysis
 */
export function createStructureAnalysisPrompt(): string {
  return `You are analyzing a residential property from aerial/satellite view.

IDENTIFY THE FOLLOWING WITH PRECISION:

1. DRIVEWAY LOCATION (Critical for determining house front)
   - Look for: concrete/asphalt surface leading from street to garage
   - Color: typically lighter gray than roof or dark asphalt
   - Shape: rectangular path connecting street to structure
   - Position relative to house: N, S, E, W, or diagonal (NE, SE, SW, NW)

2. GARAGE ORIENTATION  
   - Which direction does the garage door face? (This is typically the "front")
   - Is garage attached to main house or a separate wing?
   - Position: front-left, front-right, side-left, side-right, detached

3. FOOTPRINT SHAPE CLASSIFICATION
   - "rectangular": Simple 4-corner footprint (most common)
   - "L-shaped": Main structure + one perpendicular extension
   - "T-shaped": Main structure + extension on one long side
   - "U-shaped": Three-sided with courtyard
   - "H-shaped": Two parallel wings connected by center section
   - "complex": Multiple irregular extensions

4. MAIN STRUCTURE vs EXTENSIONS
   - Identify the PRIMARY rectangular mass of the house
   - Mark bounds as percentage of image (0-100%)
   - For extensions: identify attachment side and type
   - Extension types: garage-wing, bedroom-wing, sunroom, porch, addition

5. SCREEN ENCLOSURE DETECTION (Florida properties especially)
   - Grid pattern visible from above = aluminum screen enclosure
   - Usually rectangular, attached to back/side of house
   - Should be EXCLUDED from roof measurements
   - Mark precise bounds for exclusion

6. RIDGE DIRECTION
   - For main structure: does ridge run east-west or north-south?
   - Consider the longer dimension usually has ridge parallel to it
   - For extensions: each wing may have its own ridge direction

Return JSON:
{
  "houseOrientation": {
    "frontFacing": "E",
    "drivewayPosition": "E", 
    "garagePosition": "front-right",
    "confidence": 0.85
  },
  "footprintShape": "L-shaped",
  "mainStructure": {
    "bounds": { "minX": 30, "minY": 25, "maxX": 65, "maxY": 70 },
    "ridgeDirection": "north-south",
    "estimatedWidthFt": 45,
    "estimatedDepthFt": 55
  },
  "extensions": [
    {
      "type": "garage-wing",
      "bounds": { "minX": 60, "minY": 40, "maxX": 75, "maxY": 60 },
      "attachmentSide": "E",
      "ridgeDirection": "east-west"
    }
  ],
  "exclusions": [
    {
      "type": "screen-enclosure",
      "bounds": { "minX": 20, "minY": 55, "maxX": 35, "maxY": 75 },
      "estimatedAreaSqft": 450
    }
  ],
  "ridgeTopology": {
    "primaryRidgeCount": 2,
    "hasMultipleRidgeDirections": true,
    "junctionPoints": 1
  },
  "overallConfidence": "high"
}

IMPORTANT:
- Bounds are in PERCENTAGE of image (0-100), not pixels
- Be specific about screen enclosures - they MUST be excluded
- If no driveway visible, use roof shape and surrounding context to infer orientation
- Mark confidence as "low" if imagery is unclear or obstructed`;
}

/**
 * Parse AI response for structure analysis
 */
export function parseStructureAnalysisResponse(content: string): StructureAnalysis | null {
  try {
    // Clean markdown code blocks
    let cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Try to parse directly
    try {
      return JSON.parse(cleaned) as StructureAnalysis;
    } catch {
      // Try to extract JSON object
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as StructureAnalysis;
      }
    }
    
    console.warn('⚠️ Failed to parse structure analysis response');
    return null;
  } catch (e) {
    console.error('Structure analysis parse error:', e);
    return null;
  }
}

/**
 * Default structure analysis for fallback
 */
export function createDefaultStructureAnalysis(): StructureAnalysis {
  return {
    houseOrientation: {
      frontFacing: 'unknown',
      drivewayPosition: 'unknown',
      garagePosition: 'unknown',
      confidence: 0
    },
    footprintShape: 'rectangular',
    mainStructure: {
      bounds: { minX: 25, minY: 25, maxX: 75, maxY: 75 },
      ridgeDirection: 'east-west',
      estimatedWidthFt: 50,
      estimatedDepthFt: 40
    },
    extensions: [],
    exclusions: [],
    ridgeTopology: {
      primaryRidgeCount: 1,
      hasMultipleRidgeDirections: false,
      junctionPoints: 0
    },
    overallConfidence: 'low'
  };
}

/**
 * Merge segment orientation with structure analysis for best results
 */
export function mergeOrientationData(
  structureAnalysis: StructureAnalysis | null,
  segmentOrientation: SolarSegmentOrientation
): StructureAnalysis {
  if (!structureAnalysis) {
    // Create from segment orientation alone
    return {
      houseOrientation: {
        frontFacing: 'unknown',
        drivewayPosition: 'unknown',
        garagePosition: 'unknown',
        confidence: segmentOrientation.confidence * 0.7
      },
      footprintShape: segmentOrientation.suggestedShape,
      mainStructure: {
        bounds: { minX: 25, minY: 25, maxX: 75, maxY: 75 },
        ridgeDirection: segmentOrientation.primaryRidgeDirection,
        estimatedWidthFt: 50,
        estimatedDepthFt: 40
      },
      extensions: [],
      exclusions: [],
      ridgeTopology: {
        primaryRidgeCount: segmentOrientation.hasMultipleRidges ? 2 : 1,
        hasMultipleRidgeDirections: segmentOrientation.hasMultipleRidges,
        junctionPoints: segmentOrientation.hasMultipleRidges ? 1 : 0
      },
      overallConfidence: segmentOrientation.confidence > 0.7 ? 'medium' : 'low'
    };
  }
  
  // Override ridge direction if segment data is more confident
  if (segmentOrientation.confidence > 0.8 && 
      structureAnalysis.mainStructure.ridgeDirection !== segmentOrientation.primaryRidgeDirection) {
    console.log(`🔄 Overriding ridge direction from AI (${structureAnalysis.mainStructure.ridgeDirection}) with segment data (${segmentOrientation.primaryRidgeDirection})`);
    structureAnalysis.mainStructure.ridgeDirection = segmentOrientation.primaryRidgeDirection;
  }
  
  // Use segment data to confirm/update multi-ridge detection
  if (segmentOrientation.hasMultipleRidges && !structureAnalysis.ridgeTopology.hasMultipleRidgeDirections) {
    console.log(`🔄 Segment data indicates multiple ridges - updating topology`);
    structureAnalysis.ridgeTopology.hasMultipleRidgeDirections = true;
    structureAnalysis.ridgeTopology.primaryRidgeCount = Math.max(2, structureAnalysis.ridgeTopology.primaryRidgeCount);
  }
  
  return structureAnalysis;
}
