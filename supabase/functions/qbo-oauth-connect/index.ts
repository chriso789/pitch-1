// QBO OAuth connect — v2 (accepts action via body or query)
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { qboHost } from "../_shared/qbo-host.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const QBO_CLIENT_ID = Deno.env.get('QBO_CLIENT_ID');
const QBO_CLIENT_SECRET = Deno.env.get('QBO_CLIENT_SECRET');
const QBO_REDIRECT_URI = Deno.env.get('QBO_REDIRECT_URI');
const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  scope?: string;
}

const FRONTEND_CALLBACK_URL = Deno.env.get('QBO_FRONTEND_CALLBACK_URL') ?? 'https://pitch-crm.ai/quickbooks/callback';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Public browser redirect from Intuit — no auth header possible.
  // Forward code/realmId/state to the frontend callback which is authenticated.
  const reqUrl = new URL(req.url);
  const hasOAuthParams = reqUrl.searchParams.has('code') && reqUrl.searchParams.has('realmId');
  if (req.method === 'GET' && (reqUrl.pathname.endsWith('/callback') || hasOAuthParams)) {
    const fwd = new URL(FRONTEND_CALLBACK_URL);
    for (const k of ['code', 'realmId', 'state', 'error', 'error_description']) {
      const v = reqUrl.searchParams.get(k);
      if (v) fwd.searchParams.set(k, v);
    }
    return new Response(null, { status: 302, headers: { Location: fwd.toString() } });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization') ?? '' },
        },
      }
    );

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single();

    if (!profile || !['master', 'owner', 'office_admin', 'corporate'].includes(profile.role)) {
      console.error('[qbo-oauth-connect] Insufficient permissions, role=', profile?.role);
      throw new Error(`Insufficient permissions (role: ${profile?.role ?? 'none'})`);
    }

    // Service-role client for qbo_connections writes only (RLS has no write policy).
    // Created AFTER auth + role gate. Never used for reads driven by caller identity.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const url = new URL(req.url);
    let action = url.searchParams.get('action');
    let body: any = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { body = {}; }
      if (!action && body?.action) action = body.action;
    }
    console.log('[qbo-oauth-connect] method=', req.method, 'action=', action, 'bodyKeys=', Object.keys(body || {}));

    // Step 0: Verify config + auth (no side effects) — runs even if env vars missing
    if (action === 'verify') {
      const envSecret = (Deno.env.get('QBO_ENVIRONMENT') ?? 'production').toLowerCase();
      // Best-effort: surface the current tenant's connection environment if one exists
      const { data: existingConn } = await supabase
        .from('qbo_connections')
        .select('is_sandbox, realm_id, qbo_company_name')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .maybeSingle();
      return new Response(
        JSON.stringify({
          ok: true,
          role: profile.role,
          tenant_id: profile.tenant_id,
          hasClientId: !!QBO_CLIENT_ID,
          hasSecret: !!QBO_CLIENT_SECRET,
          hasRedirect: !!QBO_REDIRECT_URI,
          redirectUri: QBO_REDIRECT_URI ?? null,
          environment: envSecret,
          qbo_environment_secret: envSecret,
          connection_is_sandbox: existingConn ? existingConn.is_sandbox === true : null,
          connection_realm_id: existingConn?.realm_id ?? null,
          connection_company_name: existingConn?.qbo_company_name ?? null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET || !QBO_REDIRECT_URI) {
      console.error('Missing QBO env vars', {
        hasClientId: !!QBO_CLIENT_ID,
        hasSecret: !!QBO_CLIENT_SECRET,
        hasRedirect: !!QBO_REDIRECT_URI,
      });
      throw new Error('QuickBooks integration is not configured (missing QBO_CLIENT_ID/SECRET/REDIRECT_URI)');
    }

    // Step 1: Initiate OAuth
    if (action === 'initiate') {
      const state = crypto.randomUUID();
      const scope = 'com.intuit.quickbooks.accounting openid email profile';
      
      // Store state in session for CSRF protection
      const authUrl = `${QBO_AUTH_URL}?` + new URLSearchParams({
        client_id: QBO_CLIENT_ID!,
        redirect_uri: QBO_REDIRECT_URI!,
        response_type: 'code',
        scope,
        state,
      });

      return new Response(
        JSON.stringify({ authUrl, state }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Handle OAuth callback
    if (action === 'callback') {
      const { code, realmId, state } = body;

      if (!code || !realmId) {
        throw new Error('Missing code or realmId');
      }

      // Exchange code for tokens
      const tokenResponse = await fetch(QBO_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Authorization': `Basic ${btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: QBO_REDIRECT_URI!,
        }),
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        console.error('Token exchange failed:', error);
        throw new Error('Failed to exchange authorization code');
      }

      const tokens: TokenResponse = await tokenResponse.json();

      // Newly-connected tenants inherit the OAuth app's environment from QBO_ENVIRONMENT.
      const isSandbox = (Deno.env.get('QBO_ENVIRONMENT') ?? 'production').toLowerCase() === 'sandbox';

      // Get company info from the matching host
      const companyResponse = await fetch(
        `${qboHost({ is_sandbox: isSandbox })}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`,
        {
          headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Accept': 'application/json',
          },
        }
      );

      const companyData = await companyResponse.json();
      const companyName = companyData.CompanyInfo?.CompanyName || 'Unknown';

      // Calculate token expiry
      const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      // Store connection (service role — RLS has no INSERT/UPDATE policy)
      const { data: connection, error: insertError } = await adminClient
        .from('qbo_connections')
        .upsert({
          tenant_id: profile.tenant_id,
          realm_id: realmId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: tokenExpiresAt.toISOString(),
          expires_at: tokenExpiresAt.toISOString(),
          scopes: tokens.scope
            ? tokens.scope.split(/\s+/).filter(Boolean)
            : ['com.intuit.quickbooks.accounting', 'openid', 'email', 'profile'],
          connected_by: user.id,
          is_active: true,
          is_sandbox: isSandbox,
          qbo_company_name: companyName,
          metadata: {
            company_info: companyData.CompanyInfo,
          },
        }, {
          onConflict: 'tenant_id,realm_id',
        })
        .select()
        .single();

      if (insertError) {
        console.error('[qbo-oauth-connect] callback upsert failed', {
          tenant_id: profile.tenant_id,
          realm_id: realmId,
          is_sandbox: isSandbox,
          code: (insertError as any).code,
          message: insertError.message,
        });
        return new Response(
          JSON.stringify({
            success: false,
            error: 'qbo_connection_write_failed',
            details: insertError.message,
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[qbo-oauth-connect] callback upsert ok', {
        tenant_id: profile.tenant_id,
        realm_id: realmId,
        is_sandbox: isSandbox,
      });

      return new Response(
        JSON.stringify({
          success: true,
          connected: true,
          realm_id: connection.realm_id,
          company_name: connection.qbo_company_name,
          is_sandbox: connection.is_sandbox === true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Refresh token
    if (action === 'refresh') {
      const { data: connection } = await supabase
        .from('qbo_connections')
        .select('id, realm_id, refresh_token, is_sandbox')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .single();

      if (!connection) {
        throw new Error('No active QBO connection found');
      }

      const tokenResponse = await fetch(QBO_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Authorization': `Basic ${btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: connection.refresh_token,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error('Failed to refresh token');
      }

      const tokens: TokenResponse = await tokenResponse.json();
      const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      const { error: refreshError } = await adminClient
        .from('qbo_connections')
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: tokenExpiresAt.toISOString(),
          expires_at: tokenExpiresAt.toISOString(),
          last_refresh_at: new Date().toISOString(),
        })
        .eq('tenant_id', profile.tenant_id)
        .eq('id', connection.id);

      if (refreshError) {
        console.error('[qbo-oauth-connect] refresh update failed', {
          tenant_id: profile.tenant_id,
          realm_id: connection.realm_id,
          code: (refreshError as any).code,
          message: refreshError.message,
        });
        return new Response(
          JSON.stringify({
            success: false,
            error: 'qbo_connection_write_failed',
            details: refreshError.message,
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[qbo-oauth-connect] refresh ok', {
        tenant_id: profile.tenant_id,
        realm_id: connection.realm_id,
      });

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 4: Disconnect
    if (action === 'disconnect') {
      const { error: disconnectError } = await adminClient
        .from('qbo_connections')
        .update({ is_active: false, disconnected_at: new Date().toISOString() })
        .eq('tenant_id', profile.tenant_id);

      if (disconnectError) {
        console.error('[qbo-oauth-connect] disconnect failed', {
          tenant_id: profile.tenant_id,
          code: (disconnectError as any).code,
          message: disconnectError.message,
        });
        return new Response(
          JSON.stringify({
            success: false,
            error: 'qbo_connection_write_failed',
            details: disconnectError.message,
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[qbo-oauth-connect] disconnect ok', { tenant_id: profile.tenant_id });

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error('Invalid action');

  } catch (error) {
    console.error('Error in qbo-oauth-connect:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
