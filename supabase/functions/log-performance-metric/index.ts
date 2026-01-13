/**
 * Performance Metrics Ingestion Edge Function
 * Phase 6: Monitoring & Alerts
 * 
 * Receives batched performance metrics from the frontend
 * and stores them for analysis.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseService } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface PerformanceMetric {
  name: string;
  value: number;
  tags?: Record<string, string>;
  tenantId?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { metrics } = await req.json() as { metrics: PerformanceMetric[] };

    if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No metrics provided' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const supabase = supabaseService();

    // Transform metrics for insertion
    const records = metrics.map((m) => ({
      metric_name: m.name,
      metric_value: m.value,
      tenant_id: m.tenantId || null,
      tags: m.tags || {},
      created_at: new Date().toISOString(),
    }));

    // Batch insert metrics
    const { error } = await supabase
      .from('performance_metrics')
      .insert(records);

    if (error) {
      console.error('Failed to insert metrics:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to store metrics', details: error.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, count: records.length }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('Error processing metrics:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
