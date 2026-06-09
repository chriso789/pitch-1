// Shared Hono router factory for routed Edge Functions.
// Provides: CORS, request id, auth guard, tenant guard, audit logging, consistent JSON envelope.
//
// Usage in a function's index.ts:
//   import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant } from "../_shared/router.ts";
//   const app = createRouter("messaging-api");
//   app.post("/sms/send", async (c) => { ... return jsonOk(c, { id }); });
//   Deno.serve(app.fetch);

import { Hono, type Context, type Next } from "jsr:@hono/hono";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-route, x-shim-from",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export type RouterEnv = {
  Variables: {
    functionName: string;
    requestId: string;
    startedAt: number;
    userId?: string;
    tenantId?: string;
    claims?: Record<string, unknown>;
    routePath: string;
  };
};

export function createRouter(functionName: string) {
  const app = new Hono<RouterEnv>();

  // CORS preflight + headers. Note: `supabase.functions.invoke(fn, { body })` hits the function
  // root path (`/`), so frontend callers must use the `edgeApi` helper which constructs a full
  // `/functions/v1/<fn><route>` URL via fetch. Legacy shims also use that full-URL path.
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    c.set("functionName", functionName);
    c.set("requestId", crypto.randomUUID());
    c.set("startedAt", Date.now());
    c.set("routePath", new URL(c.req.url).pathname);
    await next();
    for (const [k, v] of Object.entries(corsHeaders)) c.res.headers.set(k, v);
  });

  // After-response audit log (best-effort, never throws)
  app.use("*", async (c, next) => {
    await next();
    try {
      const latency = Date.now() - c.get("startedAt");
      const shimFrom = c.req.header("x-shim-from") ?? null;
      logAuditAsync({
        function_name: functionName,
        route: c.get("routePath"),
        method: c.req.method,
        user_id: c.get("userId") ?? null,
        tenant_id: c.get("tenantId") ?? null,
        status: c.res.status,
        latency_ms: latency,
        request_id: c.get("requestId"),
        shim_from: shimFrom,
      });
    } catch {/* swallow */}
  });


  // Default 404 → not_migrated envelope so scaffolded routes are obvious
  app.notFound((c) => {
    const u = new URL(c.req.url);
    return c.json({
      ok: false,
      error: "Route not registered on this function.",
      code: "route_not_found",
      debug_pathname: u.pathname,
      debug_method: c.req.method,
      requestId: c.get("requestId"),
    }, 404);
  });

  app.onError((err, c) => {
    console.error(`[${functionName}] error:`, err);
    return jsonErr(c, "internal_error", err instanceof Error ? err.message : String(err), 500);
  });

  return app;
}

/**
 * Start a routed Edge Function with x-route / __route dispatching.
 *
 * Frontend `edgeApi(fn, route, body)` and `supabase.functions.invoke(fn, { body })`
 * always POST to the function root. This wrapper inspects the `x-route` header
 * (or `__route` body field) and rewrites the URL so Hono routes like
 * `app.post("/ingest/upload", ...)` actually match. Direct HTTP calls with a real
 * pathname (legacy shims, provider webhooks) pass through unchanged.
 */
export function serveRouter(app: Hono<RouterEnv>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return app.fetch(req);

    const url = new URL(req.url);
    // Supabase Edge Runtime delivers either "/" or "/<function-name>" for root invokes.
    const isRoot = url.pathname === "/" || url.pathname === "" || /^\/[^/]+\/?$/.test(url.pathname);

    if (!isRoot) return app.fetch(req);

    let route = req.headers.get("x-route") ?? "";
    let bodyBytes: Uint8Array | null = null;
    const mayHaveBody = req.method !== "GET" && req.method !== "HEAD";

    if (mayHaveBody) {
      bodyBytes = new Uint8Array(await req.arrayBuffer());
      if (!route) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(bodyBytes));
          if (parsed && typeof parsed.__route === "string") route = parsed.__route;
        } catch { /* non-JSON body, leave route blank */ }
      }
    }

    if (!route) {
      if (bodyBytes) {
        return app.fetch(new Request(req.url, { method: req.method, headers: req.headers, body: bodyBytes }));
      }
      return app.fetch(req);
    }

    const normalized = route.startsWith("/") ? route : `/${route}`;
    const newUrl = new URL(req.url);
    newUrl.pathname = normalized;
    const newReq = new Request(newUrl.toString(), {
      method: req.method,
      headers: req.headers,
      body: bodyBytes ?? undefined,
    });
    return app.fetch(newReq);
  });
}

// ---- response helpers ----
export function jsonOk<T>(c: Context<RouterEnv>, data: T, status = 200) {
  return c.json({ ok: true, data, requestId: c.get("requestId") }, status);
}
export function jsonErr(c: Context<RouterEnv>, code: string, message: string, status = 400) {
  return c.json({ ok: false, error: message, code, requestId: c.get("requestId") }, status);
}

// ---- supabase clients ----
export function userClient(c: Context<RouterEnv>): SupabaseClient {
  const auth = c.req.header("Authorization") ?? "";
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---- auth + tenant middleware ----
export async function requireAuth(c: Context<RouterEnv>, next: Next) {
  const auth = c.req.header("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return jsonErr(c, "unauthorized", "Missing bearer token", 401);
  const token = auth.slice(7);
  const sb = userClient(c);
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims) return jsonErr(c, "unauthorized", "Invalid token", 401);
  c.set("claims", data.claims as Record<string, unknown>);
  c.set("userId", String(data.claims.sub));
  await next();
}

export async function requireTenant(c: Context<RouterEnv>, next: Next) {
  const userId = c.get("userId");
  if (!userId) return jsonErr(c, "unauthorized", "Auth required before tenant resolution", 401);
  // Resolve effective tenant via the existing helper RPC if present, else direct read.
  const svc = serviceClient();
  const { data, error } = await svc
    .from("user_company_access")
    .select("tenant_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error || !data?.tenant_id) return jsonErr(c, "no_tenant", "No tenant access for user", 403);
  c.set("tenantId", String(data.tenant_id));
  await next();
}

// ---- audit ----
function logAuditAsync(row: Record<string, unknown>) {
  // Fire-and-forget; failures must not affect response.
  try {
    const svc = serviceClient();
    svc.from("edge_function_audit").insert(row).then(() => {}, () => {});
  } catch {/* swallow */}
}
