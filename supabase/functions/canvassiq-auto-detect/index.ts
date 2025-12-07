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
    const GOOGLE_MAPS_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') || Deno.env.get('GOOGLE_PLACES_API_KEY');

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
    const { lat, lng, radiusMeters = 100 } = body;

    if (!lat || !lng) {
      return new Response(JSON.stringify({ error: 'Missing lat/lng' }), { status: 400, headers: corsHeaders });
    }

    // Search nearby places using Google Places API
    const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&type=street_address&key=${GOOGLE_MAPS_KEY}`;
    const placesRes = await fetch(placesUrl);
    const placesData = await placesRes.json();

    const addedProperties: any[] = [];

    for (const place of (placesData.results || []).slice(0, 20)) {
      const address = {
        formatted: place.formatted_address || place.vicinity || place.name,
        place_id: place.place_id
      };

      const { data: propertyId } = await supabase.rpc('add_canvassiq_property', {
        p_tenant_id: profile.tenant_id,
        p_address: address,
        p_lat: place.geometry?.location?.lat || lat,
        p_lng: place.geometry?.location?.lng || lng,
        p_place_id: place.place_id,
        p_created_by: user.id
      });

      if (propertyId) {
        addedProperties.push({ id: propertyId, address: address.formatted });
      }
    }

    console.log(`Auto-detected ${addedProperties.length} properties near ${lat},${lng}`);

    return new Response(JSON.stringify({ 
      success: true, 
      count: addedProperties.length,
      properties: addedProperties 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
