// =====================================================
// Phase 90: Anomaly Detector
// Automatically flag unusual measurement patterns
// =====================================================

export interface AnomalyResult {
  hasAnomalies: boolean;
  anomalies: DetectedAnomaly[];
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
}

export interface DetectedAnomaly {
  id: string;
  type: AnomalyType;
  severity: 'info' | 'warning' | 'error' | 'critical';
  metric: string;
  observedValue: number;
  expectedRange: { min: number; max: number };
  deviationPercent: number;
  description: string;
  possibleCauses: string[];
  suggestedAction: string;
}

export type AnomalyType = 
  | 'statistical_outlier'
  | 'impossible_geometry'
  | 'ratio_violation'
  | 'missing_component'
  | 'duplicate_detection'
  | 'inconsistent_pitch'
  | 'edge_crossing'
  | 'area_mismatch';

// Statistical thresholds
const THRESHOLDS = {
  // Standard deviation multipliers
  OUTLIER_SIGMA: 3,
  WARNING_SIGMA: 2.5,
  
  // Geometric constraints
  MIN_FACET_AREA_SQFT: 10,
  MAX_FACET_AREA_SQFT: 5000,
  MIN_EDGE_LENGTH_FT: 2,
  MAX_EDGE_LENGTH_FT: 200,
  MIN_PITCH_DEGREES: 5,
  MAX_PITCH_DEGREES: 60,
  
  // Ratio constraints
  MIN_AREA_TO_PERIMETER_RATIO: 0.5,
  MAX_AREA_TO_PERIMETER_RATIO: 50,
  MIN_RIDGE_TO_PERIMETER_RATIO: 0.05,
  MAX_RIDGE_TO_PERIMETER_RATIO: 0.4,
  
  // Consistency constraints
  MAX_PITCH_VARIANCE_DEGREES: 15,
  MAX_AREA_VARIANCE_PERCENT: 5,
};

// Statistical baseline data (would come from database in production)
interface BaselineStats {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
}

const BASELINE_STATS: Record<string, BaselineStats> = {
  total_area: {
    mean: 2500,
    stdDev: 1200,
    min: 500,
    max: 15000,
    percentiles: { p5: 1000, p25: 1800, p50: 2300, p75: 3000, p95: 5000 },
  },
  ridge_length: {
    mean: 40,
    stdDev: 20,
    min: 10,
    max: 150,
    percentiles: { p5: 15, p25: 25, p50: 38, p75: 50, p95: 80 },
  },
  facet_count: {
    mean: 6,
    stdDev: 3,
    min: 2,
    max: 20,
    percentiles: { p5: 2, p25: 4, p50: 5, p75: 8, p95: 12 },
  },
};

export class AnomalyDetector {
  private customBaselines: Map<string, BaselineStats> = new Map();

  // Main detection method
  detectAnomalies(measurement: {
    totalArea: number;
    ridgeLength: number;
    hipLength: number;
    valleyLength: number;
    eaveLength: number;
    rakeLength: number;
    facetCount: number;
    predominantPitch: string;
    facets?: Array<{ area: number; pitch: string }>;
    edges?: Array<{ type: string; length: number; startPoint: any; endPoint: any }>;
  }): AnomalyResult {
    const anomalies: DetectedAnomaly[] = [];
    
    // Check statistical outliers
    this.checkStatisticalOutliers(measurement, anomalies);
    
    // Check impossible geometries
    this.checkGeometricConstraints(measurement, anomalies);
    
    // Check ratio violations
    this.checkRatioConstraints(measurement, anomalies);
    
    // Check for missing components
    this.checkMissingComponents(measurement, anomalies);
    
    // Check pitch consistency
    if (measurement.facets) {
      this.checkPitchConsistency(measurement.facets, anomalies);
    }
    
    // Check for edge crossings
    if (measurement.edges) {
      this.checkEdgeCrossings(measurement.edges, anomalies);
    }
    
    // Calculate overall risk
    const overallRisk = this.calculateOverallRisk(anomalies);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(anomalies);
    
    return {
      hasAnomalies: anomalies.length > 0,
      anomalies,
      overallRisk,
      recommendations,
    };
  }

  private checkStatisticalOutliers(
    measurement: any,
    anomalies: DetectedAnomaly[]
  ): void {
    // Check total area
    const areaStats = BASELINE_STATS.total_area;
    const areaZScore = (measurement.totalArea - areaStats.mean) / areaStats.stdDev;
    
    if (Math.abs(areaZScore) > THRESHOLDS.OUTLIER_SIGMA) {
      anomalies.push({
        id: `outlier-area-${Date.now()}`,
        type: 'statistical_outlier',
        severity: Math.abs(areaZScore) > 4 ? 'error' : 'warning',
        metric: 'totalArea',
        observedValue: measurement.totalArea,
        expectedRange: {
          min: areaStats.percentiles.p5,
          max: areaStats.percentiles.p95,
        },
        deviationPercent: (areaZScore * areaStats.stdDev / areaStats.mean) * 100,
        description: `Total area is ${Math.abs(areaZScore).toFixed(1)} standard deviations from typical`,
        possibleCauses: [
          'Large commercial property',
          'Multi-building detection',
          'Measurement error',
          'Unusual property type',
        ],
        suggestedAction: 'Review satellite imagery and verify property boundaries',
      });
    }
    
    // Check ridge length
    const ridgeStats = BASELINE_STATS.ridge_length;
    const ridgeZScore = (measurement.ridgeLength - ridgeStats.mean) / ridgeStats.stdDev;
    
    if (Math.abs(ridgeZScore) > THRESHOLDS.OUTLIER_SIGMA) {
      anomalies.push({
        id: `outlier-ridge-${Date.now()}`,
        type: 'statistical_outlier',
        severity: 'warning',
        metric: 'ridgeLength',
        observedValue: measurement.ridgeLength,
        expectedRange: {
          min: ridgeStats.percentiles.p5,
          max: ridgeStats.percentiles.p95,
        },
        deviationPercent: (ridgeZScore * ridgeStats.stdDev / ridgeStats.mean) * 100,
        description: `Ridge length is unusually ${ridgeZScore > 0 ? 'long' : 'short'}`,
        possibleCauses: [
          'Long rectangular building',
          'Multiple ridges not connected',
          'Detection error',
        ],
        suggestedAction: 'Verify ridge line detection accuracy',
      });
    }
  }

  private checkGeometricConstraints(
    measurement: any,
    anomalies: DetectedAnomaly[]
  ): void {
    // Check for impossible area
    if (measurement.totalArea < THRESHOLDS.MIN_FACET_AREA_SQFT) {
      anomalies.push({
        id: `geometry-area-too-small-${Date.now()}`,
        type: 'impossible_geometry',
        severity: 'critical',
        metric: 'totalArea',
        observedValue: measurement.totalArea,
        expectedRange: {
          min: THRESHOLDS.MIN_FACET_AREA_SQFT,
          max: THRESHOLDS.MAX_FACET_AREA_SQFT,
        },
        deviationPercent: ((THRESHOLDS.MIN_FACET_AREA_SQFT - measurement.totalArea) / THRESHOLDS.MIN_FACET_AREA_SQFT) * 100,
        description: 'Total area is impossibly small for a roof',
        possibleCauses: [
          'Wrong scale detection',
          'Partial roof detected',
          'Non-roof structure detected',
        ],
        suggestedAction: 'Re-run measurement with manual scale verification',
      });
    }
    
    // Check for negative values
    const numericFields = ['totalArea', 'ridgeLength', 'hipLength', 'valleyLength', 'eaveLength'];
    for (const field of numericFields) {
      if (measurement[field] < 0) {
        anomalies.push({
          id: `geometry-negative-${field}-${Date.now()}`,
          type: 'impossible_geometry',
          severity: 'critical',
          metric: field,
          observedValue: measurement[field],
          expectedRange: { min: 0, max: Infinity },
          deviationPercent: 100,
          description: `${field} has impossible negative value`,
          possibleCauses: ['Calculation error', 'Data corruption'],
          suggestedAction: 'Re-run measurement or report bug',
        });
      }
    }
  }

  private checkRatioConstraints(
    measurement: any,
    anomalies: DetectedAnomaly[]
  ): void {
    const perimeter = measurement.eaveLength + measurement.rakeLength;
    
    if (perimeter > 0) {
      const areaToPerimeterRatio = measurement.totalArea / perimeter;
      
      if (areaToPerimeterRatio < THRESHOLDS.MIN_AREA_TO_PERIMETER_RATIO) {
        anomalies.push({
          id: `ratio-area-perimeter-low-${Date.now()}`,
          type: 'ratio_violation',
          severity: 'warning',
          metric: 'areaToPerimeterRatio',
          observedValue: areaToPerimeterRatio,
          expectedRange: {
            min: THRESHOLDS.MIN_AREA_TO_PERIMETER_RATIO,
            max: THRESHOLDS.MAX_AREA_TO_PERIMETER_RATIO,
          },
          deviationPercent: ((THRESHOLDS.MIN_AREA_TO_PERIMETER_RATIO - areaToPerimeterRatio) / THRESHOLDS.MIN_AREA_TO_PERIMETER_RATIO) * 100,
          description: 'Roof shape is unusually narrow or irregular',
          possibleCauses: [
            'Very narrow building',
            'Incomplete perimeter detection',
            'Multiple small sections',
          ],
          suggestedAction: 'Review roof shape and verify perimeter',
        });
      }
      
      // Check ridge to perimeter ratio
      const ridgeToPerimeterRatio = measurement.ridgeLength / perimeter;
      
      if (ridgeToPerimeterRatio > THRESHOLDS.MAX_RIDGE_TO_PERIMETER_RATIO) {
        anomalies.push({
          id: `ratio-ridge-perimeter-high-${Date.now()}`,
          type: 'ratio_violation',
          severity: 'info',
          metric: 'ridgeToPerimeterRatio',
          observedValue: ridgeToPerimeterRatio,
          expectedRange: {
            min: THRESHOLDS.MIN_RIDGE_TO_PERIMETER_RATIO,
            max: THRESHOLDS.MAX_RIDGE_TO_PERIMETER_RATIO,
          },
          deviationPercent: ((ridgeToPerimeterRatio - THRESHOLDS.MAX_RIDGE_TO_PERIMETER_RATIO) / THRESHOLDS.MAX_RIDGE_TO_PERIMETER_RATIO) * 100,
          description: 'Ridge is unusually long relative to building size',
          possibleCauses: [
            'Multiple ridge lines',
            'Very long narrow building',
            'Complex roof with many ridges',
          ],
          suggestedAction: 'Verify ridge line detection',
        });
      }
    }
  }

  private checkMissingComponents(
    measurement: any,
    anomalies: DetectedAnomaly[]
  ): void {
    // Hip roof should have hip length
    if (measurement.facetCount > 2 && measurement.hipLength === 0 && measurement.rakeLength === 0) {
      anomalies.push({
        id: `missing-hip-or-rake-${Date.now()}`,
        type: 'missing_component',
        severity: 'warning',
        metric: 'hipLength',
        observedValue: 0,
        expectedRange: { min: 1, max: 200 },
        deviationPercent: 100,
        description: 'Multiple facets detected but no hip or rake lines',
        possibleCauses: [
          'Hip lines not detected',
          'Gable ends not detected',
          'Detection algorithm issue',
        ],
        suggestedAction: 'Review facet boundaries for missing edge classifications',
      });
    }
    
    // Check for eave on sloped roof
    if (measurement.totalArea > 100 && measurement.eaveLength === 0) {
      anomalies.push({
        id: `missing-eave-${Date.now()}`,
        type: 'missing_component',
        severity: 'error',
        metric: 'eaveLength',
        observedValue: 0,
        expectedRange: { min: 10, max: 500 },
        deviationPercent: 100,
        description: 'No eave length detected on a sized roof',
        possibleCauses: [
          'Flat roof (may be correct)',
          'Perimeter not classified',
          'Edge detection failure',
        ],
        suggestedAction: 'Verify roof type and perimeter detection',
      });
    }
  }

  private checkPitchConsistency(
    facets: Array<{ area: number; pitch: string }>,
    anomalies: DetectedAnomaly[]
  ): void {
    if (facets.length < 2) return;
    
    const pitchValues = facets.map(f => this.pitchToDegrees(f.pitch));
    const avgPitch = pitchValues.reduce((a, b) => a + b, 0) / pitchValues.length;
    const maxVariance = Math.max(...pitchValues.map(p => Math.abs(p - avgPitch)));
    
    if (maxVariance > THRESHOLDS.MAX_PITCH_VARIANCE_DEGREES) {
      anomalies.push({
        id: `inconsistent-pitch-${Date.now()}`,
        type: 'inconsistent_pitch',
        severity: 'info',
        metric: 'pitchVariance',
        observedValue: maxVariance,
        expectedRange: { min: 0, max: THRESHOLDS.MAX_PITCH_VARIANCE_DEGREES },
        deviationPercent: ((maxVariance - THRESHOLDS.MAX_PITCH_VARIANCE_DEGREES) / THRESHOLDS.MAX_PITCH_VARIANCE_DEGREES) * 100,
        description: `Facet pitches vary by ${maxVariance.toFixed(1)}°`,
        possibleCauses: [
          'Multi-level roof (correct behavior)',
          'Addition with different pitch',
          'Pitch detection error',
        ],
        suggestedAction: 'Verify if pitch variation is expected for this property',
      });
    }
  }

  private checkEdgeCrossings(
    edges: Array<{ type: string; length: number; startPoint: any; endPoint: any }>,
    anomalies: DetectedAnomaly[]
  ): void {
    // Simplified crossing detection
    // In production, would use proper line segment intersection
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        if (this.edgesCross(edges[i], edges[j])) {
          anomalies.push({
            id: `edge-crossing-${i}-${j}-${Date.now()}`,
            type: 'edge_crossing',
            severity: 'error',
            metric: 'edgeIntersection',
            observedValue: 1,
            expectedRange: { min: 0, max: 0 },
            deviationPercent: 100,
            description: `Edges ${edges[i].type} and ${edges[j].type} cross unexpectedly`,
            possibleCauses: [
              'Incorrect vertex placement',
              'Edge misclassification',
              'Complex geometry error',
            ],
            suggestedAction: 'Review edge geometry and vertex positions',
          });
        }
      }
    }
  }

  private edgesCross(edge1: any, edge2: any): boolean {
    // Placeholder - would implement proper line segment intersection
    return false;
  }

  private pitchToDegrees(pitch: string): number {
    const [rise, run] = pitch.split('/').map(Number);
    return Math.atan(rise / run) * (180 / Math.PI);
  }

  private calculateOverallRisk(anomalies: DetectedAnomaly[]): 'low' | 'medium' | 'high' | 'critical' {
    const severityCounts = {
      critical: anomalies.filter(a => a.severity === 'critical').length,
      error: anomalies.filter(a => a.severity === 'error').length,
      warning: anomalies.filter(a => a.severity === 'warning').length,
      info: anomalies.filter(a => a.severity === 'info').length,
    };
    
    if (severityCounts.critical > 0) return 'critical';
    if (severityCounts.error > 1) return 'high';
    if (severityCounts.error > 0 || severityCounts.warning > 2) return 'medium';
    return 'low';
  }

  private generateRecommendations(anomalies: DetectedAnomaly[]): string[] {
    const recommendations: string[] = [];
    
    if (anomalies.some(a => a.type === 'impossible_geometry')) {
      recommendations.push('Re-run measurement with manual verification');
    }
    
    if (anomalies.some(a => a.type === 'statistical_outlier')) {
      recommendations.push('Compare with similar properties in the area');
    }
    
    if (anomalies.some(a => a.type === 'missing_component')) {
      recommendations.push('Review edge classification for completeness');
    }
    
    if (anomalies.some(a => a.severity === 'critical')) {
      recommendations.push('Route to expert review before use');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Measurement appears valid');
    }
    
    return recommendations;
  }

  // Update baselines with new data
  updateBaseline(metric: string, values: number[]): void {
    if (values.length < 10) return;
    
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    this.customBaselines.set(metric, {
      mean,
      stdDev,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      percentiles: {
        p5: sorted[Math.floor(values.length * 0.05)],
        p25: sorted[Math.floor(values.length * 0.25)],
        p50: sorted[Math.floor(values.length * 0.50)],
        p75: sorted[Math.floor(values.length * 0.75)],
        p95: sorted[Math.floor(values.length * 0.95)],
      },
    });
  }
}

export default AnomalyDetector;
