import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HealthCheckEntry {
  service_name: string;
  status: 'healthy' | 'degraded' | 'down';
  response_time_ms: number;
  error_message?: string;
  details?: Record<string, unknown>;
}

interface HealthCheckRequest {
  checks: HealthCheckEntry[];
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body
    const body: HealthCheckRequest = await req.json();
    
    // Validate request
    if (!body.checks || !Array.isArray(body.checks) || body.checks.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing or empty checks array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Limit batch size
    if (body.checks.length > 50) {
      return new Response(
        JSON.stringify({ success: false, error: 'Maximum 50 health checks per request' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate each check
    const validStatuses = ['healthy', 'degraded', 'down'];
    for (const check of body.checks) {
      if (!check.service_name || !check.status || typeof check.response_time_ms !== 'number') {
        return new Response(
          JSON.stringify({ success: false, error: 'Each check must have service_name, status, and response_time_ms' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (!validStatuses.includes(check.status)) {
        return new Response(
          JSON.stringify({ success: false, error: 'Status must be: healthy, degraded, or down' }),
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

    // Prepare health checks for insertion - match actual table schema
    // health_checks table columns: id, service_name, status, response_time_ms, error_message, details, checked_at
    const checksToInsert = body.checks.map(check => ({
      service_name: check.service_name,
      status: check.status,
      response_time_ms: check.response_time_ms,
      error_message: check.error_message || null,
      details: check.details || null,
      checked_at: new Date().toISOString()
    }));

    // Insert health checks using service role (bypasses RLS)
    const { data, error } = await supabaseAdmin
      .from('health_checks')
      .insert(checksToInsert)
      .select('id');

    if (error) {
      console.error('[log-health-check] Database error:', error);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to log health checks' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[log-health-check] Logged ${data.length} health checks`);

    return new Response(
      JSON.stringify({ success: true, count: data.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[log-health-check] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
