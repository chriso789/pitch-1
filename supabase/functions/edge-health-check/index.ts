import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface FunctionHealth {
  name: string;
  status: 'healthy' | 'slow' | 'failed';
  response_time_ms: number;
  error?: string;
  checked_at: string;
}

// List of critical edge functions to monitor
const CRITICAL_FUNCTIONS = [
  { name: 'verify-website', requiresAuth: false, testPayload: { url: 'https://google.com' } },
  { name: 'google-maps-proxy', requiresAuth: true, testPayload: { action: 'health' } },
  { name: 'google-address-validation', requiresAuth: true, testPayload: { address: '123 Test St, Miami, FL' } },
  { name: 'supabase-health', requiresAuth: false, testPayload: {} },
  { name: 'analyze-roof-aerial', requiresAuth: true, testPayload: { health_check: true } },
  { name: 'generate-measurement-visualization', requiresAuth: true, testPayload: { health_check: true } },
  { name: 'crm-ai-agent', requiresAuth: true, testPayload: { health_check: true } },
];

async function checkFunctionHealth(
  functionName: string,
  requiresAuth: boolean,
  testPayload: Record<string, unknown>,
  authHeader: string | null
): Promise<FunctionHealth> {
  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'apikey': Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    };
    
    if (requiresAuth && authHeader) {
      headers['Authorization'] = authHeader;
    }
    
    // Use a short timeout for health checks (5 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(testPayload),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;
    
    // Determine status based on response and timing
    let status: 'healthy' | 'slow' | 'failed';
    let error: string | undefined;
    
    if (!response.ok) {
      // Some functions return errors for test payloads but are still "alive"
      // Only mark as failed for actual server errors (500+) or not found (404)
      if (response.status >= 500 || response.status === 404) {
        status = 'failed';
        error = `HTTP ${response.status}`;
      } else if (responseTime > 2000) {
        status = 'slow';
      } else {
        status = 'healthy'; // Function responded, just rejected test payload
      }
    } else if (responseTime > 2000) {
      status = 'slow';
    } else {
      status = 'healthy';
    }
    
    return {
      name: functionName,
      status,
      response_time_ms: responseTime,
      error,
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    const responseTime = Date.now() - startTime;
    let errorMessage = 'Unknown error';
    
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        errorMessage = 'Timeout (>5s)';
      } else {
        errorMessage = err.message;
      }
    }
    
    return {
      name: functionName,
      status: 'failed',
      response_time_ms: responseTime,
      error: errorMessage,
      checked_at: new Date().toISOString(),
    };
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    
    // Parse request body for optional function filter
    let specificFunctions: string[] | null = null;
    try {
      const body = await req.json();
      if (body.functions && Array.isArray(body.functions)) {
        specificFunctions = body.functions;
      }
    } catch {
      // No body or invalid JSON - check all functions
    }
    
    // Filter functions if specific ones requested
    const functionsToCheck = specificFunctions 
      ? CRITICAL_FUNCTIONS.filter(f => specificFunctions!.includes(f.name))
      : CRITICAL_FUNCTIONS;
    
    console.log(`[edge-health-check] Checking ${functionsToCheck.length} functions...`);
    
    // Check all functions in parallel
    const healthChecks = await Promise.all(
      functionsToCheck.map(fn => 
        checkFunctionHealth(fn.name, fn.requiresAuth, fn.testPayload, authHeader)
      )
    );
    
    // Calculate summary
    const summary = {
      total: healthChecks.length,
      healthy: healthChecks.filter(h => h.status === 'healthy').length,
      slow: healthChecks.filter(h => h.status === 'slow').length,
      failed: healthChecks.filter(h => h.status === 'failed').length,
      avg_response_time_ms: Math.round(
        healthChecks.reduce((sum, h) => sum + h.response_time_ms, 0) / healthChecks.length
      ),
    };
    
    console.log(`[edge-health-check] Results: ${summary.healthy} healthy, ${summary.slow} slow, ${summary.failed} failed`);
    
    return new Response(
      JSON.stringify({
        success: true,
        summary,
        functions: healthChecks,
        checked_at: new Date().toISOString(),
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (err) {
    console.error('[edge-health-check] Error:', err);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: err instanceof Error ? err.message : 'Unknown error' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
