// NOTE: Use npm: specifiers and Deno.serve to avoid bundle timeouts
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

interface AccuracyTrackingData {
  measurement_id: string;
  ai_total_area: number;
  manual_total_area: number;
  ai_ridge_ft?: number;
  manual_ridge_ft?: number;
  ai_hip_ft?: number;
  manual_hip_ft?: number;
  ai_valley_ft?: number;
  manual_valley_ft?: number;
  verified_by: string;
  tenant_id: string;
}

// NEW: Correction storage for learning
interface CorrectionData {
  measurement_id?: string;
  tenant_id: string;
  original_line_wkt: string;
  original_line_type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  corrected_line_wkt: string;
  deviation_ft: number;
  correction_source: 'user_trace' | 'manual_edit' | 'auto_correction' | 'qa_review';
  building_shape: string;
  roof_type: string;
  vertex_count: number;
  lat?: number;
  lng?: number;
  created_by?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, data } = await req.json();

    if (action === 'record') {
      // Record accuracy comparison between AI and manual measurements
      const trackingData = data as AccuracyTrackingData;
      
      // Calculate variance percentages
      const areaVariancePct = trackingData.ai_total_area > 0 
        ? Math.abs((trackingData.manual_total_area - trackingData.ai_total_area) / trackingData.ai_total_area) * 100
        : 0;
      
      const ridgeVariancePct = trackingData.ai_ridge_ft && trackingData.ai_ridge_ft > 0 && trackingData.manual_ridge_ft
        ? Math.abs((trackingData.manual_ridge_ft - trackingData.ai_ridge_ft) / trackingData.ai_ridge_ft) * 100
        : null;
      
      const hipVariancePct = trackingData.ai_hip_ft && trackingData.ai_hip_ft > 0 && trackingData.manual_hip_ft
        ? Math.abs((trackingData.manual_hip_ft - trackingData.ai_hip_ft) / trackingData.ai_hip_ft) * 100
        : null;
      
      const valleyVariancePct = trackingData.ai_valley_ft && trackingData.ai_valley_ft > 0 && trackingData.manual_valley_ft
        ? Math.abs((trackingData.manual_valley_ft - trackingData.ai_valley_ft) / trackingData.ai_valley_ft) * 100
        : null;
      
      // Calculate overall accuracy score (100% - avg variance)
      const variances = [areaVariancePct];
      if (ridgeVariancePct !== null) variances.push(ridgeVariancePct);
      if (hipVariancePct !== null) variances.push(hipVariancePct);
      if (valleyVariancePct !== null) variances.push(valleyVariancePct);
      
      const avgVariance = variances.reduce((a, b) => a + b, 0) / variances.length;
      const overallAccuracyScore = Math.max(0, 100 - avgVariance);

      const { data: result, error } = await supabase
        .from('measurement_accuracy_tracking')
        .insert({
          measurement_id: trackingData.measurement_id,
          ai_total_area: trackingData.ai_total_area,
          manual_total_area: trackingData.manual_total_area,
          area_variance_pct: areaVariancePct,
          ai_ridge_ft: trackingData.ai_ridge_ft,
          manual_ridge_ft: trackingData.manual_ridge_ft,
          ridge_variance_pct: ridgeVariancePct,
          ai_hip_ft: trackingData.ai_hip_ft,
          manual_hip_ft: trackingData.manual_hip_ft,
          hip_variance_pct: hipVariancePct,
          ai_valley_ft: trackingData.ai_valley_ft,
          manual_valley_ft: trackingData.manual_valley_ft,
          valley_variance_pct: valleyVariancePct,
          overall_accuracy_score: overallAccuracyScore,
          verified_by: trackingData.verified_by,
          tenant_id: trackingData.tenant_id
        } as any)
        .select()
        .single();

      if (error) throw error;

      console.log(`📊 Recorded accuracy: ${overallAccuracyScore.toFixed(1)}% overall`);

      return new Response(JSON.stringify({
        ok: true,
        data: result,
        accuracy_score: overallAccuracyScore
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (action === 'stats') {
      // Get accuracy statistics for a tenant
      const { tenant_id, days = 30 } = data;
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const { data: records, error } = await supabase
        .from('measurement_accuracy_tracking')
        .select('*')
        .eq('tenant_id', tenant_id)
        .gte('verified_at', cutoffDate.toISOString())
        .order('verified_at', { ascending: false });

      if (error) throw error;

      if (!records || records.length === 0) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            total_verified: 0,
            avg_accuracy_score: null,
            avg_area_variance: null,
            avg_linear_variance: null,
            records: []
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Calculate aggregates
      const totalVerified = records.length;
      const avgAccuracyScore = records.reduce((sum: number, r: any) => sum + (r.overall_accuracy_score || 0), 0) / totalVerified;
      const avgAreaVariance = records.reduce((sum: number, r: any) => sum + (r.area_variance_pct || 0), 0) / totalVerified;
      
      // Linear features average (only count non-null values)
      const linearRecords = records.filter((r: any) => 
        r.ridge_variance_pct !== null || r.hip_variance_pct !== null || r.valley_variance_pct !== null
      );
      
      let avgLinearVariance = null;
      if (linearRecords.length > 0) {
        const linearVariances: number[] = [];
        linearRecords.forEach((r: any) => {
          if (r.ridge_variance_pct !== null) linearVariances.push(r.ridge_variance_pct);
          if (r.hip_variance_pct !== null) linearVariances.push(r.hip_variance_pct);
          if (r.valley_variance_pct !== null) linearVariances.push(r.valley_variance_pct);
        });
        if (linearVariances.length > 0) {
          avgLinearVariance = linearVariances.reduce((a, b) => a + b, 0) / linearVariances.length;
        }
      }

      // Group by day for trend
      const byDay: Record<string, { count: number; totalScore: number }> = {};
      records.forEach((r: any) => {
        const day = r.verified_at.split('T')[0];
        if (!byDay[day]) byDay[day] = { count: 0, totalScore: 0 };
        byDay[day].count++;
        byDay[day].totalScore += r.overall_accuracy_score || 0;
      });

      const trend = Object.entries(byDay)
        .map(([date, { count, totalScore }]) => ({
          date,
          count,
          avg_accuracy: totalScore / count
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return new Response(JSON.stringify({
        ok: true,
        data: {
          total_verified: totalVerified,
          avg_accuracy_score: avgAccuracyScore,
          avg_area_variance: avgAreaVariance,
          avg_linear_variance: avgLinearVariance,
          trend,
          recent_records: records.slice(0, 10)
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (action === 'store-correction') {
      // NEW: Store a line correction for learning
      const correctionData = data as CorrectionData;
      
      // Calculate deviation percentage
      const deviationPct = correctionData.deviation_ft > 0 ? 
        Math.min(100, (correctionData.deviation_ft / 10) * 100) : 0;
      
      const { data: result, error } = await supabase
        .from('measurement_corrections')
        .insert({
          measurement_id: correctionData.measurement_id,
          tenant_id: correctionData.tenant_id,
          original_line_wkt: correctionData.original_line_wkt,
          original_line_type: correctionData.original_line_type,
          corrected_line_wkt: correctionData.corrected_line_wkt,
          deviation_ft: correctionData.deviation_ft,
          deviation_pct: deviationPct,
          correction_source: correctionData.correction_source,
          building_shape: correctionData.building_shape,
          roof_type: correctionData.roof_type,
          vertex_count: correctionData.vertex_count,
          lat: correctionData.lat,
          lng: correctionData.lng,
          created_by: correctionData.created_by
        })
        .select()
        .single();
      
      if (error) throw error;
      
      console.log(`📝 Stored correction for ${correctionData.original_line_type}: ${correctionData.deviation_ft.toFixed(1)}ft deviation`);
      
      return new Response(JSON.stringify({
        ok: true,
        data: result
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (action === 'get-patterns') {
      // NEW: Retrieve learned patterns for a building type
      const { tenant_id, building_shape, roof_type, limit = 100 } = data;
      
      const { data: corrections, error } = await supabase
        .from('measurement_corrections')
        .select('original_line_type, deviation_ft, building_shape, roof_type')
        .eq('tenant_id', tenant_id)
        .eq('building_shape', building_shape)
        .eq('roof_type', roof_type)
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) throw error;
      
      // Aggregate patterns
      const patterns = new Map<string, { deviations: number[]; count: number }>();
      
      for (const c of corrections || []) {
        const key = c.original_line_type;
        const existing = patterns.get(key) || { deviations: [], count: 0 };
        existing.deviations.push(c.deviation_ft);
        existing.count++;
        patterns.set(key, existing);
      }
      
      const patternList = Array.from(patterns.entries()).map(([lineType, { deviations, count }]) => ({
        lineType,
        avgDeviationFt: deviations.reduce((a, b) => a + b, 0) / deviations.length,
        count
      }));
      
      return new Response(JSON.stringify({
        ok: true,
        data: {
          patterns: patternList,
          totalCorrections: corrections?.length || 0
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else {
      return new Response(JSON.stringify({
        ok: false,
        error: `Unknown action: ${action}`
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('Accuracy tracking error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});