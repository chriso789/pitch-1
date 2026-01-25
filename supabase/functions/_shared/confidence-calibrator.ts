/**
 * Phase 24: AI Confidence Calibration System
 * Calibrates AI confidence scores against ground truth to provide
 * accurate reliability estimates using Platt scaling.
 */

export interface CalibrationDataPoint {
  rawConfidence: number;
  actualOutcome: boolean; // true = correct, false = incorrect
  componentType: string;
  region?: string;
}

export interface CalibrationModel {
  componentType: string;
  region?: string;
  plattA: number;
  plattB: number;
  sampleCount: number;
  calibrationCurve: { bin: number; accuracy: number; count: number }[];
}

export interface CalibratedScore {
  rawConfidence: number;
  calibratedConfidence: number;
  reliabilityLevel: 'low' | 'medium' | 'high' | 'very_high';
  expectedAccuracy: number;
}

/**
 * Sigmoid function for Platt scaling
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Fit Platt scaling parameters using logistic regression
 * Uses gradient descent to minimize cross-entropy loss
 */
export function fitPlattScaling(
  data: CalibrationDataPoint[]
): { a: number; b: number } {
  if (data.length < 10) {
    // Not enough data, return identity transform
    return { a: 1, b: 0 };
  }
  
  // Initialize parameters
  let a = 0;
  let b = 0;
  const learningRate = 0.1;
  const iterations = 1000;
  
  for (let iter = 0; iter < iterations; iter++) {
    let gradA = 0;
    let gradB = 0;
    
    for (const point of data) {
      const z = a * point.rawConfidence + b;
      const pred = sigmoid(z);
      const target = point.actualOutcome ? 1 : 0;
      const error = pred - target;
      
      gradA += error * point.rawConfidence;
      gradB += error;
    }
    
    // Update parameters
    a -= learningRate * gradA / data.length;
    b -= learningRate * gradB / data.length;
  }
  
  return { a, b };
}

/**
 * Apply Platt scaling calibration to a raw confidence score
 */
export function applyCalibration(
  rawConfidence: number,
  plattA: number,
  plattB: number
): number {
  const z = plattA * rawConfidence + plattB;
  return sigmoid(z);
}

/**
 * Build calibration curve by binning predictions
 */
export function buildCalibrationCurve(
  data: CalibrationDataPoint[],
  numBins: number = 10
): { bin: number; accuracy: number; count: number }[] {
  const bins: Map<number, { correct: number; total: number }> = new Map();
  
  // Initialize bins
  for (let i = 0; i < numBins; i++) {
    bins.set(i, { correct: 0, total: 0 });
  }
  
  // Assign data points to bins
  for (const point of data) {
    const binIndex = Math.min(numBins - 1, Math.floor(point.rawConfidence * numBins));
    const bin = bins.get(binIndex)!;
    bin.total++;
    if (point.actualOutcome) {
      bin.correct++;
    }
  }
  
  // Calculate accuracy per bin
  const curve: { bin: number; accuracy: number; count: number }[] = [];
  
  for (let i = 0; i < numBins; i++) {
    const bin = bins.get(i)!;
    const binCenter = (i + 0.5) / numBins;
    const accuracy = bin.total > 0 ? bin.correct / bin.total : binCenter;
    
    curve.push({
      bin: binCenter,
      accuracy,
      count: bin.total
    });
  }
  
  return curve;
}

/**
 * Calculate Expected Calibration Error (ECE)
 */
export function calculateECE(
  curve: { bin: number; accuracy: number; count: number }[]
): number {
  const totalSamples = curve.reduce((sum, b) => sum + b.count, 0);
  if (totalSamples === 0) return 0;
  
  let ece = 0;
  for (const bin of curve) {
    if (bin.count > 0) {
      const weight = bin.count / totalSamples;
      const calibrationError = Math.abs(bin.accuracy - bin.bin);
      ece += weight * calibrationError;
    }
  }
  
  return ece;
}

/**
 * Collect calibration data from predictions and ground truth
 */
export function collectCalibrationData(
  predictions: { id: string; type: string; confidence: number; geometry: any }[],
  groundTruth: { id: string; type: string; geometry: any }[],
  matchThresholdFt: number = 3.0
): CalibrationDataPoint[] {
  const data: CalibrationDataPoint[] = [];
  
  for (const pred of predictions) {
    // Find matching ground truth
    const matched = groundTruth.some(gt => 
      gt.type === pred.type && geometriesMatch(pred.geometry, gt.geometry, matchThresholdFt)
    );
    
    data.push({
      rawConfidence: pred.confidence,
      actualOutcome: matched,
      componentType: pred.type
    });
  }
  
  return data;
}

/**
 * Check if two geometries match within threshold
 */
function geometriesMatch(geom1: any, geom2: any, thresholdFt: number): boolean {
  // Simplified matching - would need full implementation
  if (!geom1 || !geom2) return false;
  
  // For linear features, compare endpoints
  if (geom1.startLat && geom2.startLat) {
    const startDist = haversineDistanceFt(
      geom1.startLat, geom1.startLng,
      geom2.startLat, geom2.startLng
    );
    const endDist = haversineDistanceFt(
      geom1.endLat, geom1.endLng,
      geom2.endLat, geom2.endLng
    );
    
    return startDist <= thresholdFt && endDist <= thresholdFt;
  }
  
  return false;
}

const EARTH_RADIUS_FT = 20902231;

function haversineDistanceFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 + 
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  return 2 * EARTH_RADIUS_FT * Math.asin(Math.sqrt(a));
}

/**
 * Train a calibration model for a specific component type
 */
export function trainCalibrationModel(
  data: CalibrationDataPoint[],
  componentType: string,
  region?: string
): CalibrationModel {
  // Filter data for this component type
  const filteredData = data.filter(d => 
    d.componentType === componentType &&
    (!region || d.region === region)
  );
  
  // Fit Platt scaling
  const { a, b } = fitPlattScaling(filteredData);
  
  // Build calibration curve
  const curve = buildCalibrationCurve(filteredData);
  
  return {
    componentType,
    region,
    plattA: a,
    plattB: b,
    sampleCount: filteredData.length,
    calibrationCurve: curve
  };
}

/**
 * Get calibrated confidence score with reliability level
 */
export function getCalibratedScore(
  rawConfidence: number,
  model: CalibrationModel
): CalibratedScore {
  const calibrated = applyCalibration(rawConfidence, model.plattA, model.plattB);
  
  // Determine reliability level
  let reliabilityLevel: 'low' | 'medium' | 'high' | 'very_high' = 'low';
  if (calibrated >= 0.95) {
    reliabilityLevel = 'very_high';
  } else if (calibrated >= 0.85) {
    reliabilityLevel = 'high';
  } else if (calibrated >= 0.70) {
    reliabilityLevel = 'medium';
  }
  
  // Look up expected accuracy from calibration curve
  const binIndex = Math.min(9, Math.floor(rawConfidence * 10));
  const expectedAccuracy = model.calibrationCurve[binIndex]?.accuracy || calibrated;
  
  return {
    rawConfidence,
    calibratedConfidence: calibrated,
    reliabilityLevel,
    expectedAccuracy
  };
}

/**
 * Update calibration model with new data (incremental update)
 */
export function updateCalibrationModel(
  existingModel: CalibrationModel,
  newData: CalibrationDataPoint[]
): CalibrationModel {
  // Combine with weighted average based on sample counts
  const oldWeight = existingModel.sampleCount / (existingModel.sampleCount + newData.length);
  const newWeight = 1 - oldWeight;
  
  // Fit on new data
  const { a: newA, b: newB } = fitPlattScaling(newData);
  
  // Weighted average of parameters
  const updatedA = existingModel.plattA * oldWeight + newA * newWeight;
  const updatedB = existingModel.plattB * oldWeight + newB * newWeight;
  
  // Update curve
  const newCurve = buildCalibrationCurve(newData);
  const updatedCurve = existingModel.calibrationCurve.map((bin, i) => ({
    bin: bin.bin,
    accuracy: bin.accuracy * oldWeight + (newCurve[i]?.accuracy || bin.accuracy) * newWeight,
    count: bin.count + (newCurve[i]?.count || 0)
  }));
  
  return {
    ...existingModel,
    plattA: updatedA,
    plattB: updatedB,
    sampleCount: existingModel.sampleCount + newData.length,
    calibrationCurve: updatedCurve
  };
}

/**
 * Evaluate calibration quality
 */
export function evaluateCalibration(model: CalibrationModel): {
  ece: number;
  quality: 'poor' | 'fair' | 'good' | 'excellent';
  recommendation: string;
} {
  const ece = calculateECE(model.calibrationCurve);
  
  let quality: 'poor' | 'fair' | 'good' | 'excellent' = 'poor';
  let recommendation = '';
  
  if (ece < 0.05) {
    quality = 'excellent';
    recommendation = 'Calibration is excellent. Confidence scores are highly reliable.';
  } else if (ece < 0.10) {
    quality = 'good';
    recommendation = 'Calibration is good. Confidence scores are generally reliable.';
  } else if (ece < 0.15) {
    quality = 'fair';
    recommendation = 'Calibration is fair. Consider collecting more ground truth data.';
  } else {
    quality = 'poor';
    recommendation = 'Calibration is poor. More training data needed before trusting confidence scores.';
  }
  
  if (model.sampleCount < 100) {
    recommendation += ` Sample size (${model.sampleCount}) is low for reliable calibration.`;
  }
  
  return { ece, quality, recommendation };
}
