// supabase-health: calls api_health_report and returns JSON for quick checks
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', 
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    const { data, error } = await supabase.rpc('api_health_report')
    
    if (error) {
      console.error('Health check error:', error)
      return new Response(
        JSON.stringify({ ok: false, error: error.message }), 
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }
    
    // Count status types
    const summary = {
      total: data.length,
      ok: data.filter((r: any) => r.status === 'OK').length,
      missing: data.filter((r: any) => r.status === 'MISSING').length,
      warnings: data.filter((r: any) => r.status === 'WARN').length,
    }
    
    return new Response(
      JSON.stringify({ 
        ok: summary.missing === 0, 
        summary,
        report: data,
        timestamp: new Date().toISOString()
      }), 
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }), 
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
