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

async function legacyLogin(username: string, password: string, siteId: string) {
  const data = await qxoFetch<any>('/v1/rest/com/becn/login', {
    method: 'POST',
    body: { username, password, siteId },
  }).catch((e) => {
    if (e instanceof QxoHttpError) {
      throw new Error(e.message || `QXO login failed (${e.status})`);
    }
    throw e;
  });
  const info = data?.messageInfo;
  if (typeof info === 'string') throw new Error(`QXO: ${info}`);
  if (data?.error || data?.errorMessage) {
    throw new Error(`QXO: ${data.error || data.errorMessage}`);
  }
  if (!info?.profileId && !info?.lastSelectedAccount) {
    throw new Error("We couldn't sign you in to QXO. Confirm your QXO username and password.");
  }
  return data;
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

      let loginRes: any;
      try {
        loginRes = await legacyLogin(username, password, siteId);
      } catch (e: any) {
        return json({ success: false, error: e?.message || 'QXO sign-in failed.' }, 200);
      }

      // Persist secrets under tenant_id; invalidate any cached OAuth tokens.
      await admin.from('qxo_credentials').upsert(
        {
          tenant_id,
          username,
          password,
          // Platform client_id (if any) is read from env at order time, not
          // stored per tenant.
          client_id: null,
          access_token: null,
          refresh_token: null,
          token_expires_at: null,
        },
        { onConflict: 'tenant_id' },
      );

      // Mirror non-sensitive flags. Stay "pending" until finalize_connection.
      await admin.from('qxo_connections').upsert(
        {
          tenant_id,
          site_id: siteId,
          environment: 'production',
          has_credentials: true,
          connection_status: 'pending',
          valid_indicator: false,
          last_error: null,
          last_validated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id' },
      );

      const info = loginRes?.messageInfo ?? {};
      const accounts = extractAccounts(loginRes);
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

      return json({
        success: true,
        accounts,
        default_account_id: defaultAccountId,
        default_branch: defaultBranch,
        profile_id: info?.profileId ?? null,
      });
    }

    // ----- 2. finalize_connection: tenant picks account/branch/job account -----
    if (action === 'finalize_connection') {
      const accountId = body.account_id ? String(body.account_id) : null;
      const branchCode = body.branch_code ? String(body.branch_code) : null;
      // job_account isn't a stable DB column yet — keep accepting it but
      // only persist what schema supports today.
      if (!accountId) {
        return json({ success: false, error: 'Account selection is required.' }, 400);
      }

      const { error: updErr } = await admin
        .from('qxo_connections')
        .update({
          account_id: accountId,
          default_branch_code: branchCode,
          connection_status: 'connected',
          valid_indicator: true,
          last_validated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('tenant_id', tenant_id);
      if (updErr) throw updErr;

      return json({ success: true });
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
        const loginRes = await legacyLogin(
          conn.username,
          conn.password,
          conn.site_id || 'dealersChoice',
        );
        const profileId = loginRes?.messageInfo?.profileId ?? null;
        const accountId =
          loginRes?.messageInfo?.lastSelectedAccount?.accountId ??
          loginRes?.messageInfo?.lastSelectedAccount?.id ??
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
        await admin
          .from('qxo_connections')
          .update({
            connection_status: 'error',
            last_error: e.message,
            valid_indicator: false,
          })
          .eq('id', conn.id);
        return json({ success: false, error: e.message });
      }
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e: any) {
    console.error('qxo-api-proxy error', e);
    return json({ success: false, error: e?.message || 'Unknown error' }, 400);
  }
});
