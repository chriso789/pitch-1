import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY');
    const TELNYX_CONNECTION_ID = Deno.env.get('TELNYX_CONNECTION_ID');

    if (!TELNYX_API_KEY || !TELNYX_CONNECTION_ID) {
      throw new Error('Telnyx credentials not configured');
    }

    // Call Telnyx Token API
    const response = await fetch('https://api.telnyx.com/v2/telephony_credentials/token', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: TELNYX_CONNECTION_ID,
        expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Telnyx API error:', response.status, errorText);
      throw new Error(`Telnyx API error: ${response.status}`);
    }

    const data = await response.json();

    return new Response(
      JSON.stringify({ token: data.data.token }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('JWT mint error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
