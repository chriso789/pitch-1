import { createClient } from 'npm:@supabase/supabase-js@2';
import { loadConnectionWithCredentials } from '../_shared/qxo-auth.ts';
import { qxoFetch, QxoHttpError } from '../_shared/qxo-http.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function login(conn: any) {
  const data = await qxoFetch<any>('/v1/rest/com/becn/login', {
    method: 'POST',
    body: {
      username: conn.username,
      password: conn.password,
      siteId: conn.site_id || 'dealersChoice',
    },
  }).catch((e) => {
    if (e instanceof QxoHttpError) throw new Error(e.message || `Login failed (${e.status})`);
    throw e;
  });
  // Beacon returns 200 even on bad credentials; the real error is inside messageInfo
  const info = data?.messageInfo;
  if (typeof info === 'string') throw new Error(`Beacon: ${info}`);
  if (data?.error || data?.errorMessage) {
    throw new Error(`Beacon: ${data.error || data.errorMessage}`);
  }
  if (!info?.profileId && !info?.lastSelectedAccount) {
    throw new Error('Beacon login returned no profile — verify username, password, and site.');
  }
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

    // Secrets live in qxo_credentials (service-role only) and are merged in here.
    const conn = await loadConnectionWithCredentials(supabase, tenant_id);

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
