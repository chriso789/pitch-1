import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { api_key, rep_email } = await req.json();
    
    // Validate API key
    const expectedApiKey = Deno.env.get('STORM_CANVASS_API_KEY');
    if (!api_key || api_key !== expectedApiKey) {
      return new Response(
        JSON.stringify({ error: 'Invalid API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find rep by email
    const { data: rep, error: repError } = await supabase
      .from('profiles')
      .select(`
        id,
        first_name,
        last_name,
        email,
        role,
        tenant_id,
        current_location,
        user_location_assignments!inner (
          location_id,
          locations (
            id,
            name,
            address,
            territory_bounds
          )
        )
      `)
      .eq('email', rep_email)
      .eq('user_location_assignments.is_active', true)
      .single();

    if (repError || !rep) {
      return new Response(
        JSON.stringify({ error: 'Representative not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get available dispositions for the tenant
    const { data: dispositions, error: dispError } = await supabase
      .from('dialer_dispositions')
      .select('id, name, description, is_positive')
      .eq('tenant_id', rep.tenant_id)
      .eq('is_active', true);

    if (dispError) {
      console.error('Error fetching dispositions:', dispError);
    }

    // Generate session token (simple approach using rep ID + timestamp)
    const sessionToken = btoa(`${rep.id}:${Date.now()}`);

    const response = {
      success: true,
      session_token: sessionToken,
      rep: {
        id: rep.id,
        name: `${rep.first_name} ${rep.last_name}`,
        email: rep.email,
        role: rep.role,
        tenant_id: rep.tenant_id,
        territories: rep.user_location_assignments.map((assignment: any) => assignment.locations)
      },
      dispositions: dispositions || []
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Auth error:', error);
    return new Response(
      JSON.stringify({ error: 'Authentication failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});