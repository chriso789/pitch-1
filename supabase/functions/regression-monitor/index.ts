import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseService } from '../_shared/supabase.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RegressionAlert {
  metricName: string;
  componentType: string;
  baselineValue: number;
  currentValue: number;
  regressionPct: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  sampleSize: number;
}

/**
 * Calculate rolling accuracy metrics and detect regressions
 */
async function calculateAccuracyMetrics(supabase: any, tenantId?: string): Promise<{
  current: Record<string, number>;
  baseline: Record<string, number>;
}> {
  // Get recent measurements (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let recentQuery = supabase
    .from('roof_measurements')
    .select('confidence_score, complexity_rating, created_at')
    .gte('created_at', sevenDaysAgo)
    .not('confidence_score', 'is', null);

  let baselineQuery = supabase
    .from('roof_measurements')
    .select('confidence_score, complexity_rating, created_at')
    .gte('created_at', thirtyDaysAgo)
    .lt('created_at', sevenDaysAgo)
    .not('confidence_score', 'is', null);

  if (tenantId) {
    recentQuery = recentQuery.eq('tenant_id', tenantId);
    baselineQuery = baselineQuery.eq('tenant_id', tenantId);
  }

  const [recentResult, baselineResult] = await Promise.all([
    recentQuery,
    baselineQuery,
  ]);

  const calculateAvg = (data: any[], field: string) => {
    if (!data || data.length === 0) return 0;
    const sum = data.reduce((acc, item) => acc + (item[field] || 0), 0);
    return sum / data.length;
  };

  const recent = recentResult.data || [];
  const baseline = baselineResult.data || [];

  return {
    current: {
      overall_accuracy: calculateAvg(recent, 'confidence_score'),
      simple_accuracy: calculateAvg(
        recent.filter((r: any) => r.complexity_rating === 'simple'),
        'confidence_score'
      ),
      moderate_accuracy: calculateAvg(
        recent.filter((r: any) => r.complexity_rating === 'moderate'),
        'confidence_score'
      ),
      complex_accuracy: calculateAvg(
        recent.filter((r: any) => r.complexity_rating === 'complex'),
        'confidence_score'
      ),
      sample_size: recent.length,
    },
    baseline: {
      overall_accuracy: calculateAvg(baseline, 'confidence_score'),
      simple_accuracy: calculateAvg(
        baseline.filter((r: any) => r.complexity_rating === 'simple'),
        'confidence_score'
      ),
      moderate_accuracy: calculateAvg(
        baseline.filter((r: any) => r.complexity_rating === 'moderate'),
        'confidence_score'
      ),
      complex_accuracy: calculateAvg(
        baseline.filter((r: any) => r.complexity_rating === 'complex'),
        'confidence_score'
      ),
      sample_size: baseline.length,
    },
  };
}

/**
 * Detect regressions by comparing current to baseline
 */
function detectRegressions(
  current: Record<string, number>,
  baseline: Record<string, number>
): RegressionAlert[] {
  const alerts: RegressionAlert[] = [];
  const thresholds = {
    critical: 5, // 5% drop
    high: 3,
    medium: 2,
    low: 1,
  };

  const metricMappings = [
    { key: 'overall_accuracy', component: 'all', name: 'Overall Accuracy' },
    { key: 'simple_accuracy', component: 'simple', name: 'Simple Roof Accuracy' },
    { key: 'moderate_accuracy', component: 'moderate', name: 'Moderate Roof Accuracy' },
    { key: 'complex_accuracy', component: 'complex', name: 'Complex Roof Accuracy' },
  ];

  for (const mapping of metricMappings) {
    const currentValue = current[mapping.key];
    const baselineValue = baseline[mapping.key];

    if (baselineValue <= 0 || currentValue <= 0) continue;

    const regressionPct = ((baselineValue - currentValue) / baselineValue) * 100;

    if (regressionPct >= thresholds.low) {
      let severity: RegressionAlert['severity'] = 'low';
      if (regressionPct >= thresholds.critical) severity = 'critical';
      else if (regressionPct >= thresholds.high) severity = 'high';
      else if (regressionPct >= thresholds.medium) severity = 'medium';

      alerts.push({
        metricName: mapping.name,
        componentType: mapping.component,
        baselineValue,
        currentValue,
        regressionPct,
        severity,
        sampleSize: current.sample_size,
      });
    }
  }

  return alerts.sort((a, b) => b.regressionPct - a.regressionPct);
}

/**
 * Log regression to database
 */
async function logRegression(supabase: any, alert: RegressionAlert, tenantId?: string) {
  await supabase.from('accuracy_regression_log').insert({
    metric_name: alert.metricName,
    component_type: alert.componentType,
    baseline_value: alert.baselineValue,
    current_value: alert.currentValue,
    regression_pct: alert.regressionPct,
    severity: alert.severity,
    sample_size: alert.sampleSize,
    investigation_status: 'new',
    tenant_id: tenantId,
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = supabaseService();
    const { tenantId, action } = await req.json().catch(() => ({}));

    if (action === 'check') {
      // Run regression check
      const metrics = await calculateAccuracyMetrics(supabase, tenantId);
      const regressions = detectRegressions(metrics.current, metrics.baseline);

      // Log any detected regressions
      for (const regression of regressions) {
        if (regression.severity === 'high' || regression.severity === 'critical') {
          await logRegression(supabase, regression, tenantId);
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            current: metrics.current,
            baseline: metrics.baseline,
            regressions,
            hasIssues: regressions.some(r => r.severity === 'high' || r.severity === 'critical'),
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'history') {
      // Get regression history
      let query = supabase
        .from('accuracy_regression_log')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(50);

      if (tenantId) {
        query = query.eq('tenant_id', tenantId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return new Response(
        JSON.stringify({ ok: true, data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'resolve') {
      const { regressionId, resolution, rootCause, resolvedBy } = await req.json();

      const { error } = await supabase
        .from('accuracy_regression_log')
        .update({
          investigation_status: 'resolved',
          resolution,
          root_cause: rootCause,
          resolved_by: resolvedBy,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', regressionId);

      if (error) throw error;

      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default: run check
    const metrics = await calculateAccuracyMetrics(supabase, tenantId);
    const regressions = detectRegressions(metrics.current, metrics.baseline);

    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          current: metrics.current,
          baseline: metrics.baseline,
          regressions,
          summary: {
            criticalCount: regressions.filter(r => r.severity === 'critical').length,
            highCount: regressions.filter(r => r.severity === 'high').length,
            mediumCount: regressions.filter(r => r.severity === 'medium').length,
            lowCount: regressions.filter(r => r.severity === 'low').length,
          },
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Regression monitor error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
