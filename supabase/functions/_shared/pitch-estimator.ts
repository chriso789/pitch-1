/**
 * Multi-Source Pitch Estimation Module
 * Phase 3: Advanced Pitch Detection
 * 
 * Combines multiple data sources for accurate roof pitch determination:
 * 1. Solar API segments (ground truth)
 * 2. Shadow analysis
 * 3. AI model prediction
 * 4. User override
 * 5. Regional defaults
 */

// ===== TYPES =====

export interface PitchSource {
  source: 'solar_api' | 'shadow_analysis' | 'ai_prediction' | 'user_override' | 'regional_default';
  pitch: string;
  confidence: number;
  details?: string;
}

export interface PitchEstimationResult {
  selectedPitch: string;
  selectedSource: PitchSource['source'];
  confidence: number;
  allSources: PitchSource[];
  slopeFactor: number;
  degrees: number;
  reasoning: string;
}

export interface SolarSegment {
  pitchDegrees?: number;
  azimuthDegrees?: number;
  areaMeters2?: number;
}

export interface ShadowAnalysisInput {
  shadowLengthFt?: number;
  roofEdgeFt?: number;
  sunAltitudeDegrees?: number;
  imageTimestamp?: string;
}

// ===== PITCH UTILITIES =====

/**
 * Convert degrees to X/12 pitch format
 */
export function degreesToPitch(degrees: number): string {
  const radians = degrees * Math.PI / 180;
  const rise = Math.tan(radians) * 12;
  const roundedRise = Math.round(rise);
  
  // Clamp to valid range
  if (roundedRise <= 0) return 'flat';
  if (roundedRise > 18) return '18/12';
  
  return `${roundedRise}/12`;
}

/**
 * Convert X/12 pitch to degrees
 */
export function pitchToDegrees(pitch: string): number {
  if (pitch === 'flat') return 0;
  
  const match = pitch.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
  if (!match) return 0;
  
  const rise = parseFloat(match[1]);
  const run = parseFloat(match[2]) || 12;
  
  return Math.atan(rise / run) * 180 / Math.PI;
}

/**
 * Calculate slope factor from pitch
 * slope_factor = sqrt(1 + (rise/run)²)
 */
export function calculateSlopeFactor(pitch: string): number {
  if (pitch === 'flat') return 1.0;
  
  const match = pitch.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
  if (!match) return 1.0;
  
  const rise = parseFloat(match[1]);
  const run = parseFloat(match[2]) || 12;
  const p = rise / run;
  
  return Math.sqrt(1 + p * p);
}

/**
 * Standard pitch lookup table
 */
const STANDARD_PITCHES: Array<{ pitch: string; degrees: number; slopeFactor: number }> = [
  { pitch: 'flat', degrees: 0, slopeFactor: 1.0 },
  { pitch: '1/12', degrees: 4.76, slopeFactor: 1.0035 },
  { pitch: '2/12', degrees: 9.46, slopeFactor: 1.0138 },
  { pitch: '3/12', degrees: 14.04, slopeFactor: 1.0308 },
  { pitch: '4/12', degrees: 18.43, slopeFactor: 1.0541 },
  { pitch: '5/12', degrees: 22.62, slopeFactor: 1.0833 },
  { pitch: '6/12', degrees: 26.57, slopeFactor: 1.1180 },
  { pitch: '7/12', degrees: 30.26, slopeFactor: 1.1577 },
  { pitch: '8/12', degrees: 33.69, slopeFactor: 1.2019 },
  { pitch: '9/12', degrees: 36.87, slopeFactor: 1.2500 },
  { pitch: '10/12', degrees: 39.81, slopeFactor: 1.3017 },
  { pitch: '11/12', degrees: 42.51, slopeFactor: 1.3566 },
  { pitch: '12/12', degrees: 45.0, slopeFactor: 1.4142 },
];

/**
 * Snap degrees to nearest standard pitch
 */
export function snapToStandardPitch(degrees: number): string {
  let closest = STANDARD_PITCHES[0];
  let minDiff = Math.abs(degrees - closest.degrees);
  
  for (const entry of STANDARD_PITCHES) {
    const diff = Math.abs(degrees - entry.degrees);
    if (diff < minDiff) {
      minDiff = diff;
      closest = entry;
    }
  }
  
  return closest.pitch;
}

// ===== SOURCE-SPECIFIC ESTIMATION =====

/**
 * Estimate pitch from Solar API segments
 * Most reliable source - uses weighted average by area
 */
function estimateFromSolarAPI(segments: SolarSegment[]): PitchSource | null {
  if (!segments || segments.length === 0) return null;
  
  let totalWeight = 0;
  let weightedSum = 0;
  
  for (const seg of segments) {
    const degrees = seg.pitchDegrees ?? 20; // Default assumption
    const weight = seg.areaMeters2 || 1;
    
    weightedSum += degrees * weight;
    totalWeight += weight;
  }
  
  if (totalWeight === 0) return null;
  
  const avgDegrees = weightedSum / totalWeight;
  const pitch = snapToStandardPitch(avgDegrees);
  
  return {
    source: 'solar_api',
    pitch,
    confidence: 0.95,
    details: `Weighted average from ${segments.length} segments: ${avgDegrees.toFixed(1)}°`,
  };
}

/**
 * Estimate pitch from shadow analysis
 * Requires visible shadows and known sun position
 */
function estimateFromShadow(input: ShadowAnalysisInput): PitchSource | null {
  const { shadowLengthFt, roofEdgeFt, sunAltitudeDegrees } = input;
  
  if (!shadowLengthFt || !roofEdgeFt || !sunAltitudeDegrees) {
    return null;
  }
  
  // Shadow-based pitch calculation
  // If we know shadow length and sun altitude, we can estimate roof height
  // height = shadow_length * tan(sun_altitude)
  // pitch_angle = atan(height / (roof_width / 2))
  
  const sunAltRad = sunAltitudeDegrees * Math.PI / 180;
  const roofHeight = shadowLengthFt * Math.tan(sunAltRad);
  
  // Assume roof width is approximately equal to edge length
  const halfWidth = roofEdgeFt / 2;
  const pitchDegrees = Math.atan(roofHeight / halfWidth) * 180 / Math.PI;
  
  // Clamp to reasonable range
  const clampedDegrees = Math.max(0, Math.min(60, pitchDegrees));
  const pitch = snapToStandardPitch(clampedDegrees);
  
  return {
    source: 'shadow_analysis',
    pitch,
    confidence: 0.7,
    details: `Shadow ${shadowLengthFt.toFixed(1)}ft at sun altitude ${sunAltitudeDegrees.toFixed(1)}°`,
  };
}

/**
 * Pitch from AI model prediction
 */
function estimateFromAI(aiPrediction: string, aiConfidence: number): PitchSource | null {
  if (!aiPrediction) return null;
  
  // Validate pitch format
  const match = aiPrediction.match(/(\d+)\s*\/\s*12/);
  if (!match) return null;
  
  const rise = parseInt(match[1]);
  if (rise < 0 || rise > 18) return null;
  
  return {
    source: 'ai_prediction',
    pitch: `${rise}/12`,
    confidence: Math.min(0.85, aiConfidence),
    details: `AI-detected pitch with ${(aiConfidence * 100).toFixed(0)}% confidence`,
  };
}

/**
 * User-specified override
 */
function getUserOverride(userPitch: string): PitchSource | null {
  if (!userPitch) return null;
  
  // Validate format
  if (userPitch === 'flat') {
    return {
      source: 'user_override',
      pitch: 'flat',
      confidence: 1.0,
      details: 'User-specified flat roof',
    };
  }
  
  const match = userPitch.match(/(\d+)\s*\/\s*12/);
  if (!match) return null;
  
  const rise = parseInt(match[1]);
  if (rise < 0 || rise > 18) return null;
  
  return {
    source: 'user_override',
    pitch: `${rise}/12`,
    confidence: 0.98, // Slightly less than 1.0 to allow for user error
    details: 'User-specified pitch value',
  };
}

/**
 * Regional default based on location
 */
function getRegionalDefault(state?: string, latitude?: number): PitchSource {
  let pitch = '6/12'; // Universal default
  let details = 'Default residential pitch';
  
  if (state) {
    const lowerState = state.toLowerCase();
    
    // Florida: Lower pitch for hurricane resistance
    if (lowerState === 'fl' || lowerState === 'florida') {
      pitch = '5/12';
      details = 'Florida regional default (hurricane resistance)';
    }
    // Northeast: Steeper for snow shedding
    else if (['me', 'nh', 'vt', 'ma', 'ct', 'ri', 'ny', 'nj', 'pa'].includes(lowerState) ||
             ['maine', 'new hampshire', 'vermont', 'massachusetts', 'connecticut', 
              'rhode island', 'new york', 'new jersey', 'pennsylvania'].includes(lowerState)) {
      pitch = '8/12';
      details = 'Northeast regional default (snow shedding)';
    }
    // Midwest: Moderate pitch
    else if (['oh', 'mi', 'in', 'il', 'wi', 'mn', 'ia', 'mo'].includes(lowerState)) {
      pitch = '7/12';
      details = 'Midwest regional default';
    }
    // Southwest: Lower pitch for flat/desert style
    else if (['az', 'nm', 'nv'].includes(lowerState) ||
             ['arizona', 'new mexico', 'nevada'].includes(lowerState)) {
      pitch = '4/12';
      details = 'Southwest regional default (low-slope common)';
    }
  }
  
  // Latitude-based fallback
  if (latitude !== undefined) {
    if (latitude > 45) {
      pitch = '8/12';
      details = 'Northern latitude default (snow regions)';
    } else if (latitude < 30) {
      pitch = '5/12';
      details = 'Southern latitude default (warm climate)';
    }
  }
  
  return {
    source: 'regional_default',
    pitch,
    confidence: 0.5,
    details,
  };
}

// ===== MAIN EXPORT =====

export interface EstimatePitchInput {
  solarSegments?: SolarSegment[];
  shadowAnalysis?: ShadowAnalysisInput;
  aiPrediction?: string;
  aiConfidence?: number;
  userOverride?: string;
  state?: string;
  latitude?: number;
}

/**
 * Estimate roof pitch using all available sources
 * Returns the most reliable estimate with full reasoning
 */
export function estimatePitch(input: EstimatePitchInput): PitchEstimationResult {
  const allSources: PitchSource[] = [];
  
  // Collect all available sources
  
  // 1. User override (highest priority when provided)
  if (input.userOverride) {
    const userSource = getUserOverride(input.userOverride);
    if (userSource) allSources.push(userSource);
  }
  
  // 2. Solar API (ground truth)
  if (input.solarSegments) {
    const solarSource = estimateFromSolarAPI(input.solarSegments);
    if (solarSource) allSources.push(solarSource);
  }
  
  // 3. Shadow analysis
  if (input.shadowAnalysis) {
    const shadowSource = estimateFromShadow(input.shadowAnalysis);
    if (shadowSource) allSources.push(shadowSource);
  }
  
  // 4. AI prediction
  if (input.aiPrediction) {
    const aiSource = estimateFromAI(input.aiPrediction, input.aiConfidence || 0.7);
    if (aiSource) allSources.push(aiSource);
  }
  
  // 5. Regional default (always available as fallback)
  allSources.push(getRegionalDefault(input.state, input.latitude));
  
  // Sort by confidence (highest first)
  allSources.sort((a, b) => b.confidence - a.confidence);
  
  // Select the highest-confidence source
  const selected = allSources[0];
  const slopeFactor = calculateSlopeFactor(selected.pitch);
  const degrees = pitchToDegrees(selected.pitch);
  
  // Build reasoning string
  const reasoning = buildReasoning(allSources, selected);
  
  return {
    selectedPitch: selected.pitch,
    selectedSource: selected.source,
    confidence: selected.confidence,
    allSources,
    slopeFactor,
    degrees,
    reasoning,
  };
}

function buildReasoning(sources: PitchSource[], selected: PitchSource): string {
  const lines: string[] = [];
  
  lines.push(`Selected pitch: ${selected.pitch} (${selected.source})`);
  lines.push(`Confidence: ${(selected.confidence * 100).toFixed(0)}%`);
  
  if (sources.length > 1) {
    lines.push('');
    lines.push('Sources considered:');
    for (const source of sources) {
      const marker = source === selected ? '→' : ' ';
      lines.push(`${marker} ${source.source}: ${source.pitch} (${(source.confidence * 100).toFixed(0)}%) - ${source.details || ''}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * Get predominant pitch from multiple facets
 * Uses area-weighted average
 */
export function getPredominantPitch(
  facets: Array<{ pitch: string; areaSqft: number }>
): string {
  if (!facets || facets.length === 0) return '6/12';
  
  let totalArea = 0;
  let weightedDegrees = 0;
  
  for (const facet of facets) {
    const degrees = pitchToDegrees(facet.pitch);
    weightedDegrees += degrees * facet.areaSqft;
    totalArea += facet.areaSqft;
  }
  
  if (totalArea === 0) return '6/12';
  
  const avgDegrees = weightedDegrees / totalArea;
  return snapToStandardPitch(avgDegrees);
}

/**
 * Validate a pitch string
 */
export function isValidPitch(pitch: string): boolean {
  if (pitch === 'flat') return true;
  
  const match = pitch.match(/^(\d+)\s*\/\s*12$/);
  if (!match) return false;
  
  const rise = parseInt(match[1]);
  return rise >= 0 && rise <= 18;
}
