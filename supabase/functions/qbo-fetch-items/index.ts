import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { qboHost } from "../_shared/qbo-host.ts";
import {
  createServiceClient,
  getValidAccessToken,
  QboReauthRequiredError,
} from "../_shared/qbo-auth.ts";
import { getIntuitTid } from "../_shared/qbo-intuit-tid.ts";
import { writeQboApiLog } from "../_shared/qbo-api.ts";

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

    // Include Service, Inventory, NonInventory, and Category items. Filtering
    // to Service-only left the picker empty for tenants whose QBO chart of
    // items uses NonInventory (typical for contractor/service accounts that
    // migrated from Desktop). URL-encode the query — unencoded spaces caused
    // some Intuit edges to return an empty QueryResponse.
    const qboQuery = `SELECT Id, Name, Description, Type, UnitPrice, IncomeAccountRef FROM Item WHERE Active=true MAXRESULTS 1000`;
    const qboResponse = await fetch(
      `${qboHost(connection)}/v3/company/${realm_id}/query?query=${encodeURIComponent(qboQuery)}&minorversion=73`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json',
        },
      }
    );


    const intuit_tid = getIntuitTid(qboResponse);
    console.log('[qbo-fetch-items] response', {
      status: qboResponse.status,
      intuit_tid,
      realm_id,
      tenant_id: tenantId,
    });
    void writeQboApiLog(admin, {
      action: 'qbo_fetch_items',
      tenant_id: tenantId,
      connection_id: connection.id,
      realm_id,
      oauth_app_env: connection.oauth_app_env,
      endpoint: `/v3/company/${realm_id}/query`,
      method: 'GET',
      http_status: qboResponse.status,
      intuit_tid,
      success: qboResponse.ok,
      request_metadata: { op: 'query_items', qbo_entity: 'Item' },
    });

    if (!qboResponse.ok) {
      const errorText = await qboResponse.text();
      console.error('QBO API Error:', {
        intuit_tid,
        status: qboResponse.status,
        body_excerpt: errorText.slice(0, 500),
      });
      // 401 from QBO means the access token was rejected even though refresh succeeded —
      // surface as reauth_required so the UI can prompt.
      if (qboResponse.status === 401) {
        return new Response(
          JSON.stringify({ error: 'reauth_required', intuit_tid, details: errorText.slice(0, 500) }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          error: 'qbo_fetch_items_failed',
          message: `QuickBooks API error [status=${qboResponse.status} intuit_tid=${intuit_tid ?? 'none'}]`,
          intuit_tid,
          status: qboResponse.status,
          details: errorText.slice(0, 500),
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const qboData = await qboResponse.json();
    const items = qboData.QueryResponse?.Item || [];

    const formattedItems = items.map((item: any) => ({
      id: item.Id,
      name: item.Name,
      description: item.Description || (item.Type ? `[${item.Type}]` : ''),
      type: item.Type,
      unitPrice: item.UnitPrice || 0,
      incomeAccountRef: item.IncomeAccountRef,
    }));

    console.log(`Fetched ${formattedItems.length} items from QBO (any type)`);


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
