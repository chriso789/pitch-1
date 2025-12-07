import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: corsHeaders });
    }

    const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).single();
    if (!profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers: corsHeaders });
    }

    const url = new URL(req.url);
    const minLng = parseFloat(url.searchParams.get('minLng') || '-180');
    const minLat = parseFloat(url.searchParams.get('minLat') || '-90');
    const maxLng = parseFloat(url.searchParams.get('maxLng') || '180');
    const maxLat = parseFloat(url.searchParams.get('maxLat') || '90');
    const limit = parseInt(url.searchParams.get('limit') || '500');

    const { data: properties, error } = await supabase.rpc('get_canvassiq_properties_in_bbox', {
      p_tenant_id: profile.tenant_id,
      p_min_lng: minLng,
      p_min_lat: minLat,
      p_max_lng: maxLng,
      p_max_lat: maxLat,
      p_limit: limit
    });

    if (error) throw error;

    const geojson = {
      type: 'FeatureCollection',
      features: (properties || []).map((p: any) => ({
        type: 'Feature',
        id: p.id,
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          disposition: p.disposition,
          address: p.address?.formatted || '',
          owner_name: p.owner_name,
          enrichment_confidence: p.enrichment_confidence,
          contact_id: p.contact_id,
          created_at: p.created_at
        }
      }))
    };

    return new Response(JSON.stringify(geojson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
