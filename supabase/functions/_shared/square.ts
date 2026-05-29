// _shared/square.ts — server-only Square API helper.
//
// Tokens live in `tenant_square_accounts` and are accessed via the service-role
// Supabase client. They are NEVER returned to the browser. All helpers here run
// inside Edge Functions and must be called from authenticated tenant routes
// (or signature-verified webhooks).
//
// Collection is intentionally DISABLED at this phase — `createSquareInvoicePaymentLink`
// throws `square_collection_disabled` until Phase 2 (OAuth UI + hosted link wiring)
// ships. The helper exists so the canonical `/create-invoice-payment-link` route
// can dispatch by provider today without a second refactor tomorrow.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type SquareEnvironment = "sandbox" | "production";

export interface TenantSquareAccount {
  tenant_id: string;
  environment: SquareEnvironment;
  access_token: string;
  refresh_token: string | null;
  access_token_expires_at: string | null;
  merchant_id: string;
  merchant_name: string | null;
  selected_location_id: string | null;
  status: string;
}

export interface SquareInvoicePaymentLinkRequest {
  tenantId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  description: string;
  buyerEmail?: string | null;
  metadata?: Record<string, string>;
}

export interface SquareInvoicePaymentLinkResult {
  provider: "square";
  provider_order_id: string;
  provider_payment_link_id: string;
  url: string;
  amountCents: number;
  currency: string;
}

const SQUARE_API_VERSION = "2024-09-19";

/** Resolve a tenant's Square credentials from the service-role client. */
export async function getTenantSquareAccount(
  service: SupabaseClient,
  tenantId: string,
): Promise<TenantSquareAccount | null> {
  const { data, error } = await service
    .from("tenant_square_accounts")
    .select(
      "tenant_id, environment, access_token, refresh_token, access_token_expires_at, merchant_id, merchant_name, selected_location_id, status",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    console.error("[square] getTenantSquareAccount error", error);
    return null;
  }
  return (data as TenantSquareAccount | null) ?? null;
}

/** Square API base URL for the given environment. */
export function squareApiBase(env: SquareEnvironment): string {
  return env === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

/** Low-level Square fetch helper. Never logs the access token. */
export async function squareFetch(
  account: TenantSquareAccount,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${squareApiBase(account.environment)}${path}`;
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${account.access_token}`);
  headers.set("Square-Version", SQUARE_API_VERSION);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}

/**
 * Create a hosted payment link for an invoice.
 *
 * DISABLED in this phase. The canonical route still routes through here so the
 * dispatch surface is stable; we just refuse until OAuth + collection are wired.
 */
export async function createSquareInvoicePaymentLink(
  _service: SupabaseClient,
  _req: SquareInvoicePaymentLinkRequest,
): Promise<SquareInvoicePaymentLinkResult> {
  throw new Error("square_collection_disabled");
}

/** Verify a Square webhook signature (HMAC-SHA-256 over notificationUrl + body). */
export async function verifySquareWebhookSignature(opts: {
  signatureHeader: string | null;
  notificationUrl: string;
  body: string;
  signatureKey: string;
}): Promise<boolean> {
  if (!opts.signatureHeader || !opts.signatureKey) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(opts.signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(opts.notificationUrl + opts.body),
  );
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64 === opts.signatureHeader;
  return b64 === opts.signatureHeader;
}

// ============================================================
// OAuth helpers
// ============================================================

export interface SquareOAuthEnvConfig {
  appId: string;
  appSecret: string;
  environment: SquareEnvironment;
  redirectUri: string;
  webhookSignatureKey: string;
}

export function loadSquareOAuthConfig(envOverride?: SquareEnvironment): SquareOAuthEnvConfig {
  const environment =
    (envOverride ??
      (Deno.env.get("SQUARE_ENVIRONMENT") as SquareEnvironment | undefined) ??
      "sandbox") as SquareEnvironment;
  const appId =
    (environment === "production"
      ? Deno.env.get("SQUARE_APP_ID_PRODUCTION")
      : Deno.env.get("SQUARE_APP_ID_SANDBOX")) ??
    Deno.env.get("SQUARE_APP_ID") ??
    "";
  const appSecret =
    (environment === "production"
      ? Deno.env.get("SQUARE_APP_SECRET_PRODUCTION")
      : Deno.env.get("SQUARE_APP_SECRET_SANDBOX")) ??
    Deno.env.get("SQUARE_APP_SECRET") ??
    "";
  const redirectUri =
    Deno.env.get("SQUARE_OAUTH_REDIRECT_URI") ??
    `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/payment-api/square/oauth/callback`;
  const webhookSignatureKey = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY") ?? "";
  return { appId, appSecret, environment, redirectUri, webhookSignatureKey };
}

export function squareOAuthAuthorizeBase(env: SquareEnvironment): string {
  // OAuth authorize lives on the merchant-facing domain.
  return env === "production"
    ? "https://connect.squareup.com/oauth2/authorize"
    : "https://connect.squareupsandbox.com/oauth2/authorize";
}

export const SQUARE_OAUTH_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_READ",
  "PAYMENTS_WRITE",
  "ORDERS_READ",
  "ORDERS_WRITE",
  "ITEMS_READ",
  "CUSTOMERS_READ",
  "CUSTOMERS_WRITE",
];

function bytesToB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function hmacSign(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return bytesToB64Url(new Uint8Array(sig));
}

export interface SquareOAuthState {
  tenantId: string;
  userId: string;
  env: SquareEnvironment;
  nonce: string;
  exp: number; // unix seconds
}

/** Sign a state payload as a short HMAC token (payload.signature) — no secret in browser. */
export async function signSquareOAuthState(state: SquareOAuthState, key: string): Promise<string> {
  const payload = bytesToB64Url(new TextEncoder().encode(JSON.stringify(state)));
  const sig = await hmacSign(key, payload);
  return `${payload}.${sig}`;
}

export async function verifySquareOAuthState(token: string, key: string): Promise<SquareOAuthState | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await hmacSign(key, payload);
  if (expected !== sig) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64UrlToBytes(payload))) as SquareOAuthState;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface SquareTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  merchant_id: string;
  token_type: string;
  scope?: string;
}

/** Exchange authorization code for OAuth tokens. */
export async function exchangeSquareOAuthCode(
  cfg: SquareOAuthEnvConfig,
  code: string,
): Promise<SquareTokenResponse> {
  const res = await fetch(`${squareApiBase(cfg.environment)}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": SQUARE_API_VERSION },
    body: JSON.stringify({
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: cfg.redirectUri,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`square_token_exchange_failed:${res.status}:${t.slice(0, 300)}`);
  }
  return (await res.json()) as SquareTokenResponse;
}

/** Refresh an expired access token. */
export async function refreshSquareAccessToken(
  cfg: SquareOAuthEnvConfig,
  refreshToken: string,
): Promise<SquareTokenResponse> {
  const res = await fetch(`${squareApiBase(cfg.environment)}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": SQUARE_API_VERSION },
    body: JSON.stringify({
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`square_token_refresh_failed:${res.status}:${t.slice(0, 300)}`);
  }
  return (await res.json()) as SquareTokenResponse;
}

/** Revoke an OAuth authorization at Square (used on disconnect). */
export async function revokeSquareOAuthToken(
  cfg: SquareOAuthEnvConfig,
  accessToken: string,
  merchantId: string,
): Promise<boolean> {
  const res = await fetch(`${squareApiBase(cfg.environment)}/oauth2/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Square-Version": SQUARE_API_VERSION,
      "Authorization": `Client ${cfg.appSecret}`,
    },
    body: JSON.stringify({
      client_id: cfg.appId,
      access_token: accessToken,
      merchant_id: merchantId,
    }),
  });
  return res.ok;
}

export interface SquareLocation {
  id: string;
  name: string;
  status: string;
  currency: string;
}

/** List merchant locations using current access token. */
export async function listSquareLocations(account: TenantSquareAccount): Promise<SquareLocation[]> {
  const res = await squareFetch(account, "/v2/locations");
  if (!res.ok) throw new Error(`square_locations_failed:${res.status}`);
  const json = await res.json();
  return (json.locations ?? []).map((l: Record<string, unknown>) => ({
    id: String(l.id ?? ""),
    name: String(l.name ?? ""),
    status: String(l.status ?? ""),
    currency: String(l.currency ?? "USD"),
  }));
}

/** Safe DTO of a tenant's Square account — never contains tokens. */
export function redactSquareAccount(a: TenantSquareAccount | null) {
  if (!a) return { connected: false as const, status: "disconnected" as const };
  const needsReauth = a.status === "needs_reauth";
  return {
    connected: a.status === "connected" && !!a.access_token,
    status: a.status,
    needs_reauth: needsReauth,
    environment: a.environment,
    merchant_id: a.merchant_id ?? null,
    merchant_name: a.merchant_name ?? null,
    selected_location_id: a.selected_location_id ?? null,
    access_token_expires_at: a.access_token_expires_at ?? null,
  };
}

