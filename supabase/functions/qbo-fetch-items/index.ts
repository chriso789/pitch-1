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
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      throw new Error('No tenant found');
    }

    // Get active QBO connection
    const { data: connection } = await supabase
      .from('qbo_connections')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_active', true)
      .single();

    if (!connection) {
      throw new Error('No active QuickBooks connection found');
    }

    // Check if token needs refresh
    const tokenExpiresAt = new Date(connection.token_expires_at);
    const now = new Date();
    
    if (tokenExpiresAt <= now) {
      // TODO: Implement token refresh logic
      throw new Error('QuickBooks token expired. Please reconnect.');
    }

    // Fetch Service Items from QBO
    const qboResponse = await fetch(
      `https://${connection.is_sandbox ? 'sandbox-' : ''}quickbooks.api.intuit.com/v3/company/${connection.realm_id}/query?query=SELECT * FROM Item WHERE Type='Service' AND Active=true MAXRESULTS 1000`,
      {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!qboResponse.ok) {
      const errorText = await qboResponse.text();
      console.error('QBO API Error:', errorText);
      throw new Error(`QuickBooks API error: ${qboResponse.status}`);
    }

    const qboData = await qboResponse.json();
    const items = qboData.QueryResponse?.Item || [];

    // Format items for frontend
    const formattedItems = items.map((item: any) => ({
      id: item.Id,
      name: item.Name,
      description: item.Description || '',
      unitPrice: item.UnitPrice || 0,
      incomeAccountRef: item.IncomeAccountRef,
    }));

    console.log(`Fetched ${formattedItems.length} service items from QBO`);

    return new Response(
      JSON.stringify({ items: formattedItems }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in qbo-fetch-items:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
