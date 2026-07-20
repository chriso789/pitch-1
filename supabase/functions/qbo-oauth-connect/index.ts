// QBO OAuth connect — v4: server-side 302 callback + legal/consent gating.
//
// Phase 1 hardening:
//   - GET /callback runs the full token exchange server-side and 302s back to
//     /settings/integrations?provider=qbo&status=... with NO HTML rendered at
//     the token-bearing URL (per Intuit security guidance).
//   - POST { action: 'initiate' } requires (a) latest Privacy/Terms/QBO consent
//     acceptances, (b) a fresh integration_consents row (consent_id in body).
//   - Token refresh always persists the latest refresh_token, refresh_token_expires_at,
//     last_refresh_at, and on invalid_grant marks the connection inactive.
//
// Auth model:
//   1. User-scoped Supabase client validates JWT + role for POST actions.
//   2. Admin/service-role client only used AFTER the gate for qbo_connections /
//      qbo_oauth_state / integration_consents writes.
//   3. GET /callback is public (Intuit cannot authenticate) — every action is
//      gated by state lookup in qbo_oauth_state which binds tenant_id/user_id.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import {
  getQboContextForConnection,
  getQboContextForMode,
  getDefaultQboMode,
  qboCredentialAvailability,
  type QboMode,
} from "../_shared/qbo-context.ts";
import { getIntuitTid } from "../_shared/qbo-intuit-tid.ts";
import { writeQboApiLog } from "../_shared/qbo-api.ts";
import { getQboOAuthEndpoints } from "../_shared/qbo-discovery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Intuit publishing requirement: OAuth 2.0 endpoints come from the OpenID
// discovery document at runtime (see qbo-discovery.ts). These constants are
// only used if the discovery fetch fails — see FALLBACK_ENDPOINTS there.

const APP_BASE_URL = Deno.env.get("QBO_APP_BASE_URL") ?? "https://pitch-crm.ai";
const SETTINGS_RETURN_PATH = "/settings/integrations";

// Intuit publishing requirement: apps must identify themselves on OAuth + API calls.
const QBO_USER_AGENT = "PitchCRM/1.0 (+https://pitch-crm.ai; support@pitch-crm.ai)";

const REQUIRED_LEGAL_KEYS = ["privacy_policy", "terms_of_service", "qbo_integration_consent"] as const;

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

function redirectToSettings(params: Record<string, string>) {
  const url = new URL(SETTINGS_RETURN_PATH, APP_BASE_URL);
  url.searchParams.set("provider", "qbo");
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}

// ===========================================================================
// Public GET /callback — runs the full exchange server-side, then 302s.
// ===========================================================================
async function handleServerCallback(reqUrl: URL): Promise<Response> {
  const admin = adminClient();
  const code = reqUrl.searchParams.get("code");
  const realmId = reqUrl.searchParams.get("realmId");
  const state = reqUrl.searchParams.get("state");
  const oauthError = reqUrl.searchParams.get("error");

  // 1. State required to bind back to a tenant / consent.
  if (!state) {
    return redirectToSettings({ status: "invalid_state", reason: "missing_state" });
  }

  const { data: stateRow } = await admin
    .from("qbo_oauth_state")
    .select("state, tenant_id, requested_mode, expected_oauth_app_env, consent_id, initiated_by, created_at, expires_at")
    .eq("state", state)
    .maybeSingle();

  if (!stateRow) {
    return redirectToSettings({ status: "invalid_state", reason: "state_not_found" });
  }

  // Expiry: prefer explicit expires_at, fall back to 15-minute window from created_at.
  const expiresAtMs = stateRow.expires_at
    ? new Date(stateRow.expires_at as string).getTime()
    : new Date(stateRow.created_at as string).getTime() + 15 * 60 * 1000;
  if (Date.now() > expiresAtMs) {
    await admin.from("qbo_oauth_state").delete().eq("state", state);
    return redirectToSettings({ status: "invalid_state", reason: "state_expired" });
  }

  // Single-use — delete now whether we succeed or fail below.
  await admin.from("qbo_oauth_state").delete().eq("state", state);

  // 2. Intuit-returned error path.
  if (oauthError) {
    return redirectToSettings({ status: "denied", reason: oauthError });
  }

  // 3. Required params.
  if (!code) return redirectToSettings({ status: "exchange_failed", reason: "missing_code" });
  if (!realmId) return redirectToSettings({ status: "missing_realm" });

  // 4. Resolve mode + credentials.
  const expectedEnv = normalizeMode(stateRow.expected_oauth_app_env) ?? normalizeMode(stateRow.requested_mode) ?? getDefaultQboMode();
  let ctx;
  try {
    ctx = getQboContextForMode(expectedEnv);
  } catch (e) {
    console.error("[qbo-oauth-connect] callback ctx missing", { mode: expectedEnv, err: String(e) });
    return redirectToSettings({ status: "exchange_failed", reason: "credentials_missing" });
  }

  // 5. Exchange code for tokens (endpoint from Intuit discovery doc).
  const endpoints = await getQboOAuthEndpoints(ctx.mode);
  const tokenResp = await fetch(endpoints.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": QBO_USER_AGENT,
      Authorization: basicAuth(ctx.clientId, ctx.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: ctx.redirectUri,
    }),
  });

  const tokenTid = getIntuitTid(tokenResp);
  console.log("[qbo-oauth-connect] callback token exchange", {
    status: tokenResp.status,
    intuit_tid: tokenTid,
    realm_id: realmId,
  });
  void writeQboApiLog(admin, {
    action: "qbo_oauth_connect",
    tenant_id: stateRow.tenant_id,
    user_id: stateRow.initiated_by ?? null,
    realm_id: realmId,
    oauth_app_env: ctx.mode,
    endpoint: "/oauth2/v1/tokens/bearer",
    method: "POST",
    http_status: tokenResp.status,
    intuit_tid: tokenTid,
    success: tokenResp.ok,
    request_metadata: { op: "token_exchange" },
  });

  if (!tokenResp.ok) {
    const errBody = await tokenResp.text();
    console.error("[qbo-oauth-connect] callback token exchange failed", {
      status: tokenResp.status,
      intuit_tid: tokenTid,
      body: errBody.slice(0, 200),
    });
    return redirectToSettings({
      status: "exchange_failed",
      reason: `http_${tokenResp.status}`,
      ...(tokenTid ? { intuit_tid: tokenTid } : {}),
    });
  }

  const tokens = (await tokenResp.json()) as TokenResponse;

  // 6. Fetch company info (best-effort).
  let companyName = "Unknown";
  let companyInfo: unknown = null;
  try {
    const ciResp = await fetch(
      `${ctx.accountingBaseUrl}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`,
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
          "User-Agent": QBO_USER_AGENT,
        },
      },
    );
    const ciTid = getIntuitTid(ciResp);
    console.log("[qbo-oauth-connect] companyinfo fetch", {
      status: ciResp.status,
      intuit_tid: ciTid,
      realm_id: realmId,
    });
    void writeQboApiLog(admin, {
      action: "qbo_oauth_connect",
      tenant_id: stateRow.tenant_id,
      user_id: stateRow.initiated_by ?? null,
      realm_id: realmId,
      oauth_app_env: ctx.mode,
      endpoint: `/v3/company/${realmId}/companyinfo/${realmId}`,
      method: "GET",
      http_status: ciResp.status,
      intuit_tid: ciTid,
      success: ciResp.ok,
      request_metadata: { op: "company_info" },
    });
    if (ciResp.ok) {
      const ci = await ciResp.json();
      companyInfo = ci.CompanyInfo;
      companyName = (ci.CompanyInfo as { CompanyName?: string } | undefined)?.CompanyName ?? "Unknown";
    }
  } catch (e) {
    console.warn("[qbo-oauth-connect] CompanyInfo fetch failed (continuing):", e);
  }

  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const refreshExpiresAt = new Date(
    Date.now() + (tokens.x_refresh_token_expires_in ?? 100 * 24 * 3600) * 1000,
  );
  const isSandbox = ctx.mode === "development";

  // 7. Upsert connection (admin client).
  const { data: connection, error: insertError } = await admin
    .from("qbo_connections")
    .upsert({
      tenant_id: stateRow.tenant_id,
      realm_id: realmId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: tokenExpiresAt.toISOString(),
      expires_at: tokenExpiresAt.toISOString(),
      refresh_token_expires_at: refreshExpiresAt.toISOString(),
      last_refresh_at: new Date().toISOString(),
      scopes: tokens.scope
        ? tokens.scope.split(/\s+/).filter(Boolean)
        : ["com.intuit.quickbooks.accounting", "openid", "email", "profile"],
      connected_by: stateRow.initiated_by,
      connected_at: new Date().toISOString(),
      is_active: true,
      oauth_app_env: ctx.mode,
      is_sandbox: isSandbox,
      qbo_company_name: companyName,
      disconnected_at: null,
      metadata: { company_info: companyInfo },
    }, { onConflict: "tenant_id,realm_id" })
    .select("id")
    .single();

  if (insertError) {
    console.error("[qbo-oauth-connect] callback upsert failed", {
      tenant_id: stateRow.tenant_id,
      realm_id: realmId,
      code: (insertError as { code?: string }).code,
      message: insertError.message,
    });
    return redirectToSettings({ status: "exchange_failed", reason: "db_write_failed" });
  }

  // 8. Bind the consent receipt to the connection (audit trail).
  if (stateRow.consent_id && connection?.id) {
    await admin
      .from("integration_consents")
      .update({ used_for_connection_id: connection.id })
      .eq("id", stateRow.consent_id);
  }

  console.log("[qbo-oauth-connect] callback upsert ok", {
    tenant_id: stateRow.tenant_id,
    realm_id: realmId,
    oauth_app_env: ctx.mode,
  });

  return redirectToSettings({
    status: "connected",
    realm: realmId,
    env: ctx.mode,
  });
}

// ===========================================================================
// Legal/consent gate for POST initiate.
// ===========================================================================
async function checkLegalAcceptance(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  const { data: docs, error: docsErr } = await admin
    .from("legal_documents")
    .select("document_key, version")
    .in("document_key", REQUIRED_LEGAL_KEYS as unknown as string[])
    .eq("is_current", true);
  if (docsErr || !docs) {
    return { ok: false, missing: [...REQUIRED_LEGAL_KEYS] };
  }
  const { data: accs } = await admin
    .from("legal_acceptances")
    .select("document_key, document_version")
    .eq("user_id", userId);
  const have = new Set((accs ?? []).map((a) => `${a.document_key}:${a.document_version}`));
  const missing = docs
    .filter((d) => !have.has(`${d.document_key}:${d.version}`))
    .map((d) => d.document_key);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Public GET callback — server-side 302 path.
  const reqUrl = new URL(req.url);
  const hasOAuthParams = reqUrl.searchParams.has("code") || reqUrl.searchParams.has("error");
  if (req.method === "GET" && (reqUrl.pathname.endsWith("/callback") || hasOAuthParams)) {
    try {
      return await handleServerCallback(reqUrl);
    } catch (e) {
      console.error("[qbo-oauth-connect] callback fatal", e);
      return redirectToSettings({ status: "exchange_failed", reason: "fatal" });
    }
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

    const admin = adminClient();

    // Parse action from query or body
    let action = reqUrl.searchParams.get("action");
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
      if (!action && typeof body?.action === "string") action = body.action as string;
    }

    const defaultMode = getDefaultQboMode();
    const availability = qboCredentialAvailability();

    // ---------- verify ----------
    if (action === "verify") {
      let connectionRow: {
        is_sandbox: boolean | null;
        oauth_app_env: string | null;
        realm_id: string | null;
        qbo_company_name: string | null;
        token_expires_at: string | null;
        refresh_token_expires_at: string | null;
        last_refresh_at: string | null;
        connected_at: string | null;
      } | null = null;
      try {
        const { data } = await admin
          .from("qbo_connections")
          .select("is_sandbox, oauth_app_env, realm_id, qbo_company_name, token_expires_at, refresh_token_expires_at, last_refresh_at, connected_at")
          .eq("tenant_id", profile.tenant_id)
          .eq("is_active", true)
          .maybeSingle();
        connectionRow = data;
      } catch { /* ignore */ }

      let contextMode: QboMode | null = null;
      try {
        contextMode = connectionRow ? getQboContextForConnection(connectionRow).mode : null;
      } catch { /* ignore */ }

      const legal = await checkLegalAcceptance(admin, user.id);

      return jsonResponse({
        ok: true,
        role: profile.role,
        tenant_id: profile.tenant_id,
        qbo_default_environment: defaultMode,
        has_development_credentials: availability.has_development_credentials,
        has_production_credentials: availability.has_production_credentials,
        has_legacy_credentials: availability.has_legacy_credentials,
        connection: connectionRow,
        qbo_context_mode: contextMode,
        legal_acceptance: legal,
      });
    }

    // ---------- initiate ----------
    if (action === "initiate") {
      const requestedMode = normalizeMode(body?.mode) ?? defaultMode;
      const consentId = typeof body?.consent_id === "string" ? (body.consent_id as string) : null;

      // Master-only gate for production mode (unless backend default is already production).
      if (requestedMode === "production" && profile.role !== "master" && defaultMode !== "production") {
        return jsonResponse({ success: false, error: "qbo_production_requires_master_role" }, 403);
      }

      // Production requires legal acceptance.
      if (requestedMode === "production") {
        const legal = await checkLegalAcceptance(admin, user.id);
        if (!legal.ok) {
          return jsonResponse(
            { success: false, error: "legal_acceptance_required", missing: legal.missing },
            412,
          );
        }
        if (!consentId) {
          return jsonResponse({ success: false, error: "consent_required" }, 412);
        }
        // Validate consent receipt belongs to this user, integration, env, and is recent (<10 min).
        const { data: consentRow } = await admin
          .from("integration_consents")
          .select("id, user_id, integration, expected_oauth_app_env, accepted_at, used_for_connection_id")
          .eq("id", consentId)
          .maybeSingle();
        if (
          !consentRow ||
          consentRow.user_id !== user.id ||
          consentRow.integration !== "quickbooks" ||
          consentRow.expected_oauth_app_env !== requestedMode ||
          consentRow.used_for_connection_id ||
          Date.now() - new Date(consentRow.accepted_at as string).getTime() > 10 * 60 * 1000
        ) {
          return jsonResponse({ success: false, error: "consent_invalid_or_expired" }, 412);
        }
      }

      let ctx;
      try {
        ctx = getQboContextForMode(requestedMode);
      } catch (e) {
        const errKey = requestedMode === "production"
          ? "qbo_production_credentials_missing"
          : "qbo_development_credentials_missing";
        return jsonResponse(
          { success: false, error: errKey, details: e instanceof Error ? e.message : String(e) },
          400,
        );
      }

      const state = crypto.randomUUID();
      const { error: stateErr } = await admin.from("qbo_oauth_state").insert({
        state,
        tenant_id: profile.tenant_id,
        requested_mode: requestedMode,
        expected_oauth_app_env: requestedMode,
        consent_id: consentId,
        initiated_by: user.id,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
      if (stateErr) {
        console.error("[qbo-oauth-connect] state insert failed", stateErr);
        return jsonResponse(
          { success: false, error: "qbo_oauth_state_write_failed", details: stateErr.message },
          500,
        );
      }

      const scope = "com.intuit.quickbooks.accounting openid email profile";
      const initiateEndpoints = await getQboOAuthEndpoints(ctx.mode);
      // `prompt=select_account login` forces Intuit to (1) show the account
      // chooser so the tenant can pick which Intuit login to use, and (2)
      // require them to re-enter credentials rather than silently reusing an
      // existing Intuit browser session. Without `select_account`, Intuit will
      // auto-forward to the currently signed-in Intuit account and skip the
      // login page entirely — which is what caused O'Brien Contracting to land
      // inside the Pitch CRM Intuit account instead of their own.
      const authUrl = `${initiateEndpoints.authorization_endpoint}?` + new URLSearchParams({
        client_id: ctx.clientId,
        redirect_uri: ctx.redirectUri,
        response_type: "code",
        scope,
        state,
        prompt: "select_account login",
      });

      return jsonResponse({ authUrl, state, mode: requestedMode });
    }

    // ---------- refresh ----------
    if (action === "refresh") {
      const { data: connection } = await admin
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

      const refreshEndpoints = await getQboOAuthEndpoints(ctx.mode);
      const tokenResp = await fetch(refreshEndpoints.token_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": QBO_USER_AGENT,
          Authorization: basicAuth(ctx.clientId, ctx.clientSecret),
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: connection.refresh_token,
        }),
      });

      const refreshTid = getIntuitTid(tokenResp);
      console.log("[qbo-oauth-connect] refresh response", {
        status: tokenResp.status,
        intuit_tid: refreshTid,
        tenant_id: profile.tenant_id,
        realm_id: connection.realm_id,
      });
      void writeQboApiLog(admin, {
        action: "qbo_token_refresh",
        tenant_id: profile.tenant_id,
        user_id: user.id ?? null,
        connection_id: connection.id,
        realm_id: connection.realm_id,
        oauth_app_env: connection.oauth_app_env,
        endpoint: "/oauth2/v1/tokens/bearer",
        method: "POST",
        http_status: tokenResp.status,
        intuit_tid: refreshTid,
        success: tokenResp.ok,
        request_metadata: { op: "refresh_token" },
      });

      if (!tokenResp.ok) {
        const errBody = await tokenResp.text();
        console.error("[qbo-oauth-connect] refresh failed", {
          status: tokenResp.status,
          intuit_tid: refreshTid,
        });
        // invalid_grant => refresh token revoked/expired; mark connection inactive.
        const isInvalidGrant = tokenResp.status === 400 && /invalid_grant/i.test(errBody);
        if (isInvalidGrant) {
          await admin
            .from("qbo_connections")
            .update({ is_active: false, disconnected_at: new Date().toISOString() })
            .eq("id", connection.id);
          return jsonResponse(
            { success: false, error: "reauth_required", status: tokenResp.status, intuit_tid: refreshTid },
            401,
          );
        }
        return jsonResponse(
          {
            success: false,
            error: "qbo_token_refresh_failed",
            status: tokenResp.status,
            intuit_tid: refreshTid,
            details: errBody.slice(0, 500),
          },
          400,
        );
      }

      const tokens = (await tokenResp.json()) as TokenResponse;
      const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      const refreshExpiresAt = new Date(
        Date.now() + (tokens.x_refresh_token_expires_in ?? 100 * 24 * 3600) * 1000,
      );

      const { error: refreshError } = await admin
        .from("qbo_connections")
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token, // always store the latest
          token_expires_at: tokenExpiresAt.toISOString(),
          expires_at: tokenExpiresAt.toISOString(),
          refresh_token_expires_at: refreshExpiresAt.toISOString(),
          last_refresh_at: new Date().toISOString(),
        })
        .eq("tenant_id", profile.tenant_id)
        .eq("id", connection.id);

      if (refreshError) {
        console.error("[qbo-oauth-connect] refresh update failed", refreshError);
        return jsonResponse(
          { success: false, error: "qbo_connection_write_failed", details: refreshError.message },
          500,
        );
      }

      return jsonResponse({ success: true });
    }

    // ---------- disconnect ----------
    if (action === "disconnect") {
      const { data: connection } = await admin
        .from("qbo_connections")
        .select("id, realm_id, refresh_token, oauth_app_env, is_sandbox")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .maybeSingle();

      if (connection) {
        try {
          const ctx = getQboContextForConnection(connection);
          const revokeEndpoints = await getQboOAuthEndpoints(ctx.mode);
          const revokeResp = await fetch(revokeEndpoints.revocation_endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "User-Agent": QBO_USER_AGENT,
              Authorization: basicAuth(ctx.clientId, ctx.clientSecret),
            },
            body: JSON.stringify({ token: connection.refresh_token }),
          });
          console.log("[qbo-oauth-connect] revoke response", {
            status: revokeResp.status,
            intuit_tid: getIntuitTid(revokeResp),
            tenant_id: profile.tenant_id,
            realm_id: connection.realm_id,
          });
        } catch (e) {
          console.warn("[qbo-oauth-connect] revoke call failed (continuing):", e);
        }
      }

      const { error: disconnectError } = await admin
        .from("qbo_connections")
        .update({ is_active: false, disconnected_at: new Date().toISOString() })
        .eq("tenant_id", profile.tenant_id);

      if (disconnectError) {
        console.error("[qbo-oauth-connect] disconnect failed", disconnectError);
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
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
