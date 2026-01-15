import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { measurementId, manualAreaSqft } = await req.json()
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    const { data: m, error } = await supabaseClient
      .from('roof_measurements')
      .select('*')
      .eq('id', measurementId)
      .single()
    
    if (error || !m) {
      return new Response(JSON.stringify({ success: false, error: 'Not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    const aiArea = m.tags?.['roof.area'] || 0
    const accuracy = manualAreaSqft ? ((aiArea - manualAreaSqft) / manualAreaSqft) * 100 : null
    
    await supabaseClient.from('roof_measurements').update({
      manual_reference_area_sqft: manualAreaSqft,
      accuracy_vs_manual_percent: accuracy,
      accuracy_compared_at: new Date().toISOString(),
    }).eq('id', measurementId)
    
    return new Response(JSON.stringify({
      success: true,
      data: { aiArea, manualArea: manualAreaSqft, accuracyPercent: accuracy }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
