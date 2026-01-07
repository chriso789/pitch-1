// Shared helper functions for roof analysis
// Extracted to reduce bundle size of main analyze-roof-aerial function

// ============= STRUCTURE ANALYSIS TYPES =============

export interface StructureAnalysis {
  houseOrientation: {
    frontFacing: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' | 'unknown';
    drivewayPosition: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' | 'unknown';
    garagePosition: string;
    confidence: number;
  };
  footprintShape: 'rectangular' | 'L-shaped' | 'T-shaped' | 'U-shaped' | 'H-shaped' | 'complex';
  mainStructure: {
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    ridgeDirection: 'east-west' | 'north-south';
    estimatedWidthFt: number;
    estimatedDepthFt: number;
  };
  extensions: Array<{
    type: string;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    attachmentSide: 'N' | 'S' | 'E' | 'W';
    ridgeDirection: 'east-west' | 'north-south';
  }>;
  exclusions: Array<{
    type: string;
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

// ============= SEGMENT ORIENTATION ANALYSIS =============

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
  
  const groups = { north: { count: 0, totalArea: 0 }, south: { count: 0, totalArea: 0 }, east: { count: 0, totalArea: 0 }, west: { count: 0, totalArea: 0 } };
  
  segments.forEach(segment => {
    const azimuth = ((segment.azimuthDegrees % 360) + 360) % 360;
    const area = (segment.areaMeters2 || 0) * 10.764;
    
    if (azimuth >= 315 || azimuth < 45) { groups.north.count++; groups.north.totalArea += area; }
    else if (azimuth >= 45 && azimuth < 135) { groups.east.count++; groups.east.totalArea += area; }
    else if (azimuth >= 135 && azimuth < 225) { groups.south.count++; groups.south.totalArea += area; }
    else { groups.west.count++; groups.west.totalArea += area; }
  });
  
  const nsTotal = groups.north.count + groups.south.count;
  const ewTotal = groups.east.count + groups.west.count;
  const primaryRidgeDirection = nsTotal >= ewTotal ? 'east-west' : 'north-south';
  
  const hasNS = groups.north.count >= 1 && groups.south.count >= 1;
  const hasEW = groups.east.count >= 1 && groups.west.count >= 1;
  const hasMultipleRidges = hasNS && hasEW && segments.length >= 4;
  
  let suggestedShape: 'rectangular' | 'L-shaped' | 'T-shaped' | 'complex' = 'rectangular';
  if (hasMultipleRidges) {
    const nsArea = groups.north.totalArea + groups.south.totalArea;
    const ewArea = groups.east.totalArea + groups.west.totalArea;
    const areaRatio = Math.max(nsArea, ewArea) / Math.min(nsArea, ewArea);
    if (areaRatio > 1.5 && areaRatio < 3) suggestedShape = 'L-shaped';
    else if (areaRatio >= 3) suggestedShape = 'T-shaped';
    else suggestedShape = 'complex';
  }
  
  console.log(`🧭 Segment orientation: ${primaryRidgeDirection} ridge, ${suggestedShape} shape`);
  return { primaryRidgeDirection, hasMultipleRidges, segmentGroups: groups, suggestedShape, confidence: Math.min(0.95, 0.5 + (segments.length * 0.1)) };
}

// ============= DEFAULT STRUCTURE ANALYSIS =============

export function createDefaultStructureAnalysis(): StructureAnalysis {
  return {
    houseOrientation: { frontFacing: 'unknown', drivewayPosition: 'unknown', garagePosition: 'unknown', confidence: 0 },
    footprintShape: 'rectangular',
    mainStructure: { bounds: { minX: 25, minY: 25, maxX: 75, maxY: 75 }, ridgeDirection: 'east-west', estimatedWidthFt: 50, estimatedDepthFt: 40 },
    extensions: [],
    exclusions: [],
    ridgeTopology: { primaryRidgeCount: 1, hasMultipleRidgeDirections: false, junctionPoints: 0 },
    overallConfidence: 'low'
  };
}

// ============= MERGE ORIENTATION DATA =============

export function mergeOrientationData(structureAnalysis: StructureAnalysis | null, segmentOrientation: SolarSegmentOrientation): StructureAnalysis {
  if (!structureAnalysis) {
    return {
      houseOrientation: { frontFacing: 'unknown', drivewayPosition: 'unknown', garagePosition: 'unknown', confidence: segmentOrientation.confidence * 0.7 },
      footprintShape: segmentOrientation.suggestedShape,
      mainStructure: { bounds: { minX: 25, minY: 25, maxX: 75, maxY: 75 }, ridgeDirection: segmentOrientation.primaryRidgeDirection, estimatedWidthFt: 50, estimatedDepthFt: 40 },
      extensions: [],
      exclusions: [],
      ridgeTopology: { primaryRidgeCount: segmentOrientation.hasMultipleRidges ? 2 : 1, hasMultipleRidgeDirections: segmentOrientation.hasMultipleRidges, junctionPoints: segmentOrientation.hasMultipleRidges ? 1 : 0 },
      overallConfidence: segmentOrientation.confidence > 0.7 ? 'medium' : 'low'
    };
  }
  if (segmentOrientation.confidence > 0.8 && structureAnalysis.mainStructure.ridgeDirection !== segmentOrientation.primaryRidgeDirection) {
    structureAnalysis.mainStructure.ridgeDirection = segmentOrientation.primaryRidgeDirection;
  }
  if (segmentOrientation.hasMultipleRidges && !structureAnalysis.ridgeTopology.hasMultipleRidgeDirections) {
    structureAnalysis.ridgeTopology.hasMultipleRidgeDirections = true;
    structureAnalysis.ridgeTopology.primaryRidgeCount = Math.max(2, structureAnalysis.ridgeTopology.primaryRidgeCount);
  }
  return structureAnalysis;
}

// ============= FLORIDA ADDRESS DETECTION =============

export function isFloridaAddress(address: string): boolean {
  if (!address) return false;
  const normalized = address.toUpperCase();
  return normalized.includes(', FL') || normalized.includes(' FL ') || normalized.includes('FLORIDA');
}

// ============= PLANIMETER ACCURACY THRESHOLDS =============

export const PLANIMETER_THRESHOLDS = {
  MIN_SPAN_PCT: 15,
  MAX_SEGMENT_LENGTH_FT: 55,
  MIN_VERTICES_PER_100FT: 4,
  RE_DETECT_THRESHOLD: 0.70,
  AREA_TOLERANCE: 0.05,
};

// ============= SAFE JSON PARSER =============

export function safeParseJSON<T>(content: string, defaultValue: T, context: string): T {
  try {
    let cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Try to fix common issues
    }
    
    const unterminatedStringMatch = cleaned.match(/"[^"]*$/);
    if (unterminatedStringMatch) {
      cleaned = cleaned.slice(0, unterminatedStringMatch.index) + '""';
    }
    
    const openBraces = (cleaned.match(/{/g) || []).length;
    const closeBraces = (cleaned.match(/}/g) || []).length;
    const openBrackets = (cleaned.match(/\[/g) || []).length;
    const closeBrackets = (cleaned.match(/]/g) || []).length;
    
    for (let i = 0; i < openBrackets - closeBrackets; i++) cleaned += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) cleaned += '}';
    
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as T;
        } catch {
          // Give up
        }
      }
    }
    
    console.error(`⚠️ ${context}: Failed to parse JSON, using default`);
    return defaultValue;
  } catch (e) {
    console.error(`⚠️ ${context}: JSON parse error:`, e);
    return defaultValue;
  }
}

// ============= GEOMETRY HELPERS =============

export function distance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

export function findNearestPoint<T extends { x: number; y: number }>(point: { x: number; y: number }, candidates: T[]): T | null {
  if (!candidates || candidates.length === 0) return null;
  
  let nearest: T | null = null;
  let minDist = Infinity;
  
  candidates.forEach(c => {
    const d = distance(point, c);
    if (d < minDist) {
      minDist = d;
      nearest = c;
    }
  });
  
  return nearest;
}

export function findFourMainCorners(vertices: any[]): any[] {
  if (vertices.length <= 4) return vertices;
  
  const centroidX = vertices.reduce((s, v) => s + v.x, 0) / vertices.length;
  const centroidY = vertices.reduce((s, v) => s + v.y, 0) / vertices.length;
  
  return [...vertices]
    .sort((a, b) => {
      const distA = distance(a, { x: centroidX, y: centroidY });
      const distB = distance(b, { x: centroidX, y: centroidY });
      return distB - distA;
    })
    .slice(0, 4);
}

export function calculateDistanceFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ============= COORDINATE CONVERSION =============

export function pixelToGeo(
  xPct: number, 
  yPct: number, 
  center: { lat: number; lng: number }, 
  imageSize: number, 
  zoom: number
): { lat: number; lng: number } {
  const metersPerPixel = (156543.03392 * Math.cos(center.lat * Math.PI / 180)) / Math.pow(2, zoom);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);
  
  const pixelX = ((xPct / 100) - 0.5) * imageSize;
  const pixelY = ((yPct / 100) - 0.5) * imageSize;
  const metersX = pixelX * metersPerPixel;
  const metersY = pixelY * metersPerPixel;
  
  return {
    lat: center.lat - (metersY / metersPerDegLat),
    lng: center.lng + (metersX / metersPerDegLng)
  };
}

export function geoToPixel(
  lat: number, 
  lng: number, 
  center: { lat: number; lng: number }, 
  imageSize: number, 
  zoom: number
): { x: number; y: number } {
  const metersPerPixel = (156543.03392 * Math.cos(center.lat * Math.PI / 180)) / Math.pow(2, zoom);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);
  
  const metersY = (center.lat - lat) * metersPerDegLat;
  const metersX = (lng - center.lng) * metersPerDegLng;
  
  const pixelX = metersX / metersPerPixel;
  const pixelY = metersY / metersPerPixel;
  
  return {
    x: ((pixelX / imageSize) + 0.5) * 100,
    y: ((pixelY / imageSize) + 0.5) * 100
  };
}

export function isValidPixelCoord(coord: { x: number; y: number }): boolean {
  return coord.x >= 0 && coord.x <= 100 && coord.y >= 0 && coord.y <= 100;
}

// ============= DIRECTION HELPERS =============

export function getDirectionFromAngle(angleDegrees: number): string {
  const normalized = (angleDegrees + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return 'east';
  if (normalized >= 22.5 && normalized < 67.5) return 'southeast';
  if (normalized >= 67.5 && normalized < 112.5) return 'south';
  if (normalized >= 112.5 && normalized < 157.5) return 'southwest';
  if (normalized >= 157.5 && normalized < 202.5) return 'west';
  if (normalized >= 202.5 && normalized < 247.5) return 'northwest';
  if (normalized >= 247.5 && normalized < 292.5) return 'north';
  return 'northeast';
}
