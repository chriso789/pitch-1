import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { endpoint, params } = await req.json();
    const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
    
    if (!apiKey) {
      throw new Error('Google Places API key not configured');
    }

    let url = '';
    
    switch (endpoint) {
      case 'autocomplete':
        url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?key=${apiKey}&${new URLSearchParams(params)}`;
        break;
      case 'details':
        url = `https://maps.googleapis.com/maps/api/place/details/json?key=${apiKey}&${new URLSearchParams(params)}`;
        break;
      case 'geocode':
        url = `https://maps.googleapis.com/maps/api/geocode/json?key=${apiKey}&${new URLSearchParams(params)}`;
        break;
      case 'satellite':
        // Google Maps Static API for satellite imagery
        url = `https://maps.googleapis.com/maps/api/staticmap?key=${apiKey}&${new URLSearchParams(params)}`;
        break;
      case 'elevation':
        // Elevation API for roof pitch calculation
        url = `https://maps.googleapis.com/maps/api/elevation/json?key=${apiKey}&${new URLSearchParams(params)}`;
        break;
      default:
        throw new Error('Invalid endpoint');
    }

    const response = await fetch(url);
    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});