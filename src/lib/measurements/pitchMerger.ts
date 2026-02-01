/**
 * Pitch Merger Utility
 * 
 * Consolidates pitch/slope data from multiple sources into a unified model.
 * Priority order: Manual > Solar API segments > AI detection > Default
 */

export interface PitchSource {
  source: 'manual' | 'solar_api' | 'ai_detection' | 'default';
  pitch: string;
  confidence: number;
  azimuth?: number;
  facetIndex?: number;
}

export interface FacetPitch {
  facetIndex: number;
  pitch: string;
  pitchDegrees: number;
  slopeFactor: number;
  source: string;
  confidence: number;
}

// Standard pitch-to-slope-factor lookup
const PITCH_SLOPE_FACTORS: Record<string, number> = {
  'flat': 1.0,
  '0/12': 1.0,
  '1/12': 1.003,
  '2/12': 1.014,
  '3/12': 1.031,
  '4/12': 1.054,
  '5/12': 1.083,
  '6/12': 1.118,
  '7/12': 1.158,
  '8/12': 1.202,
  '9/12': 1.250,
  '10/12': 1.302,
  '11/12': 1.357,
  '12/12': 1.414,
  '13/12': 1.474,
  '14/12': 1.537,
  '15/12': 1.601,
  '16/12': 1.667,
};

/**
 * Convert pitch degrees to standard notation (e.g., 26.57° → "6/12")
 */
export function degreesToPitchNotation(degrees: number): string {
  // tan(degrees) = rise/12
  const rise = Math.round(Math.tan(degrees * Math.PI / 180) * 12);
  const clampedRise = Math.max(0, Math.min(16, rise));
  return `${clampedRise}/12`;
}

/**
 * Convert pitch notation to degrees (e.g., "6/12" → 26.57°)
 */
export function pitchNotationToDegrees(pitch: string): number {
  const match = pitch.match(/(\d+)\/12/);
  if (!match) return 0;
  const rise = parseInt(match[1], 10);
  return Math.atan(rise / 12) * 180 / Math.PI;
}

/**
 * Get slope factor for a pitch value
 */
export function getSlopeFactor(pitch: string): number {
  return PITCH_SLOPE_FACTORS[pitch] || PITCH_SLOPE_FACTORS['6/12'];
}

/**
 * Merge all pitch sources into a unified model per facet
 * 
 * @param measurement - The roof measurement record
 * @returns Map of facet index to unified pitch data
 */
export function mergeAllPitchSources(measurement: any): Map<number, FacetPitch> {
  const facetPitches = new Map<number, FacetPitch>();
  
  // Source 1: Solar API segments (high priority for pitch accuracy)
  const solarSegments = measurement?.solar_api_response?.roofSegments || [];
  solarSegments.forEach((seg: any, idx: number) => {
    if (seg.pitchDegrees !== undefined) {
      const pitch = degreesToPitchNotation(seg.pitchDegrees);
      facetPitches.set(idx, {
        facetIndex: idx,
        pitch,
        pitchDegrees: seg.pitchDegrees,
        slopeFactor: getSlopeFactor(pitch),
        source: 'solar_api',
        confidence: 0.85,
      });
    }
  });
  
  // Source 2: Database facets with manual pitch overrides
  const dbFacets = measurement?.facets_json || [];
  if (Array.isArray(dbFacets)) {
    dbFacets.forEach((facet: any, idx: number) => {
      if (facet.pitch && facet.pitchSource === 'manual') {
        // Manual always overrides
        facetPitches.set(idx, {
          facetIndex: idx,
          pitch: facet.pitch,
          pitchDegrees: pitchNotationToDegrees(facet.pitch),
          slopeFactor: getSlopeFactor(facet.pitch),
          source: 'manual',
          confidence: 1.0,
        });
      } else if (facet.pitch || facet.estimatedPitch) {
        // Only use if Solar API didn't provide data for this facet
        if (!facetPitches.has(idx)) {
          const pitch = facet.pitch || facet.estimatedPitch;
          facetPitches.set(idx, {
            facetIndex: idx,
            pitch,
            pitchDegrees: pitchNotationToDegrees(pitch),
            slopeFactor: getSlopeFactor(pitch),
            source: 'ai_detection',
            confidence: 0.7,
          });
        }
      }
    });
  }
  
  // Source 3: AI detection passes
  const aiPasses = measurement?.ai_detection_data?.pitchEstimates || [];
  aiPasses.forEach((estimate: any) => {
    if (estimate.facetIndex !== undefined && !facetPitches.has(estimate.facetIndex)) {
      const pitch = estimate.pitch || degreesToPitchNotation(estimate.pitchDegrees || 0);
      facetPitches.set(estimate.facetIndex, {
        facetIndex: estimate.facetIndex,
        pitch,
        pitchDegrees: estimate.pitchDegrees || pitchNotationToDegrees(pitch),
        slopeFactor: getSlopeFactor(pitch),
        source: 'ai_detection',
        confidence: estimate.confidence || 0.6,
      });
    }
  });
  
  return facetPitches;
}

/**
 * Get the predominant pitch across all facets
 * Uses weighted average based on facet areas if available
 */
export function getPredominantPitch(
  measurement: any,
  facetPitches?: Map<number, FacetPitch>
): string {
  // First check explicit predominant_pitch from measurement
  if (measurement?.predominant_pitch) {
    return measurement.predominant_pitch;
  }
  
  // Get pitches from merged sources if not provided
  const pitches = facetPitches || mergeAllPitchSources(measurement);
  
  if (pitches.size === 0) {
    return '6/12'; // Default pitch
  }
  
  // Get facet areas for weighting
  const facets = measurement?.facets_json || [];
  const areas = new Map<number, number>();
  if (Array.isArray(facets)) {
    facets.forEach((f: any, idx: number) => {
      areas.set(idx, f.areaSqft || f.area_flat_sqft || 100);
    });
  }
  
  // Weighted average of pitch degrees
  let totalWeight = 0;
  let weightedSum = 0;
  
  pitches.forEach((facetPitch, idx) => {
    const area = areas.get(idx) || 100;
    totalWeight += area;
    weightedSum += facetPitch.pitchDegrees * area;
  });
  
  if (totalWeight === 0) {
    return '6/12';
  }
  
  const avgDegrees = weightedSum / totalWeight;
  return degreesToPitchNotation(avgDegrees);
}

/**
 * Apply pitch data to facets for display
 */
export function applyPitchToFacets(
  facets: any[],
  measurement: any
): any[] {
  const pitchMap = mergeAllPitchSources(measurement);
  
  return facets.map((facet, idx) => {
    const pitchData = pitchMap.get(idx);
    
    if (pitchData) {
      return {
        ...facet,
        pitch: pitchData.pitch,
        pitchDegrees: pitchData.pitchDegrees,
        slopeFactor: pitchData.slopeFactor,
        pitchSource: pitchData.source,
        pitchConfidence: pitchData.confidence,
        // Recalculate adjusted area with proper slope factor
        area_adjusted_sqft: (facet.area_flat_sqft || facet.areaSqft || 0) * pitchData.slopeFactor,
      };
    }
    
    return facet;
  });
}
