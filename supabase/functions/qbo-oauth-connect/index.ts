// QBO OAuth connect — v3: full split credentials with per-connection context routing.
//
// Auth model:
//   1. User-scoped Supabase client validates JWT + role gate.
//   2. AFTER the gate, an admin client (service role) is created and used ONLY for
//      qbo_connections / qbo_oauth_state writes (RLS has no write policy).
//
// Environment model:
//   - Each connection carries oauth_app_env ('development' | 'production').
//   - Token exchange, refresh, revoke, and accounting REST calls all resolve their
//     client_id / client_secret / host / redirect_uri from the connection's environment.
//   - The mode requested during 'initiate' is persisted in qbo_oauth_state and recovered
//     during 'callback'.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import {
  getQboContextForConnection,
  getQboContextForMode,
  getDefaultQboMode,
  qboCredentialAvailability,
  type QboMode,
} from "../_shared/qbo-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

const FRONTEND_CALLBACK_URL =
  Deno.env.get("QBO_FRONTEND_CALLBACK_URL") ?? "https://pitch-crm.ai/quickbooks/callback";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  scope?: string;
}

function basicAuth(clientId: string, clientSecret: string) {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeMode(input: unknown): QboMode | null {
  if (input === "development" || input === "production") return input;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Public browser redirect from Intuit — forward to the authenticated frontend page.
  const reqUrl = new URL(req.url);
  const hasOAuthParams = reqUrl.searchParams.has("code") && reqUrl.searchParams.has("realmId");
  if (req.method === "GET" && (reqUrl.pathname.endsWith("/callback") || hasOAuthParams)) {
    const fwd = new URL(FRONTEND_CALLBACK_URL);
    for (const k of ["code", "realmId", "state", "error", "error_description"]) {
      const v = reqUrl.searchParams.get(k);
      if (v) fwd.searchParams.set(k, v);
    }
    return new Response(null, { status: 302, headers: { Location: fwd.toString() } });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (
      !profile ||
      !["master", "owner", "office_admin", "corporate"].includes(profile.role)
    ) {
      return jsonResponse({ error: `Insufficient permissions (role: ${profile?.role ?? "none"})` }, 403);
    }

    // Service-role client for writes — created AFTER auth + role gate.
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Parse action from query or body
    let action = reqUrl.searchParams.get("action");
    let body: any = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
      if (!action && body?.action) action = body.action;
    }

    const defaultMode = getDefaultQboMode();
    const availability = qboCredentialAvailability();

    // ---------- verify ----------
    if (action === "verify") {
      let connectionRow: any = null;
      try {
        const { data } = await adminClient
          .from("qbo_connections")
          .select("is_sandbox, oauth_app_env, realm_id, qbo_company_name")
          .eq("tenant_id", profile.tenant_id)
          .eq("is_active", true)
          .maybeSingle();
        connectionRow = data;
      } catch {}

      let contextMode: QboMode | null = null;
      try {
        contextMode = connectionRow
          ? getQboContextForConnection(connectionRow).mode
          : null;
      } catch {}

      return jsonResponse({
        ok: true,
        role: profile.role,
        tenant_id: profile.tenant_id,
        qbo_default_environment: defaultMode,
        has_development_credentials: availability.has_development_credentials,
        has_production_credentials: availability.has_production_credentials,
        has_legacy_credentials: availability.has_legacy_credentials,
        connection_is_sandbox: connectionRow ? connectionRow.is_sandbox === true : null,
        connection_oauth_app_env: connectionRow?.oauth_app_env ?? null,
        connection_realm_id: connectionRow?.realm_id ?? null,
        connection_company_name: connectionRow?.qbo_company_name ?? null,
        qbo_context_mode: contextMode,
      });
    }

    // ---------- initiate ----------
    if (action === "initiate") {
      const requestedMode = normalizeMode(body?.mode) ?? defaultMode;

      // Master-only gate for production mode (unless backend default is already production).
      if (requestedMode === "production" && profile.role !== "master" && defaultMode !== "production") {
        return jsonResponse(
          { success: false, error: "qbo_production_requires_master_role" },
          403,
        );
      }

      // Verify credentials exist for the requested mode.
      let ctx;
      try {
        ctx = getQboContextForMode(requestedMode);
      } catch (e) {
        const errKey =
          requestedMode === "production"
            ? "qbo_production_credentials_missing"
            : "qbo_development_credentials_missing";
        return jsonResponse(
          { success: false, error: errKey, details: e instanceof Error ? e.message : String(e) },
          400,
        );
      }

      const state = crypto.randomUUID();

      // Persist the requested mode for callback recovery. Service-role write only.
      const { error: stateErr } = await adminClient
        .from("qbo_oauth_state")
        .insert({
          state,
          tenant_id: profile.tenant_id,
          requested_mode: requestedMode,
          initiated_by: user.id,
        });
      if (stateErr) {
        console.error("[qbo-oauth-connect] state insert failed", stateErr);
        return jsonResponse(
          { success: false, error: "qbo_oauth_state_write_failed", details: stateErr.message },
          500,
        );
      }

      const scope = "com.intuit.quickbooks.accounting openid email profile";
      const authUrl = `${QBO_AUTH_URL}?` + new URLSearchParams({
        client_id: ctx.clientId,
        redirect_uri: ctx.redirectUri,
        response_type: "code",
        scope,
        state,
      });

      return jsonResponse({
        authUrl,
        state,
        mode: requestedMode,
      });
    }

    // ---------- callback ----------
    if (action === "callback") {
      const { code, realmId, state } = body ?? {};
      if (!code || !realmId) return jsonResponse({ error: "Missing code or realmId" }, 400);

      // Recover requested mode from qbo_oauth_state (10-minute window).
      let recoveredMode: QboMode = defaultMode;
      if (state) {
        const { data: stateRow } = await adminClient
          .from("qbo_oauth_state")
          .select("requested_mode, tenant_id, created_at")
          .eq("state", state)
          .maybeSingle();

        if (stateRow && stateRow.tenant_id === profile.tenant_id) {
          const ageMs = Date.now() - new Date(stateRow.created_at as string).getTime();
          if (ageMs < 10 * 60 * 1000) {
            const m = normalizeMode(stateRow.requested_mode);
            if (m) recoveredMode = m;
          }
          // Clean up regardless.
          await adminClient.from("qbo_oauth_state").delete().eq("state", state);
        }
      }

      // Resolve credentials for the recovered mode.
      let ctx;
      try {
        ctx = getQboContextForMode(recoveredMode);
      } catch (e) {
        return jsonResponse(
          {
            success: false,
            error:
              recoveredMode === "production"
                ? "qbo_production_credentials_missing"
                : "qbo_development_credentials_missing",
            details: e instanceof Error ? e.message : String(e),
          },
          400,
        );
      }

      // Exchange the authorization code using THIS mode's credentials.
      const tokenResp = await fetch(QBO_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: basicAuth(ctx.clientId, ctx.clientSecret),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: ctx.redirectUri,
        }),
      });

      if (!tokenResp.ok) {
        const errBody = await tokenResp.text();
        console.error("[qbo-oauth-connect] token exchange failed", { status: tokenResp.status });
        return jsonResponse(
          { success: false, error: "qbo_token_exchange_failed", status: tokenResp.status, details: errBody },
          400,
        );
      }

      const tokens = (await tokenResp.json()) as TokenResponse;

      // Fetch CompanyInfo via THIS mode's host.
      let companyName = "Unknown";
      let companyInfo: any = null;
      try {
        const ciResp = await fetch(
          `${ctx.accountingBaseUrl}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`,
          {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              Accept: "application/json",
            },
          },
        );
        if (ciResp.ok) {
          const ci = await ciResp.json();
          companyInfo = ci.CompanyInfo;
          companyName = companyInfo?.CompanyName ?? "Unknown";
        }
      } catch (e) {
        console.warn("[qbo-oauth-connect] CompanyInfo fetch failed (continuing):", e);
      }

      const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      const refreshExpiresAt = new Date(
        Date.now() + (tokens.x_refresh_token_expires_in ?? 100 * 24 * 3600) * 1000,
      );
      const isSandbox = ctx.mode === "development";

      const { data: connection, error: insertError } = await adminClient
        .from("qbo_connections")
        .upsert({
          tenant_id: profile.tenant_id,
          realm_id: realmId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: tokenExpiresAt.toISOString(),
          expires_at: tokenExpiresAt.toISOString(),
          refresh_token_expires_at: refreshExpiresAt.toISOString(),
          scopes: tokens.scope
            ? tokens.scope.split(/\s+/).filter(Boolean)
            : ["com.intuit.quickbooks.accounting", "openid", "email", "profile"],
          connected_by: user.id,
          is_active: true,
          oauth_app_env: ctx.mode,
          is_sandbox: isSandbox,
          qbo_company_name: companyName,
          disconnected_at: null,
          metadata: { company_info: companyInfo },
        }, { onConflict: "tenant_id,realm_id" })
        .select()
        .single();

      if (insertError) {
        console.error("[qbo-oauth-connect] callback upsert failed", {
          tenant_id: profile.tenant_id,
          realm_id: realmId,
          oauth_app_env: ctx.mode,
          code: (insertError as any).code,
          message: insertError.message,
        });
        return jsonResponse(
          { success: false, error: "qbo_connection_write_failed", details: insertError.message },
          500,
        );
      }

      console.log("[qbo-oauth-connect] callback upsert ok", {
        tenant_id: profile.tenant_id,
        realm_id: realmId,
        oauth_app_env: ctx.mode,
      });

      return jsonResponse({
        success: true,
        connected: true,
        realm_id: connection.realm_id,
        company_name: connection.qbo_company_name,
        oauth_app_env: connection.oauth_app_env,
        is_sandbox: connection.is_sandbox === true,
      });
    }

    // ---------- refresh ----------
    if (action === "refresh") {
      const { data: connection } = await adminClient
        .from("qbo_connections")
        .select("id, realm_id, refresh_token, oauth_app_env, is_sandbox")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .single();

      if (!connection) return jsonResponse({ error: "No active QBO connection found" }, 404);

      let ctx;
      try {
        ctx = getQboContextForConnection(connection);
      } catch (e) {
        return jsonResponse(
          { success: false, error: "qbo_connection_credentials_missing", details: e instanceof Error ? e.message : String(e) },
          400,
        );
      }

      const tokenResp = await fetch(QBO_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: basicAuth(ctx.clientId, ctx.clientSecret),
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: connection.refresh_token,
        }),
      });

      if (!tokenResp.ok) {
        const errBody = await tokenResp.text();
        console.error("[qbo-oauth-connect] refresh failed", { status: tokenResp.status });
        return jsonResponse(
          { success: false, error: "qbo_token_refresh_failed", status: tokenResp.status, details: errBody },
          400,
        );
      }

      const tokens = (await tokenResp.json()) as TokenResponse;
      const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      const refreshExpiresAt = new Date(
        Date.now() + (tokens.x_refresh_token_expires_in ?? 100 * 24 * 3600) * 1000,
      );

      const { error: refreshError } = await adminClient
        .from("qbo_connections")
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: tokenExpiresAt.toISOString(),
          expires_at: tokenExpiresAt.toISOString(),
          refresh_token_expires_at: refreshExpiresAt.toISOString(),
          last_refresh_at: new Date().toISOString(),
        })
        .eq("tenant_id", profile.tenant_id)
        .eq("id", connection.id);

      if (refreshError) {
        console.error("[qbo-oauth-connect] refresh update failed", {
          tenant_id: profile.tenant_id,
          realm_id: connection.realm_id,
          message: refreshError.message,
        });
        return jsonResponse(
          { success: false, error: "qbo_connection_write_failed", details: refreshError.message },
          500,
        );
      }

      return jsonResponse({ success: true });
    }

    // ---------- disconnect ----------
    if (action === "disconnect") {
      const { data: connection } = await adminClient
        .from("qbo_connections")
        .select("id, realm_id, refresh_token, oauth_app_env, is_sandbox")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .maybeSingle();

      if (connection) {
        // Best-effort provider revoke using THIS connection's credentials.
        try {
          const ctx = getQboContextForConnection(connection);
          await fetch(QBO_REVOKE_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: basicAuth(ctx.clientId, ctx.clientSecret),
            },
            body: JSON.stringify({ token: connection.refresh_token }),
          });
        } catch (e) {
          console.warn("[qbo-oauth-connect] revoke call failed (continuing):", e);
        }
      }

      const { error: disconnectError } = await adminClient
        .from("qbo_connections")
        .update({ is_active: false, disconnected_at: new Date().toISOString() })
        .eq("tenant_id", profile.tenant_id);

      if (disconnectError) {
        console.error("[qbo-oauth-connect] disconnect failed", {
          tenant_id: profile.tenant_id,
          message: disconnectError.message,
        });
        return jsonResponse(
          { success: false, error: "qbo_connection_write_failed", details: disconnectError.message },
          500,
        );
      }

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Invalid action" }, 400);
  } catch (error) {
    console.error("Error in qbo-oauth-connect:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
});
