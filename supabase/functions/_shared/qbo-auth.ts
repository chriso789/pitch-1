// Shared QuickBooks Online auth + token-hygiene helpers (Phase 1 of QBO Blueprint).
//
// Responsibilities:
//  - Build OAuth authorize URLs and exchange authorization codes.
//  - Persist tokens to public.qbo_connections with refresh-token rollover.
//  - Return a valid access token on demand, refreshing ≥5 min before expiry.
//  - Track 100-day refresh-token reauth window.
//
// NOTE: At this phase tokens are stored as-is (matches existing schema). Field-
// level encryption (pgsodium) is a follow-up; the column names are already
// future-proofed via the `*_encrypted` accessor below.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.1";
import {
  getQboContextForConnection,
  getQboContextForMode,
  getDefaultQboMode,
  type QboContext,
} from "./qbo-context.ts";

export const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QBO_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export const QBO_DEFAULT_SCOPES = "com.intuit.quickbooks.accounting openid email profile";

const REFRESH_SKEW_SECONDS = 5 * 60;

export interface QboTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type?: string;
}

export interface QboConnectionRow {
  id: string;
  tenant_id: string;
  realm_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  scopes: string[] | string | null;
  is_active: boolean;
  qbo_company_name: string | null;
  oauth_app_env?: string | null;
  is_sandbox?: boolean | null;
}

/**
 * @deprecated Use getQboContextForConnection(conn) or getQboContextForMode(mode) instead.
 * Returns the default-mode context for backwards compatibility.
 */
export function getQboEnv() {
  const ctx = getQboContextForMode(getDefaultQboMode());
  return {
    clientId: ctx.clientId,
    clientSecret: ctx.clientSecret,
    redirectUri: ctx.redirectUri,
    environment: ctx.mode,
    apiBase: ctx.accountingBaseUrl,
  };
}

function basicAuthHeader(clientId: string, clientSecret: string) {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

export function buildAuthorizeUrl(opts: {
  state: string;
  scopes?: string;
}) {
  const { clientId, redirectUri } = getQboEnv();
  const url = new URL(QBO_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", opts.scopes ?? QBO_DEFAULT_SCOPES);
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export async function exchangeAuthorizationCode(
  code: string,
  ctx?: QboContext,
): Promise<QboTokenResponse> {
  const c = ctx ?? getQboContextForMode(getDefaultQboMode());
  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: basicAuthHeader(c.clientId, c.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: c.redirectUri,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`QBO token exchange failed [${res.status}]: ${body}`);
  }
  return (await res.json()) as QboTokenResponse;
}

export class QboReauthRequiredError extends Error {
  constructor(message = "QuickBooks reauthorization required") {
    super(message);
    this.name = "QboReauthRequiredError";
  }
}

export async function refreshAccessToken(
  refreshToken: string,
  ctx?: QboContext,
): Promise<QboTokenResponse> {
  const c = ctx ?? getQboContextForMode(getDefaultQboMode());
  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: basicAuthHeader(c.clientId, c.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // invalid_grant => refresh token revoked/expired by Intuit; surface as reauth.
    if (res.status === 400 && /invalid_grant/i.test(body)) {
      throw new QboReauthRequiredError(`QBO refresh rejected (invalid_grant): ${body}`);
    }
    throw new Error(`QBO token refresh failed [${res.status}]: ${body}`);
  }
  return (await res.json()) as QboTokenResponse;
}

function computeExpiries(tokens: QboTokenResponse) {
  const now = Date.now();
  return {
    token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(
      now + (tokens.x_refresh_token_expires_in ?? 100 * 24 * 3600) * 1000,
    ).toISOString(),
  };
}

/**
 * Persist a freshly-issued (or refreshed) token bundle for a given tenant+realm.
 * Always rolls over the refresh token — Intuit's docs require storing the latest one.
 */
export async function persistTokens(
  service: SupabaseClient,
  args: {
    tenant_id: string;
    realm_id: string;
    tokens: QboTokenResponse;
    connected_by?: string | null;
    qbo_company_name?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const exp = computeExpiries(args.tokens);
  const row = {
    tenant_id: args.tenant_id,
    realm_id: args.realm_id,
    access_token: args.tokens.access_token,
    refresh_token: args.tokens.refresh_token,
    token_expires_at: exp.token_expires_at,
    refresh_token_expires_at: exp.refresh_token_expires_at,
    expires_at: exp.token_expires_at, // keep legacy column in sync
    last_refresh_at: new Date().toISOString(),
    scopes: QBO_DEFAULT_SCOPES.split(" "),
    is_active: true,
    disconnected_at: null,
    ...(args.connected_by ? { connected_by: args.connected_by } : {}),
    ...(args.qbo_company_name ? { qbo_company_name: args.qbo_company_name } : {}),
    ...(args.metadata ? { metadata: args.metadata } : {}),
  };

  const { data, error } = await service
    .from("qbo_connections")
    .upsert(row, { onConflict: "tenant_id,realm_id" })
    .select()
    .single();
  if (error) throw new Error(`Failed to persist QBO tokens: ${error.message}`);
  return data as QboConnectionRow;
}

/**
 * Returns a valid access token for the active connection of `tenant_id`,
 * refreshing in-place (with rollover) if expiry is within the skew window.
 *
 * MUST be called from an edge function with the service role client so it can
 * read/update tokens regardless of caller RLS.
 */
export async function getValidAccessToken(
  service: SupabaseClient,
  tenant_id: string,
): Promise<{ access_token: string; realm_id: string; connection: QboConnectionRow }> {
  const { data: conn, error } = await service
    .from("qbo_connections")
    .select("*")
    .eq("tenant_id", tenant_id)
    .eq("is_active", true)
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load QBO connection: ${error.message}`);
  if (!conn) throw new Error("No active QuickBooks connection for this tenant");

  const c = conn as QboConnectionRow & { refresh_token_expires_at: string | null };

  const refreshExp = c.refresh_token_expires_at ? Date.parse(c.refresh_token_expires_at) : 0;
  if (refreshExp && refreshExp < Date.now()) {
    throw new Error("QBO refresh token has expired — user must reconnect QuickBooks");
  }

  const expiresAt = c.token_expires_at ? Date.parse(c.token_expires_at) : 0;
  const needsRefresh = !expiresAt || expiresAt - Date.now() < REFRESH_SKEW_SECONDS * 1000;

  if (!needsRefresh) {
    return { access_token: c.access_token, realm_id: c.realm_id, connection: c };
  }

  const refreshed = await refreshAccessToken(c.refresh_token, getQboContextForConnection(c));
  const updated = await persistTokens(service, {
    tenant_id: c.tenant_id,
    realm_id: c.realm_id,
    tokens: refreshed,
  });
  return { access_token: updated.access_token, realm_id: updated.realm_id, connection: updated };
}

export async function fetchCompanyInfo(
  accessToken: string,
  realmId: string,
  connection?: { is_sandbox?: boolean | null; oauth_app_env?: string | null },
) {
  const ctx = connection ? getQboContextForConnection(connection) : getQboContextForMode(getDefaultQboMode());
  const res = await fetch(
    `${ctx.accountingBaseUrl}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
  );
  if (!res.ok) return null;
  return await res.json();
}

export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
}

export async function revokeConnection(service: SupabaseClient, tenant_id: string) {
  const { data: conn } = await service
    .from("qbo_connections")
    .select("id, refresh_token, oauth_app_env, is_sandbox")
    .eq("tenant_id", tenant_id)
    .eq("is_active", true)
    .maybeSingle();
  if (!conn) return;

  try {
    const ctx = getQboContextForConnection(conn);
    await fetch(QBO_REVOKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: basicAuthHeader(ctx.clientId, ctx.clientSecret),
      },
      body: JSON.stringify({ token: (conn as { refresh_token: string }).refresh_token }),
    });
  } catch (e) {
    console.warn("QBO revoke call failed (continuing):", e);
  }

  await service
    .from("qbo_connections")
    .update({ is_active: false, disconnected_at: new Date().toISOString() })
    .eq("id", (conn as { id: string }).id);
}
