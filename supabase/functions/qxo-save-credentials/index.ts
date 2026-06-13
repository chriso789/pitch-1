// Saves QXO/Beacon credentials into the service-role-only `qxo_credentials`
// table. The browser never writes secrets to a client-readable table — this
// function is the only path. Non-sensitive fields (site_id, environment,
// has_credentials flag, connection_status) are mirrored to `qxo_connections`.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

  try {
    // 1) Authenticate the caller via their bearer token.
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ success: false, error: 'Missing Authorization header' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const user = userRes.user;

    const body = await req.json().catch(() => ({}));
    const {
      tenant_id,
      username,
      password,
      client_id,
      site_id,
      environment,
      clear,
    }: {
      tenant_id?: string;
      username?: string | null;
      password?: string | null;
      client_id?: string | null;
      site_id?: string | null;
      environment?: string | null;
      clear?: boolean;
    } = body || {};

    if (!tenant_id) return json({ success: false, error: 'tenant_id is required' }, 400);

    // 2) Authorize: caller must be a member of the tenant.
    //    user_company_access.tenant_id is the canonical column in this repo.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: access, error: accessErr } = await admin
      .from('user_company_access')
      .select('user_id, tenant_id')
      .eq('user_id', user.id)
      .eq('tenant_id', tenant_id)
      .maybeSingle();

    if (accessErr) throw accessErr;
    if (!access) {
      // Allow master role to manage any tenant.
      const { data: isMaster } = await admin.rpc('has_role', {
        _user_id: user.id,
        _role: 'master',
      });
      if (!isMaster) return json({ success: false, error: 'Not authorized for this tenant' }, 403);
    }

    const nowIso = new Date().toISOString();

    // 3) Clear path: wipe secrets + mark disconnected + revoke authorization.
    if (clear) {
      await admin.from('qxo_credentials').delete().eq('tenant_id', tenant_id);
      await admin
        .from('qxo_connections')
        .update({
          has_credentials: false,
          connection_status: 'disconnected',
          valid_indicator: false,
          last_error: null,
          authorization_status: 'revoked',
          revoked_at: nowIso,
        })
        .eq('tenant_id', tenant_id);
      return json({ success: true, cleared: true });
    }

    // 4) Save path: require username + password.
    if (!username || !password) {
      return json({ success: false, error: 'username and password are required' }, 400);
    }

    // Upsert credentials (RLS-locked table — only this function can touch it).
    const credPayload: Record<string, unknown> = {
      tenant_id,
      username,
      password,
      client_id: client_id ?? null,
      // New credentials invalidate any cached token.
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
    };
    const { error: credErr } = await admin
      .from('qxo_credentials')
      .upsert(credPayload, { onConflict: 'tenant_id' });
    if (credErr) throw credErr;

    // Ensure a qxo_connections row exists with the non-sensitive metadata
    // AND the authorization metadata required by the tenant guard.
    const connPayload: Record<string, unknown> = {
      tenant_id,
      site_id: site_id || 'dealersChoice',
      environment: environment || 'staging',
      has_credentials: true,
      connection_status: 'disconnected',
      valid_indicator: false,
      last_error: null,
      authorized_by_user_id: user.id,
      authorization_method: 'api_key',
      authorization_status: 'active',
      scopes: ['pricing', 'catalog', 'order_submit', 'order_status', 'invoice_read', 'delivery_tracking'],
      connected_at: nowIso,
      revoked_at: null,
      last_verified_at: nowIso,
    };
    const { error: connErr } = await admin
      .from('qxo_connections')
      .upsert(connPayload, { onConflict: 'tenant_id' });
    if (connErr) throw connErr;

    return json({ success: true });
  } catch (e: any) {
    console.error('qxo-save-credentials error', e);
    return json({ success: false, error: e?.message || 'Unknown error' }, 500);
  }
});
