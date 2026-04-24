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

  const mapboxToken = Deno.env.get('MAPBOX_PUBLIC_TOKEN') || Deno.env.get('MAPBOX_ACCESS_TOKEN') || ''

  const { data, error } = await supabase
    .from('training_pairs')
    .select('id,aerial_image_url,labels,line_masks')
    .gte('alignment_quality', 0.02)
    .not('line_masks', 'is', null)
    .order('alignment_quality', { ascending: false })
    .limit(1000)

  if (error) {
    return new Response(JSON.stringify({ error: (error instanceof Error ? error.message : String(error)) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Filter for totalSegments >= 1 and replace expired Mapbox tokens
  const filtered = (data || [])
    .filter(r => r.line_masks && typeof r.line_masks === 'object' && (r.line_masks as any).totalSegments >= 1)
    .map(r => ({
      ...r,
      aerial_image_url: r.aerial_image_url?.replace(/access_token=[^&]+/, `access_token=${mapboxToken}`) || r.aerial_image_url
    }))

  return new Response(JSON.stringify(filtered), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
