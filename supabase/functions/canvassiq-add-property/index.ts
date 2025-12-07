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

    const body = await req.json();
    const { address, lat, lng, place_id } = body;

    if (!address || !lat || !lng) {
      return new Response(JSON.stringify({ error: 'Missing required fields: address, lat, lng' }), { status: 400, headers: corsHeaders });
    }

    const { data: propertyId, error } = await supabase.rpc('add_canvassiq_property', {
      p_tenant_id: profile.tenant_id,
      p_address: address,
      p_lat: lat,
      p_lng: lng,
      p_place_id: place_id || null,
      p_created_by: user.id
    });

    if (error) throw error;

    const { data: property } = await supabase
      .from('canvassiq_properties')
      .select('*')
      .eq('id', propertyId)
      .single();

    console.log(`Property added/found: ${propertyId}`);

    return new Response(JSON.stringify({ success: true, property }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
