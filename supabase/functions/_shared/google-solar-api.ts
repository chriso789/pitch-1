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
