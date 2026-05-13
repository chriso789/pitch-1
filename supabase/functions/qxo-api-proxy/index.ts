import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BASE_URLS: Record<string, string> = {
  staging: 'https://api-stg.becn.com',
  production: 'https://api.becn.com',
};

function baseUrl(env: string) {
  return BASE_URLS[env] || BASE_URLS.staging;
}

async function login(conn: any) {
  const res = await fetch(`${baseUrl(conn.environment)}/v1/rest/com/becn/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: conn.username,
      password: conn.password,
      siteId: conn.site_id || 'dealersChoice',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Login failed (${res.status})`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { action, tenant_id } = await req.json();
    if (!action || !tenant_id) throw new Error('action and tenant_id required');

    const { data: conn, error } = await supabase
      .from('qxo_connections')
      .select('*')
      .eq('tenant_id', tenant_id)
      .maybeSingle();
    if (error) throw error;
    if (!conn) throw new Error('No QXO connection found for tenant');

    if (action === 'validate_connection') {
      try {
        const login_res = await login(conn);
        const profileId = login_res?.messageInfo?.profileId || null;
        const accountId =
          login_res?.messageInfo?.lastSelectedAccount?.accountId ||
          login_res?.messageInfo?.lastSelectedAccount?.id ||
          null;

        await supabase
          .from('qxo_connections')
          .update({
            connection_status: 'connected',
            last_validated_at: new Date().toISOString(),
            last_error: null,
            profile_id: profileId,
            account_id: accountId,
            valid_indicator: true,
          })
          .eq('id', conn.id);

        return new Response(
          JSON.stringify({ success: true, profileId, accountId, raw: login_res?.messageInfo }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      } catch (e: any) {
        await supabase
          .from('qxo_connections')
          .update({
            connection_status: 'error',
            last_error: e.message,
            valid_indicator: false,
          })
          .eq('id', conn.id);
        return new Response(
          JSON.stringify({ success: false, error: e.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e: any) {
    console.error('qxo-api-proxy error', e);
    return new Response(
      JSON.stringify({ success: false, error: e.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
