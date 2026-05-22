// messaging-worker — internal/cron routes for the messaging domain.
//
// Auth: requires either Supabase service-role bearer OR x-internal-secret.
// All routes delegate to legacy processors so cron/scheduled jobs continue
// firing while logic is ported inline in a follow-up loop.

import type { Context, Next } from "jsr:@hono/hono";
import { createRouter, jsonOk, jsonErr, type RouterEnv } from "../_shared/router.ts";
import { delegate } from "../_shared/delegate.ts";
import { logAuditAsync } from "../_shared/audit.ts";

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_WORKER_SECRET = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";

const app = createRouter("messaging-worker");

app.get("/__health", (c) => jsonOk(c, { fn: "messaging-worker", ok: true }));

// Service-role OR internal-secret guard (workers are called by pg_cron, edge
// functions, or admin tools — never by end users).
async function requireWorkerAuth(c: Context<RouterEnv>, next: Next) {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const secret = c.req.header("x-internal-secret") ?? "";
  const okService = !!SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY;
  const okSecret = !!INTERNAL_WORKER_SECRET && secret === INTERNAL_WORKER_SECRET;
  if (!okService && !okSecret) return jsonErr(c, "forbidden", "worker_auth_required", 403);
  await next();
}

app.use("/*", requireWorkerAuth);

function note(c: any, event: string, details: Record<string, unknown> = {}) {
  logAuditAsync({
    function_name: "messaging-worker",
    route: c.get("routePath"),
    method: c.req.method,
    status: 0,
    request_id: c.get("requestId") ?? null,
    notes: JSON.stringify({ event, ...details }),
  });
}

// =====================================================================
// Blast processor tick — sms-blast-processor (cron, no body)
// =====================================================================
app.post("/blast/process", async (c) => {
  note(c, "blast_tick");
  return delegate(c.req.raw, "sms-blast-processor", "messaging-worker", { serviceRole: true });
});

// =====================================================================
// Outbound queue processor — messaging-queue-processor
// =====================================================================
app.post("/queue/process", async (c) => {
  note(c, "queue_tick");
  return delegate(c.req.raw, "messaging-queue-processor", "messaging-worker", { serviceRole: true });
});

// =====================================================================
// AI follow-up worker — SMS path only
// =====================================================================
app.post("/followup/process", async (c) => {
  note(c, "followup_tick");
  return delegate(c.req.raw, "ai-followup-worker", "messaging-worker", { serviceRole: true });
});

// =====================================================================
// Delivery retry — kicks the blast processor for stuck items
// =====================================================================
app.post("/delivery/retry", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  note(c, "delivery_retry", { blast_id: body.blast_id });
  return delegate(c.req.raw, "sms-blast-processor", "messaging-worker", {
    body: { ...body, retry: true },
    serviceRole: true,
  });
});

// =====================================================================
// DNC scrub batch — defensive, uses opt_outs table directly
// =====================================================================
app.post("/dnc/scrub-batch", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const phones: string[] = Array.isArray(body.phones) ? body.phones : [];
  if (phones.length === 0) return jsonErr(c, "bad_request", "phones[] required");
  // Lightweight inline implementation (no legacy fn).
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    SUPABASE_SERVICE_ROLE_KEY,
  );
  const { data, error } = await sb
    .from("opt_outs")
    .select("phone")
    .in("phone", phones);
  if (error) return jsonErr(c, "dnc_scrub_failed", error.message, 500);
  const blocked = new Set((data ?? []).map((r: any) => r.phone));
  const clean = phones.filter((p) => !blocked.has(p));
  note(c, "dnc_scrub", { in: phones.length, blocked: blocked.size, clean: clean.length });
  return jsonOk(c, { blocked: [...blocked], clean });
});

Deno.serve(app.fetch);
