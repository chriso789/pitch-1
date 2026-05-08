// Google Solar API Client
// Centralized Solar API fetching for all measurement functions
// Reads API key from environment - no external dependencies needed

export interface SolarAPIData {
  available: boolean;
  buildingFootprintSqft?: number;
  estimatedPerimeterFt?: number;
  roofSegments?: SolarSegment[];
  boundingBox?: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  imageryQuality?: string;
  imageryDate?: string;
  center?: { latitude: number; longitude: number };
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

/**
 * Fetch building insights from Google Solar API
 * Reads GOOGLE_SOLAR_API_KEY from environment if not provided
 */
export async function fetchGoogleSolarData(
  lat: number,
  lng: number,
  apiKey?: string
): Promise<SolarAPIData> {
  const key = apiKey || Deno.env.get('GOOGLE_SOLAR_API_KEY') || '';
  
  if (!key) {
    console.warn('⚠️ GOOGLE_SOLAR_API_KEY not configured');
    return { available: false };
  }
  
  try {
    console.log(`🌞 Fetching Solar API data for (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
    
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${key}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Solar API error: ${response.status} - ${errorText}`);
      return { available: false };
    }
    
    const data = await response.json();
    
    // Extract roof segments with pitch and azimuth
    const roofSegments: SolarSegment[] = data.solarPotential?.roofSegmentStats?.map((seg: any) => ({
      pitchDegrees: seg.pitchDegrees ?? 20,
      azimuthDegrees: seg.azimuthDegrees ?? 0,
      areaMeters2: seg.stats?.areaMeters2,
      stats: seg.stats,
      boundingBox: seg.boundingBox,
    })) || [];
    
    // Calculate total roof area
    const wholeRoofAreaM2 = data.solarPotential?.wholeRoofStats?.areaMeters2;
    const buildingFootprintSqft = wholeRoofAreaM2 
      ? wholeRoofAreaM2 * 10.7639 
      : undefined;
    
    // Estimate perimeter from bounding box
    let estimatedPerimeterFt: number | undefined;
    if (data.boundingBox) {
      const sw = data.boundingBox.sw;
      const ne = data.boundingBox.ne;
      const widthDeg = Math.abs(ne.longitude - sw.longitude);
      const heightDeg = Math.abs(ne.latitude - sw.latitude);
      const avgLat = (sw.latitude + ne.latitude) / 2;
      const metersPerDegLng = 111320 * Math.cos(avgLat * Math.PI / 180);
      const metersPerDegLat = 111320;
      const widthM = widthDeg * metersPerDegLng;
      const heightM = heightDeg * metersPerDegLat;
      estimatedPerimeterFt = (2 * widthM + 2 * heightM) * 3.28084;
    }
    
    console.log(`✅ Solar API: ${roofSegments.length} segments, ${buildingFootprintSqft?.toFixed(0) || 'N/A'} sqft`);
    
    return {
      available: true,
      buildingFootprintSqft,
      estimatedPerimeterFt,
      roofSegments,
      boundingBox: data.boundingBox,
      imageryQuality: data.imageryQuality,
      imageryDate: data.imageryDate,
      center: data.center,
    };
    
  } catch (error) {
    console.error('Solar API fetch failed:', error);
    return { available: false };
  }
}

/**
 * Get the predominant pitch from Solar segments
 */
export function getPredominantPitchFromSolar(solarData: SolarAPIData): string {
  if (!solarData.roofSegments || solarData.roofSegments.length === 0) {
    return '6/12'; // Default assumption
  }
  
  // Weight by area if available, otherwise count
  const pitchCounts: Map<number, number> = new Map();
  
  for (const seg of solarData.roofSegments) {
    const pitchBin = Math.round(seg.pitchDegrees / 5) * 5; // Round to nearest 5°
    const weight = seg.areaMeters2 || 1;
    pitchCounts.set(pitchBin, (pitchCounts.get(pitchBin) || 0) + weight);
  }
  
  // Find most common pitch
  let maxWeight = 0;
  let dominantPitch = 20; // Default ~4.5/12
  
  for (const [pitch, weight] of pitchCounts) {
    if (weight > maxWeight) {
      maxWeight = weight;
      dominantPitch = pitch;
    }
  }
  
  // Convert degrees to x/12 ratio
  const rise = Math.tan(dominantPitch * Math.PI / 180) * 12;
  const roundedRise = Math.round(rise);
  
  return `${roundedRise}/12`;
}

/**
 * Analyze solar segment orientations to determine ridge direction
 */
export function analyzeRidgeDirectionFromSolar(solarData: SolarAPIData): {
  direction: 'east-west' | 'north-south' | 'unknown';
  confidence: number;
} {
  if (!solarData.roofSegments || solarData.roofSegments.length < 2) {
    return { direction: 'unknown', confidence: 0 };
  }
  
  // Group segments by azimuth quadrant
  const eastWestCount = solarData.roofSegments.filter(
    seg => (seg.azimuthDegrees >= 45 && seg.azimuthDegrees < 135) ||
           (seg.azimuthDegrees >= 225 && seg.azimuthDegrees < 315)
  ).length;
  
  const northSouthCount = solarData.roofSegments.filter(
    seg => (seg.azimuthDegrees >= 0 && seg.azimuthDegrees < 45) ||
           (seg.azimuthDegrees >= 135 && seg.azimuthDegrees < 225) ||
           (seg.azimuthDegrees >= 315 && seg.azimuthDegrees <= 360)
  ).length;
  
  const total = solarData.roofSegments.length;
  
  if (northSouthCount > eastWestCount) {
    // N/S facing segments = E/W ridge
    return {
      direction: 'east-west',
      confidence: northSouthCount / total
    };
  } else if (eastWestCount > northSouthCount) {
    // E/W facing segments = N/S ridge
    return {
      direction: 'north-south',
      confidence: eastWestCount / total
    };
  }
  
  return { direction: 'unknown', confidence: 0.5 };
}

// ============================================
// DATA LAYERS METADATA
// ============================================

export interface SolarDataLayersMetadata {
  available: boolean;
  imageryDate?: { year: number; month: number; day: number };
  imageryQuality?: string;
  dsmUrl?: string;
  rgbUrl?: string;
  maskUrl?: string;
  annualFluxUrl?: string;
  monthlyFluxUrl?: string;
  hourlyShadeUrls?: string[];
  imageryProcessedDate?: string;
}

/**
 * Fetch Solar API data layers metadata (DSM/RGB/mask URLs, imagery date).
 * Provides provenance info for training data and quality assessment.
 */
export async function fetchGoogleSolarDataLayers(
  lat: number,
  lng: number,
  radiusMeters = 35,
  apiKey?: string
): Promise<SolarDataLayersMetadata> {
  const key = apiKey || Deno.env.get('GOOGLE_SOLAR_API_KEY') || '';
  
  if (!key) {
    return { available: false };
  }
  
  try {
    const url = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=${radiusMeters}&view=FULL_LAYERS&requiredQuality=HIGH&pixelSizeMeters=0.1&key=${key}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.warn(`Solar DataLayers error: ${response.status}`);
      return { available: false };
    }
    
    const data = await response.json();
    
    return {
      available: true,
      imageryDate: data.imageryDate,
      imageryQuality: data.imageryQuality,
      dsmUrl: data.dsmUrl,
      rgbUrl: data.rgbUrl,
      maskUrl: data.maskUrl,
      annualFluxUrl: data.annualFluxUrl,
      monthlyFluxUrl: data.monthlyFluxUrl,
      hourlyShadeUrls: data.hourlyShadeUrls,
      imageryProcessedDate: data.imageryProcessedDate,
    };
  } catch (error) {
    console.error('Solar DataLayers fetch failed:', error);
    return { available: false };
  }
}

// ═══════════════════════════════════════════════════
// SOLAR TOPOLOGY PRIORS EXTRACTION
// ═══════════════════════════════════════════════════

import type { SolarTopologyPrior, SolarSegmentPrior, InferredEdge } from "./constraint-roof-solver.ts";

type PxPt = { x: number; y: number };

/**
 * Extract topology priors from Google Solar API data for the constraint solver.
 * Converts Solar segments into constraint-ready priors with pitch locking,
 * segment adjacency, and inferred ridge/valley directions.
 */
export function extractSolarTopologyPriors(
  solarData: any,
  geoToPx: (lat: number, lng: number) => PxPt,
): SolarTopologyPrior | null {
  const segments = solarData?.solarPotential?.roofSegmentStats || [];
  if (segments.length < 2) return null;

  // Compute area-weighted dominant pitch
  let totalWeight = 0;
  let weightedPitch = 0;
  let totalAreaSqft = 0;
  for (const seg of segments) {
    const area = seg.stats?.areaMeters2 || 0;
    const areaSqft = area * 10.7639;
    const pitch = seg.pitchDegrees ?? 0;
    if (pitch >= 1) {
      weightedPitch += pitch * area;
      totalWeight += area;
    }
    totalAreaSqft += areaSqft;
  }
  if (totalWeight === 0) return null;

  const dominantPitchDeg = weightedPitch / totalWeight;
  const dominantRise = Math.tan(dominantPitchDeg * Math.PI / 180) * 12;
  const roundedRise = Math.round(dominantRise * 10) / 10;

  // Build segment priors
  const segmentPriors: SolarSegmentPrior[] = segments.map((seg: any, i: number) => {
    const area = (seg.stats?.areaMeters2 || 0) * 10.7639;
    let centerPx: PxPt | null = null;
    let bboxPx: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

    if (seg.center?.latitude != null && seg.center?.longitude != null) {
      centerPx = geoToPx(seg.center.latitude, seg.center.longitude);
    }
    if (seg.boundingBox?.sw && seg.boundingBox?.ne) {
      const sw = geoToPx(seg.boundingBox.sw.latitude, seg.boundingBox.sw.longitude);
      const ne = geoToPx(seg.boundingBox.ne.latitude, seg.boundingBox.ne.longitude);
      bboxPx = {
        minX: Math.min(sw.x, ne.x), minY: Math.min(sw.y, ne.y),
        maxX: Math.max(sw.x, ne.x), maxY: Math.max(sw.y, ne.y),
      };
    }

    return {
      index: i,
      pitch_deg: seg.pitchDegrees ?? dominantPitchDeg,
      azimuth_deg: seg.azimuthDegrees ?? 0,
      area_sqft: area,
      center_px: centerPx,
      bbox_px: bboxPx,
    };
  });

  // Build adjacency from bounding box proximity
  const adjacency: [number, number][] = [];
  const inferredRidges: InferredEdge[] = [];
  const inferredValleys: InferredEdge[] = [];

  for (let i = 0; i < segmentPriors.length; i++) {
    for (let j = i + 1; j < segmentPriors.length; j++) {
      const si = segmentPriors[i];
      const sj = segmentPriors[j];
      if (!si.center_px || !sj.center_px) continue;

      const dist = Math.hypot(si.center_px.x - sj.center_px.x, si.center_px.y - sj.center_px.y);
      if (dist > 200) continue; // Too far apart

      adjacency.push([i, j]);

      // Classify edge between adjacent segments
      const azDiff = Math.abs(si.azimuth_deg - sj.azimuth_deg);
      const normDiff = Math.min(azDiff, 360 - azDiff);
      const mid = si.center_px && sj.center_px
        ? { x: (si.center_px.x + sj.center_px.x) / 2, y: (si.center_px.y + sj.center_px.y) / 2 }
        : null;

      if (normDiff > 120) {
        inferredRidges.push({
          from_segment: i, to_segment: j, type: 'ridge',
          midpoint_px: mid, confidence: Math.min(1, normDiff / 180),
        });
      } else if (normDiff > 60) {
        inferredValleys.push({
          from_segment: i, to_segment: j, type: 'valley',
          midpoint_px: mid, confidence: Math.min(1, normDiff / 120),
        });
      }
    }
  }

  const wholeRoofAreaSqft = (solarData?.solarPotential?.wholeRoofStats?.areaMeters2 || 0) * 10.7639;

  return {
    dominant_pitch_deg: dominantPitchDeg,
    dominant_pitch_rise: roundedRise,
    pitch_band: [Math.max(0.5, roundedRise - 1), roundedRise + 1],
    segments: segmentPriors,
    segment_adjacency: adjacency,
    inferred_ridges: inferredRidges,
    inferred_valleys: inferredValleys,
    expected_facet_count: Math.max(4, segments.length),
    total_pitched_area_sqft: totalAreaSqft,
    whole_roof_area_sqft: wholeRoofAreaSqft || totalAreaSqft,
  };
}
