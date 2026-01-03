import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CrashReport {
  error_type: string;
  error_message: string;
  stack_trace?: string;
  component?: string;
  route?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
  auto_recovered?: boolean;
}

// Simple in-memory rate limiting (per IP, 100 requests per minute)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100;
const RATE_LIMIT_WINDOW = 60000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (record.count >= RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get client IP for rate limiting
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                     req.headers.get('x-real-ip') || 
                     'unknown';
    
    if (!checkRateLimit(clientIp)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: CrashReport = await req.json();
    
    // Validate required fields
    if (!body.error_type || !body.error_message || !body.severity) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields: error_type, error_message, severity' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate severity
    const validSeverities = ['low', 'medium', 'high', 'critical'];
    if (!validSeverities.includes(body.severity)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid severity. Must be: low, medium, high, or critical' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create service role client to bypass RLS
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Try to get tenant_id from authenticated user
    let tenantId: string | null = null;
    let userId: string | null = null;
    
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
        userId = user.id;
        
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

    // Insert crash report using service role (bypasses RLS)
    const { data, error } = await supabaseAdmin
      .from('system_crashes')
      .insert({
        tenant_id: tenantId,
        error_type: body.error_type,
        error_message: body.error_message.substring(0, 5000), // Truncate long messages
        stack_trace: body.stack_trace?.substring(0, 10000), // Truncate long stack traces
        component: body.component || 'unknown',
        route: body.route,
        severity: body.severity,
        metadata: {
          ...body.metadata,
          user_id: userId,
          client_ip: clientIp,
          user_agent: req.headers.get('user-agent'),
          timestamp: new Date().toISOString()
        },
        auto_recovered: body.auto_recovered || false
      })
      .select('id')
      .single();

    if (error) {
      console.error('[log-system-crash] Database error:', error);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to log crash report' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[log-system-crash] Logged crash: ${data.id} (severity: ${body.severity}, tenant: ${tenantId || 'none'})`);

    return new Response(
      JSON.stringify({ success: true, crash_id: data.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[log-system-crash] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
