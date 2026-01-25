/**
 * Phase 25: Dormer & Protrusion Detection Module
 * Accurately detects and measures roof dormers, skylights, and other protrusions.
 */

export interface DormerDetection {
  id: string;
  type: 'shed' | 'gable' | 'hip' | 'eyebrow' | 'barrel' | 'flat';
  centerLat: number;
  centerLng: number;
  widthFt: number;
  heightFt: number;
  depthFt: number;
  ridgeDirectionDegrees: number;
  ridgeLengthFt: number;
  facetCount: number;
  areaSqFt: number;
  valleysGenerated: LinearFeature[];
  hipsGenerated: LinearFeature[];
  confidence: number;
}

export interface LinearFeature {
  type: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  lengthFt: number;
}

export interface DormerDetectionResult {
  dormers: DormerDetection[];
  totalDormerArea: number;
  additionalValleyLengthFt: number;
  additionalHipLengthFt: number;
  adjustedMainRoofArea: number;
}

/**
 * Dormer type characteristics for detection
 */
const DORMER_CHARACTERISTICS = {
  shed: {
    facetCount: 1,
    hasRidge: false,
    typicalAspectRatio: { min: 1.5, max: 3.0 },
    valleyCount: 2,
    hipCount: 0
  },
  gable: {
    facetCount: 2,
    hasRidge: true,
    typicalAspectRatio: { min: 1.0, max: 2.0 },
    valleyCount: 2,
    hipCount: 0
  },
  hip: {
    facetCount: 3,
    hasRidge: true,
    typicalAspectRatio: { min: 1.0, max: 1.8 },
    valleyCount: 2,
    hipCount: 2
  },
  eyebrow: {
    facetCount: 1,
    hasRidge: false,
    typicalAspectRatio: { min: 2.0, max: 4.0 },
    valleyCount: 0,
    hipCount: 0
  },
  barrel: {
    facetCount: 1,
    hasRidge: false,
    typicalAspectRatio: { min: 1.2, max: 2.5 },
    valleyCount: 0,
    hipCount: 0
  },
  flat: {
    facetCount: 1,
    hasRidge: false,
    typicalAspectRatio: { min: 1.0, max: 2.5 },
    valleyCount: 2,
    hipCount: 0
  }
};

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
 * Generate AI prompt for dormer detection
 */
export function getDormerDetectionPrompt(mainRoofContext: string): string {
  return `Analyze this satellite/aerial image of a roof and identify all dormers.

Main roof context:
${mainRoofContext}

For each dormer, identify:
1. TYPE: shed (single sloped surface), gable (two sloped surfaces meeting at ridge), hip (three sloped surfaces), eyebrow (curved), barrel (curved vault), or flat
2. POSITION: Approximate center location on the main roof
3. SIZE: Width (parallel to main roof edge), height (vertical), depth (how far it projects)
4. ORIENTATION: Direction the dormer faces (N, S, E, W, or degrees)
5. RIDGE: If present, the direction and approximate length

Dormer identification tips:
- Dormers create shadows different from main roof
- Shed dormers have a single sloped top
- Gable dormers have triangular front with two roof slopes
- Hip dormers have a more complex shape with side slopes
- Eyebrow dormers have curved, flowing lines
- Look for window openings in the front face

Return in this JSON format:
{
  "dormers": [
    {
      "type": "gable|shed|hip|eyebrow|barrel|flat",
      "centerPosition": {"lat": number, "lng": number},
      "widthFt": number,
      "heightFt": number,
      "depthFt": number,
      "orientation": number (degrees from north),
      "ridgeLength": number or null,
      "confidence": number (0-1)
    }
  ],
  "totalCount": number,
  "notes": "any observations about dormer detection"
}`;
}

/**
 * Classify dormer type based on detected characteristics
 */
export function classifyDormerType(
  bounds: { width: number; height: number; depth: number },
  shadowPattern: string,
  hasVisibleRidge: boolean
): { type: DormerDetection['type']; confidence: number } {
  const aspectRatio = bounds.width / bounds.depth;
  
  // Check each type's characteristics
  let bestMatch: DormerDetection['type'] = 'shed';
  let bestConfidence = 0;
  
  for (const [type, chars] of Object.entries(DORMER_CHARACTERISTICS)) {
    let score = 0;
    
    // Check aspect ratio
    if (aspectRatio >= chars.typicalAspectRatio.min && aspectRatio <= chars.typicalAspectRatio.max) {
      score += 0.4;
    }
    
    // Check ridge presence
    if (chars.hasRidge === hasVisibleRidge) {
      score += 0.3;
    }
    
    // Shadow pattern analysis
    if (shadowPattern === 'triangular' && (type === 'gable' || type === 'hip')) {
      score += 0.2;
    } else if (shadowPattern === 'single_slope' && type === 'shed') {
      score += 0.2;
    } else if (shadowPattern === 'curved' && (type === 'eyebrow' || type === 'barrel')) {
      score += 0.2;
    }
    
    // Size-based heuristics
    if (bounds.width >= 4 && bounds.width <= 12) {
      score += 0.1; // Typical dormer width range
    }
    
    if (score > bestConfidence) {
      bestConfidence = score;
      bestMatch = type as DormerDetection['type'];
    }
  }
  
  return { type: bestMatch, confidence: bestConfidence };
}

/**
 * Generate dormer geometry (valleys and hips)
 */
export function generateDormerGeometry(
  dormer: Omit<DormerDetection, 'valleysGenerated' | 'hipsGenerated' | 'id'>
): { valleys: LinearFeature[]; hips: LinearFeature[] } {
  const valleys: LinearFeature[] = [];
  const hips: LinearFeature[] = [];
  
  const chars = DORMER_CHARACTERISTICS[dormer.type];
  
  // Calculate corner positions
  const halfWidth = dormer.widthFt / 2;
  const orientRad = dormer.ridgeDirectionDegrees * Math.PI / 180;
  
  // Lateral offset in lat/lng
  const latOffset = (halfWidth / EARTH_RADIUS_FT) * (180 / Math.PI);
  const lngOffset = latOffset / Math.cos(dormer.centerLat * Math.PI / 180);
  
  // Generate valleys (where dormer meets main roof)
  if (chars.valleyCount >= 2) {
    // Left valley
    valleys.push({
      type: 'valley',
      startLat: dormer.centerLat - latOffset * Math.cos(orientRad),
      startLng: dormer.centerLng - lngOffset * Math.sin(orientRad),
      endLat: dormer.centerLat,
      endLng: dormer.centerLng,
      lengthFt: dormer.depthFt * 1.2 // Approximate valley length
    });
    
    // Right valley
    valleys.push({
      type: 'valley',
      startLat: dormer.centerLat + latOffset * Math.cos(orientRad),
      startLng: dormer.centerLng + lngOffset * Math.sin(orientRad),
      endLat: dormer.centerLat,
      endLng: dormer.centerLng,
      lengthFt: dormer.depthFt * 1.2
    });
  }
  
  // Generate hips for hip dormers
  if (chars.hipCount >= 2 && dormer.type === 'hip') {
    const depthOffset = (dormer.depthFt / EARTH_RADIUS_FT) * (180 / Math.PI);
    
    // Left hip
    hips.push({
      type: 'hip',
      startLat: dormer.centerLat - latOffset * Math.cos(orientRad),
      startLng: dormer.centerLng - lngOffset * Math.sin(orientRad),
      endLat: dormer.centerLat + depthOffset * Math.sin(orientRad) / 2,
      endLng: dormer.centerLng + depthOffset * Math.cos(orientRad) / 2,
      lengthFt: Math.sqrt(Math.pow(halfWidth, 2) + Math.pow(dormer.depthFt/2, 2))
    });
    
    // Right hip
    hips.push({
      type: 'hip',
      startLat: dormer.centerLat + latOffset * Math.cos(orientRad),
      startLng: dormer.centerLng + lngOffset * Math.sin(orientRad),
      endLat: dormer.centerLat + depthOffset * Math.sin(orientRad) / 2,
      endLng: dormer.centerLng + depthOffset * Math.cos(orientRad) / 2,
      lengthFt: Math.sqrt(Math.pow(halfWidth, 2) + Math.pow(dormer.depthFt/2, 2))
    });
  }
  
  return { valleys, hips };
}

/**
 * Integrate dormer geometry with main roof
 */
export function integrateDormerWithMainRoof(
  mainRoofArea: number,
  mainRoofFeatures: { valleys: LinearFeature[]; hips: LinearFeature[] },
  dormers: DormerDetection[]
): {
  adjustedArea: number;
  mergedFeatures: { valleys: LinearFeature[]; hips: LinearFeature[] };
  dormerContribution: number;
} {
  let totalDormerArea = 0;
  const allValleys = [...mainRoofFeatures.valleys];
  const allHips = [...mainRoofFeatures.hips];
  
  for (const dormer of dormers) {
    totalDormerArea += dormer.areaSqFt;
    allValleys.push(...dormer.valleysGenerated);
    allHips.push(...dormer.hipsGenerated);
  }
  
  return {
    adjustedArea: mainRoofArea + totalDormerArea,
    mergedFeatures: { valleys: allValleys, hips: allHips },
    dormerContribution: totalDormerArea
  };
}

/**
 * Calculate dormer area based on type and dimensions
 */
export function calculateDormerArea(
  type: DormerDetection['type'],
  widthFt: number,
  depthFt: number,
  pitch: string = '6/12'
): number {
  // Parse pitch
  const pitchMatch = pitch.match(/(\d+)\/12/);
  const pitchRatio = pitchMatch ? parseInt(pitchMatch[1]) / 12 : 0.5;
  const pitchMultiplier = Math.sqrt(1 + pitchRatio * pitchRatio);
  
  const chars = DORMER_CHARACTERISTICS[type];
  let flatArea = widthFt * depthFt;
  
  switch (type) {
    case 'shed':
      // Single slope
      return flatArea * pitchMultiplier;
      
    case 'gable':
      // Two slopes, each half width
      return flatArea * pitchMultiplier;
      
    case 'hip':
      // Three facets - front and two sides
      const frontArea = (widthFt * depthFt * 0.6) * pitchMultiplier;
      const sideArea = (widthFt * depthFt * 0.2) * pitchMultiplier * 2;
      return frontArea + sideArea;
      
    case 'eyebrow':
    case 'barrel':
      // Curved - approximate as 1.2x flat area
      return flatArea * 1.2;
      
    case 'flat':
      return flatArea;
      
    default:
      return flatArea * pitchMultiplier;
  }
}

/**
 * Main dormer detection function
 */
export function detectDormers(
  aiDetections: any[],
  mainRoofBounds: { lat: number; lng: number }[],
  mainRoofArea: number
): DormerDetectionResult {
  const dormers: DormerDetection[] = [];
  let totalDormerArea = 0;
  let additionalValleyLength = 0;
  let additionalHipLength = 0;
  
  for (let i = 0; i < aiDetections.length; i++) {
    const detection = aiDetections[i];
    
    // Classify type
    const { type, confidence } = classifyDormerType(
      {
        width: detection.widthFt || 6,
        height: detection.heightFt || 4,
        depth: detection.depthFt || 4
      },
      detection.shadowPattern || 'unknown',
      detection.hasRidge || false
    );
    
    // Calculate area
    const area = calculateDormerArea(type, detection.widthFt || 6, detection.depthFt || 4);
    
    // Generate geometry
    const partialDormer = {
      type,
      centerLat: detection.centerPosition?.lat || mainRoofBounds[0].lat,
      centerLng: detection.centerPosition?.lng || mainRoofBounds[0].lng,
      widthFt: detection.widthFt || 6,
      heightFt: detection.heightFt || 4,
      depthFt: detection.depthFt || 4,
      ridgeDirectionDegrees: detection.orientation || 0,
      ridgeLengthFt: detection.ridgeLength || (detection.widthFt || 6) * 0.8,
      facetCount: DORMER_CHARACTERISTICS[type].facetCount,
      areaSqFt: area,
      confidence
    };
    
    const geometry = generateDormerGeometry(partialDormer);
    
    const dormer: DormerDetection = {
      ...partialDormer,
      id: `dormer_${i}`,
      valleysGenerated: geometry.valleys,
      hipsGenerated: geometry.hips
    };
    
    dormers.push(dormer);
    totalDormerArea += area;
    additionalValleyLength += geometry.valleys.reduce((sum, v) => sum + v.lengthFt, 0);
    additionalHipLength += geometry.hips.reduce((sum, h) => sum + h.lengthFt, 0);
  }
  
  return {
    dormers,
    totalDormerArea,
    additionalValleyLengthFt: additionalValleyLength,
    additionalHipLengthFt: additionalHipLength,
    adjustedMainRoofArea: mainRoofArea + totalDormerArea
  };
}
