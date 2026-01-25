/**
 * Phase 29: Multi-Story Roof Layer Separation
 * Correctly separates and measures multi-story roof layers.
 */

export interface RoofLayer {
  id: string;
  layerIndex: number;
  type: 'main' | 'upper' | 'lower' | 'addition' | 'garage' | 'porch';
  perimeterCoords: { lat: number; lng: number }[];
  areaSqFt: number;
  heightAboveGradeFt: number;
  heightDifferentialFt: number;
  facetCount: number;
  linearFeatures: {
    ridges: any[];
    hips: any[];
    valleys: any[];
    eaves: any[];
    rakes: any[];
  };
  confidence: number;
}

export interface MultiStoryAnalysisResult {
  layers: RoofLayer[];
  totalLayers: number;
  mainRoofArea: number;
  secondaryRoofArea: number;
  totalCombinedArea: number;
  stepFlashingRequired: boolean;
  transitionLines: { lat: number; lng: number }[][];
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
 * Calculate polygon area using shoelace formula
 */
function calculatePolygonArea(coords: { lat: number; lng: number }[]): number {
  if (coords.length < 3) return 0;
  
  let area = 0;
  const n = coords.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // Convert to approximate feet
    const x1 = coords[i].lng * 364567 * Math.cos(coords[i].lat * Math.PI / 180);
    const y1 = coords[i].lat * 364567;
    const x2 = coords[j].lng * 364567 * Math.cos(coords[j].lat * Math.PI / 180);
    const y2 = coords[j].lat * 364567;
    
    area += x1 * y2 - x2 * y1;
  }
  
  return Math.abs(area) / 2;
}

/**
 * Generate AI prompt for multi-story roof detection
 */
export function getMultiStoryDetectionPrompt(): string {
  return `Analyze this satellite/aerial image to identify multiple roof levels on this building.

Look for indicators of multi-story roofing:
1. SHADOW DEPTH DIFFERENCES - Deeper shadows indicate higher roof sections
2. COLOR/TEXTURE TRANSITIONS - Different roof ages may show color variations
3. STEP TRANSITIONS - Where lower roof meets upper wall
4. DORMERS ON LOWER SECTIONS - Indicate second-story areas
5. ATTACHED STRUCTURES - Garages, porches, additions at different heights

For each roof layer, identify:
- Whether it's main structure or attached
- Approximate height relationship to other layers
- Perimeter boundary
- Interior features (ridges, hips, valleys)

Common patterns:
- Two-story with single-story addition
- Split-level transitions
- Attached garage below main roof
- Covered porch at ground level

Return in JSON format:
{
  "layers": [
    {
      "type": "main|upper|lower|addition|garage|porch",
      "relativeHeight": "highest|middle|lowest",
      "estimatedHeightFt": number,
      "perimeterPoints": [{"lat": number, "lng": number}],
      "hasDormers": boolean,
      "confidence": number
    }
  ],
  "transitionLines": [
    {"from": "layer_index", "to": "layer_index", "points": [{"lat": number, "lng": number}]}
  ],
  "notes": "observations about layer detection"
}`;
}

/**
 * Detect roof layers from shadow depth analysis
 */
export function detectRoofLayers(
  shadowAnalysis: {
    regions: { center: { lat: number; lng: number }; depth: number; bounds: any }[];
  },
  fullPerimeter: { lat: number; lng: number }[]
): { layerBounds: { lat: number; lng: number }[]; heightFt: number }[] {
  const layers: { layerBounds: { lat: number; lng: number }[]; heightFt: number }[] = [];
  
  if (!shadowAnalysis.regions || shadowAnalysis.regions.length === 0) {
    // Single layer - use full perimeter
    return [{
      layerBounds: fullPerimeter,
      heightFt: 10 // Assume single story
    }];
  }
  
  // Group regions by shadow depth
  const depthThreshold = 0.2; // 20% difference indicates different height
  const sortedRegions = [...shadowAnalysis.regions].sort((a, b) => b.depth - a.depth);
  
  let currentDepth = sortedRegions[0]?.depth || 0;
  let currentGroup: typeof sortedRegions = [];
  
  for (const region of sortedRegions) {
    if (Math.abs(region.depth - currentDepth) / currentDepth > depthThreshold) {
      // New layer group
      if (currentGroup.length > 0) {
        layers.push({
          layerBounds: mergeRegionBounds(currentGroup),
          heightFt: estimateHeightFromShadow(currentDepth)
        });
      }
      currentGroup = [region];
      currentDepth = region.depth;
    } else {
      currentGroup.push(region);
    }
  }
  
  // Add final group
  if (currentGroup.length > 0) {
    layers.push({
      layerBounds: mergeRegionBounds(currentGroup),
      heightFt: estimateHeightFromShadow(currentDepth)
    });
  }
  
  return layers;
}

/**
 * Merge region bounds into single perimeter
 */
function mergeRegionBounds(
  regions: { bounds: any }[]
): { lat: number; lng: number }[] {
  // Simplified - would use convex hull in production
  const allPoints: { lat: number; lng: number }[] = [];
  
  for (const region of regions) {
    if (region.bounds?.points) {
      allPoints.push(...region.bounds.points);
    }
  }
  
  // Return convex hull of all points
  return computeConvexHull(allPoints);
}

/**
 * Compute convex hull of points
 */
function computeConvexHull(points: { lat: number; lng: number }[]): { lat: number; lng: number }[] {
  if (points.length < 3) return points;
  
  // Graham scan algorithm
  const sorted = [...points].sort((a, b) => a.lat - b.lat || a.lng - b.lng);
  
  const cross = (o: any, a: any, b: any) =>
    (a.lat - o.lat) * (b.lng - o.lng) - (a.lng - o.lng) * (b.lat - o.lat);
  
  const lower: typeof points = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  
  const upper: typeof points = [];
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  
  lower.pop();
  upper.pop();
  
  return [...lower, ...upper];
}

/**
 * Estimate building height from shadow depth
 */
function estimateHeightFromShadow(shadowDepth: number): number {
  // Rough estimation - would use sun angle in production
  // shadowDepth is normalized 0-1
  const minHeight = 8; // Single story
  const maxHeight = 30; // Three story
  
  return minHeight + shadowDepth * (maxHeight - minHeight);
}

/**
 * Calculate height differential between layers
 */
export function calculateLayerHeightDifferential(
  upperLayer: RoofLayer,
  lowerLayer: RoofLayer,
  sunAngle: number = 45
): number {
  // Based on relative shadow depths
  return Math.abs(upperLayer.heightAboveGradeFt - lowerLayer.heightAboveGradeFt);
}

/**
 * Separate layer perimeters to avoid double-counting
 */
export function separateLayerPerimeters(
  combinedPerimeter: { lat: number; lng: number }[],
  layerBoundaries: { lat: number; lng: number }[][]
): { lat: number; lng: number }[][] {
  const separatedPerimeters: { lat: number; lng: number }[][] = [];
  
  for (const boundary of layerBoundaries) {
    // Clip boundary to combined perimeter
    const clipped = clipPolygonToPolygon(boundary, combinedPerimeter);
    if (clipped.length >= 3) {
      separatedPerimeters.push(clipped);
    }
  }
  
  return separatedPerimeters;
}

/**
 * Clip one polygon to another (simplified)
 */
function clipPolygonToPolygon(
  subject: { lat: number; lng: number }[],
  clip: { lat: number; lng: number }[]
): { lat: number; lng: number }[] {
  // Simplified - return subject if it overlaps with clip
  // Production would use Sutherland-Hodgman algorithm
  
  const subjectCenter = {
    lat: subject.reduce((s, p) => s + p.lat, 0) / subject.length,
    lng: subject.reduce((s, p) => s + p.lng, 0) / subject.length
  };
  
  // Check if center is inside clip polygon
  if (isPointInPolygon(subjectCenter, clip)) {
    return subject;
  }
  
  return [];
}

/**
 * Check if point is inside polygon
 */
function isPointInPolygon(
  point: { lat: number; lng: number },
  polygon: { lat: number; lng: number }[]
): boolean {
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (((polygon[i].lng > point.lng) !== (polygon[j].lng > point.lng)) &&
        (point.lat < (polygon[j].lat - polygon[i].lat) * (point.lng - polygon[i].lng) / 
         (polygon[j].lng - polygon[i].lng) + polygon[i].lat)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Validate that layer areas don't exceed total
 */
export function validateLayerAreas(
  layers: RoofLayer[],
  totalFootprint: number
): {
  valid: boolean;
  issues: string[];
  adjustedAreas: number[];
} {
  const issues: string[] = [];
  const adjustedAreas: number[] = [];
  
  const summedArea = layers.reduce((sum, l) => sum + l.areaSqFt, 0);
  
  // Areas can exceed footprint due to overlapping upper floors
  // but shouldn't be more than 2x footprint typically
  if (summedArea > totalFootprint * 2.5) {
    issues.push(`Total layer areas (${summedArea.toFixed(0)} sqft) exceed reasonable limit for footprint (${totalFootprint.toFixed(0)} sqft)`);
  }
  
  // Check each layer
  for (const layer of layers) {
    if (layer.areaSqFt > totalFootprint * 1.2) {
      issues.push(`Layer ${layer.id} area (${layer.areaSqFt.toFixed(0)} sqft) exceeds footprint`);
    }
    adjustedAreas.push(Math.min(layer.areaSqFt, totalFootprint * 1.1));
  }
  
  return {
    valid: issues.length === 0,
    issues,
    adjustedAreas
  };
}

/**
 * Main multi-story analysis function
 */
export function analyzeMultiStoryRoof(
  aiDetections: any[],
  fullPerimeter: { lat: number; lng: number }[]
): MultiStoryAnalysisResult {
  const layers: RoofLayer[] = [];
  const transitionLines: { lat: number; lng: number }[][] = [];
  
  let mainRoofArea = 0;
  let secondaryRoofArea = 0;
  
  for (let i = 0; i < aiDetections.length; i++) {
    const detection = aiDetections[i];
    
    const perimeterCoords = detection.perimeterPoints || fullPerimeter;
    const area = calculatePolygonArea(perimeterCoords);
    
    const layer: RoofLayer = {
      id: `layer_${i}`,
      layerIndex: i,
      type: detection.type || 'main',
      perimeterCoords,
      areaSqFt: area,
      heightAboveGradeFt: detection.estimatedHeightFt || (i === 0 ? 20 : 10),
      heightDifferentialFt: 0,
      facetCount: detection.facetCount || 2,
      linearFeatures: {
        ridges: [],
        hips: [],
        valleys: [],
        eaves: [],
        rakes: []
      },
      confidence: detection.confidence || 0.7
    };
    
    layers.push(layer);
    
    if (layer.type === 'main' || layer.type === 'upper') {
      mainRoofArea += area;
    } else {
      secondaryRoofArea += area;
    }
  }
  
  // Calculate height differentials
  for (let i = 1; i < layers.length; i++) {
    layers[i].heightDifferentialFt = layers[0].heightAboveGradeFt - layers[i].heightAboveGradeFt;
  }
  
  // Extract transition lines
  if (aiDetections.some(d => d.transitionPoints)) {
    for (const detection of aiDetections) {
      if (detection.transitionPoints) {
        transitionLines.push(detection.transitionPoints);
      }
    }
  }
  
  return {
    layers,
    totalLayers: layers.length,
    mainRoofArea,
    secondaryRoofArea,
    totalCombinedArea: mainRoofArea + secondaryRoofArea,
    stepFlashingRequired: layers.length > 1,
    transitionLines
  };
}
