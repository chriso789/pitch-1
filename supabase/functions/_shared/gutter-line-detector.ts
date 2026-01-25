/**
 * Phase 27: Gutter Line Detection Enhancement
 * Precisely detects gutter/drip edge lines for accurate eave measurement.
 */

export interface GutterLineDetection {
  id: string;
  segmentType: 'eave' | 'rake';
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  lengthFt: number;
  overhangDistanceFt: number;
  gutterPresent: boolean;
  confidence: number;
}

export interface GutterDetectionResult {
  gutterLines: GutterLineDetection[];
  totalEaveLengthFt: number;
  totalRakeLengthFt: number;
  averageOverhangFt: number;
  gutterCoverage: number; // percentage of eaves with gutters
  refinedPerimeter: { lat: number; lng: number }[];
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
 * Calculate bearing between two points
 */
function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const toDeg = (rad: number) => rad * 180 / Math.PI;
  
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - 
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  
  let bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

/**
 * Generate AI prompt for gutter line detection
 */
export function getGutterDetectionPrompt(): string {
  return `Analyze this satellite/aerial image to detect gutter and drip edge lines on the roof.

Focus on identifying:
1. GUTTER LINES - The outermost visible edge of gutters (usually darker line parallel to roof edge)
2. DRIP EDGE - Metal flashing at roof edges (may appear as thin lighter or darker line)
3. FASCIA - Vertical face board at roof edge (helps identify true edge)
4. EAVE OVERHANG - Distance from building wall to gutter/drip edge

Detection tips:
- Gutters create subtle shadows underneath
- Gutters are typically 4-6 inches wide
- Drip edge extends slightly beyond fascia
- Roof overhangs are typically 6-18 inches
- Look for color change at transition from roof to gutter

For each detected gutter/edge segment, provide:
- Start and end coordinates
- Whether gutter appears present
- Estimated overhang distance from building wall

Return in JSON format:
{
  "gutterSegments": [
    {
      "startLat": number,
      "startLng": number,
      "endLat": number,
      "endLng": number,
      "hasGutter": boolean,
      "estimatedOverhangFt": number,
      "confidence": number
    }
  ],
  "overallGutterCondition": "new|good|fair|poor|missing",
  "notes": "observations about gutter detection"
}`;
}

/**
 * Analyze edge gradient to identify gutter/fascia transition
 */
export function analyzeEdgeGradient(
  edgePixels: number[][],
  expectedGutterColor: { r: number; g: number; b: number }
): {
  gutterPresent: boolean;
  gutterWidth: number;
  confidence: number;
} {
  // Simplified gradient analysis
  // In production, would analyze actual pixel data
  
  if (!edgePixels || edgePixels.length === 0) {
    return { gutterPresent: false, gutterWidth: 0, confidence: 0.3 };
  }
  
  // Look for color transition indicating gutter
  // Gutters typically appear as darker band at roof edge
  
  let darkBandWidth = 0;
  let inDarkBand = false;
  
  for (let i = 0; i < edgePixels.length; i++) {
    const pixel = edgePixels[i];
    const brightness = (pixel[0] + pixel[1] + pixel[2]) / 3;
    
    if (brightness < 100) { // Dark pixel threshold
      if (!inDarkBand) {
        inDarkBand = true;
        darkBandWidth = 1;
      } else {
        darkBandWidth++;
      }
    } else {
      if (inDarkBand && darkBandWidth >= 3) {
        // Found consistent dark band
        break;
      }
      inDarkBand = false;
      darkBandWidth = 0;
    }
  }
  
  // Gutter width in pixels (typical gutter ~5 inches, at zoom 20 ~3-6 pixels)
  const gutterPresent = darkBandWidth >= 3 && darkBandWidth <= 10;
  
  return {
    gutterPresent,
    gutterWidth: darkBandWidth,
    confidence: gutterPresent ? 0.75 : 0.5
  };
}

/**
 * Calculate overhang distance from footprint edge to gutter line
 */
export function calculateOverhangDistance(
  footprintEdge: { lat: number; lng: number }[],
  gutterLine: { lat: number; lng: number }[]
): number {
  if (footprintEdge.length < 2 || gutterLine.length < 2) {
    return 1.0; // Default 1 foot overhang
  }
  
  // Calculate perpendicular distance from footprint edge to gutter line
  let totalDistance = 0;
  let sampleCount = 0;
  
  // Sample points along footprint edge
  for (let i = 0; i < footprintEdge.length - 1; i++) {
    const fp = footprintEdge[i];
    
    // Find closest point on gutter line
    let minDist = Infinity;
    for (let j = 0; j < gutterLine.length - 1; j++) {
      const dist = pointToLineDistance(
        fp.lat, fp.lng,
        gutterLine[j].lat, gutterLine[j].lng,
        gutterLine[j + 1].lat, gutterLine[j + 1].lng
      );
      minDist = Math.min(minDist, dist);
    }
    
    if (minDist < Infinity) {
      totalDistance += minDist;
      sampleCount++;
    }
  }
  
  return sampleCount > 0 ? totalDistance / sampleCount : 1.0;
}

/**
 * Calculate perpendicular distance from point to line segment
 */
function pointToLineDistance(
  px: number, py: number,
  lx1: number, ly1: number,
  lx2: number, ly2: number
): number {
  const A = px - lx1;
  const B = py - ly1;
  const C = lx2 - lx1;
  const D = ly2 - ly1;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }
  
  let xx: number, yy: number;
  
  if (param < 0) {
    xx = lx1;
    yy = ly1;
  } else if (param > 1) {
    xx = lx2;
    yy = ly2;
  } else {
    xx = lx1 + param * C;
    yy = ly1 + param * D;
  }
  
  return haversineDistanceFt(px, py, xx, yy);
}

/**
 * Refine eave measurements using gutter line positions
 */
export function refineEaveMeasurement(
  originalEave: { startLat: number; startLng: number; endLat: number; endLng: number },
  gutterLinePosition: { startLat: number; startLng: number; endLat: number; endLng: number }
): { startLat: number; startLng: number; endLat: number; endLng: number; lengthFt: number } {
  // Use gutter line position as the true eave edge
  const refined = {
    startLat: gutterLinePosition.startLat,
    startLng: gutterLinePosition.startLng,
    endLat: gutterLinePosition.endLat,
    endLng: gutterLinePosition.endLng,
    lengthFt: haversineDistanceFt(
      gutterLinePosition.startLat,
      gutterLinePosition.startLng,
      gutterLinePosition.endLat,
      gutterLinePosition.endLng
    )
  };
  
  return refined;
}

/**
 * Classify edge segment as eave or rake based on ridge orientation
 */
export function classifyEdgeSegment(
  edge: { startLat: number; startLng: number; endLat: number; endLng: number },
  ridgeDirection: number // degrees from north
): 'eave' | 'rake' {
  const edgeBearing = calculateBearing(
    edge.startLat, edge.startLng,
    edge.endLat, edge.endLng
  );
  
  // Eaves are parallel to ridge (within 30 degrees)
  // Rakes are perpendicular to ridge
  const angleDiff = Math.abs(edgeBearing - ridgeDirection);
  const normalizedDiff = Math.min(angleDiff, 360 - angleDiff);
  
  if (normalizedDiff <= 30 || normalizedDiff >= 150) {
    return 'eave';
  }
  
  return 'rake';
}

/**
 * Main gutter detection function
 */
export function detectGutterLines(
  perimeterBounds: { lat: number; lng: number }[],
  ridgeDirection: number,
  aiDetections?: any[]
): GutterDetectionResult {
  const gutterLines: GutterLineDetection[] = [];
  let totalEaveLength = 0;
  let totalRakeLength = 0;
  let totalOverhang = 0;
  let gutterSegments = 0;
  let gutterCount = 0;
  
  // Process each perimeter segment
  for (let i = 0; i < perimeterBounds.length; i++) {
    const start = perimeterBounds[i];
    const end = perimeterBounds[(i + 1) % perimeterBounds.length];
    
    const edge = {
      startLat: start.lat,
      startLng: start.lng,
      endLat: end.lat,
      endLng: end.lng
    };
    
    const segmentType = classifyEdgeSegment(edge, ridgeDirection);
    const lengthFt = haversineDistanceFt(start.lat, start.lng, end.lat, end.lng);
    
    // Check AI detections for this segment
    let gutterPresent = false;
    let overhangFt = segmentType === 'eave' ? 1.0 : 0.75; // Default overhangs
    let confidence = 0.6;
    
    if (aiDetections) {
      const matchingDetection = aiDetections.find(d => 
        haversineDistanceFt(d.startLat, d.startLng, start.lat, start.lng) < 5 &&
        haversineDistanceFt(d.endLat, d.endLng, end.lat, end.lng) < 5
      );
      
      if (matchingDetection) {
        gutterPresent = matchingDetection.hasGutter || false;
        overhangFt = matchingDetection.estimatedOverhangFt || overhangFt;
        confidence = matchingDetection.confidence || 0.7;
      }
    }
    
    gutterLines.push({
      id: `gutter_${i}`,
      segmentType,
      startLat: start.lat,
      startLng: start.lng,
      endLat: end.lat,
      endLng: end.lng,
      lengthFt,
      overhangDistanceFt: overhangFt,
      gutterPresent,
      confidence
    });
    
    if (segmentType === 'eave') {
      totalEaveLength += lengthFt;
      gutterSegments++;
      if (gutterPresent) gutterCount++;
    } else {
      totalRakeLength += lengthFt;
    }
    
    totalOverhang += overhangFt;
  }
  
  return {
    gutterLines,
    totalEaveLengthFt: totalEaveLength,
    totalRakeLengthFt: totalRakeLength,
    averageOverhangFt: totalOverhang / gutterLines.length,
    gutterCoverage: gutterSegments > 0 ? (gutterCount / gutterSegments) * 100 : 0,
    refinedPerimeter: perimeterBounds // Would be adjusted based on gutter positions
  };
}

/**
 * Generate gutter material list
 */
export function generateGutterMaterialList(
  result: GutterDetectionResult
): { item: string; quantity: number; unit: string }[] {
  const materials: { item: string; quantity: number; unit: string }[] = [];
  
  // Gutters (10ft sections)
  materials.push({
    item: 'Gutter sections (10ft)',
    quantity: Math.ceil(result.totalEaveLengthFt / 10),
    unit: 'pieces'
  });
  
  // Downspouts (every 35-40 ft of gutter)
  const downspoutCount = Math.ceil(result.totalEaveLengthFt / 35);
  materials.push({
    item: 'Downspouts (10ft)',
    quantity: downspoutCount,
    unit: 'pieces'
  });
  
  // Inside corners (estimate based on perimeter complexity)
  const corners = Math.floor(result.gutterLines.length / 4);
  materials.push({
    item: 'Inside corners',
    quantity: corners,
    unit: 'pieces'
  });
  
  // Outside corners
  materials.push({
    item: 'Outside corners',
    quantity: corners,
    unit: 'pieces'
  });
  
  // End caps (2 per gutter run)
  materials.push({
    item: 'End caps',
    quantity: downspoutCount * 2,
    unit: 'pieces'
  });
  
  // Drip edge
  materials.push({
    item: 'Drip edge',
    quantity: Math.ceil((result.totalEaveLengthFt + result.totalRakeLengthFt) / 10),
    unit: 'pieces (10ft)'
  });
  
  return materials;
}
