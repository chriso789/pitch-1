// Shared QXO/Beacon auth helper.
// Reads non-sensitive status from qxo_connections and secrets
// (username/password/client_id/access_token/refresh_token) from the
// service-role-only qxo_credentials table. Tokens are persisted back to
// qxo_credentials; connection status flags stay on qxo_connections.

export const BEACON_BASE_URL = 'https://api.qxo.com';
const OAUTH_PATH = '/v1/rest/com/becn/oauth';
const REFRESH_PATH = '/rest/model/REST/oauth/token';
const DEFAULT_SCOPE = 'manage-rebate';
const DEFAULT_REDIRECT = 'https://api.qxo.com/oauth/callback';

export interface BeaconAuth {
  headers: Record<string, string>;
  conn: any;
  accountId: string | null;
  branch: string | null;
  apiSiteId: string | null;
  loginInfo: any;
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export const cap = (s: any, n: number): string =>
  s == null ? '' : String(s).slice(0, n);

function expiresInToISO(seconds: number): string {
  // Refresh 60s early.
  return new Date(Date.now() + Math.max(60, seconds - 60) * 1000).toISOString();
}

/**
 * Load a tenant's qxo connection joined with its server-side credentials.
 * Only call from edge functions running with the service role — qxo_credentials
 * has RLS enabled with no policies, so anon/authenticated clients cannot read it.
 */
export async function loadConnectionWithCredentials(supabase: any, tenantId: string) {
  if (!tenantId) throw new Error('tenant_id is required');
  const { data: conn, error: connErr } = await supabase
    .from('qxo_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (connErr) throw connErr;
  if (!conn) throw new Error('No QXO connection found for this tenant.');

  const { data: creds, error: credErr } = await supabase
    .from('qxo_credentials')
    .select('username, password, client_id, access_token, refresh_token, token_expires_at')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (credErr) throw credErr;

  return {
    ...conn,
    username: creds?.username ?? null,
    password: creds?.password ?? null,
    client_id: creds?.client_id ?? null,
    access_token: creds?.access_token ?? null,
    refresh_token: creds?.refresh_token ?? null,
    token_expires_at: creds?.token_expires_at ?? null,
  };
}

async function persistTokens(supabase: any, tenantId: string, connId: string, tok: any) {
  const expiresAt = tok?.expires_in
    ? expiresInToISO(Number(tok.expires_in))
    : new Date(Date.now() + 25 * 60 * 1000).toISOString();
  // Tokens go to the service-role-only credentials table.
  await supabase
    .from('qxo_credentials')
    .update({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? undefined,
      token_expires_at: expiresAt,
    })
    .eq('tenant_id', tenantId);
  // Non-sensitive status flags stay on qxo_connections (visible to tenant via RLS).
  await supabase
    .from('qxo_connections')
    .update({
      connection_status: 'connected',
      last_validated_at: new Date().toISOString(),
      last_error: null,
      valid_indicator: true,
    })
    .eq('id', connId);
}

async function oauthLogin(conn: any): Promise<any> {
  if (!conn.client_id) {
    throw new Error(
      'QXO client_id is not configured. Add your QXO/Beacon API client_id in Settings → QXO before placing orders.',
    );
  }
  const url = new URL(BEACON_BASE_URL + OAUTH_PATH);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', DEFAULT_REDIRECT);
  url.searchParams.set('client_id', conn.client_id);
  url.searchParams.set('scope', DEFAULT_SCOPE);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      username: conn.username,
      password: conn.password,
      siteId: conn.site_id || 'becnus',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    const msg =
      data?.message ||
      data?.messages?.[0]?.value ||
      `Beacon OAuth failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function refreshToken(conn: any): Promise<any | null> {
  if (!conn.refresh_token || !conn.client_id) return null;
  const url = new URL(BEACON_BASE_URL + REFRESH_PATH);
  url.searchParams.set('grant_type', 'refresh_token');
  url.searchParams.set('client_id', conn.client_id);
  url.searchParams.set('refresh_token', conn.refresh_token);
  url.searchParams.set('scopes', DEFAULT_SCOPE);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: conn.client_id,
      refresh_token: conn.refresh_token,
      scopes: DEFAULT_SCOPE,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) return null;
  return data;
}

export async function getBeaconAuth(supabase: any, tenantId: string): Promise<BeaconAuth> {
  const conn = await loadConnectionWithCredentials(supabase, tenantId);

  // 1) Use cached access_token if still valid.
  let accessToken: string | null = null;
  const exp = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (conn.access_token && exp > Date.now() + 30_000) {
    accessToken = conn.access_token;
  }

  // 2) Try refresh.
  if (!accessToken && conn.refresh_token) {
    try {
      const tok = await refreshToken(conn);
      if (tok?.access_token) {
        await persistTokens(supabase, tenantId, conn.id, tok);
        accessToken = tok.access_token;
        conn.refresh_token = tok.refresh_token ?? conn.refresh_token;
      }
    } catch { /* fall through to fresh login */ }
  }

  // 3) Fresh OAuth login.
  if (!accessToken) {
    try {
      const tok = await oauthLogin(conn);
      await persistTokens(supabase, tenantId, conn.id, tok);
      accessToken = tok.access_token;
    } catch (e: any) {
      await supabase
        .from('qxo_connections')
        .update({
          connection_status: 'error',
          last_error: e?.message ?? 'OAuth login failed',
        })
        .eq('id', conn.id);
      throw e;
    }
  }

  return {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    conn,
    accountId: conn.account_id || null,
    branch: conn.default_branch_code || null,
    apiSiteId: conn.site_id || 'BDD',
    loginInfo: null,
  };
}
