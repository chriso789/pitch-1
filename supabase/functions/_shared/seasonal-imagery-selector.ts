/**
 * Phase 51: Seasonal Imagery Selector
 * Optimal imagery selection based on capture conditions.
 */

export interface ImageryMetadata {
  captureDate: Date;
  sunAngle: number;
  cloudCover: number;
  snowCover: boolean;
  leafCover: 'none' | 'partial' | 'full';
  shadowQuality: 'excellent' | 'good' | 'fair' | 'poor';
  resolution: number;
  provider: string;
}

export interface ImageryScore {
  imageId: string;
  overallScore: number;
  seasonScore: number;
  lightingScore: number;
  clarityScore: number;
  recommended: boolean;
  reasons: string[];
}

/**
 * Score imagery based on seasonal and lighting conditions
 */
export function scoreImagery(metadata: ImageryMetadata): ImageryScore {
  const reasons: string[] = [];
  let seasonScore = 100;
  let lightingScore = 100;
  let clarityScore = 100;

  // Season scoring - prefer spring and fall
  const month = metadata.captureDate.getMonth();
  const isSpring = month >= 2 && month <= 4; // March-May
  const isFall = month >= 8 && month <= 10; // September-November
  const isWinter = month === 11 || month === 0 || month === 1;
  const isSummer = month >= 5 && month <= 7;

  if (isSpring || isFall) {
    seasonScore = 100;
    reasons.push('Optimal season (spring/fall) - good sun angle');
  } else if (isSummer) {
    seasonScore = 85;
    reasons.push('Summer imagery - possible harsh shadows');
  } else if (isWinter) {
    seasonScore = metadata.snowCover ? 40 : 70;
    if (metadata.snowCover) {
      reasons.push('Winter with snow cover - roof edges obscured');
    } else {
      reasons.push('Winter without snow - low sun angle');
    }
  }

  // Leaf cover penalty
  if (metadata.leafCover === 'full') {
    seasonScore -= 20;
    reasons.push('Full leaf cover may obscure roof edges');
  } else if (metadata.leafCover === 'partial') {
    seasonScore -= 10;
    reasons.push('Partial leaf cover - minor obstruction');
  }

  // Sun angle scoring
  // Optimal: 35-55 degrees for good shadow definition without harsh shadows
  if (metadata.sunAngle >= 35 && metadata.sunAngle <= 55) {
    lightingScore = 100;
    reasons.push('Optimal sun angle for shadow analysis');
  } else if (metadata.sunAngle >= 25 && metadata.sunAngle < 35) {
    lightingScore = 85;
    reasons.push('Low sun angle - long shadows may complicate analysis');
  } else if (metadata.sunAngle > 55 && metadata.sunAngle <= 70) {
    lightingScore = 80;
    reasons.push('High sun angle - reduced shadow definition');
  } else if (metadata.sunAngle > 70) {
    lightingScore = 60;
    reasons.push('Very high sun angle - minimal shadows for pitch estimation');
  } else {
    lightingScore = 50;
    reasons.push('Very low sun angle - may cause glare or excessive shadows');
  }

  // Cloud cover penalty
  if (metadata.cloudCover > 80) {
    clarityScore -= 30;
    reasons.push('Heavy cloud cover - reduced contrast');
  } else if (metadata.cloudCover > 50) {
    clarityScore -= 15;
    reasons.push('Moderate cloud cover');
  } else if (metadata.cloudCover > 20) {
    clarityScore -= 5;
    reasons.push('Light cloud cover - minimal impact');
  }

  // Shadow quality
  switch (metadata.shadowQuality) {
    case 'excellent':
      lightingScore = Math.min(lightingScore + 10, 100);
      break;
    case 'good':
      break;
    case 'fair':
      lightingScore -= 10;
      reasons.push('Shadow quality fair - pitch estimation may be less accurate');
      break;
    case 'poor':
      lightingScore -= 25;
      reasons.push('Poor shadow quality - pitch estimation unreliable');
      break;
  }

  // Resolution scoring
  if (metadata.resolution <= 0.3) {
    clarityScore = 100;
  } else if (metadata.resolution <= 0.5) {
    clarityScore -= 5;
  } else if (metadata.resolution <= 1.0) {
    clarityScore -= 15;
    reasons.push('Lower resolution imagery');
  } else {
    clarityScore -= 30;
    reasons.push('Low resolution - edge detection may be imprecise');
  }

  const overallScore = Math.round(
    seasonScore * 0.3 + lightingScore * 0.4 + clarityScore * 0.3
  );

  return {
    imageId: '',
    overallScore,
    seasonScore,
    lightingScore,
    clarityScore,
    recommended: overallScore >= 75,
    reasons,
  };
}

/**
 * Rank multiple imagery options and select the best
 */
export function selectBestImagery(
  options: Array<{ id: string; metadata: ImageryMetadata }>
): {
  selectedId: string;
  score: ImageryScore;
  alternatives: Array<{ id: string; score: number }>;
} {
  const scored = options.map(opt => ({
    id: opt.id,
    score: scoreImagery(opt.metadata),
  }));

  // Sort by overall score descending
  scored.sort((a, b) => b.score.overallScore - a.score.overallScore);

  const best = scored[0];
  
  return {
    selectedId: best.id,
    score: { ...best.score, imageId: best.id },
    alternatives: scored.slice(1, 4).map(s => ({
      id: s.id,
      score: s.score.overallScore,
    })),
  };
}

/**
 * Estimate capture date conditions from image properties
 */
export function estimateImageryConditions(
  captureDate: string,
  latitude: number
): Partial<ImageryMetadata> {
  const date = new Date(captureDate);
  const month = date.getMonth();
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000
  );

  // Estimate sun angle based on latitude and day of year
  // Simplified calculation
  const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * (Math.PI / 180));
  const solarNoonAltitude = 90 - Math.abs(latitude) + declination;
  
  // Estimate leaf cover based on latitude and month
  let leafCover: 'none' | 'partial' | 'full' = 'none';
  if (latitude > 30 && latitude < 55) {
    if (month >= 5 && month <= 8) leafCover = 'full';
    else if (month >= 3 && month <= 10) leafCover = 'partial';
  }

  // Estimate snow probability
  const snowProbability = latitude > 40 && (month === 11 || month <= 2) ? 0.3 : 0;

  return {
    captureDate: date,
    sunAngle: Math.max(20, Math.min(80, solarNoonAltitude)),
    leafCover,
    snowCover: Math.random() < snowProbability,
  };
}

/**
 * Get recommended capture windows for a location
 */
export function getOptimalCaptureWindows(
  latitude: number
): { start: string; end: string; reason: string }[] {
  const windows: { start: string; end: string; reason: string }[] = [];
  
  if (latitude >= 25 && latitude <= 50) {
    // Northern mid-latitudes
    windows.push({
      start: 'March 15',
      end: 'May 15',
      reason: 'Spring - optimal sun angle, minimal leaf cover',
    });
    windows.push({
      start: 'September 15',
      end: 'November 1',
      reason: 'Fall - good lighting, leaves changing/falling',
    });
  } else if (latitude > 50) {
    // Northern high latitudes
    windows.push({
      start: 'May 1',
      end: 'August 31',
      reason: 'Summer - sufficient daylight hours',
    });
  } else {
    // Lower latitudes
    windows.push({
      start: 'November 1',
      end: 'February 28',
      reason: 'Winter - lower sun angle reduces harsh shadows',
    });
  }

  return windows;
}
