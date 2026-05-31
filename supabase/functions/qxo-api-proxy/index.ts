// QXO/Beacon tenant-scoped connect + ops proxy.
//
// Customer-facing flow (no platform secrets exposed to tenants):
//   1. action: 'authenticate'      → tenant supplies QXO username/password,
//                                    we persist them under qxo_credentials,
//                                    log in to QXO, and return account/branch
//                                    options the user can pick from.
//   2. action: 'finalize_connection' → tenant picks account/branch/job_account,
//                                      we write non-sensitive mapping to
//                                      qxo_connections, sync branches, mark
//                                      connected.
//   3. action: 'sync_branches'     → refresh tenant's branch list.
//   4. action: 'validate_connection' (developer-only) → legacy /login probe.
//
// All writes are scoped to the JWT-resolved tenant_id; secrets only ever live
// in qxo_credentials (service-role-only RLS).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { loadConnectionWithCredentials } from '../_shared/qxo-auth.ts';
import { qxoFetch, QxoHttpError } from '../_shared/qxo-http.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Public Beacon/QXO docs confirm two adjacent auth contracts:
//   - Legacy session login: POST {base}/v1/rest/com/becn/login
//   - OAuth token service:  POST {base}/rest/model/REST/oauth/token  (refresh-only is publicly documented)
// We do NOT hard-code an "authenticate" path beyond these. The contract used at
// runtime is selected by the server-side QXO_AUTH_MODE env (default: 'session').
// Tenants never see this switch.
type QxoAuthMode = 'session' | 'token';

function getQxoAuthMode(): QxoAuthMode {
  const v = (Deno.env.get('QXO_AUTH_MODE') || 'session').toLowerCase();
  return v === 'token' ? 'token' : 'session';
}

interface QxoAuthResult {
  mode: QxoAuthMode;
  raw: any;
  /** Discovery payload normalized by extractAccounts/etc; raw upstream user info if available. */
  userInfo: any;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: string | null;
}

async function qxoAuthenticate(
  username: string,
  password: string,
  siteId: string,
): Promise<QxoAuthResult> {
  const mode = getQxoAuthMode();

  if (mode === 'token') {
    // Partner-issued OAuth password/credentials exchange.
    // The exact form (grant_type, client_id, client_secret, scope) lives behind
    // platform secrets and is configured per the live QXO partner contract.
    const clientId = Deno.env.get('QXO_CLIENT_ID') || '';
    const clientSecret = Deno.env.get('QXO_CLIENT_SECRET') || '';
    const tokenPath = Deno.env.get('QXO_TOKEN_PATH') || '/rest/model/REST/oauth/token';
    const form = new URLSearchParams();
    form.set('grant_type', 'password');
    form.set('username', username);
    form.set('password', password);
    if (clientId) form.set('client_id', clientId);
    if (clientSecret) form.set('client_secret', clientSecret);
    if (siteId) form.set('siteId', siteId);

    const data = await qxoFetch<any>(tokenPath, {
      method: 'POST',
      raw: form.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch((e) => {
      if (e instanceof QxoHttpError) throw new Error(e.message || `QXO token exchange failed (${e.status})`);
      throw e;
    });
    const access = data?.access_token || data?.accessToken || null;
    if (!access) {
      throw new Error("We couldn't sign you in to QXO. Confirm your QXO username and password.");
    }
    const expiresIn = Number(data?.expires_in ?? data?.expiresIn ?? 0);
    const expiresAt = expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;
    return {
      mode: 'token',
      raw: data,
      userInfo: data,
      accessToken: access,
      refreshToken: data?.refresh_token || data?.refreshToken || null,
      tokenExpiresAt: expiresAt,
    };
  }

  // Default: documented QXO customer session login. QXO's public docs and
  // gateway behavior vary by account, so try the richer payload first and fall
  // back to older documented variants before failing.
  const loginBodies = [
    {
      username,
      password,
      siteId,
      persistentLoginType: 'RememberMe',
      userAgent: 'desktop',
      apiSiteId: null,
    },
    { username, password, siteId },
    { username, password },
  ];

  let lastMessage = '';
  for (const body of loginBodies) {
    const data = await qxoFetch<any>('/v1/rest/com/becn/login', {
      method: 'POST',
      body,
    }).catch((e) => {
      if (e instanceof QxoHttpError) throw new Error(e.message || `QXO login failed (${e.status})`);
      throw e;
    });

    const info = data?.messageInfo;
    if (info && typeof info === 'object' && (info.profileId || info.lastSelectedAccount)) {
      return { mode: 'session', raw: data, userInfo: info };
    }

    lastMessage = String(
      typeof info === 'string'
        ? info
        : data?.error || data?.errorMessage || data?.message || data?.messages?.[0]?.value || '',
    );

    if (/site id|required|invalid/i.test(lastMessage)) continue;
  }

  if (/invalid token/i.test(lastMessage)) {
    throw new Error(
      'QXO rejected the login with "Invalid token". This usually means QXO has not enabled partner API access for this user/account yet, even if the same credentials work in the QXO portal.',
    );
  }
  if (lastMessage) throw new Error(`QXO: ${lastMessage}`);
  throw new Error("We couldn't sign you in to QXO. Confirm your QXO username and password.");
}

/** Pull the list of account options the user can choose from. QXO returns
 *  different shapes per tenant; we normalize the common ones. */
function extractAccounts(loginRes: any): Array<{ id: string; label: string }> {
  const info = loginRes?.messageInfo ?? {};
  const out: Array<{ id: string; label: string }> = [];
  const seen = new Set<string>();

  const push = (id: any, label: any) => {
    const sid = id == null ? '' : String(id);
    if (!sid || seen.has(sid)) return;
    seen.add(sid);
    out.push({ id: sid, label: label ? String(label) : sid });
  };

  const candidates = [
    info.accounts,
    info.accountList,
    info.userAccounts,
    info.availableAccounts,
  ].filter(Array.isArray);
  for (const arr of candidates) {
    for (const a of arr) {
      push(
        a?.accountId ?? a?.id ?? a?.account ?? a?.number,
        a?.accountName ?? a?.name ?? a?.displayName ?? a?.companyName,
      );
    }
  }
  const last = info.lastSelectedAccount;
  if (last) push(last.accountId ?? last.id, last.accountName ?? last.name);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    const tenant_id = body?.tenant_id as string | undefined;
    if (!action || !tenant_id) throw new Error('action and tenant_id required');

    // Authn for tenant-write actions (authenticate / finalize_connection).
    const needsAuthn = action === 'authenticate' || action === 'finalize_connection';
    if (needsAuthn) {
      const authHeader = req.headers.get('Authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (!token) return json({ success: false, error: 'Missing Authorization header' }, 401);

      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userRes, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userRes?.user) return json({ success: false, error: 'Invalid session' }, 401);
      const user = userRes.user;

      const { data: access } = await admin
        .from('user_company_access')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('company_id', tenant_id)
        .maybeSingle();
      if (!access) {
        const { data: isMaster } = await admin.rpc('has_role', {
          _user_id: user.id,
          _role: 'master',
        });
        if (!isMaster) return json({ success: false, error: 'Not authorized for this tenant' }, 403);
      }
    }

    // ----- 1. authenticate: tenant signs into their QXO user account -----
    if (action === 'authenticate') {
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) {
        return json({ success: false, error: 'QXO username and password are required.' }, 400);
      }

      // QXO siteId is platform-level; tenants never see it.
      const siteId = Deno.env.get('QXO_SITE_ID') || 'dealersChoice';

      let authRes: QxoAuthResult;
      try {
        authRes = await qxoAuthenticate(username, password, siteId);
      } catch (e: any) {
        return json({ success: false, error: e?.message || 'QXO sign-in failed.' }, 200);
      }

      // Persist secrets under tenant_id. In session mode we keep the password
      // because re-auth is required when the session expires; in token mode the
      // password can be dropped once we have a refresh_token.
      await admin.from('qxo_credentials').upsert(
        {
          tenant_id,
          username,
          password: authRes.mode === 'token' && authRes.refreshToken ? null : password,
          client_id: null,
          access_token: authRes.accessToken ?? null,
          refresh_token: authRes.refreshToken ?? null,
          token_expires_at: authRes.tokenExpiresAt ?? null,
          auth_mode: authRes.mode,
        },
        { onConflict: 'tenant_id' },
      );

      // Mirror non-sensitive flags. "needs_mapping" until finalize_connection.
      await admin.from('qxo_connections').upsert(
        {
          tenant_id,
          site_id: siteId,
          environment: 'production',
          has_credentials: true,
          connection_status: 'needs_mapping',
          valid_indicator: false,
          last_error: null,
          last_validated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id' },
      );

      const info = authRes.userInfo ?? {};
      const accounts = extractAccounts(authRes.raw);
      const defaultAccountId =
        info?.lastSelectedAccount?.accountId ||
        info?.lastSelectedAccount?.id ||
        accounts[0]?.id ||
        null;
      const defaultBranch =
        info?.lastSelectedAccount?.branchNumber ||
        info?.lastSelectedAccount?.branch ||
        info?.defaultBranch ||
        null;

      // Templates: not exposed by the public session login. Surface anything the
      // upstream actually returned so the UI can render an optional selector;
      // otherwise an empty list keeps the field hidden.
      const templatesRaw = Array.isArray(info?.templates)
        ? info.templates
        : Array.isArray(info?.orderTemplates)
          ? info.orderTemplates
          : [];
      const templates = templatesRaw
        .map((t: any) => ({
          id: String(t?.id ?? t?.templateId ?? t?.code ?? ''),
          name: String(t?.name ?? t?.templateName ?? t?.label ?? t?.id ?? ''),
        }))
        .filter((t: any) => t.id);

      return json({
        success: true,
        accounts,
        default_account_id: defaultAccountId,
        default_branch: defaultBranch,
        profile_id: info?.profileId ?? null,
        templates,
        state: 'needs_mapping',
      });
    }

    // ----- 2. finalize_connection: tenant picks account/branch/job + contact -----
    if (action === 'finalize_connection') {
      const accountId = body.account_id ? String(body.account_id) : null;
      const accountNumber = body.account_number ? String(body.account_number) : null;
      const branchCode = body.branch_code ? String(body.branch_code) : null;
      const jobAccount = body.job_account ? String(body.job_account) : null;
      const branchContactName = body.branch_contact_name ? String(body.branch_contact_name).trim() : null;
      const branchContactPhone = body.branch_contact_phone ? String(body.branch_contact_phone).trim() : null;
      const branchContactEmail = body.branch_contact_email ? String(body.branch_contact_email).trim() : null;
      const templateId = body.template_id ? String(body.template_id) : null;
      const templateName = body.template_name ? String(body.template_name) : null;

      if (!accountId) {
        return json({ success: false, error: 'Account selection is required.' }, 400);
      }
      if (!branchCode) {
        return json({ success: false, error: 'Default branch is required.' }, 400);
      }
      if (!branchContactName || (!branchContactPhone && !branchContactEmail)) {
        return json(
          { success: false, error: 'Branch contact name and phone or email are required.' },
          400,
        );
      }

      const { error: updErr } = await admin
        .from('qxo_connections')
        .update({
          account_id: accountId,
          account_number: accountNumber ?? accountId,
          default_branch_code: branchCode,
          job_account: jobAccount,
          branch_contact_name: branchContactName,
          branch_contact_phone: branchContactPhone,
          branch_contact_email: branchContactEmail,
          template_id: templateId,
          template_name: templateName,
          connection_status: 'connected',
          valid_indicator: true,
          last_validated_at: new Date().toISOString(),
          last_sync_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('tenant_id', tenant_id);
      if (updErr) throw updErr;

      return json({ success: true, state: 'connected' });
    }


    // ----- 3. sync_branches (stub — branch discovery happens at login today) -----
    if (action === 'sync_branches') {
      await admin
        .from('qxo_connections')
        .update({ last_validated_at: new Date().toISOString() })
        .eq('tenant_id', tenant_id);
      return json({ success: true });
    }

    // ----- 4. legacy validate_connection (developer-only fallback) -----
    if (action === 'validate_connection') {
      const conn = await loadConnectionWithCredentials(admin, tenant_id);
      if (!conn.username || !conn.password) {
        return json({ success: false, error: 'No saved QXO credentials.' }, 400);
      }
      try {
        const authRes = await qxoAuthenticate(
          conn.username,
          conn.password,
          conn.site_id || 'dealersChoice',
        );
        const info = authRes.userInfo ?? {};
        const profileId = info?.profileId ?? null;
        const accountId =
          info?.lastSelectedAccount?.accountId ??
          info?.lastSelectedAccount?.id ??
          null;
        await admin
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
        return json({ success: true, profileId, accountId });
      } catch (e: any) {
        const msg = String(e?.message || '');
        const looksExpired = /401|unauthor|expired|invalid_token|invalid token|session/i.test(msg);
        await admin
          .from('qxo_connections')
          .update({
            connection_status: looksExpired ? 'expired' : 'error',
            last_error: e.message,
            valid_indicator: false,
          })
          .eq('id', conn.id);
        return json({ success: false, error: e.message, state: looksExpired ? 'expired' : 'error' });
      }
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e: any) {
    console.error('qxo-api-proxy error', e);
    return json({ success: false, error: e?.message || 'Unknown error' }, 400);
  }
});
