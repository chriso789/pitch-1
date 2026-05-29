import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const accessToken = Deno.env.get('SQUARE_ACCESS_TOKEN');
    const environment = (Deno.env.get('SQUARE_ENVIRONMENT') || 'sandbox').toLowerCase();
    const locationId = Deno.env.get('SQUARE_LOCATION_ID') || null;

    if (!accessToken) {
      return new Response(
        JSON.stringify({
          ok: false,
          configured: false,
          error: 'SQUARE_ACCESS_TOKEN is not set',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const base = environment === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com';

    const res = await fetch(`${base}/v2/locations`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Square-Version': '2024-10-17',
        'Content-Type': 'application/json',
      },
    });

    const body = await res.json();

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          configured: true,
          environment,
          error: body?.errors?.[0]?.detail || 'Square API call failed',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const locations = (body?.locations || []).map((l: any) => ({
      id: l.id,
      name: l.name,
      status: l.status,
      currency: l.currency,
    }));

    return new Response(
      JSON.stringify({
        ok: true,
        configured: true,
        environment,
        locationId,
        locationCount: locations.length,
        locations,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
