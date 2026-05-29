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
}
