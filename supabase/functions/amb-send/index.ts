
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, text, business_id } = await req.json();

    const CSP_API_KEY = Deno.env.get('AMB_CSP_API_KEY');
    const CSP_ENDPOINT = Deno.env.get('AMB_CSP_ENDPOINT');

    if (!CSP_ENDPOINT) {
      throw new Error('AMB_CSP_ENDPOINT not configured');
    }

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
  } catch (error: unknown) {
    console.error('AMB send error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
