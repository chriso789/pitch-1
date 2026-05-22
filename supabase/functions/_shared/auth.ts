// Auth/authorization middleware for routed Edge Functions.
// Re-exports core guards from router.ts plus service-role / internal-secret / webhook-signature guards.

import type { Context, Next } from "jsr:@hono/hono";
import { jsonErr, type RouterEnv } from "./router.ts";

export { requireAuth, requireTenant } from "./router.ts";

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_WORKER_SECRET = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";

/** Require the request to carry the Supabase service-role key. Use on worker/admin routes. */
export async function requireServiceRole(c: Context<RouterEnv>, next: Next) {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!SUPABASE_SERVICE_ROLE_KEY || token !== SUPABASE_SERVICE_ROLE_KEY) {
    return jsonErr(c, "forbidden", "service_role required", 403);
  }
  await next();
}

/** Require an internal worker secret header. Use for pg_cron / function-to-function calls. */
export async function requireInternalSecret(c: Context<RouterEnv>, next: Next) {
  const provided = c.req.header("x-internal-secret") ?? "";
  if (!INTERNAL_WORKER_SECRET || provided !== INTERNAL_WORKER_SECRET) {
    return jsonErr(c, "forbidden", "internal_secret required", 403);
  }
  await next();
}

/**
 * Verify a webhook HMAC signature. Provider-specific verification fns live in their
 * own _shared/* helper (e.g. telnyx, stripe). This is a generic HMAC-SHA256 base check.
 */
export async function verifyHmacSha256(rawBody: string, signature: string, secret: string): Promise<boolean> {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time-ish compare
  const a = hex;
  const b = signature.replace(/^sha256=/, "").toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
