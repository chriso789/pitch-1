// Shared shim helper for deprecated QBO edge functions.
// Purpose: keep old invoke paths alive during migration but force
//   - authenticated user
//   - server-derived tenant (never body tenant_id / realm_id)
//   - single source of truth: qbo-worker
//
// Emits a deprecation log and a X-Deprecation response header on every call.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-route, x-tenant-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

export interface ShimForwardArgs {
  op: string;
  /** Sanitized args to forward. tenant_id / realm_id are stripped before this is called. */
  args: Record<string, unknown>;
  /** Name of the legacy function, for logging. */
  legacyName: string;
  /** Route the tenant/realm/id fields the caller *tried* to pass so we can reject/log them. */
  rejectedFields?: string[];
}

export function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "X-Deprecation": "This endpoint is deprecated. Use qbo-worker with { op, args }.",
      ...extraHeaders,
    },
  });
}

/** Require an Authorization: Bearer header and validate against Supabase Auth. */
export async function requireAuthedUser(
  req: Request,
): Promise<
  | { ok: true; userId: string; bearer: string }
  | { ok: false; res: Response }
> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      res: jsonResponse(
        { ok: false, error: "unauthorized", code: "missing_bearer" },
        401,
      ),
    };
  }
  const token = authHeader.slice(7);
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return {
      ok: false,
      res: jsonResponse(
        { ok: false, error: "unauthorized", code: "invalid_token" },
        401,
      ),
    };
  }
  return { ok: true, userId: String(data.claims.sub), bearer: token };
}

/**
 * Strip client-supplied tenant/realm fields. Returns the sanitized body plus
 * a list of rejected field names (for logging and header emission).
 */
export function stripTenantAndRealm(
  body: Record<string, unknown>,
): { clean: Record<string, unknown>; rejected: string[] } {
  const rejected: string[] = [];
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const kl = k.toLowerCase();
    if (kl === "tenant_id" || kl === "tenantid" || kl === "realm_id" || kl === "realmid") {
      rejected.push(k);
      continue;
    }
    clean[k] = v;
  }
  return { clean, rejected };
}

/** Forward to qbo-worker with the caller's bearer token; tenant is resolved server-side inside qbo-worker. */
export async function forwardToQboWorker(
  bearer: string,
  op: string,
  args: Record<string, unknown>,
  legacyName: string,
  rejectedFields: string[],
): Promise<Response> {
  const url = `${SUPABASE_URL}/functions/v1/qbo-worker`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      "X-Legacy-Shim": legacyName,
    },
    body: JSON.stringify({ op, args }),
  });
  const text = await res.text();
  console.log(
    `[qbo-shim] legacy=${legacyName} → op=${op} status=${res.status} rejected_fields=${rejectedFields.join(",") || "none"}`,
  );
  return new Response(text, {
    status: res.status,
    headers: {
      ...corsHeaders,
      "Content-Type": res.headers.get("Content-Type") ?? "application/json",
      "X-Deprecation": `Use qbo-worker { op: "${op}" } instead of ${legacyName}.`,
      "X-Rejected-Body-Fields": rejectedFields.join(",") || "",
    },
  });
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
