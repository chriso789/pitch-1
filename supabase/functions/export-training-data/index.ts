import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data, error } = await supabase
    .from('training_pairs')
    .select('id,aerial_image_url,labels,line_masks')
    .gte('alignment_quality', 0.02)
    .not('line_masks', 'is', null)
    .order('alignment_quality', { ascending: false })
    .limit(1000)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Filter for totalSegments >= 1
  const filtered = (data || []).filter(r => 
    r.line_masks && typeof r.line_masks === 'object' && (r.line_masks as any).totalSegments >= 1
  )

  return new Response(JSON.stringify(filtered), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
