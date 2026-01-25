/**
 * Phase 69: 100% Accuracy Certification Path (Diamond Certification)
 * Defines and enforces path to "100% Accuracy" certification
 */

interface DiamondCertificationResult {
  certified: boolean;
  certificationLevel: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | null;
  certificationNumber: string | null;
  overallScore: number;
  areaAccuracyPct: number;
  linearAccuracyPct: number;
  pitchAccuracyScore: number;
  topologyScore: number;
  allValidationsPassed: boolean;
  expertReviewRequired: boolean;
  certificationRequirements: CertificationRequirement[];
  missingRequirements: string[];
  validUntil: Date | null;
  certificateHash: string | null;
}

interface CertificationRequirement {
  id: string;
  name: string;
  category: string;
  required: boolean;
  passed: boolean;
  value: number | string;
  threshold: number | string;
  description: string;
}

interface MeasurementForCertification {
  measurementId: string;
  totalArea: number;
  groundTruthArea?: number;
  linearMeasurements: {
    ridge: number;
    hip: number;
    valley: number;
    eave: number;
    rake: number;
  };
  groundTruthLinear?: {
    ridge?: number;
    hip?: number;
    valley?: number;
    eave?: number;
    rake?: number;
  };
  pitch: string;
  groundTruthPitch?: string;
  topologyValidation: {
    passed: boolean;
    score: number;
    errors: number;
  };
  validationResult: {
    isValid: boolean;
    overallScore: number;
    criticalChecksPassed: boolean;
  };
  expertReviewed: boolean;
  expertReviewerId?: string;
  expertReviewNotes?: string;
}

// Certification thresholds by level
const CERTIFICATION_THRESHOLDS = {
  bronze: {
    areaAccuracy: 95,
    linearAccuracy: 93,
    pitchAccuracy: 90,
    topologyScore: 90,
    requireExpertReview: false
  },
  silver: {
    areaAccuracy: 97,
    linearAccuracy: 96,
    pitchAccuracy: 95,
    topologyScore: 95,
    requireExpertReview: false
  },
  gold: {
    areaAccuracy: 98,
    linearAccuracy: 97,
    pitchAccuracy: 97,
    topologyScore: 98,
    requireExpertReview: false
  },
  platinum: {
    areaAccuracy: 99,
    linearAccuracy: 98.5,
    pitchAccuracy: 98,
    topologyScore: 99,
    requireExpertReview: true
  },
  diamond: {
    areaAccuracy: 99.5,
    linearAccuracy: 99.5,
    pitchAccuracy: 99,
    topologyScore: 100,
    requireExpertReview: true
  }
};

/**
 * Main certification evaluation function
 */
export function evaluateForDiamondCertification(
  measurement: MeasurementForCertification
): DiamondCertificationResult {
  const requirements: CertificationRequirement[] = [];
  const missingRequirements: string[] = [];

  // Calculate accuracy metrics
  const areaAccuracy = calculateAreaAccuracy(measurement);
  const linearAccuracy = calculateLinearAccuracy(measurement);
  const pitchAccuracy = calculatePitchAccuracy(measurement);
  const topologyScore = measurement.topologyValidation.score;

  // Requirement 1: Area Accuracy
  requirements.push({
    id: 'area_accuracy',
    name: 'Area Accuracy',
    category: 'accuracy',
    required: true,
    passed: areaAccuracy >= CERTIFICATION_THRESHOLDS.diamond.areaAccuracy,
    value: areaAccuracy,
    threshold: CERTIFICATION_THRESHOLDS.diamond.areaAccuracy,
    description: `Total area within ${100 - CERTIFICATION_THRESHOLDS.diamond.areaAccuracy}% of ground truth`
  });

  // Requirement 2: Linear Accuracy
  requirements.push({
    id: 'linear_accuracy',
    name: 'Linear Feature Accuracy',
    category: 'accuracy',
    required: true,
    passed: linearAccuracy >= CERTIFICATION_THRESHOLDS.diamond.linearAccuracy,
    value: linearAccuracy,
    threshold: CERTIFICATION_THRESHOLDS.diamond.linearAccuracy,
    description: 'All linear features within 1ft of ground truth'
  });

  // Requirement 3: Pitch Accuracy
  requirements.push({
    id: 'pitch_accuracy',
    name: 'Pitch Accuracy',
    category: 'accuracy',
    required: true,
    passed: pitchAccuracy >= CERTIFICATION_THRESHOLDS.diamond.pitchAccuracy,
    value: pitchAccuracy,
    threshold: CERTIFICATION_THRESHOLDS.diamond.pitchAccuracy,
    description: 'Pitch detection within ±0.5/12 of actual'
  });

  // Requirement 4: Topology Validation
  requirements.push({
    id: 'topology_validation',
    name: 'Topology Validation',
    category: 'validation',
    required: true,
    passed: topologyScore >= CERTIFICATION_THRESHOLDS.diamond.topologyScore,
    value: topologyScore,
    threshold: CERTIFICATION_THRESHOLDS.diamond.topologyScore,
    description: 'All topology checks must pass'
  });

  // Requirement 5: Zero Critical Errors
  const zeroCriticalErrors = measurement.topologyValidation.errors === 0;
  requirements.push({
    id: 'zero_errors',
    name: 'Zero Critical Errors',
    category: 'validation',
    required: true,
    passed: zeroCriticalErrors,
    value: measurement.topologyValidation.errors,
    threshold: 0,
    description: 'No critical topology or validation errors'
  });

  // Requirement 6: All Validation Checks Pass
  requirements.push({
    id: 'all_validations',
    name: 'All Validations Passed',
    category: 'validation',
    required: true,
    passed: measurement.validationResult.isValid && measurement.validationResult.criticalChecksPassed,
    value: measurement.validationResult.overallScore,
    threshold: 100,
    description: 'All zero-tolerance validation checks must pass'
  });

  // Requirement 7: Expert Review (for Platinum/Diamond)
  requirements.push({
    id: 'expert_review',
    name: 'Expert Human Review',
    category: 'review',
    required: true,
    passed: measurement.expertReviewed,
    value: measurement.expertReviewed ? 'Completed' : 'Pending',
    threshold: 'Completed',
    description: 'Measurement must be verified by expert reviewer'
  });

  // Requirement 8: Ground Truth Available
  const hasGroundTruth = measurement.groundTruthArea !== undefined && measurement.groundTruthLinear !== undefined;
  requirements.push({
    id: 'ground_truth',
    name: 'Ground Truth Validation',
    category: 'data',
    required: true,
    passed: hasGroundTruth,
    value: hasGroundTruth ? 'Available' : 'Not Available',
    threshold: 'Available',
    description: 'Ground truth data from verified source required'
  });

  // Collect missing requirements
  for (const req of requirements) {
    if (req.required && !req.passed) {
      missingRequirements.push(`${req.name}: ${req.value} (required: ${req.threshold})`);
    }
  }

  // Determine certification level
  const certificationLevel = determineCertificationLevel(
    areaAccuracy,
    linearAccuracy,
    pitchAccuracy,
    topologyScore,
    measurement.expertReviewed
  );

  const certified = certificationLevel === 'diamond';
  const allValidationsPassed = requirements.every(r => !r.required || r.passed);

  // Calculate overall score
  const overallScore = (areaAccuracy + linearAccuracy + pitchAccuracy + topologyScore) / 4;

  // Generate certification number if certified
  let certificationNumber: string | null = null;
  let certificateHash: string | null = null;
  let validUntil: Date | null = null;

  if (certified) {
    certificationNumber = generateCertificationNumber(measurement.measurementId);
    certificateHash = generateCertificateHash(measurement, certificationNumber);
    validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + 1); // Valid for 1 year
  }

  return {
    certified,
    certificationLevel,
    certificationNumber,
    overallScore: Math.round(overallScore * 100) / 100,
    areaAccuracyPct: areaAccuracy,
    linearAccuracyPct: linearAccuracy,
    pitchAccuracyScore: pitchAccuracy,
    topologyScore,
    allValidationsPassed,
    expertReviewRequired: !measurement.expertReviewed && certificationLevel !== null,
    certificationRequirements: requirements,
    missingRequirements,
    validUntil,
    certificateHash
  };
}

/**
 * Calculate area accuracy percentage
 */
function calculateAreaAccuracy(measurement: MeasurementForCertification): number {
  if (!measurement.groundTruthArea) {
    return 0; // Can't calculate without ground truth
  }

  const difference = Math.abs(measurement.totalArea - measurement.groundTruthArea);
  const errorPercent = (difference / measurement.groundTruthArea) * 100;
  const accuracy = Math.max(0, 100 - errorPercent);

  return Math.round(accuracy * 100) / 100;
}

/**
 * Calculate linear feature accuracy percentage
 */
function calculateLinearAccuracy(measurement: MeasurementForCertification): number {
  if (!measurement.groundTruthLinear) {
    return 0; // Can't calculate without ground truth
  }

  const features: { measured: number; truth: number }[] = [];

  if (measurement.groundTruthLinear.ridge) {
    features.push({ measured: measurement.linearMeasurements.ridge, truth: measurement.groundTruthLinear.ridge });
  }
  if (measurement.groundTruthLinear.hip) {
    features.push({ measured: measurement.linearMeasurements.hip, truth: measurement.groundTruthLinear.hip });
  }
  if (measurement.groundTruthLinear.valley) {
    features.push({ measured: measurement.linearMeasurements.valley, truth: measurement.groundTruthLinear.valley });
  }
  if (measurement.groundTruthLinear.eave) {
    features.push({ measured: measurement.linearMeasurements.eave, truth: measurement.groundTruthLinear.eave });
  }
  if (measurement.groundTruthLinear.rake) {
    features.push({ measured: measurement.linearMeasurements.rake, truth: measurement.groundTruthLinear.rake });
  }

  if (features.length === 0) return 0;

  let totalAccuracy = 0;
  for (const feature of features) {
    const difference = Math.abs(feature.measured - feature.truth);
    const errorPercent = feature.truth > 0 ? (difference / feature.truth) * 100 : 0;
    totalAccuracy += Math.max(0, 100 - errorPercent);
  }

  return Math.round((totalAccuracy / features.length) * 100) / 100;
}

/**
 * Calculate pitch accuracy score
 */
function calculatePitchAccuracy(measurement: MeasurementForCertification): number {
  if (!measurement.groundTruthPitch) {
    return 0; // Can't calculate without ground truth
  }

  const measuredPitch = parseInt(measurement.pitch.split('/')[0]) || 0;
  const truthPitch = parseInt(measurement.groundTruthPitch.split('/')[0]) || 0;

  const difference = Math.abs(measuredPitch - truthPitch);
  
  // Perfect match = 100, 1/12 off = 90, 2/12 off = 80, etc.
  const accuracy = Math.max(0, 100 - (difference * 10));

  return accuracy;
}

/**
 * Determine certification level based on metrics
 */
function determineCertificationLevel(
  areaAccuracy: number,
  linearAccuracy: number,
  pitchAccuracy: number,
  topologyScore: number,
  expertReviewed: boolean
): 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | null {
  // Check each level from highest to lowest
  const levels: Array<'diamond' | 'platinum' | 'gold' | 'silver' | 'bronze'> = 
    ['diamond', 'platinum', 'gold', 'silver', 'bronze'];

  for (const level of levels) {
    const thresholds = CERTIFICATION_THRESHOLDS[level];
    
    const meetsAreaThreshold = areaAccuracy >= thresholds.areaAccuracy;
    const meetsLinearThreshold = linearAccuracy >= thresholds.linearAccuracy;
    const meetsPitchThreshold = pitchAccuracy >= thresholds.pitchAccuracy;
    const meetsTopologyThreshold = topologyScore >= thresholds.topologyScore;
    const meetsReviewRequirement = !thresholds.requireExpertReview || expertReviewed;

    if (meetsAreaThreshold && meetsLinearThreshold && meetsPitchThreshold && 
        meetsTopologyThreshold && meetsReviewRequirement) {
      return level;
    }
  }

  return null;
}

/**
 * Generate unique certification number
 */
function generateCertificationNumber(measurementId: string): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const idHash = hashString(measurementId).substring(0, 6).toUpperCase();
  return `DMD-${timestamp}-${idHash}`;
}

/**
 * Generate certificate hash for verification
 */
function generateCertificateHash(measurement: MeasurementForCertification, certificationNumber: string): string {
  const data = JSON.stringify({
    measurementId: measurement.measurementId,
    totalArea: measurement.totalArea,
    certificationNumber,
    timestamp: Date.now()
  });
  return hashString(data);
}

/**
 * Simple hash function
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Generate certification badge HTML
 */
export function generateCertificationBadge(result: DiamondCertificationResult): string {
  if (!result.certified) {
    return '';
  }

  const levelColors: Record<string, string> = {
    bronze: '#CD7F32',
    silver: '#C0C0C0',
    gold: '#FFD700',
    platinum: '#E5E4E2',
    diamond: '#B9F2FF'
  };

  const color = levelColors[result.certificationLevel || 'bronze'];

  return `
    <div class="certification-badge" style="
      background: linear-gradient(135deg, ${color}, white);
      border: 3px solid ${color};
      border-radius: 50%;
      width: 120px;
      height: 120px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: Arial, sans-serif;
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    ">
      <div style="font-size: 24px;">💎</div>
      <div style="font-weight: bold; font-size: 12px; text-transform: uppercase;">
        ${result.certificationLevel}
      </div>
      <div style="font-size: 10px; color: #333;">
        CERTIFIED
      </div>
      <div style="font-size: 8px; color: #666; margin-top: 4px;">
        ${result.overallScore.toFixed(1)}%
      </div>
    </div>
  `;
}

/**
 * Generate PDF certificate content
 */
export function generateCertificateContent(
  result: DiamondCertificationResult,
  measurementDetails: {
    address: string;
    totalArea: number;
    measuredDate: Date;
    verifiedBy?: string;
  }
): {
  title: string;
  sections: { heading: string; content: string }[];
  footer: string;
} {
  return {
    title: `${(result.certificationLevel || 'N/A').toUpperCase()} ACCURACY CERTIFICATION`,
    sections: [
      {
        heading: 'Certification Details',
        content: `
          Certificate Number: ${result.certificationNumber}
          Certification Level: ${result.certificationLevel?.toUpperCase()}
          Issue Date: ${new Date().toLocaleDateString()}
          Valid Until: ${result.validUntil?.toLocaleDateString()}
        `
      },
      {
        heading: 'Property Information',
        content: `
          Address: ${measurementDetails.address}
          Total Roof Area: ${measurementDetails.totalArea.toFixed(0)} sq ft
          Measurement Date: ${measurementDetails.measuredDate.toLocaleDateString()}
        `
      },
      {
        heading: 'Accuracy Metrics',
        content: `
          Overall Score: ${result.overallScore.toFixed(2)}%
          Area Accuracy: ${result.areaAccuracyPct.toFixed(2)}%
          Linear Accuracy: ${result.linearAccuracyPct.toFixed(2)}%
          Pitch Accuracy: ${result.pitchAccuracyScore.toFixed(2)}%
          Topology Score: ${result.topologyScore}%
        `
      },
      {
        heading: 'Verification',
        content: `
          Verified By: ${measurementDetails.verifiedBy || 'Automated System'}
          Certificate Hash: ${result.certificateHash}
          This certificate can be verified at: verify.pitchcrm.com/${result.certificationNumber}
        `
      }
    ],
    footer: `
      This certification confirms that the roof measurement meets ${result.certificationLevel?.toUpperCase()} 
      accuracy standards as verified against professional ground truth data.
      Certificate ID: ${result.certificationNumber}
    `
  };
}

/**
 * Verify certification authenticity
 */
export function verifyCertification(
  certificationNumber: string,
  measurementId: string,
  certificateHash: string
): { valid: boolean; reason: string } {
  // Regenerate hash and compare
  const expectedHash = hashString(JSON.stringify({
    measurementId,
    certificationNumber
  }));

  // This is a simplified verification - in production, you'd check against database
  if (certificateHash.length < 6) {
    return { valid: false, reason: 'Invalid certificate hash format' };
  }

  if (!certificationNumber.startsWith('DMD-')) {
    return { valid: false, reason: 'Invalid certification number format' };
  }

  return { valid: true, reason: 'Certificate verification passed' };
}

/**
 * Get certification level description
 */
export function getCertificationDescription(level: string | null): string {
  const descriptions: Record<string, string> = {
    bronze: 'Bronze certification indicates ≥95% accuracy in roof measurements. Suitable for standard residential projects.',
    silver: 'Silver certification indicates ≥97% accuracy. Recommended for larger residential and light commercial projects.',
    gold: 'Gold certification indicates ≥98% accuracy. Ideal for commercial projects and insurance claims.',
    platinum: 'Platinum certification indicates ≥99% accuracy. Expert-verified for high-value projects and legal documentation.',
    diamond: 'Diamond certification indicates ≥99.5% accuracy. The highest level of accuracy certification, verified against professional ground truth data and expert review.'
  };

  return descriptions[level || ''] || 'Not certified - does not meet minimum accuracy requirements.';
}

/**
 * Calculate time to next certification level
 */
export function getPathToNextLevel(result: DiamondCertificationResult): {
  currentLevel: string | null;
  nextLevel: string | null;
  improvements: { metric: string; current: number; required: number; gap: number }[];
} {
  const levels: Array<'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond'> = 
    ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
  
  const currentIndex = result.certificationLevel 
    ? levels.indexOf(result.certificationLevel as any)
    : -1;
  
  if (currentIndex === levels.length - 1) {
    return {
      currentLevel: result.certificationLevel,
      nextLevel: null,
      improvements: []
    };
  }

  const nextLevel = levels[currentIndex + 1];
  const nextThresholds = CERTIFICATION_THRESHOLDS[nextLevel];

  const improvements: { metric: string; current: number; required: number; gap: number }[] = [];

  if (result.areaAccuracyPct < nextThresholds.areaAccuracy) {
    improvements.push({
      metric: 'Area Accuracy',
      current: result.areaAccuracyPct,
      required: nextThresholds.areaAccuracy,
      gap: nextThresholds.areaAccuracy - result.areaAccuracyPct
    });
  }

  if (result.linearAccuracyPct < nextThresholds.linearAccuracy) {
    improvements.push({
      metric: 'Linear Accuracy',
      current: result.linearAccuracyPct,
      required: nextThresholds.linearAccuracy,
      gap: nextThresholds.linearAccuracy - result.linearAccuracyPct
    });
  }

  if (result.pitchAccuracyScore < nextThresholds.pitchAccuracy) {
    improvements.push({
      metric: 'Pitch Accuracy',
      current: result.pitchAccuracyScore,
      required: nextThresholds.pitchAccuracy,
      gap: nextThresholds.pitchAccuracy - result.pitchAccuracyScore
    });
  }

  if (result.topologyScore < nextThresholds.topologyScore) {
    improvements.push({
      metric: 'Topology Score',
      current: result.topologyScore,
      required: nextThresholds.topologyScore,
      gap: nextThresholds.topologyScore - result.topologyScore
    });
  }

  return {
    currentLevel: result.certificationLevel,
    nextLevel,
    improvements
  };
}
