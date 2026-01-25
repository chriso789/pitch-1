/**
 * Phase 4 & 5: Hip Line Topology Enforcement & Valley Detection
 * Mathematically correct hip and valley line generation
 * Topology validation and intersection mapping
 */

import { haversineDistanceFt, extractVerticesFromWKT } from './vertex-detector.ts';
import { calculateAzimuth } from './ridge-detector.ts';

export interface DetectedHip {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  lengthFt: number;
  azimuthDegrees: number;
  confidence: number;
  connectedRidgeId: string | null;
  connectedPerimeterVertex: boolean;
  wkt: string;
}

export interface DetectedValley {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  lengthFt: number;
  azimuthDegrees: number;
  confidence: number;
  connectsToRidge: boolean;
  isReflex: boolean;
  wkt: string;
}

export interface HipValidationRules {
  expectedHipAngleDegrees: number;
  angleToleranceDegrees: number;
  minHipLengthFt: number;
  maxHipLengthFt: number;
  hipMustConnectToRidge: boolean;
  hipMustConnectToPerimeter: boolean;
}

export interface ValleyValidationRules {
  minValleyLengthFt: number;
  maxValleyLengthFt: number;
  valleyMustConnectToRidge: boolean;
  valleyStartsAtReflexCorner: boolean;
}

const DEFAULT_HIP_RULES: HipValidationRules = {
  expectedHipAngleDegrees: 45,
  angleToleranceDegrees: 15,
  minHipLengthFt: 5,
  maxHipLengthFt: 50,
  hipMustConnectToRidge: true,
  hipMustConnectToPerimeter: true
};

const DEFAULT_VALLEY_RULES: ValleyValidationRules = {
  minValleyLengthFt: 5,
  maxValleyLengthFt: 40,
  valleyMustConnectToRidge: true,
  valleyStartsAtReflexCorner: true
};

/**
 * Determine expected hip count based on building shape
 */
export function getExpectedHipCount(
  buildingShape: 'rectangle' | 'l_shape' | 't_shape' | 'u_shape' | 'complex',
  roofStyle: 'hip' | 'gable' | 'combination'
): { min: number; max: number } {
  if (roofStyle === 'gable') {
    return { min: 0, max: 0 };
  }

  switch (buildingShape) {
    case 'rectangle':
      return { min: 4, max: 4 };
    case 'l_shape':
      return { min: 6, max: 8 };
    case 't_shape':
      return { min: 8, max: 10 };
    case 'u_shape':
      return { min: 8, max: 10 };
    case 'complex':
      return { min: 6, max: 16 };
    default:
      return { min: 0, max: 12 };
  }
}

/**
 * Determine expected valley count based on building shape
 */
export function getExpectedValleyCount(
  buildingShape: 'rectangle' | 'l_shape' | 't_shape' | 'u_shape' | 'complex'
): { min: number; max: number } {
  switch (buildingShape) {
    case 'rectangle':
      return { min: 0, max: 0 };
    case 'l_shape':
      return { min: 1, max: 2 };
    case 't_shape':
      return { min: 2, max: 3 };
    case 'u_shape':
      return { min: 2, max: 3 };
    case 'complex':
      return { min: 1, max: 6 };
    default:
      return { min: 0, max: 4 };
  }
}

/**
 * Detect reflex (concave) corners in building footprint
 * Valleys typically originate from reflex corners
 */
export function detectReflexCorners(
  footprintVertices: { lat: number; lng: number }[]
): { lat: number; lng: number; angle: number }[] {
  const reflexCorners: { lat: number; lng: number; angle: number }[] = [];

  if (footprintVertices.length < 4) return reflexCorners;

  for (let i = 0; i < footprintVertices.length; i++) {
    const prev = footprintVertices[(i - 1 + footprintVertices.length) % footprintVertices.length];
    const curr = footprintVertices[i];
    const next = footprintVertices[(i + 1) % footprintVertices.length];

    // Calculate vectors
    const v1x = curr.lng - prev.lng;
    const v1y = curr.lat - prev.lat;
    const v2x = next.lng - curr.lng;
    const v2y = next.lat - curr.lat;

    // Cross product to determine turn direction
    const cross = v1x * v2y - v1y * v2x;

    // Calculate angle
    const dot = v1x * v2x + v1y * v2y;
    const det = v1x * v2y - v1y * v2x;
    const angle = Math.atan2(det, dot) * 180 / Math.PI;

    // Reflex angle (interior angle > 180°) for clockwise polygon
    // This depends on polygon winding order, adjust as needed
    if (cross < 0) {
      reflexCorners.push({ lat: curr.lat, lng: curr.lng, angle: 360 + angle });
    }
  }

  return reflexCorners;
}

/**
 * Validate hip topology - all hips must connect properly
 */
export function validateHipTopology(
  hips: DetectedHip[],
  ridges: { id: string; startLat: number; startLng: number; endLat: number; endLng: number }[],
  perimeterCorners: { lat: number; lng: number }[],
  toleranceFt: number = 2.0
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const hip of hips) {
    // Check if hip connects to ridge
    let connectsToRidge = false;
    for (const ridge of ridges) {
      const startToRidgeStart = haversineDistanceFt(hip.startLat, hip.startLng, ridge.startLat, ridge.startLng);
      const startToRidgeEnd = haversineDistanceFt(hip.startLat, hip.startLng, ridge.endLat, ridge.endLng);
      const endToRidgeStart = haversineDistanceFt(hip.endLat, hip.endLng, ridge.startLat, ridge.startLng);
      const endToRidgeEnd = haversineDistanceFt(hip.endLat, hip.endLng, ridge.endLat, ridge.endLng);

      if (Math.min(startToRidgeStart, startToRidgeEnd, endToRidgeStart, endToRidgeEnd) <= toleranceFt) {
        connectsToRidge = true;
        break;
      }
    }

    if (!connectsToRidge) {
      errors.push(`Hip ${hip.id} does not connect to any ridge endpoint`);
    }

    // Check if hip connects to perimeter
    let connectsToPerimeter = false;
    for (const corner of perimeterCorners) {
      const startDistance = haversineDistanceFt(hip.startLat, hip.startLng, corner.lat, corner.lng);
      const endDistance = haversineDistanceFt(hip.endLat, hip.endLng, corner.lat, corner.lng);

      if (startDistance <= toleranceFt || endDistance <= toleranceFt) {
        connectsToPerimeter = true;
        break;
      }
    }

    if (!connectsToPerimeter) {
      errors.push(`Hip ${hip.id} does not connect to any perimeter corner`);
    }
  }

  // Validate hip count for rectangular hip roof
  if (perimeterCorners.length === 4 && ridges.length === 1) {
    if (hips.length !== 4) {
      errors.push(`Rectangular hip roof should have 4 hips, found ${hips.length}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate valley placement
 */
export function validateValleyPlacement(
  valleys: DetectedValley[],
  ridges: { id: string; startLat: number; startLng: number; endLat: number; endLng: number }[],
  reflexCorners: { lat: number; lng: number }[],
  toleranceFt: number = 3.0
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const valley of valleys) {
    // Check if valley connects to ridge
    let connectsToRidge = false;
    for (const ridge of ridges) {
      const startToRidgeStart = haversineDistanceFt(valley.startLat, valley.startLng, ridge.startLat, ridge.startLng);
      const startToRidgeEnd = haversineDistanceFt(valley.startLat, valley.startLng, ridge.endLat, ridge.endLng);
      const endToRidgeStart = haversineDistanceFt(valley.endLat, valley.endLng, ridge.startLat, ridge.startLng);
      const endToRidgeEnd = haversineDistanceFt(valley.endLat, valley.endLng, ridge.endLat, ridge.endLng);

      // Valleys can also connect to ridge midpoints for L/T shapes
      const ridgeMidLat = (ridge.startLat + ridge.endLat) / 2;
      const ridgeMidLng = (ridge.startLng + ridge.endLng) / 2;
      const endToRidgeMid = haversineDistanceFt(valley.endLat, valley.endLng, ridgeMidLat, ridgeMidLng);

      if (Math.min(startToRidgeStart, startToRidgeEnd, endToRidgeStart, endToRidgeEnd, endToRidgeMid) <= toleranceFt * 2) {
        connectsToRidge = true;
        break;
      }
    }

    if (!connectsToRidge && valleys.length > 0) {
      errors.push(`Valley ${valley.id} does not connect to any ridge`);
    }

    // Check if valley originates from reflex corner
    let startsAtReflex = false;
    for (const reflex of reflexCorners) {
      const startDistance = haversineDistanceFt(valley.startLat, valley.startLng, reflex.lat, reflex.lng);
      const endDistance = haversineDistanceFt(valley.endLat, valley.endLng, reflex.lat, reflex.lng);

      if (startDistance <= toleranceFt || endDistance <= toleranceFt) {
        startsAtReflex = true;
        break;
      }
    }

    if (!startsAtReflex && reflexCorners.length > 0) {
      // This is a warning, not an error - valleys don't always start exactly at reflex corners
      console.log(`Valley ${valley.id} does not start at a reflex corner (may be acceptable)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Calculate expected hip length based on roof pitch and building width
 */
export function calculateExpectedHipLength(
  buildingWidthFt: number,
  pitchDegrees: number
): number {
  // For a standard hip roof, hip length ≈ √(rise² + run²)
  // where run = building width / 2, rise = run × tan(pitch)
  const runFt = buildingWidthFt / 2;
  const riseFt = runFt * Math.tan(pitchDegrees * Math.PI / 180);
  
  // Hip runs diagonally, so add the diagonal factor
  const horizontalHipRun = runFt * Math.sqrt(2); // Hip runs at 45° horizontally
  const hipLengthFt = Math.sqrt(horizontalHipRun ** 2 + riseFt ** 2);

  return hipLengthFt;
}

/**
 * Detect hips from linear features with validation
 */
export function detectHips(
  linearFeaturesWKT: { type: string; wkt: string; confidence?: number }[],
  perimeterWKT: string,
  ridges: { id: string; startLat: number; startLng: number; endLat: number; endLng: number }[],
  rules: Partial<HipValidationRules> = {}
): { hips: DetectedHip[]; totalHipFt: number; validationErrors: string[] } {
  const cfg = { ...DEFAULT_HIP_RULES, ...rules };
  const hips: DetectedHip[] = [];
  const perimeterCorners = extractVerticesFromWKT(perimeterWKT);

  // Filter hip features
  const hipFeatures = linearFeaturesWKT.filter(f => f.type === 'hip');

  for (const feature of hipFeatures) {
    const match = feature.wkt.match(/LINESTRING\s*\(([^)]+)\)/i);
    if (!match) continue;

    const coordString = match[1];
    const coordPairs = coordString.split(',').map(s => s.trim());

    if (coordPairs.length < 2) continue;

    const [startLngStr, startLatStr] = coordPairs[0].split(/\s+/);
    const [endLngStr, endLatStr] = coordPairs[coordPairs.length - 1].split(/\s+/);

    const startLat = parseFloat(startLatStr);
    const startLng = parseFloat(startLngStr);
    const endLat = parseFloat(endLatStr);
    const endLng = parseFloat(endLngStr);

    const lengthFt = haversineDistanceFt(startLat, startLng, endLat, endLng);
    const azimuth = calculateAzimuth(startLat, startLng, endLat, endLng);

    // Check ridge connection
    let connectedRidgeId: string | null = null;
    for (const ridge of ridges) {
      const startToRidgeStart = haversineDistanceFt(startLat, startLng, ridge.startLat, ridge.startLng);
      const startToRidgeEnd = haversineDistanceFt(startLat, startLng, ridge.endLat, ridge.endLng);
      const endToRidgeStart = haversineDistanceFt(endLat, endLng, ridge.startLat, ridge.startLng);
      const endToRidgeEnd = haversineDistanceFt(endLat, endLng, ridge.endLat, ridge.endLng);

      if (Math.min(startToRidgeStart, startToRidgeEnd, endToRidgeStart, endToRidgeEnd) <= 2.0) {
        connectedRidgeId = ridge.id;
        break;
      }
    }

    // Check perimeter connection
    let connectedToPerimeter = false;
    for (const corner of perimeterCorners) {
      const startDist = haversineDistanceFt(startLat, startLng, corner.lat, corner.lng);
      const endDist = haversineDistanceFt(endLat, endLng, corner.lat, corner.lng);
      if (startDist <= 2.0 || endDist <= 2.0) {
        connectedToPerimeter = true;
        break;
      }
    }

    hips.push({
      id: `hip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      startLat,
      startLng,
      endLat,
      endLng,
      lengthFt,
      azimuthDegrees: azimuth,
      confidence: feature.confidence || 0.80,
      connectedRidgeId,
      connectedPerimeterVertex: connectedToPerimeter,
      wkt: feature.wkt
    });
  }

  // Validate topology
  const validation = validateHipTopology(hips, ridges, perimeterCorners);

  return {
    hips,
    totalHipFt: hips.reduce((sum, h) => sum + h.lengthFt, 0),
    validationErrors: validation.errors
  };
}

/**
 * Detect valleys from linear features with validation
 */
export function detectValleys(
  linearFeaturesWKT: { type: string; wkt: string; confidence?: number }[],
  perimeterWKT: string,
  ridges: { id: string; startLat: number; startLng: number; endLat: number; endLng: number }[],
  rules: Partial<ValleyValidationRules> = {}
): { valleys: DetectedValley[]; totalValleyFt: number; validationErrors: string[] } {
  const cfg = { ...DEFAULT_VALLEY_RULES, ...rules };
  const valleys: DetectedValley[] = [];
  const perimeterCorners = extractVerticesFromWKT(perimeterWKT);
  const reflexCorners = detectReflexCorners(perimeterCorners);

  // Filter valley features
  const valleyFeatures = linearFeaturesWKT.filter(f => f.type === 'valley');

  for (const feature of valleyFeatures) {
    const match = feature.wkt.match(/LINESTRING\s*\(([^)]+)\)/i);
    if (!match) continue;

    const coordString = match[1];
    const coordPairs = coordString.split(',').map(s => s.trim());

    if (coordPairs.length < 2) continue;

    const [startLngStr, startLatStr] = coordPairs[0].split(/\s+/);
    const [endLngStr, endLatStr] = coordPairs[coordPairs.length - 1].split(/\s+/);

    const startLat = parseFloat(startLatStr);
    const startLng = parseFloat(startLngStr);
    const endLat = parseFloat(endLatStr);
    const endLng = parseFloat(endLngStr);

    const lengthFt = haversineDistanceFt(startLat, startLng, endLat, endLng);
    const azimuth = calculateAzimuth(startLat, startLng, endLat, endLng);

    // Check if connects to ridge
    let connectsToRidge = false;
    for (const ridge of ridges) {
      const endToRidgeMidLat = (ridge.startLat + ridge.endLat) / 2;
      const endToRidgeMidLng = (ridge.startLng + ridge.endLng) / 2;
      const distToMid = haversineDistanceFt(endLat, endLng, endToRidgeMidLat, endToRidgeMidLng);
      
      if (distToMid <= 5.0) {
        connectsToRidge = true;
        break;
      }
    }

    // Check if starts at reflex corner
    let isReflex = false;
    for (const reflex of reflexCorners) {
      const startDist = haversineDistanceFt(startLat, startLng, reflex.lat, reflex.lng);
      if (startDist <= 3.0) {
        isReflex = true;
        break;
      }
    }

    valleys.push({
      id: `valley_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      startLat,
      startLng,
      endLat,
      endLng,
      lengthFt,
      azimuthDegrees: azimuth,
      confidence: feature.confidence || 0.75,
      connectsToRidge,
      isReflex,
      wkt: feature.wkt
    });
  }

  // Validate placement
  const validation = validateValleyPlacement(valleys, ridges, reflexCorners);

  return {
    valleys,
    totalValleyFt: valleys.reduce((sum, v) => sum + v.lengthFt, 0),
    validationErrors: validation.errors
  };
}

/**
 * Generate AI prompt for hip and valley detection
 */
export function getHipValleyDetectionPrompt(): string {
  return `
HIP AND VALLEY LINE DETECTION INSTRUCTIONS:

=== HIP LINES ===
Hips are DIAGONAL lines that run from ridge endpoints to perimeter corners.

IDENTIFICATION CHARACTERISTICS:
1. Hips run at approximately 45° relative to the building's main axis
2. Each hip connects ONE ridge endpoint to ONE perimeter corner
3. For rectangular hip roofs: exactly 4 hips (one at each corner)
4. Hips cast a diagonal shadow pattern

TOPOLOGY RULES:
- Hip must connect to ridge endpoint at one end
- Hip must connect to perimeter corner at other end
- No two hips share the same ridge endpoint (except at complex junctions)
- Hip angle is typically 45° for standard roof pitches

=== VALLEY LINES ===
Valleys are where two roof planes meet in a V-shape (the opposite of a ridge).

IDENTIFICATION CHARACTERISTICS:
1. Valleys typically occur where roof extensions meet the main structure
2. Valleys run from REFLEX (inside) corners toward the ridge
3. L-shaped building = 1 valley
4. T-shaped building = 2 valleys
5. Valleys appear as darker lines (shadow collects in valley)

TOPOLOGY RULES:
- Valley starts at or near a reflex (concave) corner
- Valley ends at a ridge or hip junction
- Valley length ≈ from reflex corner to ridge intersection

=== COMMON ERRORS TO AVOID ===
- Do NOT mark eave edges as hips
- Do NOT mark rake edges as hips
- Do NOT confuse valleys with hips (valleys are at inside corners)
- For simple rectangular buildings, there should be NO valleys

OUTPUT FORMAT:
For each hip/valley, provide:
- Start and end coordinates (lat, lng)
- Type: 'hip' or 'valley'
- Confidence score (0-1)

Return as WKT LINESTRING format.
`;
}
