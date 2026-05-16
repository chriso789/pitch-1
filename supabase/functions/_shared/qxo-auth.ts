// Shared QXO/Beacon auth helper.
// Reads non-sensitive status from qxo_connections and secrets
// (username/password/client_id/access_token/refresh_token) from the
// service-role-only qxo_credentials table. Tokens are persisted back to
// qxo_credentials; connection status flags stay on qxo_connections.

import { qxoFetch, QxoHttpError, getQxoBaseUrl } from './qxo-http.ts';

export const BEACON_BASE_URL = getQxoBaseUrl();
const OAUTH_PATH = '/v1/rest/com/becn/oauth';
const REFRESH_PATH = '/rest/model/REST/oauth/token';
const DEFAULT_SCOPE = 'manage-rebate';
const DEFAULT_REDIRECT = `${getQxoBaseUrl()}/oauth/callback`;

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
  try {
    const data = await qxoFetch<any>(OAUTH_PATH, {
      method: 'POST',
      query: {
        response_type: 'code',
        redirect_uri: DEFAULT_REDIRECT,
        client_id: conn.client_id,
        scope: DEFAULT_SCOPE,
      },
      body: {
        username: conn.username,
        password: conn.password,
        siteId: conn.site_id || 'becnus',
      },
      retryStatuses: [500, 502, 503, 504],
    });
    if (!data?.access_token) {
      const msg = data?.message || data?.messages?.[0]?.value || 'Beacon OAuth returned no access_token';
      throw new Error(msg);
    }
    return data;
  } catch (e) {
    if (e instanceof QxoHttpError) {
      throw new Error(e.message || `Beacon OAuth failed (${e.status})`);
    }
    throw e;
  }
}

async function refreshToken(conn: any): Promise<any | null> {
  if (!conn.refresh_token || !conn.client_id) return null;
  try {
    const data = await qxoFetch<any>(REFRESH_PATH, {
      method: 'POST',
      query: {
        grant_type: 'refresh_token',
        client_id: conn.client_id,
        refresh_token: conn.refresh_token,
        scopes: DEFAULT_SCOPE,
      },
      body: {
        grant_type: 'refresh_token',
        client_id: conn.client_id,
        refresh_token: conn.refresh_token,
        scopes: DEFAULT_SCOPE,
      },
      retryStatuses: [500, 502, 503, 504],
    });
    if (!data?.access_token) return null;
    return data;
  } catch {
    return null;
  }
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
