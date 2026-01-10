// Phase 5: Self-Evaluation & Correction Loop
// Compares AI-generated overlays against user traces and satellite image features
// Provides alignment scoring and auto-correction recommendations

type XY = [number, number]; // [lng, lat]

export interface LinearFeature {
  id: string;
  wkt: string;
  length_ft: number;
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  source?: 'dsm' | 'solar_segment' | 'skeleton' | 'ai_vision' | 'manual';
  confidence?: number;
}

export interface UserTrace {
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  points: XY[];
  length_ft: number;
}

export interface DeviationResult {
  featureId: string;
  featureType: string;
  avgDeviationFt: number;
  maxDeviationFt: number;
  alignmentScore: number; // 0-1 where 1 is perfect alignment
  needsCorrection: boolean;
  correctedWkt?: string;
}

export interface EvaluationResult {
  overallScore: number; // 0-100
  deviations: DeviationResult[];
  missingFeatures: { type: string; count: number }[];
  extraFeatures: { type: string; count: number }[];
  recommendations: string[];
  autoCorrections: Array<{
    originalId: string;
    originalWkt: string;
    correctedWkt: string;
    deviationFt: number;
  }>;
}

// Constants for evaluation thresholds
const DEVIATION_THRESHOLD_FT = 2.0; // Max acceptable deviation
const ALIGNMENT_THRESHOLD = 0.85; // Minimum acceptable alignment score
const POINT_MATCH_RADIUS_FT = 5.0; // Radius for matching endpoints

/**
 * Evaluate AI-generated overlay against user traces
 * Returns detailed deviation analysis and auto-corrections
 */
export function evaluateOverlay(
  aiFeatures: LinearFeature[],
  userTraces: UserTrace[],
  footprintCoords: XY[]
): EvaluationResult {
  const deviations: DeviationResult[] = [];
  const autoCorrections: EvaluationResult['autoCorrections'] = [];
  const recommendations: string[] = [];
  
  // Group features by type
  const aiByType = groupByType(aiFeatures);
  const userByType = groupUserTracesByType(userTraces);
  
  // Analyze each feature type
  const featureTypes: Array<'ridge' | 'hip' | 'valley' | 'eave' | 'rake'> = ['ridge', 'hip', 'valley', 'eave', 'rake'];
  
  for (const type of featureTypes) {
    const aiOfType = aiByType.get(type) || [];
    const userOfType = userByType.get(type) || [];
    
    if (aiOfType.length === 0 && userOfType.length === 0) {
      continue;
    }
    
    // Match AI features to user traces
    for (const aiFeature of aiOfType) {
      const aiCoords = parseWktLinestring(aiFeature.wkt);
      if (!aiCoords) continue;
      
      // Find closest matching user trace
      let bestMatch: { trace: UserTrace; deviation: number } | null = null;
      
      for (const trace of userOfType) {
        if (!trace?.points || trace.points.length < 2) continue;
        const deviation = calculateLineDeviation(aiCoords, trace.points);
        if (!bestMatch || deviation < bestMatch.deviation) {
          bestMatch = { trace, deviation };
        }
      }
      
      if (bestMatch) {
        const alignmentScore = Math.max(0, 1 - bestMatch.deviation / 10); // Normalize to 0-1
        const needsCorrection = bestMatch.deviation > DEVIATION_THRESHOLD_FT || alignmentScore < ALIGNMENT_THRESHOLD;
        
        deviations.push({
          featureId: aiFeature.id,
          featureType: type,
          avgDeviationFt: bestMatch.deviation,
          maxDeviationFt: bestMatch.deviation * 1.5, // Estimate
          alignmentScore,
          needsCorrection,
          correctedWkt: needsCorrection ? pointsToWkt(bestMatch.trace.points) : undefined
        });
        
        if (needsCorrection) {
          autoCorrections.push({
            originalId: aiFeature.id,
            originalWkt: aiFeature.wkt,
            correctedWkt: pointsToWkt(bestMatch.trace.points),
            deviationFt: bestMatch.deviation
          });
          
          recommendations.push(
            `${type} ${aiFeature.id}: Deviation of ${bestMatch.deviation.toFixed(1)}ft from user trace. Auto-correction available.`
          );
        }
      } else {
        // No matching user trace - flag as potentially extra
        deviations.push({
          featureId: aiFeature.id,
          featureType: type,
          avgDeviationFt: 0,
          maxDeviationFt: 0,
          alignmentScore: 0.5, // Unknown alignment
          needsCorrection: false
        });
      }
    }
  }
  
  // Identify missing features (user traced but AI didn't detect)
  const missingFeatures: EvaluationResult['missingFeatures'] = [];
  const extraFeatures: EvaluationResult['extraFeatures'] = [];
  
  for (const type of featureTypes) {
    const aiCount = (aiByType.get(type) || []).length;
    const userCount = (userByType.get(type) || []).length;
    
    if (userCount > aiCount) {
      missingFeatures.push({ type, count: userCount - aiCount });
      recommendations.push(`Missing ${userCount - aiCount} ${type}(s) that user traced. AI may have missed these features.`);
    } else if (aiCount > userCount && userCount > 0) {
      extraFeatures.push({ type, count: aiCount - userCount });
      recommendations.push(`AI detected ${aiCount - userCount} extra ${type}(s) not present in user trace. These may be false positives.`);
    }
  }
  
  // Calculate overall score
  const totalFeatures = deviations.length;
  const correctFeatures = deviations.filter(d => !d.needsCorrection).length;
  const alignmentSum = deviations.reduce((sum, d) => sum + d.alignmentScore, 0);
  
  const overallScore = totalFeatures > 0 
    ? Math.round((correctFeatures / totalFeatures * 50) + (alignmentSum / totalFeatures * 50))
    : 50; // Default score if no features to evaluate
  
  console.log(`Overlay evaluation: ${overallScore}% score, ${deviations.filter(d => d.needsCorrection).length} corrections needed`);
  
  return {
    overallScore,
    deviations,
    missingFeatures,
    extraFeatures,
    recommendations,
    autoCorrections
  };
}

/**
 * Calculate deviation between AI line and user trace
 * Uses Hausdorff-like distance calculation
 */
function calculateLineDeviation(aiCoords: XY[], userCoords: XY[]): number {
  if (!aiCoords || !userCoords || aiCoords.length < 2 || userCoords.length < 2) {
    return Infinity;
  }
  
  // Sample points along AI line
  const sampleCount = 10;
  let totalDeviation = 0;
  
  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const aiPoint = interpolateAlongLine(aiCoords, t);
    
    // Find closest point on user line
    let minDist = Infinity;
    for (let j = 0; j < userCoords.length - 1; j++) {
      const dist = pointToSegmentDistance(aiPoint, userCoords[j], userCoords[j + 1]);
      minDist = Math.min(minDist, dist);
    }
    
    totalDeviation += minDist;
  }
  
  // Convert to feet (assuming coords are in degrees)
  const avgDeviationDegrees = totalDeviation / (sampleCount + 1);
  const avgDeviationFt = avgDeviationDegrees * 364000; // Rough conversion at mid-latitudes
  
  return avgDeviationFt;
}

/**
 * Interpolate point along a line at parameter t (0-1)
 */
function interpolateAlongLine(coords: XY[], t: number): XY {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return coords[0];
  if (t <= 0) return coords[0];
  if (t >= 1) return coords[coords.length - 1];
  
  // Calculate total length
  let totalLen = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    totalLen += distance(coords[i], coords[i + 1]);
  }
  
  const targetLen = totalLen * t;
  let accumLen = 0;
  
  for (let i = 0; i < coords.length - 1; i++) {
    const segLen = distance(coords[i], coords[i + 1]);
    if (accumLen + segLen >= targetLen) {
      const segT = (targetLen - accumLen) / segLen;
      return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * segT,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * segT
      ];
    }
    accumLen += segLen;
  }
  
  return coords[coords.length - 1];
}

/**
 * Calculate distance from point to line segment
 */
function pointToSegmentDistance(point: XY, segStart: XY, segEnd: XY): number {
  const dx = segEnd[0] - segStart[0];
  const dy = segEnd[1] - segStart[1];
  const segLenSq = dx * dx + dy * dy;
  
  if (segLenSq === 0) {
    return distance(point, segStart);
  }
  
  let t = ((point[0] - segStart[0]) * dx + (point[1] - segStart[1]) * dy) / segLenSq;
  t = Math.max(0, Math.min(1, t));
  
  const closestPoint: XY = [
    segStart[0] + t * dx,
    segStart[1] + t * dy
  ];
  
  return distance(point, closestPoint);
}

function distance(a: XY, b: XY): number {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
}

/**
 * Parse WKT LINESTRING to coordinate array
 */
function parseWktLinestring(wkt: string): XY[] | null {
  const match = wkt.match(/LINESTRING\(([^)]+)\)/);
  if (!match) return null;
  
  return match[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(' ').map(Number);
    return [lng, lat] as XY;
  });
}

/**
 * Convert points to WKT LINESTRING
 */
function pointsToWkt(points: XY[]): string {
  const coordStr = points.map(p => `${p[0]} ${p[1]}`).join(', ');
  return `LINESTRING(${coordStr})`;
}

/**
 * Group features by type
 */
function groupByType(features: LinearFeature[]): Map<string, LinearFeature[]> {
  const groups = new Map<string, LinearFeature[]>();
  for (const f of features) {
    const existing = groups.get(f.type) || [];
    existing.push(f);
    groups.set(f.type, existing);
  }
  return groups;
}

/**
 * Group user traces by type
 */
function groupUserTracesByType(traces: UserTrace[]): Map<string, UserTrace[]> {
  const groups = new Map<string, UserTrace[]>();
  for (const t of traces) {
    const existing = groups.get(t.type) || [];
    existing.push(t);
    groups.set(t.type, existing);
  }
  return groups;
}

/**
 * Apply auto-corrections to features
 */
export function applyCorrections(
  features: LinearFeature[],
  corrections: EvaluationResult['autoCorrections']
): LinearFeature[] {
  const correctionMap = new Map(corrections.map(c => [c.originalId, c.correctedWkt]));
  
  return features.map(f => {
    const correction = correctionMap.get(f.id);
    if (correction) {
      // Re-calculate length from corrected WKT
      const coords = parseWktLinestring(correction);
      let newLength = 0;
      if (coords && coords.length >= 2) {
        for (let i = 0; i < coords.length - 1; i++) {
          newLength += distance(coords[i], coords[i + 1]) * 364000; // Convert to feet
        }
      }
      
      return {
        ...f,
        wkt: correction,
        length_ft: newLength || f.length_ft,
        source: 'manual' as const,
        confidence: 0.95 // High confidence after user correction
      };
    }
    return f;
  });
}
