import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MetricEntry {
  metric_name: string;
  metric_value: number;
  metric_unit?: string;
  tags?: Record<string, unknown>;
}

interface MetricsRequest {
  metrics: MetricEntry[];
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body
    const body: MetricsRequest = await req.json();
    
    // Validate request
    if (!body.metrics || !Array.isArray(body.metrics) || body.metrics.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing or empty metrics array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Limit batch size
    if (body.metrics.length > 100) {
      return new Response(
        JSON.stringify({ success: false, error: 'Maximum 100 metrics per request' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate each metric
    for (const metric of body.metrics) {
      if (!metric.metric_name || typeof metric.metric_value !== 'number') {
        return new Response(
          JSON.stringify({ success: false, error: 'Each metric must have metric_name (string) and metric_value (number)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Create service role client to bypass RLS
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Try to get tenant_id from authenticated user
    let tenantId: string | null = null;
    
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { 
          auth: { persistSession: false },
          global: { headers: { Authorization: authHeader } }
        }
      );
      
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (user) {
        // Get tenant_id from user's profile
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .single();
        
        if (profile?.tenant_id) {
          tenantId = profile.tenant_id;
        }
      }
    }

    // Prepare metrics for insertion
    const metricsToInsert = body.metrics.map(metric => ({
      tenant_id: tenantId,
      metric_name: metric.metric_name,
      metric_value: metric.metric_value,
      metric_unit: metric.metric_unit || null,
      tags: metric.tags || null
    }));

    // Insert metrics using service role (bypasses RLS)
    const { data, error } = await supabaseAdmin
      .from('system_metrics')
      .insert(metricsToInsert)
      .select('id');

    if (error) {
      console.error('[log-system-metrics] Database error:', error);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to log metrics' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[log-system-metrics] Logged ${data.length} metrics (tenant: ${tenantId || 'none'})`);

    return new Response(
      JSON.stringify({ success: true, count: data.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[log-system-metrics] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
