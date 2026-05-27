import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { qboHost } from "../_shared/qbo-host.ts";
import {
  createServiceClient,
  getValidAccessToken,
  QboReauthRequiredError,
} from "../_shared/qbo-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Caller client (RLS) — only used to authenticate the user and resolve their tenant.
    const caller = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { data: profile } = await caller
      .from('profiles')
      .select('active_tenant_id, tenant_id')
      .eq('id', user.id)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId) {
      throw new Error('No tenant found');
    }

    // Service client for token I/O (bypasses RLS).
    const admin = createServiceClient();

    // Single source of truth for fetching/refreshing tokens.
    // On invalid_grant this will mark the connection inactive and throw QboReauthRequiredError.
    const { access_token, realm_id, connection } = await getValidAccessToken(admin, tenantId);

    const qboResponse = await fetch(
      `${qboHost(connection)}/v3/company/${realm_id}/query?query=SELECT * FROM Item WHERE Type='Service' AND Active=true MAXRESULTS 1000`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!qboResponse.ok) {
      const errorText = await qboResponse.text();
      console.error('QBO API Error:', errorText);
      // 401 from QBO means the access token was rejected even though refresh succeeded —
      // surface as reauth_required so the UI can prompt.
      if (qboResponse.status === 401) {
        return new Response(
          JSON.stringify({ error: 'reauth_required', details: errorText }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`QuickBooks API error: ${qboResponse.status}`);
    }

    const qboData = await qboResponse.json();
    const items = qboData.QueryResponse?.Item || [];

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
    if (error instanceof QboReauthRequiredError) {
      return new Response(
        JSON.stringify({ error: 'reauth_required', message: error.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
