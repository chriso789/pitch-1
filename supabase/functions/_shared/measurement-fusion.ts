// Measurement Fusion Engine
// Multi-source weighted reconciliation for roof measurements
// Combines Solar API, footprint polygon, skeleton topology, terrain elevation,
// and AI vision detections into a single authoritative measurement

export interface FusionSource {
  value: number;
  confidence: number; // 0-1
  source: string;
}

export interface FusionInput {
  area: {
    vendorReport?: FusionSource;           // Roofr/EagleView ground truth (highest priority)
    footprintPlanimetric?: FusionSource;   // Mapbox Vector polygon area
    solarAPI?: FusionSource;               // Google Solar wholeRoofStats
    skeletonFacetSum?: FusionSource;       // Sum of skeleton-derived facets
    aiVision?: FusionSource;               // AI detected area
  };
  pitch: {
    vendorReport?: FusionSource;           // Roofr/EagleView ground truth pitch
    solarSegments?: FusionSource;          // Google Solar pitchDegrees
    terrainRGB?: FusionSource;             // Mapbox Terrain elevation delta
    dsmAnalysis?: FusionSource;            // DSM ridge-to-eave
    userOverride?: FusionSource;           // Manual input
  };
  linear: {
    ridgeFt?: { vendorReport?: FusionSource; skeleton?: FusionSource; aiVision?: FusionSource; solarInferred?: FusionSource };
    hipFt?: { vendorReport?: FusionSource; skeleton?: FusionSource; aiVision?: FusionSource; solarInferred?: FusionSource };
    valleyFt?: { vendorReport?: FusionSource; skeleton?: FusionSource; aiVision?: FusionSource; solarInferred?: FusionSource };
    eaveFt?: { vendorReport?: FusionSource; skeleton?: FusionSource; aiVision?: FusionSource; solarInferred?: FusionSource };
    rakeFt?: { vendorReport?: FusionSource; skeleton?: FusionSource; aiVision?: FusionSource; solarInferred?: FusionSource };
  };
}

/**
 * Vendor truth data from parsed Roofr/EagleView reports.
 * Fed into the fusion pipeline as the highest-confidence source.
 */
export interface VendorTruth {
  source: 'roofr' | 'eagleview' | 'hover' | 'manual' | string;
  areaSqft?: number;
  pitchRatio?: string;       // e.g. "5/12"
  pitchDegrees?: number;
  ridgeFt?: number;
  hipFt?: number;
  valleyFt?: number;
  eaveFt?: number;
  rakeFt?: number;
  facetCount?: number;
  confidence?: number;       // Default 0.95
}

export interface FusedMeasurement {
  totalAreaSqft: number;
  slopedAreaSqft: number;
  pitchRatio: string;
  pitchDegrees: number;
  linear: {
    ridgeFt: number;
    hipFt: number;
    valleyFt: number;
    eaveFt: number;
    rakeFt: number;
    perimeterFt: number;
  };
  squares: number;
  confidence: {
    area: number;
    pitch: number;
    linear: number;
    overall: number;
  };
  sourceAttribution: {
    area: string;
    pitch: string;
    linear: string;
  };
  deviations: FusionDeviation[];
  requiresManualReview: boolean;
  reviewReasons: string[];
}

export interface FusionDeviation {
  component: string;
  sources: { name: string; value: number }[];
  maxDeviationPct: number;
  flagged: boolean;
}

// Default weights per source type
const AREA_WEIGHTS: Record<string, number> = {
  vendorReport: 0.60,        // Vendor truth highest priority
  footprintPlanimetric: 0.40,
  solarAPI: 0.35,
  skeletonFacetSum: 0.25,
  aiVision: 0.15,
};

const PITCH_WEIGHTS: Record<string, number> = {
  userOverride: 1.0,  // Always wins if provided
  vendorReport: 0.65, // Vendor truth second only to user override
  solarSegments: 0.50,
  terrainRGB: 0.30,
  dsmAnalysis: 0.20,
};

const LINEAR_WEIGHTS: Record<string, number> = {
  vendorReport: 0.60,        // Vendor truth highest priority
  skeleton: 0.50,
  aiVision: 0.30,
  solarInferred: 0.20,
};

const VENDOR_DEVIATION_THRESHOLD_PCT = 12; // Match Python pipeline tolerance

const DEVIATION_THRESHOLD_PCT = 10; // Flag when sources disagree by >10%

/**
 * Weighted average of multiple sources, each with a base weight and confidence multiplier.
 */
function weightedFuse(
  sources: Record<string, FusionSource | undefined>,
  baseWeights: Record<string, number>
): { value: number; confidence: number; primarySource: string } {
  let weightedSum = 0;
  let totalWeight = 0;
  let primarySource = 'none';
  let maxContribution = 0;

  for (const [key, src] of Object.entries(sources)) {
    if (!src || src.value <= 0) continue;
    const baseWeight = baseWeights[key] ?? 0.1;
    const effectiveWeight = baseWeight * src.confidence;
    weightedSum += src.value * effectiveWeight;
    totalWeight += effectiveWeight;

    if (effectiveWeight > maxContribution) {
      maxContribution = effectiveWeight;
      primarySource = src.source;
    }
  }

  if (totalWeight === 0) return { value: 0, confidence: 0, primarySource: 'none' };

  return {
    value: weightedSum / totalWeight,
    confidence: Math.min(0.98, totalWeight / Object.keys(sources).length),
    primarySource,
  };
}

/**
 * Check deviation between sources and flag if >threshold.
 */
function checkDeviation(
  component: string,
  sources: Record<string, FusionSource | undefined>
): FusionDeviation {
  const validSources = Object.entries(sources)
    .filter(([, s]) => s && s.value > 0)
    .map(([name, s]) => ({ name, value: s!.value }));

  if (validSources.length < 2) {
    return { component, sources: validSources, maxDeviationPct: 0, flagged: false };
  }

  const values = validSources.map(s => s.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const maxDev = Math.max(...values.map(v => Math.abs(v - mean) / mean * 100));

  return {
    component,
    sources: validSources,
    maxDeviationPct: Math.round(maxDev * 10) / 10,
    flagged: maxDev > DEVIATION_THRESHOLD_PCT,
  };
}

/**
 * Fuse a single linear measurement type from multiple sources.
 */
function fuseLinear(
  sources: { skeleton?: FusionSource; aiVision?: FusionSource; solarInferred?: FusionSource } | undefined
): { value: number; confidence: number } {
  if (!sources) return { value: 0, confidence: 0 };
  const result = weightedFuse(sources as Record<string, FusionSource | undefined>, LINEAR_WEIGHTS);
  return { value: result.value, confidence: result.confidence };
}

/**
 * Convert pitch degrees to ratio string.
 */
function degreesToRatio(degrees: number): string {
  if (degrees < 2) return 'flat';
  const rise = Math.round(Math.tan(degrees * Math.PI / 180) * 12);
  return `${Math.max(1, Math.min(24, rise))}/12`;
}

/**
 * Convert pitch ratio to degrees.
 */
function ratioToDegrees(ratio: string): number {
  if (ratio === 'flat') return 0;
  const match = ratio.match(/^(\d+)\/(\d+)$/);
  if (!match) return 20;
  return Math.atan(parseInt(match[1]) / parseInt(match[2])) * (180 / Math.PI);
}

/**
 * Run the full multi-source measurement fusion.
 */
export function fuseMeasurements(input: FusionInput): FusedMeasurement {
  const deviations: FusionDeviation[] = [];
  const reviewReasons: string[] = [];

  // ---- AREA FUSION ----
  const areaResult = weightedFuse(input.area, AREA_WEIGHTS);
  const areaDev = checkDeviation('area', input.area);
  deviations.push(areaDev);
  if (areaDev.flagged) {
    reviewReasons.push(`Area sources disagree by ${areaDev.maxDeviationPct}% (threshold: ${DEVIATION_THRESHOLD_PCT}%)`);
  }

  // ---- PITCH FUSION ----
  // User override always wins
  let pitchResult: { value: number; confidence: number; primarySource: string };
  if (input.pitch.userOverride && input.pitch.userOverride.value > 0) {
    pitchResult = {
      value: input.pitch.userOverride.value,
      confidence: 1.0,
      primarySource: input.pitch.userOverride.source,
    };
  } else {
    pitchResult = weightedFuse(input.pitch, PITCH_WEIGHTS);
  }
  const pitchDev = checkDeviation('pitch', input.pitch);
  deviations.push(pitchDev);
  if (pitchDev.flagged && !input.pitch.userOverride) {
    reviewReasons.push(`Pitch sources disagree by ${pitchDev.maxDeviationPct}%`);
  }

  const pitchDegrees = pitchResult.value;
  const pitchRatio = degreesToRatio(pitchDegrees);

  // ---- LINEAR FUSION ----
  const ridge = fuseLinear(input.linear.ridgeFt);
  const hip = fuseLinear(input.linear.hipFt);
  const valley = fuseLinear(input.linear.valleyFt);
  const eave = fuseLinear(input.linear.eaveFt);
  const rake = fuseLinear(input.linear.rakeFt);

  // Check ridge deviation
  if (input.linear.ridgeFt) {
    const ridgeDev = checkDeviation('ridge', input.linear.ridgeFt as Record<string, FusionSource | undefined>);
    deviations.push(ridgeDev);
    if (ridgeDev.flagged) reviewReasons.push(`Ridge length sources disagree by ${ridgeDev.maxDeviationPct}%`);
  }

  const linearConfidence = [ridge, hip, valley, eave, rake]
    .filter(l => l.value > 0)
    .reduce((sum, l) => sum + l.confidence, 0) / Math.max(1, [ridge, hip, valley, eave, rake].filter(l => l.value > 0).length);

  // ---- SLOPED AREA ----
  const slopeFactor = pitchDegrees > 0 ? 1 / Math.cos(pitchDegrees * Math.PI / 180) : 1;
  const slopedArea = areaResult.value * slopeFactor;

  // ---- OVERALL CONFIDENCE ----
  const overallConfidence = (areaResult.confidence * 0.5 + pitchResult.confidence * 0.3 + linearConfidence * 0.2);

  return {
    totalAreaSqft: Math.round(areaResult.value),
    slopedAreaSqft: Math.round(slopedArea),
    pitchRatio,
    pitchDegrees: Math.round(pitchDegrees * 10) / 10,
    linear: {
      ridgeFt: Math.round(ridge.value),
      hipFt: Math.round(hip.value),
      valleyFt: Math.round(valley.value),
      eaveFt: Math.round(eave.value),
      rakeFt: Math.round(rake.value),
      perimeterFt: Math.round(eave.value + rake.value),
    },
    squares: Math.round(slopedArea / 100 * 10) / 10,
    confidence: {
      area: Math.round(areaResult.confidence * 100) / 100,
      pitch: Math.round(pitchResult.confidence * 100) / 100,
      linear: Math.round(linearConfidence * 100) / 100,
      overall: Math.round(overallConfidence * 100) / 100,
    },
    sourceAttribution: {
      area: areaResult.primarySource,
      pitch: pitchResult.primarySource,
      linear: 'multi-source fusion',
    },
    deviations,
    requiresManualReview: reviewReasons.length > 0,
    reviewReasons,
  };
}

/**
 * Convert VendorTruth into FusionInput sources, to be merged with other sources.
 */
export function vendorTruthToFusionSources(vendor: VendorTruth): Partial<FusionInput> {
  const conf = vendor.confidence ?? 0.95;
  const src = `vendor_${vendor.source}`;
  const input: Partial<FusionInput> = { area: {}, pitch: {}, linear: {} };

  if (vendor.areaSqft && vendor.areaSqft > 0) {
    input.area!.vendorReport = { value: vendor.areaSqft, confidence: conf, source: src };
  }

  if (vendor.pitchDegrees && vendor.pitchDegrees > 0) {
    input.pitch!.vendorReport = { value: vendor.pitchDegrees, confidence: conf, source: src };
  } else if (vendor.pitchRatio) {
    const match = vendor.pitchRatio.match(/^(\d+)\/(\d+)$/);
    if (match) {
      const deg = Math.atan(parseInt(match[1]) / parseInt(match[2])) * (180 / Math.PI);
      input.pitch!.vendorReport = { value: deg, confidence: conf, source: src };
    }
  }

  const linearSource = (val?: number) => val && val > 0
    ? { vendorReport: { value: val, confidence: conf, source: src } }
    : undefined;

  input.linear!.ridgeFt = linearSource(vendor.ridgeFt);
  input.linear!.hipFt = linearSource(vendor.hipFt);
  input.linear!.valleyFt = linearSource(vendor.valleyFt);
  input.linear!.eaveFt = linearSource(vendor.eaveFt);
  input.linear!.rakeFt = linearSource(vendor.rakeFt);

  return input;
}

/**
 * Merge vendor truth sources into an existing FusionInput.
 */
export function mergeVendorIntoFusion(base: FusionInput, vendor: VendorTruth): FusionInput {
  const vendorSources = vendorTruthToFusionSources(vendor);
  
  // Merge area
  if (vendorSources.area?.vendorReport) {
    base.area.vendorReport = vendorSources.area.vendorReport;
  }
  
  // Merge pitch
  if (vendorSources.pitch?.vendorReport) {
    base.pitch.vendorReport = vendorSources.pitch.vendorReport;
  }
  
  // Merge linear — add vendorReport to each linear type
  for (const key of ['ridgeFt', 'hipFt', 'valleyFt', 'eaveFt', 'rakeFt'] as const) {
    const vendorLinear = vendorSources.linear?.[key];
    if (vendorLinear?.vendorReport) {
      if (!base.linear[key]) {
        base.linear[key] = {};
      }
      base.linear[key]!.vendorReport = vendorLinear.vendorReport;
    }
  }
  
  return base;
}
