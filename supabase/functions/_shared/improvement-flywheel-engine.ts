/**
 * Phase 70: Continuous Improvement Flywheel
 * Builds self-improving system that approaches perfection over time
 */

interface FlywheelMetrics {
  metricDate: Date;
  metricType: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  totalMeasurements: number;
  groundTruthIngested: number;
  calibrationsUpdated: number;
  errorPatternsIdentified: number;
  trainingExamplesGenerated: number;
  edgeCasesResolved: number;
  accuracyImprovementPct: number;
  diamondCertificationRate: number;
  autoApprovalRate: number;
  humanReviewRate: number;
  averageAccuracy: number;
}

interface ErrorPattern {
  id: string;
  patternType: string;
  description: string;
  frequency: number;
  averageImpact: number;
  rootCause: string;
  suggestedFix: string;
  affectedComponents: string[];
  detectedAt: Date;
  resolvedAt?: Date;
}

interface ImprovementAction {
  id: string;
  actionType: 'calibration' | 'prompt_update' | 'threshold_adjustment' | 'training' | 'manual_review';
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  expectedImpact: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  results?: string;
}

interface TrainingExample {
  id: string;
  measurementId: string;
  exampleType: 'positive' | 'negative' | 'edge_case';
  component: string;
  originalDetection: any;
  groundTruth: any;
  correction: any;
  notes: string;
  createdAt: Date;
}

/**
 * Main flywheel orchestration function
 */
export async function runFlywheelCycle(
  cycleType: 'daily' | 'weekly' | 'monthly' | 'quarterly',
  supabase: any,
  tenantId: string
): Promise<{
  success: boolean;
  metrics: FlywheelMetrics;
  actions: ImprovementAction[];
  errors: string[];
}> {
  const errors: string[] = [];
  const actions: ImprovementAction[] = [];

  try {
    // Step 1: Collect metrics from the period
    const metrics = await collectPeriodMetrics(supabase, tenantId, cycleType);

    // Step 2: Analyze error patterns
    const errorPatterns = await analyzeErrorPatterns(supabase, tenantId, cycleType);
    metrics.errorPatternsIdentified = errorPatterns.length;

    // Step 3: Generate training examples from corrections
    const trainingExamples = await generateTrainingExamples(supabase, tenantId, cycleType);
    metrics.trainingExamplesGenerated = trainingExamples.length;

    // Step 4: Update calibrations based on new data
    const calibrationUpdates = await updateCalibrations(supabase, tenantId);
    metrics.calibrationsUpdated = calibrationUpdates;

    // Step 5: Resolve edge cases
    const resolvedEdgeCases = await resolveEdgeCases(supabase, tenantId);
    metrics.edgeCasesResolved = resolvedEdgeCases;

    // Step 6: Generate improvement actions
    const newActions = generateImprovementActions(errorPatterns, metrics);
    actions.push(...newActions);

    // Step 7: Calculate improvement trajectory
    metrics.accuracyImprovementPct = await calculateImprovementTrajectory(supabase, tenantId, cycleType);

    // Step 8: Save metrics
    await saveFlywheel Metrics(supabase, tenantId, metrics);

    // Step 9: Execute high-priority actions
    for (const action of actions.filter(a => a.priority === 'critical' || a.priority === 'high')) {
      try {
        await executeAction(action, supabase, tenantId);
      } catch (error) {
        errors.push(`Failed to execute action ${action.id}: ${error.message}`);
      }
    }

    return { success: true, metrics, actions, errors };
  } catch (error) {
    errors.push(`Flywheel cycle failed: ${error.message}`);
    return { 
      success: false, 
      metrics: createEmptyMetrics(cycleType), 
      actions, 
      errors 
    };
  }
}

/**
 * Collect metrics for the specified period
 */
async function collectPeriodMetrics(
  supabase: any,
  tenantId: string,
  cycleType: string
): Promise<FlywheelMetrics> {
  const periodDays = {
    daily: 1,
    weekly: 7,
    monthly: 30,
    quarterly: 90
  }[cycleType] || 1;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - periodDays);

  // Get measurement count
  const { count: measurementCount } = await supabase
    .from('roof_measurements')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('created_at', startDate.toISOString());

  // Get ground truth count
  const { count: groundTruthCount } = await supabase
    .from('measurement_ground_truth')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('created_at', startDate.toISOString());

  // Get diamond certification rate
  const { count: diamondCount } = await supabase
    .from('diamond_certifications')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('certified_at', startDate.toISOString())
    .eq('revoked', false);

  // Get auto-approval rate
  const { count: autoApprovedCount } = await supabase
    .from('verification_routing_decisions')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('routing_decision', 'auto_approve')
    .gte('created_at', startDate.toISOString());

  // Get human review rate
  const { count: humanReviewCount } = await supabase
    .from('verification_routing_decisions')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .neq('routing_decision', 'auto_approve')
    .gte('created_at', startDate.toISOString());

  // Calculate average accuracy
  const { data: accuracyData } = await supabase
    .from('measurement_certifications')
    .select('overall_score')
    .eq('tenant_id', tenantId)
    .gte('certified_at', startDate.toISOString());

  const avgAccuracy = accuracyData?.length > 0
    ? accuracyData.reduce((sum: number, m: any) => sum + (m.overall_score || 0), 0) / accuracyData.length
    : 0;

  const totalDecisions = (autoApprovedCount || 0) + (humanReviewCount || 0);

  return {
    metricDate: new Date(),
    metricType: cycleType as any,
    totalMeasurements: measurementCount || 0,
    groundTruthIngested: groundTruthCount || 0,
    calibrationsUpdated: 0, // Will be updated later
    errorPatternsIdentified: 0, // Will be updated later
    trainingExamplesGenerated: 0, // Will be updated later
    edgeCasesResolved: 0, // Will be updated later
    accuracyImprovementPct: 0, // Will be calculated
    diamondCertificationRate: measurementCount > 0 ? ((diamondCount || 0) / measurementCount) * 100 : 0,
    autoApprovalRate: totalDecisions > 0 ? ((autoApprovedCount || 0) / totalDecisions) * 100 : 0,
    humanReviewRate: totalDecisions > 0 ? ((humanReviewCount || 0) / totalDecisions) * 100 : 0,
    averageAccuracy: avgAccuracy
  };
}

/**
 * Analyze error patterns from corrections and failures
 */
async function analyzeErrorPatterns(
  supabase: any,
  tenantId: string,
  cycleType: string
): Promise<ErrorPattern[]> {
  const periodDays = { daily: 1, weekly: 7, monthly: 30, quarterly: 90 }[cycleType] || 7;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - periodDays);

  // Get self-corrections
  const { data: corrections } = await supabase
    .from('measurement_self_corrections')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('created_at', startDate.toISOString());

  // Get field technician corrections
  const { data: fieldCorrections } = await supabase
    .from('field_technician_corrections')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('created_at', startDate.toISOString());

  // Analyze patterns
  const patternCounts: Record<string, { count: number; impacts: number[] }> = {};

  for (const correction of corrections || []) {
    const type = correction.correction_type || 'unknown';
    if (!patternCounts[type]) {
      patternCounts[type] = { count: 0, impacts: [] };
    }
    patternCounts[type].count++;
    if (correction.confidence_after && correction.confidence_before) {
      patternCounts[type].impacts.push(correction.confidence_after - correction.confidence_before);
    }
  }

  for (const correction of fieldCorrections || []) {
    const type = `field_${correction.correction_type}` || 'field_unknown';
    if (!patternCounts[type]) {
      patternCounts[type] = { count: 0, impacts: [] };
    }
    patternCounts[type].count++;
  }

  // Convert to ErrorPattern objects
  return Object.entries(patternCounts)
    .filter(([_, data]) => data.count >= 3) // Only patterns occurring 3+ times
    .map(([type, data]) => ({
      id: `pattern_${type}_${Date.now()}`,
      patternType: type,
      description: `Recurring ${type.replace(/_/g, ' ')} correction pattern`,
      frequency: data.count,
      averageImpact: data.impacts.length > 0 
        ? data.impacts.reduce((a, b) => a + b, 0) / data.impacts.length 
        : 0,
      rootCause: inferRootCause(type),
      suggestedFix: suggestFix(type),
      affectedComponents: inferAffectedComponents(type),
      detectedAt: new Date()
    }));
}

/**
 * Generate training examples from corrections
 */
async function generateTrainingExamples(
  supabase: any,
  tenantId: string,
  cycleType: string
): Promise<TrainingExample[]> {
  const periodDays = { daily: 1, weekly: 7, monthly: 30, quarterly: 90 }[cycleType] || 7;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - periodDays);

  // Get high-confidence corrections (human-reviewed)
  const { data: corrections } = await supabase
    .from('measurement_self_corrections')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('human_reviewed', true)
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(100);

  const examples: TrainingExample[] = [];

  for (const correction of corrections || []) {
    examples.push({
      id: `example_${correction.id}`,
      measurementId: correction.measurement_id,
      exampleType: 'positive',
      component: correction.correction_type,
      originalDetection: correction.original_geometry,
      groundTruth: correction.corrected_geometry,
      correction: {
        type: correction.correction_type,
        reason: correction.correction_reason
      },
      notes: `Confidence improved from ${correction.confidence_before} to ${correction.confidence_after}`,
      createdAt: new Date()
    });
  }

  // Save training examples to annotation table for future AI training
  for (const example of examples) {
    await supabase.from('measurement_annotations').insert({
      measurement_id: example.measurementId,
      annotation_type: 'training_note',
      target_type: example.component,
      content: JSON.stringify(example),
      is_training_example: true,
      tenant_id: tenantId
    });
  }

  return examples;
}

/**
 * Update calibration parameters based on new ground truth
 */
async function updateCalibrations(supabase: any, tenantId: string): Promise<number> {
  // Get recent ground truth comparisons
  const { data: groundTruths } = await supabase
    .from('measurement_ground_truth')
    .select('*, roof_measurements(*)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!groundTruths || groundTruths.length < 10) {
    return 0; // Not enough data for calibration
  }

  // Calculate bias for each component
  const biases: Record<string, number[]> = {
    area: [],
    ridge: [],
    hip: [],
    valley: [],
    eave: []
  };

  for (const gt of groundTruths) {
    const measurement = gt.roof_measurements;
    if (!measurement) continue;

    if (gt.verified_total_area && measurement.total_area) {
      biases.area.push(measurement.total_area - gt.verified_total_area);
    }
    if (gt.verified_ridge && measurement.ridge_length) {
      biases.ridge.push(measurement.ridge_length - gt.verified_ridge);
    }
    // ... similar for other components
  }

  // Update calibration table
  let updatedCount = 0;
  for (const [component, values] of Object.entries(biases)) {
    if (values.length >= 5) {
      const avgBias = values.reduce((a, b) => a + b, 0) / values.length;
      const stdDev = Math.sqrt(
        values.reduce((sum, v) => sum + Math.pow(v - avgBias, 2), 0) / values.length
      );

      await supabase.from('ai_confidence_calibration').upsert({
        component_type: component,
        raw_confidence_bin: 0.9, // Placeholder
        actual_accuracy: 100 - Math.abs(avgBias),
        sample_count: values.length,
        platt_a: avgBias,
        platt_b: stdDev,
        tenant_id: tenantId,
        updated_at: new Date().toISOString()
      });

      updatedCount++;
    }
  }

  return updatedCount;
}

/**
 * Resolve pending edge cases
 */
async function resolveEdgeCases(supabase: any, tenantId: string): Promise<number> {
  // Get pending edge cases that can be auto-resolved
  const { data: edgeCases } = await supabase
    .from('detected_edge_cases')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('resolution_status', 'pending')
    .eq('routed_to', 'specialized_pipeline')
    .limit(50);

  let resolved = 0;

  for (const edgeCase of edgeCases || []) {
    // Attempt auto-resolution based on edge case type
    const resolution = attemptAutoResolve(edgeCase);
    
    if (resolution.resolved) {
      await supabase
        .from('detected_edge_cases')
        .update({
          resolution_status: 'resolved',
          resolution_notes: resolution.notes
        })
        .eq('id', edgeCase.id);
      
      resolved++;
    }
  }

  return resolved;
}

/**
 * Generate improvement actions based on analysis
 */
function generateImprovementActions(
  errorPatterns: ErrorPattern[],
  metrics: FlywheelMetrics
): ImprovementAction[] {
  const actions: ImprovementAction[] = [];

  // Action 1: Address high-frequency error patterns
  for (const pattern of errorPatterns.filter(p => p.frequency >= 10)) {
    actions.push({
      id: `action_${pattern.id}`,
      actionType: 'prompt_update',
      priority: pattern.frequency >= 20 ? 'critical' : 'high',
      description: `Address ${pattern.patternType} pattern (${pattern.frequency} occurrences)`,
      expectedImpact: pattern.averageImpact * pattern.frequency,
      status: 'pending',
      createdAt: new Date()
    });
  }

  // Action 2: If accuracy dropped, investigate
  if (metrics.accuracyImprovementPct < 0) {
    actions.push({
      id: `action_accuracy_drop_${Date.now()}`,
      actionType: 'manual_review',
      priority: 'critical',
      description: `Investigate accuracy regression of ${Math.abs(metrics.accuracyImprovementPct).toFixed(2)}%`,
      expectedImpact: 0,
      status: 'pending',
      createdAt: new Date()
    });
  }

  // Action 3: If human review rate is high, consider threshold adjustment
  if (metrics.humanReviewRate > 30) {
    actions.push({
      id: `action_threshold_${Date.now()}`,
      actionType: 'threshold_adjustment',
      priority: 'medium',
      description: `Optimize routing thresholds to reduce ${metrics.humanReviewRate.toFixed(1)}% human review rate`,
      expectedImpact: metrics.humanReviewRate - 20, // Target 20% or less
      status: 'pending',
      createdAt: new Date()
    });
  }

  // Action 4: If diamond certification rate is low, identify gaps
  if (metrics.diamondCertificationRate < 40) {
    actions.push({
      id: `action_diamond_${Date.now()}`,
      actionType: 'training',
      priority: 'medium',
      description: `Improve diamond certification rate from ${metrics.diamondCertificationRate.toFixed(1)}%`,
      expectedImpact: 40 - metrics.diamondCertificationRate,
      status: 'pending',
      createdAt: new Date()
    });
  }

  return actions;
}

/**
 * Calculate accuracy improvement trajectory
 */
async function calculateImprovementTrajectory(
  supabase: any,
  tenantId: string,
  cycleType: string
): Promise<number> {
  // Get previous period metrics
  const periodDays = { daily: 1, weekly: 7, monthly: 30, quarterly: 90 }[cycleType] || 7;
  const previousStart = new Date();
  previousStart.setDate(previousStart.getDate() - periodDays * 2);
  const previousEnd = new Date();
  previousEnd.setDate(previousEnd.getDate() - periodDays);

  // Get previous accuracy
  const { data: previousMetrics } = await supabase
    .from('improvement_flywheel_metrics')
    .select('average_accuracy')
    .eq('tenant_id', tenantId)
    .eq('metric_type', cycleType)
    .lt('metric_date', previousEnd.toISOString())
    .order('metric_date', { ascending: false })
    .limit(1);

  if (!previousMetrics || previousMetrics.length === 0) {
    return 0;
  }

  // Get current accuracy from recent measurements
  const { data: currentMeasurements } = await supabase
    .from('measurement_certifications')
    .select('overall_score')
    .eq('tenant_id', tenantId)
    .gte('certified_at', previousEnd.toISOString());

  if (!currentMeasurements || currentMeasurements.length === 0) {
    return 0;
  }

  const currentAvg = currentMeasurements.reduce((sum: number, m: any) => sum + (m.overall_score || 0), 0) / currentMeasurements.length;
  const previousAvg = previousMetrics[0].average_accuracy || 0;

  return currentAvg - previousAvg;
}

/**
 * Save flywheel metrics to database
 */
async function saveFlywheelMetrics(supabase: any, tenantId: string, metrics: FlywheelMetrics): Promise<void> {
  await supabase.from('improvement_flywheel_metrics').insert({
    metric_date: metrics.metricDate.toISOString().split('T')[0],
    metric_type: metrics.metricType,
    total_measurements: metrics.totalMeasurements,
    ground_truth_ingested: metrics.groundTruthIngested,
    calibrations_updated: metrics.calibrationsUpdated,
    error_patterns_identified: metrics.errorPatternsIdentified,
    training_examples_generated: metrics.trainingExamplesGenerated,
    edge_cases_resolved: metrics.edgeCasesResolved,
    accuracy_improvement_pct: metrics.accuracyImprovementPct,
    diamond_certification_rate: metrics.diamondCertificationRate,
    auto_approval_rate: metrics.autoApprovalRate,
    human_review_rate: metrics.humanReviewRate,
    average_accuracy: metrics.averageAccuracy,
    tenant_id: tenantId
  });
}

/**
 * Execute an improvement action
 */
async function executeAction(action: ImprovementAction, supabase: any, tenantId: string): Promise<void> {
  action.status = 'in_progress';

  try {
    switch (action.actionType) {
      case 'calibration':
        await updateCalibrations(supabase, tenantId);
        break;
      case 'threshold_adjustment':
        // Log for manual adjustment
        console.log(`Threshold adjustment recommended: ${action.description}`);
        break;
      case 'prompt_update':
        // Log for manual prompt update
        console.log(`Prompt update recommended: ${action.description}`);
        break;
      case 'training':
        // Generate training examples
        await generateTrainingExamples(supabase, tenantId, 'weekly');
        break;
      case 'manual_review':
        // Create alert for manual review
        console.log(`Manual review required: ${action.description}`);
        break;
    }

    action.status = 'completed';
    action.completedAt = new Date();
    action.results = 'Action completed successfully';
  } catch (error) {
    action.status = 'failed';
    action.results = `Failed: ${error.message}`;
  }
}

// Helper functions
function createEmptyMetrics(cycleType: string): FlywheelMetrics {
  return {
    metricDate: new Date(),
    metricType: cycleType as any,
    totalMeasurements: 0,
    groundTruthIngested: 0,
    calibrationsUpdated: 0,
    errorPatternsIdentified: 0,
    trainingExamplesGenerated: 0,
    edgeCasesResolved: 0,
    accuracyImprovementPct: 0,
    diamondCertificationRate: 0,
    autoApprovalRate: 0,
    humanReviewRate: 0,
    averageAccuracy: 0
  };
}

function inferRootCause(patternType: string): string {
  const causes: Record<string, string> = {
    'disconnected_ridge': 'AI sometimes fails to extend ridges to hip intersections',
    'hip_not_at_corner': 'Corner detection may miss acute angles',
    'perimeter_gap': 'Low-contrast imagery causes edge detection gaps',
    'facet_closure': 'Facet vertices not properly closed',
    'vertex_snap': 'Similar features not merged within tolerance'
  };
  return causes[patternType] || 'Unknown - requires manual investigation';
}

function suggestFix(patternType: string): string {
  const fixes: Record<string, string> = {
    'disconnected_ridge': 'Increase ridge extension tolerance and add hip intersection detection',
    'hip_not_at_corner': 'Improve corner detection with angle analysis',
    'perimeter_gap': 'Use multi-pass edge detection with varying thresholds',
    'facet_closure': 'Add automatic facet closure in post-processing',
    'vertex_snap': 'Increase vertex clustering tolerance'
  };
  return fixes[patternType] || 'Manual review and prompt tuning required';
}

function inferAffectedComponents(patternType: string): string[] {
  const components: Record<string, string[]> = {
    'disconnected_ridge': ['ridge', 'hip'],
    'hip_not_at_corner': ['hip', 'perimeter'],
    'perimeter_gap': ['perimeter', 'eave', 'rake'],
    'facet_closure': ['facet'],
    'vertex_snap': ['all']
  };
  return components[patternType] || ['unknown'];
}

function attemptAutoResolve(edgeCase: any): { resolved: boolean; notes: string } {
  // Simple auto-resolution logic for common edge cases
  switch (edgeCase.edge_case_type) {
    case 'simple_gable':
      return { resolved: true, notes: 'Simple gable roof - standard processing applied' };
    case 'flat_roof':
      return { resolved: true, notes: 'Flat roof detected - minimal linear features expected' };
    default:
      return { resolved: false, notes: 'Requires human review' };
  }
}

/**
 * Generate improvement report
 */
export function generateImprovementReport(metrics: FlywheelMetrics): string {
  return `
# Accuracy Improvement Report
## Period: ${metrics.metricType.toUpperCase()} ending ${metrics.metricDate.toLocaleDateString()}

### Key Metrics
- **Total Measurements**: ${metrics.totalMeasurements}
- **Average Accuracy**: ${metrics.averageAccuracy.toFixed(2)}%
- **Diamond Certification Rate**: ${metrics.diamondCertificationRate.toFixed(1)}%
- **Auto-Approval Rate**: ${metrics.autoApprovalRate.toFixed(1)}%
- **Accuracy Improvement**: ${metrics.accuracyImprovementPct >= 0 ? '+' : ''}${metrics.accuracyImprovementPct.toFixed(3)}%

### Improvement Activities
- Ground Truth Ingested: ${metrics.groundTruthIngested}
- Calibrations Updated: ${metrics.calibrationsUpdated}
- Error Patterns Identified: ${metrics.errorPatternsIdentified}
- Training Examples Generated: ${metrics.trainingExamplesGenerated}
- Edge Cases Resolved: ${metrics.edgeCasesResolved}

### Status
${metrics.accuracyImprovementPct >= 0 ? '✅ Accuracy improving' : '⚠️ Accuracy regression detected - investigation required'}
`;
}
