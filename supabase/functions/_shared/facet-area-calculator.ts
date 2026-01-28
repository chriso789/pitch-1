// Unified Facet Area Calculator
// Splits footprint into facets using skeleton topology and computes areas

import type { RoofTopology, XY, SkeletonEdge } from './roof-topology-builder.ts';

export interface ComputedFacet {
  id: string;
  polygon: XY[];
  planAreaSqft: number;
  slopedAreaSqft: number;
  pitch: string;
  pitchDegrees: number;
  azimuthDegrees: number;
  direction: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
}

export interface AreaCalculationResult {
  facets: ComputedFacet[];
  totals: {
    planAreaSqft: number;
    slopedAreaSqft: number;
    squares: number;
    predominantPitch: string;
  };
  linearTotals: {
    ridgeFt: number;
    hipFt: number;
    valleyFt: number;
    eaveFt: number;
    rakeFt: number;
    perimeterFt: number;
  };
  calculationMethod: string;
  requiresManualReview: boolean;
  reviewReasons: string[];
}

export interface SolarSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaMeters2?: number;
  stats?: { areaMeters2: number };
  boundingBox?: {
    sw: { longitude: number; latitude: number };
    ne: { longitude: number; latitude: number };
  };
}

// Convert pitch degrees to pitch ratio string (e.g., "6/12")
function degreesToPitchRatio(degrees: number): string {
  if (degrees < 2) return 'flat';
  const rise = Math.round(Math.tan(degrees * Math.PI / 180) * 12);
  return `${rise}/12`;
}

// Convert pitch ratio string to degrees
function pitchRatioToDegrees(pitch: string): number {
  if (pitch === 'flat') return 0;
  const match = pitch.match(/^(\d+)\/(\d+)$/);
  if (!match) return 20; // Default ~4/12
  const rise = Number(match[1]);
  const run = Number(match[2] || 12);
  return Math.atan(rise / run) * 180 / Math.PI;
}

// Get slope factor from pitch
function getSlopeFactorFromPitch(pitch: string): number {
  if (pitch === 'flat') return 1;
  const match = pitch.match(/^(\d+)\/(\d+)$/);
  if (!match) return 1.118; // Default for 4/12
  const rise = Number(match[1]);
  const run = Number(match[2] || 12);
  return Math.sqrt(rise * rise + run * run) / run;
}

// Get cardinal direction from azimuth
function getCardinalDirection(azimuth: number): 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW' {
  const normalized = ((azimuth % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return 'N';
  if (normalized >= 22.5 && normalized < 67.5) return 'NE';
  if (normalized >= 67.5 && normalized < 112.5) return 'E';
  if (normalized >= 112.5 && normalized < 157.5) return 'SE';
  if (normalized >= 157.5 && normalized < 202.5) return 'S';
  if (normalized >= 202.5 && normalized < 247.5) return 'SW';
  if (normalized >= 247.5 && normalized < 292.5) return 'W';
  return 'NW';
}

// Calculate polygon area using Shoelace formula
function calculatePolygonAreaSqft(coords: XY[]): number {
  if (coords.length < 3) return 0;
  
  const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  
  let sum = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const x1 = coords[i][0] * metersPerDegLng;
    const y1 = coords[i][1] * metersPerDegLat;
    const x2 = coords[j][0] * metersPerDegLng;
    const y2 = coords[j][1] * metersPerDegLat;
    sum += (x1 * y2 - x2 * y1);
  }
  
  const areaSqM = Math.abs(sum) / 2;
  return areaSqM * 10.7639;
}

// Get centroid of polygon
function getCentroid(coords: XY[]): XY {
  const x = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const y = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return [x, y];
}

// Calculate edge length in feet
function edgeLengthFt(start: XY, end: XY): number {
  const midLat = (start[1] + end[1]) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  const dx = (end[0] - start[0]) * metersPerDegLng;
  const dy = (end[1] - start[1]) * metersPerDegLat;
  return Math.sqrt(dx * dx + dy * dy) * 3.28084;
}

// Find nearest Solar segment by centroid proximity
function findNearestSolarSegment(
  centroid: XY,
  segments?: SolarSegment[]
): SolarSegment | null {
  if (!segments || segments.length === 0) return null;
  
  // If segment has bounding box, check if centroid is inside
  for (const seg of segments) {
    if (seg.boundingBox) {
      const { sw, ne } = seg.boundingBox;
      if (centroid[0] >= sw.longitude && centroid[0] <= ne.longitude &&
          centroid[1] >= sw.latitude && centroid[1] <= ne.latitude) {
        return seg;
      }
    }
  }
  
  // Otherwise return first segment with valid data
  return segments.find(s => s.pitchDegrees !== undefined) || null;
}

// Estimate azimuth from facet position relative to topology
function estimateAzimuthFromPosition(centroid: XY, topology: RoofTopology): number {
  // Find nearest ridge line
  const ridges = topology.skeleton.filter(e => e.type === 'ridge');
  if (ridges.length === 0) return 0;
  
  const mainRidge = ridges[0];
  const ridgeMid: XY = [
    (mainRidge.start[0] + mainRidge.end[0]) / 2,
    (mainRidge.start[1] + mainRidge.end[1]) / 2
  ];
  
  // Direction from ridge to centroid determines azimuth
  const dx = centroid[0] - ridgeMid[0];
  const dy = centroid[1] - ridgeMid[1];
  
  // Convert to compass bearing (0 = N, 90 = E, etc.)
  let angle = Math.atan2(dx, dy) * 180 / Math.PI;
  if (angle < 0) angle += 360;
  
  return angle;
}

// Find predominant pitch from facets
function findPredominantPitch(facets: ComputedFacet[]): string {
  if (facets.length === 0) return '6/12';
  
  // Weight by area
  const pitchWeights = new Map<string, number>();
  for (const facet of facets) {
    const current = pitchWeights.get(facet.pitch) || 0;
    pitchWeights.set(facet.pitch, current + facet.slopedAreaSqft);
  }
  
  let maxWeight = 0;
  let predominant = '6/12';
  pitchWeights.forEach((weight, pitch) => {
    if (weight > maxWeight) {
      maxWeight = weight;
      predominant = pitch;
    }
  });
  
  return predominant;
}

// Calculate linear totals from topology
function calculateLinearTotals(topology: RoofTopology): AreaCalculationResult['linearTotals'] {
  const ridgeFt = topology.skeleton
    .filter(e => e.type === 'ridge')
    .reduce((sum, e) => sum + edgeLengthFt(e.start, e.end), 0);
  
  const hipFt = topology.skeleton
    .filter(e => e.type === 'hip')
    .reduce((sum, e) => sum + edgeLengthFt(e.start, e.end), 0);
  
  const valleyFt = topology.skeleton
    .filter(e => e.type === 'valley')
    .reduce((sum, e) => sum + edgeLengthFt(e.start, e.end), 0);
  
  const eaveFt = topology.boundaryClassification.eaveEdges
    .reduce((sum, e) => sum + edgeLengthFt(e[0], e[1]), 0);
  
  const rakeFt = topology.boundaryClassification.rakeEdges
    .reduce((sum, e) => sum + edgeLengthFt(e[0], e[1]), 0);
  
  return {
    ridgeFt,
    hipFt,
    valleyFt,
    eaveFt,
    rakeFt,
    perimeterFt: eaveFt + rakeFt
  };
}

/**
 * Create facets from Google Solar segments (preferred when available)
 */
function createFacetsFromSolarSegments(
  segments: SolarSegment[],
  topology: RoofTopology
): { facets: ComputedFacet[]; quality: number } {
  const facets: ComputedFacet[] = [];
  let totalQuality = 0;
  
  // Sort by area (largest first)
  const sorted = [...segments].sort((a, b) => {
    const areaA = a.stats?.areaMeters2 || a.areaMeters2 || 0;
    const areaB = b.stats?.areaMeters2 || b.areaMeters2 || 0;
    return areaB - areaA;
  });
  
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    
    const pitchDeg = seg.pitchDegrees ?? 20;
    const azimuthDeg = seg.azimuthDegrees ?? 0;
    const areaSqM = seg.stats?.areaMeters2 || seg.areaMeters2 || 0;
    const slopedAreaSqft = areaSqM * 10.7639;
    
    // Calculate plan area from sloped area
    const pitchRad = Math.max(0, Math.min(90, pitchDeg)) * Math.PI / 180;
    const planAreaSqft = slopedAreaSqft * Math.cos(pitchRad);
    
    // Get polygon from bounding box if available
    let polygon: XY[] = topology.footprintCoords;
    if (seg.boundingBox?.sw && seg.boundingBox?.ne) {
      const { sw, ne } = seg.boundingBox;
      polygon = [
        [sw.longitude, sw.latitude],
        [ne.longitude, sw.latitude],
        [ne.longitude, ne.latitude],
        [sw.longitude, ne.latitude]
      ];
    }
    
    let quality = 0.9;
    if (seg.pitchDegrees === undefined) quality -= 0.1;
    if (!seg.stats?.areaMeters2 && !seg.areaMeters2) quality -= 0.15;
    if (slopedAreaSqft < 10) quality -= 0.2;
    
    facets.push({
      id: String.fromCharCode(65 + i),
      polygon,
      planAreaSqft,
      slopedAreaSqft,
      pitch: degreesToPitchRatio(pitchDeg),
      pitchDegrees: pitchDeg,
      azimuthDegrees: azimuthDeg,
      direction: getCardinalDirection(azimuthDeg)
    });
    
    totalQuality += quality;
  }
  
  return {
    facets,
    quality: facets.length > 0 ? totalQuality / facets.length : 0
  };
}

/**
 * Create facets from skeleton topology (fallback when Solar not available)
 */
function createFacetsFromSkeleton(
  topology: RoofTopology,
  predominantPitch: string
): { facets: ComputedFacet[]; quality: number } {
  const { footprintCoords, skeleton } = topology;
  const reviewReasons: string[] = [];
  
  // For simple rectangular buildings with single ridge
  const ridges = skeleton.filter(e => e.type === 'ridge');
  const isSimpleRectangle = footprintCoords.length === 4 && ridges.length === 1 && topology.reflexVertexCount === 0;
  
  if (isSimpleRectangle) {
    // Split into 2 facets based on ridge
    const ridge = ridges[0];
    const ridgeMidY = (ridge.start[1] + ridge.end[1]) / 2;
    const centroidY = footprintCoords.reduce((s, c) => s + c[1], 0) / footprintCoords.length;
    
    // Partition vertices
    const facet1Verts = footprintCoords.filter(v => v[1] > centroidY);
    const facet2Verts = footprintCoords.filter(v => v[1] <= centroidY);
    
    // Add ridge endpoints to each facet
    facet1Verts.push(ridge.start, ridge.end);
    facet2Verts.push(ridge.start, ridge.end);
    
    const slopeFactor = getSlopeFactorFromPitch(predominantPitch);
    const pitchDegrees = pitchRatioToDegrees(predominantPitch);
    
    const area1 = calculatePolygonAreaSqft(facet1Verts);
    const area2 = calculatePolygonAreaSqft(facet2Verts);
    
    const facets: ComputedFacet[] = [
      {
        id: 'A',
        polygon: facet1Verts,
        planAreaSqft: area1,
        slopedAreaSqft: area1 * slopeFactor,
        pitch: predominantPitch,
        pitchDegrees,
        azimuthDegrees: 0,
        direction: 'N'
      },
      {
        id: 'B',
        polygon: facet2Verts,
        planAreaSqft: area2,
        slopedAreaSqft: area2 * slopeFactor,
        pitch: predominantPitch,
        pitchDegrees,
        azimuthDegrees: 180,
        direction: 'S'
      }
    ];
    
    return { facets, quality: 0.7 };
  }
  
  // For complex shapes, return empty and flag for manual review
  console.log(`⚠️ Complex shape detected - manual facet definition required`);
  return { facets: [], quality: 0.3 };
}

/**
 * Main function: Compute facets and areas from topology
 */
export function computeFacetsAndAreas(
  topology: RoofTopology,
  solarSegments?: SolarSegment[],
  predominantPitch: string = '6/12'
): AreaCalculationResult {
  const reviewReasons: string[] = [];
  let calculationMethod = 'unknown';
  let facets: ComputedFacet[] = [];
  let quality = 0;
  
  // Prefer Solar segments when available (most accurate)
  if (solarSegments && solarSegments.length >= 2) {
    const result = createFacetsFromSolarSegments(solarSegments, topology);
    facets = result.facets;
    quality = result.quality;
    calculationMethod = `solar_segments_${topology.ridgeSource}`;
    console.log(`✓ Created ${facets.length} facets from Solar segments (quality: ${(quality * 100).toFixed(0)}%)`);
    
  } else {
    // Fallback to skeleton-based splitting
    const result = createFacetsFromSkeleton(topology, predominantPitch);
    facets = result.facets;
    quality = result.quality;
    calculationMethod = `skeleton_split_${topology.ridgeSource}`;
    
    if (facets.length === 0) {
      reviewReasons.push('Complex shape - manual facet definition required');
    }
  }
  
  // Calculate totals
  const planAreaSqft = facets.reduce((sum, f) => sum + f.planAreaSqft, 0);
  const slopedAreaSqft = facets.reduce((sum, f) => sum + f.slopedAreaSqft, 0);
  
  // If no facets but we have footprint, calculate area from footprint
  let finalPlanArea = planAreaSqft;
  let finalSlopedArea = slopedAreaSqft;
  
  if (facets.length === 0 && topology.footprintCoords.length >= 3) {
    finalPlanArea = calculatePolygonAreaSqft(topology.footprintCoords);
    const slopeFactor = getSlopeFactorFromPitch(predominantPitch);
    finalSlopedArea = finalPlanArea * slopeFactor;
    reviewReasons.push('Area calculated from footprint - facets not split');
  }
  
  // Calculate linear totals
  const linearTotals = calculateLinearTotals(topology);
  
  // Determine if manual review is needed
  const requiresManualReview = 
    quality < 0.7 || 
    facets.length === 0 || 
    facets.length === 1 ||
    topology.warnings.length > 0 ||
    reviewReasons.length > 0;
  
  if (topology.warnings.length > 0) {
    reviewReasons.push(...topology.warnings);
  }
  
  return {
    facets,
    totals: {
      planAreaSqft: finalPlanArea,
      slopedAreaSqft: finalSlopedArea,
      squares: finalSlopedArea / 100,
      predominantPitch: facets.length > 0 ? findPredominantPitch(facets) : predominantPitch
    },
    linearTotals,
    calculationMethod,
    requiresManualReview,
    reviewReasons
  };
}
