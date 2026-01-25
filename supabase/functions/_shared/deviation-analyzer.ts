/**
 * Phase 10: Deviation Detection and Alerting
 * Automatic flagging of measurements that deviate from expected ranges
 */

import { haversineDistanceFt } from './vertex-detector.ts';

export interface DeviationAlert {
  id: string;
  type: DeviationType;
  severity: 'info' | 'warning' | 'error' | 'critical';
  description: string;
  expectedValue: number;
  actualValue: number;
  deviationPct: number;
  deviationFt: number;
  ruleName: string;
  featureId?: string;
  location?: { lat: number; lng: number };
  recommendedAction: string;
}

export type DeviationType =
  | 'area_mismatch'
  | 'length_anomaly'
  | 'count_mismatch'
  | 'topology_error'
  | 'pitch_inconsistency'
  | 'shape_violation'
  | 'connectivity_error'
  | 'ratio_anomaly';

export interface DeviationRules {
  areaDeviationThresholdPct: number;
  ridgeLengthMinFt: number;
  ridgeLengthMaxFt: number;
  hipLengthMinFt: number;
  hipLengthMaxFt: number;
  valleyLengthMinFt: number;
  valleyLengthMaxFt: number;
  totalLinearDeviationPct: number;
  pitchVarianceMaxDegrees: number;
  minConfidenceScore: number;
}

const DEFAULT_RULES: DeviationRules = {
  areaDeviationThresholdPct: 5,
  ridgeLengthMinFt: 10,
  ridgeLengthMaxFt: 100,
  hipLengthMinFt: 5,
  hipLengthMaxFt: 50,
  valleyLengthMinFt: 5,
  valleyLengthMaxFt: 40,
  totalLinearDeviationPct: 10,
  pitchVarianceMaxDegrees: 3,
  minConfidenceScore: 0.7
};

export interface MeasurementData {
  totalAreaSqft: number;
  ridgeTotalFt: number;
  hipTotalFt: number;
  valleyTotalFt: number;
  eaveTotalFt: number;
  rakeTotalFt: number;
  perimeterFt: number;
  ridgeCount: number;
  hipCount: number;
  valleyCount: number;
  pitchDegrees: number;
  buildingShape: 'rectangle' | 'l_shape' | 't_shape' | 'u_shape' | 'complex';
  roofStyle: 'gable' | 'hip' | 'combination';
  confidenceScore: number;
}

export interface BenchmarkData {
  expectedAreaSqft?: number;
  expectedRidgeFt?: number;
  expectedHipFt?: number;
  expectedValleyFt?: number;
  expectedEaveFt?: number;
  expectedRakeFt?: number;
  expectedPitchDegrees?: number;
}

/**
 * Generate unique alert ID
 */
function generateAlertId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculate deviation percentage
 */
function calculateDeviationPct(expected: number, actual: number): number {
  if (expected === 0) return actual === 0 ? 0 : 100;
  return Math.abs((actual - expected) / expected) * 100;
}

/**
 * Get expected feature counts based on building shape and roof style
 */
export function getExpectedFeatureCounts(
  buildingShape: string,
  roofStyle: string
): { ridges: { min: number; max: number }; hips: { min: number; max: number }; valleys: { min: number; max: number } } {
  const counts = {
    ridges: { min: 1, max: 1 },
    hips: { min: 0, max: 0 },
    valleys: { min: 0, max: 0 }
  };

  // Adjust based on building shape
  switch (buildingShape) {
    case 'rectangle':
      counts.ridges = { min: 1, max: 1 };
      counts.valleys = { min: 0, max: 0 };
      break;
    case 'l_shape':
      counts.ridges = { min: 2, max: 2 };
      counts.valleys = { min: 1, max: 2 };
      break;
    case 't_shape':
      counts.ridges = { min: 2, max: 3 };
      counts.valleys = { min: 2, max: 3 };
      break;
    case 'u_shape':
      counts.ridges = { min: 2, max: 3 };
      counts.valleys = { min: 2, max: 3 };
      break;
    case 'complex':
      counts.ridges = { min: 2, max: 6 };
      counts.valleys = { min: 1, max: 6 };
      break;
  }

  // Adjust hips based on roof style
  if (roofStyle === 'hip' || roofStyle === 'combination') {
    switch (buildingShape) {
      case 'rectangle':
        counts.hips = { min: 4, max: 4 };
        break;
      case 'l_shape':
        counts.hips = { min: 6, max: 8 };
        break;
      case 't_shape':
        counts.hips = { min: 8, max: 12 };
        break;
      case 'u_shape':
        counts.hips = { min: 8, max: 12 };
        break;
      case 'complex':
        counts.hips = { min: 6, max: 16 };
        break;
    }
  }

  return counts;
}

/**
 * Check area deviation against Solar API or benchmark
 */
export function checkAreaDeviation(
  measurement: MeasurementData,
  benchmark: BenchmarkData,
  rules: Partial<DeviationRules> = {}
): DeviationAlert | null {
  const cfg = { ...DEFAULT_RULES, ...rules };

  if (!benchmark.expectedAreaSqft) return null;

  const deviationPct = calculateDeviationPct(benchmark.expectedAreaSqft, measurement.totalAreaSqft);

  if (deviationPct > cfg.areaDeviationThresholdPct) {
    const severity = deviationPct > 15 ? 'critical' : deviationPct > 10 ? 'error' : 'warning';
    
    return {
      id: generateAlertId(),
      type: 'area_mismatch',
      severity,
      description: `Roof area ${measurement.totalAreaSqft.toFixed(0)} sqft differs from benchmark by ${deviationPct.toFixed(1)}%`,
      expectedValue: benchmark.expectedAreaSqft,
      actualValue: measurement.totalAreaSqft,
      deviationPct,
      deviationFt: Math.abs(benchmark.expectedAreaSqft - measurement.totalAreaSqft),
      ruleName: 'area_benchmark_comparison',
      recommendedAction: 'Verify footprint accuracy and recalculate area'
    };
  }

  return null;
}

/**
 * Check individual linear feature length anomalies
 */
export function checkLengthAnomalies(
  measurement: MeasurementData,
  rules: Partial<DeviationRules> = {}
): DeviationAlert[] {
  const cfg = { ...DEFAULT_RULES, ...rules };
  const alerts: DeviationAlert[] = [];

  // Check ridge length
  if (measurement.ridgeTotalFt > 0) {
    const avgRidgeLength = measurement.ridgeTotalFt / Math.max(1, measurement.ridgeCount);
    
    if (avgRidgeLength < cfg.ridgeLengthMinFt) {
      alerts.push({
        id: generateAlertId(),
        type: 'length_anomaly',
        severity: 'warning',
        description: `Average ridge length ${avgRidgeLength.toFixed(1)}ft is below minimum ${cfg.ridgeLengthMinFt}ft`,
        expectedValue: cfg.ridgeLengthMinFt,
        actualValue: avgRidgeLength,
        deviationPct: calculateDeviationPct(cfg.ridgeLengthMinFt, avgRidgeLength),
        deviationFt: cfg.ridgeLengthMinFt - avgRidgeLength,
        ruleName: 'ridge_min_length',
        recommendedAction: 'Check for incorrectly detected short ridges or split ridge segments'
      });
    }

    if (avgRidgeLength > cfg.ridgeLengthMaxFt) {
      alerts.push({
        id: generateAlertId(),
        type: 'length_anomaly',
        severity: 'warning',
        description: `Average ridge length ${avgRidgeLength.toFixed(1)}ft exceeds maximum ${cfg.ridgeLengthMaxFt}ft`,
        expectedValue: cfg.ridgeLengthMaxFt,
        actualValue: avgRidgeLength,
        deviationPct: calculateDeviationPct(cfg.ridgeLengthMaxFt, avgRidgeLength),
        deviationFt: avgRidgeLength - cfg.ridgeLengthMaxFt,
        ruleName: 'ridge_max_length',
        recommendedAction: 'Verify building dimensions or check for merged ridge segments'
      });
    }
  }

  // Check hip lengths
  if (measurement.hipTotalFt > 0 && measurement.hipCount > 0) {
    const avgHipLength = measurement.hipTotalFt / measurement.hipCount;
    
    if (avgHipLength < cfg.hipLengthMinFt) {
      alerts.push({
        id: generateAlertId(),
        type: 'length_anomaly',
        severity: 'warning',
        description: `Average hip length ${avgHipLength.toFixed(1)}ft is below minimum ${cfg.hipLengthMinFt}ft`,
        expectedValue: cfg.hipLengthMinFt,
        actualValue: avgHipLength,
        deviationPct: calculateDeviationPct(cfg.hipLengthMinFt, avgHipLength),
        deviationFt: cfg.hipLengthMinFt - avgHipLength,
        ruleName: 'hip_min_length',
        recommendedAction: 'Review hip detection - may be incorrectly identified features'
      });
    }
  }

  // Check valley lengths
  if (measurement.valleyTotalFt > 0 && measurement.valleyCount > 0) {
    const avgValleyLength = measurement.valleyTotalFt / measurement.valleyCount;
    
    if (avgValleyLength < cfg.valleyLengthMinFt) {
      alerts.push({
        id: generateAlertId(),
        type: 'length_anomaly',
        severity: 'warning',
        description: `Average valley length ${avgValleyLength.toFixed(1)}ft is below minimum ${cfg.valleyLengthMinFt}ft`,
        expectedValue: cfg.valleyLengthMinFt,
        actualValue: avgValleyLength,
        deviationPct: calculateDeviationPct(cfg.valleyLengthMinFt, avgValleyLength),
        deviationFt: cfg.valleyLengthMinFt - avgValleyLength,
        ruleName: 'valley_min_length',
        recommendedAction: 'Verify valley detection accuracy'
      });
    }
  }

  return alerts;
}

/**
 * Check feature count mismatches based on building shape
 */
export function checkCountMismatches(
  measurement: MeasurementData,
  rules: Partial<DeviationRules> = {}
): DeviationAlert[] {
  const alerts: DeviationAlert[] = [];
  const expected = getExpectedFeatureCounts(measurement.buildingShape, measurement.roofStyle);

  // Check ridge count
  if (measurement.ridgeCount < expected.ridges.min || measurement.ridgeCount > expected.ridges.max) {
    alerts.push({
      id: generateAlertId(),
      type: 'count_mismatch',
      severity: 'error',
      description: `${measurement.ridgeCount} ridges detected for ${measurement.buildingShape} building (expected ${expected.ridges.min}-${expected.ridges.max})`,
      expectedValue: expected.ridges.min,
      actualValue: measurement.ridgeCount,
      deviationPct: 0,
      deviationFt: 0,
      ruleName: 'ridge_count_validation',
      recommendedAction: 'Review ridge detection or verify building shape classification'
    });
  }

  // Check hip count
  if (measurement.roofStyle !== 'gable') {
    if (measurement.hipCount < expected.hips.min || measurement.hipCount > expected.hips.max) {
      alerts.push({
        id: generateAlertId(),
        type: 'count_mismatch',
        severity: 'error',
        description: `${measurement.hipCount} hips detected for ${measurement.buildingShape} ${measurement.roofStyle} roof (expected ${expected.hips.min}-${expected.hips.max})`,
        expectedValue: expected.hips.min,
        actualValue: measurement.hipCount,
        deviationPct: 0,
        deviationFt: 0,
        ruleName: 'hip_count_validation',
        recommendedAction: 'Check hip detection or verify roof style classification'
      });
    }
  }

  // Check valley count
  if (measurement.valleyCount < expected.valleys.min || measurement.valleyCount > expected.valleys.max) {
    if (measurement.buildingShape !== 'rectangle') {
      alerts.push({
        id: generateAlertId(),
        type: 'count_mismatch',
        severity: 'warning',
        description: `${measurement.valleyCount} valleys detected for ${measurement.buildingShape} building (expected ${expected.valleys.min}-${expected.valleys.max})`,
        expectedValue: expected.valleys.min,
        actualValue: measurement.valleyCount,
        deviationPct: 0,
        deviationFt: 0,
        ruleName: 'valley_count_validation',
        recommendedAction: 'Review valley detection or building shape'
      });
    }
  }

  return alerts;
}

/**
 * Check perimeter consistency (eaves + rakes should equal perimeter)
 */
export function checkPerimeterConsistency(
  measurement: MeasurementData,
  tolerancePct: number = 5
): DeviationAlert | null {
  const classifiedPerimeter = measurement.eaveTotalFt + measurement.rakeTotalFt;
  const deviationPct = calculateDeviationPct(measurement.perimeterFt, classifiedPerimeter);

  if (deviationPct > tolerancePct) {
    return {
      id: generateAlertId(),
      type: 'shape_violation',
      severity: 'warning',
      description: `Classified perimeter (${classifiedPerimeter.toFixed(1)}ft) differs from total perimeter (${measurement.perimeterFt.toFixed(1)}ft) by ${deviationPct.toFixed(1)}%`,
      expectedValue: measurement.perimeterFt,
      actualValue: classifiedPerimeter,
      deviationPct,
      deviationFt: Math.abs(measurement.perimeterFt - classifiedPerimeter),
      ruleName: 'perimeter_consistency',
      recommendedAction: 'Check for unclassified edges or measurement gaps'
    };
  }

  return null;
}

/**
 * Check ratio anomalies (e.g., ridge to building width)
 */
export function checkRatioAnomalies(
  measurement: MeasurementData,
  buildingWidthFt: number,
  buildingLengthFt: number
): DeviationAlert[] {
  const alerts: DeviationAlert[] = [];

  // Ridge length should be approximately building length (for hip roofs, minus 2x overhang)
  if (measurement.ridgeTotalFt > 0 && buildingLengthFt > 0) {
    const ridgeToLengthRatio = measurement.ridgeTotalFt / buildingLengthFt;
    
    if (ridgeToLengthRatio < 0.5 || ridgeToLengthRatio > 1.3) {
      alerts.push({
        id: generateAlertId(),
        type: 'ratio_anomaly',
        severity: 'warning',
        description: `Ridge to building length ratio (${ridgeToLengthRatio.toFixed(2)}) is outside expected range (0.5-1.3)`,
        expectedValue: 1.0,
        actualValue: ridgeToLengthRatio,
        deviationPct: calculateDeviationPct(1.0, ridgeToLengthRatio),
        deviationFt: 0,
        ruleName: 'ridge_to_length_ratio',
        recommendedAction: 'Verify ridge length and building dimensions'
      });
    }
  }

  // For hip roofs, hip length should be related to building width and pitch
  if (measurement.roofStyle === 'hip' && measurement.hipTotalFt > 0 && buildingWidthFt > 0) {
    const avgHipLength = measurement.hipTotalFt / Math.max(1, measurement.hipCount);
    const expectedHipLength = buildingWidthFt * 0.7; // Rough estimate for standard pitch
    const hipDeviation = calculateDeviationPct(expectedHipLength, avgHipLength);

    if (hipDeviation > 30) {
      alerts.push({
        id: generateAlertId(),
        type: 'ratio_anomaly',
        severity: 'info',
        description: `Average hip length (${avgHipLength.toFixed(1)}ft) deviates ${hipDeviation.toFixed(1)}% from expected based on building width`,
        expectedValue: expectedHipLength,
        actualValue: avgHipLength,
        deviationPct: hipDeviation,
        deviationFt: Math.abs(expectedHipLength - avgHipLength),
        ruleName: 'hip_to_width_ratio',
        recommendedAction: 'Verify hip measurements and roof pitch'
      });
    }
  }

  return alerts;
}

/**
 * Check confidence score threshold
 */
export function checkConfidenceScore(
  confidenceScore: number,
  rules: Partial<DeviationRules> = {}
): DeviationAlert | null {
  const cfg = { ...DEFAULT_RULES, ...rules };

  if (confidenceScore < cfg.minConfidenceScore) {
    return {
      id: generateAlertId(),
      type: 'topology_error',
      severity: confidenceScore < 0.5 ? 'critical' : 'warning',
      description: `Overall confidence score (${(confidenceScore * 100).toFixed(1)}%) is below threshold (${(cfg.minConfidenceScore * 100).toFixed(1)}%)`,
      expectedValue: cfg.minConfidenceScore,
      actualValue: confidenceScore,
      deviationPct: calculateDeviationPct(cfg.minConfidenceScore, confidenceScore),
      deviationFt: 0,
      ruleName: 'confidence_threshold',
      recommendedAction: 'Manual review recommended due to low confidence'
    };
  }

  return null;
}

/**
 * Run all deviation checks
 */
export function analyzeDeviations(
  measurement: MeasurementData,
  benchmark: BenchmarkData = {},
  buildingDimensions: { widthFt: number; lengthFt: number } = { widthFt: 0, lengthFt: 0 },
  rules: Partial<DeviationRules> = {}
): DeviationAlert[] {
  const alerts: DeviationAlert[] = [];

  // Area deviation
  const areaAlert = checkAreaDeviation(measurement, benchmark, rules);
  if (areaAlert) alerts.push(areaAlert);

  // Length anomalies
  const lengthAlerts = checkLengthAnomalies(measurement, rules);
  alerts.push(...lengthAlerts);

  // Count mismatches
  const countAlerts = checkCountMismatches(measurement, rules);
  alerts.push(...countAlerts);

  // Perimeter consistency
  const perimeterAlert = checkPerimeterConsistency(measurement);
  if (perimeterAlert) alerts.push(perimeterAlert);

  // Ratio anomalies
  if (buildingDimensions.widthFt > 0 || buildingDimensions.lengthFt > 0) {
    const ratioAlerts = checkRatioAnomalies(
      measurement,
      buildingDimensions.widthFt,
      buildingDimensions.lengthFt
    );
    alerts.push(...ratioAlerts);
  }

  // Confidence check
  const confidenceAlert = checkConfidenceScore(measurement.confidenceScore, rules);
  if (confidenceAlert) alerts.push(confidenceAlert);

  // Sort by severity
  const severityOrder = { critical: 0, error: 1, warning: 2, info: 3 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

/**
 * Summarize deviation analysis
 */
export function summarizeDeviations(alerts: DeviationAlert[]): {
  totalAlerts: number;
  criticalCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  passesQualityCheck: boolean;
  summary: string;
} {
  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const errorCount = alerts.filter(a => a.severity === 'error').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;
  const infoCount = alerts.filter(a => a.severity === 'info').length;

  const passesQualityCheck = criticalCount === 0 && errorCount <= 1;

  let summary = '';
  if (alerts.length === 0) {
    summary = 'All measurements within expected ranges. No deviations detected.';
  } else if (passesQualityCheck) {
    summary = `Minor deviations detected (${warningCount} warnings, ${infoCount} info). Measurements acceptable with review.`;
  } else {
    summary = `Significant deviations detected (${criticalCount} critical, ${errorCount} errors). Manual review required.`;
  }

  return {
    totalAlerts: alerts.length,
    criticalCount,
    errorCount,
    warningCount,
    infoCount,
    passesQualityCheck,
    summary
  };
}
