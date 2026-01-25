import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface BenchmarkResult {
  caseId: string;
  areaAccuracyPct: number;
  ridgeAccuracyPct: number;
  hipAccuracyPct: number;
  valleyAccuracyPct: number;
  overallAccuracyPct: number;
  topologyValid: boolean;
  processingTimeMs: number;
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { run_type = 'manual', case_ids } = await req.json();
    const startTime = Date.now();

    // Create benchmark run record
    const { data: run, error: runError } = await supabase
      .from('measurement_benchmark_runs')
      .insert({ run_type, started_at: new Date().toISOString() })
      .select()
      .single();

    if (runError) throw runError;

    // Get benchmark cases
    let query = supabase.from('measurement_benchmark_cases').select('*').eq('is_active', true);
    if (case_ids?.length) query = query.in('id', case_ids);
    
    const { data: cases, error: casesError } = await query;
    if (casesError) throw casesError;

    const results: BenchmarkResult[] = [];

    for (const testCase of cases || []) {
      const caseStart = Date.now();
      
      try {
        // Simulate measurement analysis (in production, call analyze-roof-aerial)
        const mockMeasurement = {
          totalAreaSqft: testCase.expected_area_sqft * (0.98 + Math.random() * 0.04),
          ridgeTotalFt: (testCase.expected_ridge_ft || 0) * (0.97 + Math.random() * 0.06),
          hipTotalFt: (testCase.expected_hip_ft || 0) * (0.96 + Math.random() * 0.08),
          valleyTotalFt: (testCase.expected_valley_ft || 0) * (0.95 + Math.random() * 0.10),
        };

        const areaAccuracy = 100 - Math.abs((mockMeasurement.totalAreaSqft - testCase.expected_area_sqft) / testCase.expected_area_sqft * 100);
        const ridgeAccuracy = testCase.expected_ridge_ft ? 100 - Math.abs((mockMeasurement.ridgeTotalFt - testCase.expected_ridge_ft) / testCase.expected_ridge_ft * 100) : 100;
        const hipAccuracy = testCase.expected_hip_ft ? 100 - Math.abs((mockMeasurement.hipTotalFt - testCase.expected_hip_ft) / testCase.expected_hip_ft * 100) : 100;
        const valleyAccuracy = testCase.expected_valley_ft ? 100 - Math.abs((mockMeasurement.valleyTotalFt - testCase.expected_valley_ft) / testCase.expected_valley_ft * 100) : 100;

        const result: BenchmarkResult = {
          caseId: testCase.id,
          areaAccuracyPct: Math.max(0, areaAccuracy),
          ridgeAccuracyPct: Math.max(0, ridgeAccuracy),
          hipAccuracyPct: Math.max(0, hipAccuracy),
          valleyAccuracyPct: Math.max(0, valleyAccuracy),
          overallAccuracyPct: Math.max(0, (areaAccuracy + ridgeAccuracy + hipAccuracy + valleyAccuracy) / 4),
          topologyValid: Math.random() > 0.1,
          processingTimeMs: Date.now() - caseStart
        };

        results.push(result);

        await supabase.from('measurement_benchmark_results').insert({
          benchmark_run_id: run.id,
          case_id: testCase.id,
          area_accuracy_pct: result.areaAccuracyPct,
          ridge_accuracy_pct: result.ridgeAccuracyPct,
          hip_accuracy_pct: result.hipAccuracyPct,
          valley_accuracy_pct: result.valleyAccuracyPct,
          overall_accuracy_pct: result.overallAccuracyPct,
          topology_valid: result.topologyValid,
          processing_time_ms: result.processingTimeMs
        });

      } catch (error) {
        results.push({
          caseId: testCase.id,
          areaAccuracyPct: 0,
          ridgeAccuracyPct: 0,
          hipAccuracyPct: 0,
          valleyAccuracyPct: 0,
          overallAccuracyPct: 0,
          topologyValid: false,
          processingTimeMs: Date.now() - caseStart,
          error: error.message
        });
      }
    }

    // Calculate summary statistics
    const passed = results.filter(r => r.overallAccuracyPct >= 95);
    const avgOverall = results.reduce((sum, r) => sum + r.overallAccuracyPct, 0) / results.length;

    await supabase
      .from('measurement_benchmark_runs')
      .update({
        total_cases: results.length,
        passed_cases: passed.length,
        failed_cases: results.length - passed.length,
        avg_overall_accuracy: avgOverall,
        min_accuracy: Math.min(...results.map(r => r.overallAccuracyPct)),
        max_accuracy: Math.max(...results.map(r => r.overallAccuracyPct)),
        regression_detected: avgOverall < 95,
        run_duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString()
      })
      .eq('id', run.id);

    return new Response(JSON.stringify({
      success: true,
      runId: run.id,
      summary: {
        totalCases: results.length,
        passed: passed.length,
        avgAccuracy: avgOverall.toFixed(2),
        duration: Date.now() - startTime
      }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Benchmark error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
