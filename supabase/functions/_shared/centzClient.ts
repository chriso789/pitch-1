// Centz API v3.1 client — used by payment-api Centz routes and centz-webhook.
//
// - Auth header: `x-access-token` (NOT Authorization: Bearer)
// - Stage base:      https://stage-api.centz.com
// - Production base: https://api.centz.com
// - Version path:    /api/v3.1
//
// Per-tenant credentials are loaded from public.centz_connections.
// Some endpoint variants take {site_id} / {merchant_id} / {external_id} —
// keep path templates editable via the connection row (api_version_path)
// and env overrides so Centz route variants can be tuned without code edits.

import { type SupabaseClient } from "npm:@supabase/supabase-js@2";

export type CentzEnv = "stage" | "production";

export interface CentzConnection {
  id: string;
  tenant_id: string;
  environment: CentzEnv;
  api_access_token: string;
  api_version_path: string;
  agency_external_id: string | null;
  agency_name: string | null;
  site_external_id: string | null;
  site_centz_id: string | null;
  merchant_id: string | null;
  webhook_url: string | null;
  active: boolean;
}

export interface CentzResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

const STAGE_BASE = Deno.env.get("CENTZ_STAGE_BASE_URL") ?? "https://stage-api.centz.com";
const PROD_BASE = Deno.env.get("CENTZ_PRODUCTION_BASE_URL") ?? "https://api.centz.com";

/** Default path templates. Override per-call when Centz docs prescribe variants. */
export const CENTZ_PATHS = {
  siteEnterpriseAddUpdate:
    Deno.env.get("CENTZ_SITE_ENTERPRISE_ADD_UPDATE_PATH") ?? "/api/v3.1/siteEnterprise/addUpdate",
  siteGroupAddUpdate:
    Deno.env.get("CENTZ_SITE_GROUP_ADD_UPDATE_PATH") ?? "/api/v3.1/siteGroup/addUpdate",
  siteAddUpdate: Deno.env.get("CENTZ_SITE_ADD_UPDATE_PATH") ?? "/api/v3.1/site/addUpdate",
  invoiceAddUpdate:
    Deno.env.get("CENTZ_INVOICE_ADD_UPDATE_PATH") ?? "/api/v3.1/invoice/addUpdate",
  invoiceSend: Deno.env.get("CENTZ_INVOICE_SEND_PATH") ?? "/api/v3.1/invoice/send",
  invoiceGet: Deno.env.get("CENTZ_INVOICE_GET_PATH") ?? "/api/v3.1/invoice/{external_id}",
  invoicesList: Deno.env.get("CENTZ_INVOICES_GET_PATH") ?? "/api/v3.1/invoices",
};

export function centzBaseUrl(env: CentzEnv): string {
  return env === "production" ? PROD_BASE : STAGE_BASE;
}

/** Replace `{site_id}`, `{merchant_id}`, `{external_id}` placeholders. */
export function centzPath(template: string, params: Record<string, string | undefined> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = params[key];
    if (v === undefined || v === null || v === "") {
      throw new Error(`centzPath: missing param '${key}' for template ${template}`);
    }
    return encodeURIComponent(v);
  });
}

/**
 * Load the per-tenant Centz connection. Throws when no active connection exists.
 * Service-role client only — never call from authenticated client code.
 */
export async function loadCentzConnection(
  svc: SupabaseClient,
  tenantId: string,
  environment?: CentzEnv,
): Promise<CentzConnection> {
  let query = svc
    .from("centz_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (environment) query = query.eq("environment", environment);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw new Error(`centz_connection_lookup_failed: ${error.message}`);
  if (!data) throw new Error("centz_not_connected");
  return data as CentzConnection;
}

export interface CentzRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathTemplate: string;
  pathParams?: Record<string, string | undefined>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/**
 * Send a Centz API request using a tenant connection.
 *
 * Always uses `x-access-token` header. Returns parsed JSON (or text fallback)
 * plus the raw status. Non-2xx responses are returned with ok=false so callers
 * can decide whether to persist or surface a structured error — they do not
 * throw automatically.
 */
export async function centzRequest<T = unknown>(
  conn: CentzConnection,
  opts: CentzRequestOptions,
): Promise<CentzResult<T>> {
  if (!conn.api_access_token) throw new Error("centz_token_missing");
  const path = centzPath(opts.pathTemplate, opts.pathParams ?? {});
  const url = new URL(`${centzBaseUrl(conn.environment)}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const method = opts.method ?? "POST";
  const res = await fetch(url.toString(), {
    method,
    headers: {
      "x-access-token": conn.api_access_token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: opts.body !== undefined && method !== "GET" ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { ok: res.ok, status: res.status, data: parsed as T };
}

/** Convenience helpers */
export const centzPost = <T = unknown>(
  conn: CentzConnection,
  pathTemplate: string,
  body: unknown,
  pathParams?: Record<string, string | undefined>,
) => centzRequest<T>(conn, { method: "POST", pathTemplate, body, pathParams });

export const centzGet = <T = unknown>(
  conn: CentzConnection,
  pathTemplate: string,
  pathParams?: Record<string, string | undefined>,
  query?: Record<string, string | number | undefined>,
) => centzRequest<T>(conn, { method: "GET", pathTemplate, pathParams, query });

// ---------- money + payload helpers ----------

export function centsToDecimal(cents: number): number {
  return Math.round(cents) / 100;
}

/** Validate Centz invoice line/total math per v3.1 rules. */
export function validateInvoiceTotals(lines: Array<{ qty: number; unit_price: number; total: number }>, totalsTotal: number): { ok: true } | { ok: false; error: string } {
  for (const [i, ln] of lines.entries()) {
    const expected = Math.round(ln.qty * ln.unit_price * 100) / 100;
    if (Math.abs(expected - ln.total) > 0.01) {
      return { ok: false, error: `line ${i} total ${ln.total} != qty*unit_price ${expected}` };
    }
  }
  const sum = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
  if (Math.abs(sum - totalsTotal) > 0.01) {
    return { ok: false, error: `totals.total ${totalsTotal} != sum(lines) ${sum}` };
  }
  return { ok: true };
}

/** Status mapping from Centz payment/event payloads to local centz_invoices.status */
export function mapCentzPaymentStatus(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (["captured", "paid", "succeeded", "completed", "success"].includes(s)) return "paid";
  if (["failed", "declined", "error"].includes(s)) return "failed";
  if (["cancelled", "canceled"].includes(s)) return "cancelled";
  if (["refunded", "refund"].includes(s)) return "refunded";
  if (["chargeback", "dispute"].includes(s)) return "chargeback";
  if (["partial", "partially_paid"].includes(s)) return "partially_paid";
  return null;
}
