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
    const { measurementId } = await req.json()
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    const { data: m } = await supabaseClient
      .from('roof_measurements')
      .select('*')
      .eq('id', measurementId)
      .single()
    
    if (!m) {
      return new Response(JSON.stringify({ success: false, error: 'Not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    let score = 50 // Base score
    const factors: Record<string, number> = {}
    
    // Source quality (max 25 points)
    const sourceScores: Record<string, number> = {
      'mapbox_vector': 25, 'regrid_parcel': 22, 'osm_buildings': 18,
      'microsoft_buildings': 18, 'manual': 25, 'solar_bbox_fallback': 5
    }
    factors.source = sourceScores[m.footprint_source] || 10
    score += factors.source
    
    // Edge coverage (max 15 points)
    const coverage = m.edge_coverage_percent || 0
    factors.coverage = coverage >= 80 && coverage <= 110 ? 15 : coverage >= 60 ? 10 : 5
    score += factors.coverage
    
    // Accuracy vs manual (max 10 points)
    const accuracy = Math.abs(m.accuracy_vs_manual_percent || 0)
    factors.accuracy = accuracy < 5 ? 10 : accuracy < 10 ? 7 : accuracy < 20 ? 3 : 0
    score += factors.accuracy
    
    score = Math.min(100, Math.max(0, score))
    
    await supabaseClient.from('roof_measurements')
      .update({ quality_score: score }).eq('id', measurementId)
    
    return new Response(JSON.stringify({
      success: true, data: { score, factors, requiresReview: score < 60 }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
