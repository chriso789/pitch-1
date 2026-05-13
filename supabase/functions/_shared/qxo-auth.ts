// Shared QXO/Beacon auth helper.
// Today: cookie-based session login (existing flow).
// Tomorrow: when QXO_CLIENT_ID/QXO_CLIENT_SECRET are added, swap the body to
// fetch /v1/rest/com/becn/oauth and return Authorization: Bearer <token>.
// Every new edge function calls this helper so the OAuth swap is one-file.

export const BEACON_BASE_URL = 'https://api.becn.com';

export interface BeaconAuth {
  headers: Record<string, string>;
  conn: any;
  accountId: string | null;
  branch: string | null;
  apiSiteId: string | null;
  loginInfo: any;
}

export async function getBeaconAuth(supabase: any, tenantId: string): Promise<BeaconAuth> {
  if (!tenantId) throw new Error('tenant_id is required');

  const { data: conn, error } = await supabase
    .from('qxo_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!conn) throw new Error('No QXO connection found for this tenant.');

  // Future: if conn.access_token && conn.token_expires_at > now → use Bearer.
  // For now: fall back to username/password cookie session.
  const res = await fetch(`${BEACON_BASE_URL}/v1/rest/com/becn/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: conn.username,
      password: conn.password,
      siteId: conn.site_id || 'dealersChoice',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Beacon login failed (${res.status})`);
  const info = data?.messageInfo;
  if (typeof info === 'string') throw new Error(`Beacon: ${info}`);
  if (!info?.profileId && !info?.lastSelectedAccount) {
    throw new Error('Beacon login returned no profile — credentials may be invalid.');
  }
  const cookie = res.headers.get('set-cookie') || '';

  return {
    headers: { Cookie: cookie, Accept: 'application/json' },
    conn,
    accountId:
      conn.account_id ||
      info?.lastSelectedAccount?.accountId ||
      info?.lastSelectedAccount?.id ||
      null,
    branch:
      conn.default_branch_code ||
      info?.lastSelectedBranch?.branchCode ||
      info?.lastSelectedBranch?.code ||
      null,
    apiSiteId: conn.site_id || info?.apiSiteId || 'BDD',
    loginInfo: info,
  };
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// Trim/cap a string per Beacon max-length rules.
export const cap = (s: any, n: number): string =>
  s == null ? '' : String(s).slice(0, n);
