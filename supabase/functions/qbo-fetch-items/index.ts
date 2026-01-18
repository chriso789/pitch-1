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

    // Check if token needs refresh (add 5-minute buffer)
    const tokenExpiresAt = new Date(connection.expires_at);
    const now = new Date();
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    
    if (tokenExpiresAt.getTime() <= now.getTime() + bufferMs) {
      console.log('QuickBooks token expired or expiring soon, refreshing...');
      
      // Refresh the token using Intuit's OAuth 2.0 endpoint
      const refreshResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Authorization': `Basic ${btoa(`${Deno.env.get('QBO_CLIENT_ID')}:${Deno.env.get('QBO_CLIENT_SECRET')}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: connection.refresh_token,
        }),
      });

      if (!refreshResponse.ok) {
        const errorText = await refreshResponse.text();
        console.error('Token refresh failed:', errorText);
        throw new Error('QuickBooks token refresh failed. Please reconnect your account.');
      }

      const tokenData = await refreshResponse.json();
      
      // Calculate new expiry time
      const newExpiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));
      
      // Update tokens in database
      const { error: updateError } = await supabase
        .from('qbo_connections')
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: newExpiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', connection.id);

      if (updateError) {
        console.error('Failed to update tokens:', updateError);
        throw new Error('Failed to save refreshed tokens');
      }

      // Update connection object for API call
      connection.access_token = tokenData.access_token;
      console.log('QuickBooks token refreshed successfully');
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
