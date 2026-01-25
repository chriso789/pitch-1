/**
 * Phase 63: Smart Verification Routing
 * Routes measurements to human verification based on complexity and risk
 */

interface RoutingDecision {
  decision: 'auto_approve' | 'standard_review' | 'senior_review' | 'expert_review' | 'manual_only';
  confidenceScore: number;
  complexityScore: number;
  valueScore: number;
  riskScore: number;
  routingFactors: RoutingFactor[];
  estimatedReviewTimeMinutes: number;
  reviewDeadlineHours: number;
  assignedReviewerTier: 'trainee' | 'standard' | 'senior' | 'expert' | null;
}

interface RoutingFactor {
  name: string;
  weight: number;
  value: number;
  contribution: number;
  description: string;
}

interface MeasurementContext {
  measurementId: string;
  confidenceScore: number;
  roofArea: number;
  facetCount: number;
  roofType: string;
  pitch: string;
  hasMultipleStories: boolean;
  hasDormers: boolean;
  hasComplexGeometry: boolean;
  estimatedValue: number;
  customerTier: 'standard' | 'premium' | 'enterprise';
  groundTruthAvailable: boolean;
  previousMeasurementExists: boolean;
  deviationFromPrevious: number;
  topologyErrors: number;
  selfCorrectionsApplied: number;
}

interface ReviewerWorkload {
  reviewerId: string;
  tier: 'trainee' | 'standard' | 'senior' | 'expert';
  currentQueueSize: number;
  averageReviewTimeMinutes: number;
  accuracyScore: number;
  isAvailable: boolean;
}

/**
 * Main routing function
 */
export function routeToVerification(context: MeasurementContext): RoutingDecision {
  const factors: RoutingFactor[] = [];

  // Factor 1: AI Confidence Score
  const confidenceFactor = calculateConfidenceFactor(context.confidenceScore);
  factors.push(confidenceFactor);

  // Factor 2: Roof Complexity
  const complexityFactor = calculateComplexityFactor(context);
  factors.push(complexityFactor);

  // Factor 3: Financial Value/Risk
  const valueFactor = calculateValueFactor(context);
  factors.push(valueFactor);

  // Factor 4: Data Quality
  const qualityFactor = calculateQualityFactor(context);
  factors.push(qualityFactor);

  // Factor 5: Customer Importance
  const customerFactor = calculateCustomerFactor(context);
  factors.push(customerFactor);

  // Factor 6: Historical Consistency
  const consistencyFactor = calculateConsistencyFactor(context);
  factors.push(consistencyFactor);

  // Calculate overall scores
  const confidenceScore = confidenceFactor.contribution;
  const complexityScore = complexityFactor.value;
  const valueScore = valueFactor.value;
  const riskScore = calculateOverallRisk(factors);

  // Make routing decision
  const decision = makeRoutingDecision(factors, context);

  // Estimate review time and deadline
  const estimatedReviewTimeMinutes = estimateReviewTime(complexityScore, context);
  const reviewDeadlineHours = calculateDeadline(decision, context.customerTier);

  // Assign reviewer tier
  const assignedReviewerTier = decision === 'auto_approve' 
    ? null 
    : determineReviewerTier(decision);

  return {
    decision,
    confidenceScore,
    complexityScore,
    valueScore,
    riskScore,
    routingFactors: factors,
    estimatedReviewTimeMinutes,
    reviewDeadlineHours,
    assignedReviewerTier
  };
}

/**
 * Calculate confidence contribution factor
 */
function calculateConfidenceFactor(confidence: number): RoutingFactor {
  // Higher confidence = lower need for review
  const value = confidence;
  const weight = 0.3; // 30% weight
  const contribution = value * weight;

  let description = '';
  if (confidence >= 0.95) {
    description = 'Very high AI confidence - minimal review needed';
  } else if (confidence >= 0.85) {
    description = 'High confidence - standard review sufficient';
  } else if (confidence >= 0.70) {
    description = 'Moderate confidence - careful review recommended';
  } else {
    description = 'Low confidence - expert review required';
  }

  return {
    name: 'ai_confidence',
    weight,
    value,
    contribution,
    description
  };
}

/**
 * Calculate complexity factor
 */
function calculateComplexityFactor(context: MeasurementContext): RoutingFactor {
  let complexityScore = 0;

  // Base complexity from facet count
  if (context.facetCount <= 4) complexityScore += 0.1;
  else if (context.facetCount <= 8) complexityScore += 0.3;
  else if (context.facetCount <= 12) complexityScore += 0.5;
  else complexityScore += 0.8;

  // Roof type complexity
  const complexRoofTypes = ['hip', 'dutch_hip', 'gambrel', 'mansard', 'butterfly'];
  if (complexRoofTypes.includes(context.roofType)) complexityScore += 0.2;

  // Structural complexity
  if (context.hasMultipleStories) complexityScore += 0.15;
  if (context.hasDormers) complexityScore += 0.2;
  if (context.hasComplexGeometry) complexityScore += 0.25;

  // Pitch complexity
  const pitch = parseInt(context.pitch.split('/')[0]) || 5;
  if (pitch > 12) complexityScore += 0.15;

  // Normalize to 0-1
  const value = Math.min(1, complexityScore);
  const weight = 0.25;
  const contribution = value * weight;

  let description = '';
  if (value < 0.3) description = 'Simple roof geometry';
  else if (value < 0.5) description = 'Moderate complexity';
  else if (value < 0.7) description = 'Complex roof structure';
  else description = 'Very complex - multiple features';

  return {
    name: 'complexity',
    weight,
    value,
    contribution,
    description
  };
}

/**
 * Calculate value/financial risk factor
 */
function calculateValueFactor(context: MeasurementContext): RoutingFactor {
  // Higher value = more careful review
  let valueScore = 0;

  if (context.estimatedValue >= 50000) valueScore = 1.0;
  else if (context.estimatedValue >= 25000) valueScore = 0.7;
  else if (context.estimatedValue >= 10000) valueScore = 0.4;
  else valueScore = 0.2;

  // Adjust for roof area (larger roofs = higher stakes)
  if (context.roofArea > 5000) valueScore = Math.min(1, valueScore + 0.2);
  else if (context.roofArea > 3000) valueScore = Math.min(1, valueScore + 0.1);

  const weight = 0.2;
  const contribution = valueScore * weight;

  let description = '';
  if (valueScore >= 0.8) description = 'High-value project - careful review';
  else if (valueScore >= 0.5) description = 'Moderate value project';
  else description = 'Standard value project';

  return {
    name: 'financial_value',
    weight,
    value: valueScore,
    contribution,
    description
  };
}

/**
 * Calculate data quality factor
 */
function calculateQualityFactor(context: MeasurementContext): RoutingFactor {
  let qualityScore = 0.5; // Start neutral

  // Ground truth available
  if (context.groundTruthAvailable) qualityScore += 0.2;

  // Previous measurement consistency
  if (context.previousMeasurementExists) {
    if (context.deviationFromPrevious < 0.02) qualityScore += 0.15;
    else if (context.deviationFromPrevious < 0.05) qualityScore += 0.05;
    else qualityScore -= 0.1; // Large deviation is concerning
  }

  // Topology errors
  if (context.topologyErrors === 0) qualityScore += 0.1;
  else if (context.topologyErrors > 2) qualityScore -= 0.2;

  // Self-corrections applied
  if (context.selfCorrectionsApplied === 0) qualityScore += 0.05;
  else if (context.selfCorrectionsApplied > 3) qualityScore -= 0.1;

  const value = Math.max(0, Math.min(1, qualityScore));
  const weight = 0.15;
  const contribution = value * weight;

  let description = '';
  if (value >= 0.7) description = 'High quality data with validation';
  else if (value >= 0.4) description = 'Standard quality data';
  else description = 'Quality concerns flagged';

  return {
    name: 'data_quality',
    weight,
    value,
    contribution,
    description
  };
}

/**
 * Calculate customer importance factor
 */
function calculateCustomerFactor(context: MeasurementContext): RoutingFactor {
  let customerScore = 0.5;

  switch (context.customerTier) {
    case 'enterprise':
      customerScore = 1.0;
      break;
    case 'premium':
      customerScore = 0.7;
      break;
    case 'standard':
    default:
      customerScore = 0.3;
  }

  const weight = 0.05;
  const contribution = customerScore * weight;

  return {
    name: 'customer_tier',
    weight,
    value: customerScore,
    contribution,
    description: `${context.customerTier} customer - ${customerScore >= 0.7 ? 'priority' : 'standard'} handling`
  };
}

/**
 * Calculate consistency factor based on historical data
 */
function calculateConsistencyFactor(context: MeasurementContext): RoutingFactor {
  let consistencyScore = 0.5;

  if (context.previousMeasurementExists) {
    if (context.deviationFromPrevious < 0.01) {
      consistencyScore = 0.9; // Very consistent
    } else if (context.deviationFromPrevious < 0.03) {
      consistencyScore = 0.7; // Reasonably consistent
    } else if (context.deviationFromPrevious < 0.05) {
      consistencyScore = 0.5; // Some variation
    } else {
      consistencyScore = 0.2; // Significant deviation
    }
  }

  const weight = 0.05;
  const contribution = consistencyScore * weight;

  return {
    name: 'historical_consistency',
    weight,
    value: consistencyScore,
    contribution,
    description: context.previousMeasurementExists
      ? `${(context.deviationFromPrevious * 100).toFixed(1)}% deviation from previous`
      : 'No previous measurement available'
  };
}

/**
 * Calculate overall risk score
 */
function calculateOverallRisk(factors: RoutingFactor[]): number {
  const confidenceFactor = factors.find(f => f.name === 'ai_confidence');
  const complexityFactor = factors.find(f => f.name === 'complexity');
  const valueFactor = factors.find(f => f.name === 'financial_value');
  const qualityFactor = factors.find(f => f.name === 'data_quality');

  // Risk increases with complexity and value, decreases with confidence and quality
  const risk = (
    (1 - (confidenceFactor?.value || 0.5)) * 0.35 +
    (complexityFactor?.value || 0.5) * 0.25 +
    (valueFactor?.value || 0.5) * 0.25 +
    (1 - (qualityFactor?.value || 0.5)) * 0.15
  );

  return Math.round(risk * 100) / 100;
}

/**
 * Make routing decision based on factors
 */
function makeRoutingDecision(factors: RoutingFactor[], context: MeasurementContext): RoutingDecision['decision'] {
  const confidenceFactor = factors.find(f => f.name === 'ai_confidence');
  const complexityFactor = factors.find(f => f.name === 'complexity');
  const valueFactor = factors.find(f => f.name === 'financial_value');
  const qualityFactor = factors.find(f => f.name === 'data_quality');
  const customerFactor = factors.find(f => f.name === 'customer_tier');

  const confidence = confidenceFactor?.value || 0;
  const complexity = complexityFactor?.value || 0;
  const value = valueFactor?.value || 0;
  const quality = qualityFactor?.value || 0;
  const customerPriority = customerFactor?.value || 0;

  // Auto-approve conditions:
  // - Very high confidence (>95%)
  // - Low complexity
  // - Good quality
  // - No topology errors
  if (confidence >= 0.95 && complexity < 0.3 && quality >= 0.6 && context.topologyErrors === 0) {
    return 'auto_approve';
  }

  // Manual only conditions:
  // - Very low confidence
  // - Many topology errors
  // - Very complex geometry
  if (confidence < 0.5 || context.topologyErrors > 5 || (complexity > 0.8 && confidence < 0.7)) {
    return 'manual_only';
  }

  // Expert review conditions:
  // - Enterprise customer with high value
  // - Complex geometry with moderate confidence
  // - Large deviation from previous
  if (
    (customerPriority >= 1.0 && value >= 0.8) ||
    (complexity >= 0.7 && confidence < 0.8) ||
    (context.previousMeasurementExists && context.deviationFromPrevious > 0.1)
  ) {
    return 'expert_review';
  }

  // Senior review conditions:
  // - High value projects
  // - Moderate complexity with lower confidence
  if (
    value >= 0.7 ||
    (complexity >= 0.5 && confidence < 0.85) ||
    customerPriority >= 0.7
  ) {
    return 'senior_review';
  }

  // Standard review for everything else
  return 'standard_review';
}

/**
 * Estimate review time based on complexity
 */
function estimateReviewTime(complexityScore: number, context: MeasurementContext): number {
  // Base time in minutes
  let baseTime = 2;

  // Add time for complexity
  baseTime += complexityScore * 8;

  // Add time for facet count
  baseTime += context.facetCount * 0.5;

  // Add time for special features
  if (context.hasDormers) baseTime += 2;
  if (context.hasMultipleStories) baseTime += 2;
  if (context.topologyErrors > 0) baseTime += context.topologyErrors * 1.5;

  return Math.round(baseTime);
}

/**
 * Calculate review deadline based on priority
 */
function calculateDeadline(decision: RoutingDecision['decision'], customerTier: string): number {
  const baseDeadlines: Record<string, number> = {
    'auto_approve': 0,
    'standard_review': 24,
    'senior_review': 12,
    'expert_review': 8,
    'manual_only': 48
  };

  let deadline = baseDeadlines[decision] || 24;

  // Expedite for premium/enterprise customers
  if (customerTier === 'enterprise') deadline = Math.floor(deadline * 0.5);
  else if (customerTier === 'premium') deadline = Math.floor(deadline * 0.75);

  return deadline;
}

/**
 * Determine appropriate reviewer tier
 */
function determineReviewerTier(decision: RoutingDecision['decision']): RoutingDecision['assignedReviewerTier'] {
  switch (decision) {
    case 'auto_approve':
      return null;
    case 'standard_review':
      return 'standard';
    case 'senior_review':
      return 'senior';
    case 'expert_review':
    case 'manual_only':
      return 'expert';
    default:
      return 'standard';
  }
}

/**
 * Assign specific reviewer based on workload and skills
 */
export function assignReviewer(
  decision: RoutingDecision,
  availableReviewers: ReviewerWorkload[]
): ReviewerWorkload | null {
  if (decision.decision === 'auto_approve') return null;

  const requiredTier = decision.assignedReviewerTier;
  const tierHierarchy = ['trainee', 'standard', 'senior', 'expert'];

  // Filter reviewers by tier (same or higher)
  const requiredTierIndex = tierHierarchy.indexOf(requiredTier || 'standard');
  const eligibleReviewers = availableReviewers.filter(r => {
    const reviewerTierIndex = tierHierarchy.indexOf(r.tier);
    return reviewerTierIndex >= requiredTierIndex && r.isAvailable;
  });

  if (eligibleReviewers.length === 0) return null;

  // Sort by: lowest queue size, highest accuracy
  eligibleReviewers.sort((a, b) => {
    // Primary: queue size
    if (a.currentQueueSize !== b.currentQueueSize) {
      return a.currentQueueSize - b.currentQueueSize;
    }
    // Secondary: accuracy
    return b.accuracyScore - a.accuracyScore;
  });

  return eligibleReviewers[0];
}

/**
 * Calculate priority score for queue ordering
 */
export function calculateQueuePriority(
  decision: RoutingDecision,
  createdAt: Date
): number {
  // Higher = more urgent
  let priority = 50; // Base priority

  // Urgency from decision type
  const decisionPriority: Record<string, number> = {
    'manual_only': 30,
    'expert_review': 25,
    'senior_review': 15,
    'standard_review': 10,
    'auto_approve': 0
  };
  priority += decisionPriority[decision.decision] || 0;

  // Urgency from risk score
  priority += decision.riskScore * 20;

  // Urgency from value
  priority += decision.valueScore * 10;

  // Age penalty (older items get priority)
  const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  const remainingHours = decision.reviewDeadlineHours - ageHours;
  
  if (remainingHours < 2) priority += 30;
  else if (remainingHours < 6) priority += 20;
  else if (remainingHours < 12) priority += 10;

  return Math.round(priority);
}

/**
 * Track and escalate overdue reviews
 */
export function checkForEscalation(
  decision: RoutingDecision,
  createdAt: Date,
  currentReviewerTier: string
): {
  shouldEscalate: boolean;
  newTier: string | null;
  reason: string;
} {
  const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  const percentOfDeadline = ageHours / decision.reviewDeadlineHours;

  if (percentOfDeadline >= 1.0) {
    // Past deadline - escalate to next tier
    const tierHierarchy = ['trainee', 'standard', 'senior', 'expert'];
    const currentIndex = tierHierarchy.indexOf(currentReviewerTier);
    const nextTier = currentIndex < tierHierarchy.length - 1 
      ? tierHierarchy[currentIndex + 1] 
      : null;

    return {
      shouldEscalate: true,
      newTier: nextTier,
      reason: `Review deadline exceeded (${ageHours.toFixed(1)}h vs ${decision.reviewDeadlineHours}h limit)`
    };
  }

  if (percentOfDeadline >= 0.8) {
    // Approaching deadline - flag but don't escalate yet
    return {
      shouldEscalate: false,
      newTier: null,
      reason: `Approaching deadline (${Math.round(percentOfDeadline * 100)}% elapsed)`
    };
  }

  return {
    shouldEscalate: false,
    newTier: null,
    reason: 'Within normal timeframe'
  };
}
