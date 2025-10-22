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
    const { to, text, business_id } = await req.json();

    // Call your CSP's API (Zendesk, Webex, etc.)
    const CSP_API_KEY = Deno.env.get('AMB_CSP_API_KEY');
    const CSP_ENDPOINT = Deno.env.get('AMB_CSP_ENDPOINT');

    const response = await fetch(CSP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CSP_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        destination: to,
        message: { text },
        business_id,
      }),
    });

    if (!response.ok) {
      throw new Error(`CSP API error: ${response.status}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('AMB send error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
