import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

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
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_tenant_id, tenant_id')
      .eq('id', user.id)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId) {
      throw new Error('No tenant found');
    }

    // Get active QBO connection
    const { data: connection } = await supabase
      .from('qbo_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (!connection) {
      throw new Error('No active QuickBooks connection found');
    }

    // Check Projects API availability using GraphQL introspection
    const graphqlQuery = {
      query: `
        query {
          __type(name: "Project") {
            name
            fields {
              name
            }
          }
        }
      `
    };

    const graphqlResponse = await fetch(
      `https://${connection.is_sandbox ? 'sandbox-' : ''}quickbooks.api.intuit.com/graphql`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(graphqlQuery),
      }
    );

    const graphqlData = await graphqlResponse.json();
    const projectsAvailable = !!graphqlData.data?.__type?.name;

    console.log('Projects API available:', projectsAvailable);

    // Also check company preferences for Projects
    const prefsResponse = await fetch(
      `https://${connection.is_sandbox ? 'sandbox-' : ''}quickbooks.api.intuit.com/v3/company/${connection.realm_id}/preferences`,
      {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Accept': 'application/json',
        },
      }
    );

    let projectsEnabled = false;
    if (prefsResponse.ok) {
      const prefsData = await prefsResponse.json();
      projectsEnabled = prefsData.Preferences?.ProjectsPrefs?.ProjectsEnabled === true;
    }

    return new Response(
      JSON.stringify({ 
        projectsApiAvailable: projectsAvailable,
        projectsEnabled,
        useSubCustomerFallback: !projectsAvailable || !projectsEnabled,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in qbo-check-projects-api:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        projectsApiAvailable: false,
        useSubCustomerFallback: true,
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
