// messaging-api — routed Edge Function (consolidation phase 1).
//
// Strategy: real route handlers that delegate to legacy SMS/comms functions
// while preserving table writes, tenant scoping, and provider integrations.
// Logic will be ported inline in a follow-up loop; for now this gives the
// frontend a single domain endpoint and an auth/audit boundary.
//
// See docs/messaging-consolidation-report.md for the migration map.

import { createRouter, jsonOk, jsonErr, userClient, serviceClient, serveRouter } from "../_shared/router.ts";
import { requireAuth, requireTenant } from "../_shared/auth.ts";
import { delegate } from "../_shared/delegate.ts";
import { logAuditAsync } from "../_shared/audit.ts";

const app = createRouter("messaging-api");

// --- public health ---
app.get("/__health", (c) => jsonOk(c, { fn: "messaging-api", ok: true }));

// --- auth required for everything below ---
app.use("/*", requireAuth);
app.use("/*", requireTenant);

// helper: domain audit note
function note(c: any, event: string, details: Record<string, unknown> = {}) {
  logAuditAsync({
    function_name: "messaging-api",
    route: c.get("routePath"),
    method: c.req.method,
    status: 0,
    user_id: c.get("userId") ?? null,
    tenant_id: c.get("tenantId") ?? null,
    request_id: c.get("requestId") ?? null,
    notes: JSON.stringify({ event, ...details }),
  });
}

// =======================================================================
// SMS: outbound send (single)
// Migrated from: telnyx-send-sms (canonical), send-sms, messaging-send-sms
// =======================================================================
app.post("/sms/send", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  note(c, "outbound_sms_sent", { to: body.to, contactId: body.contactId });
  return delegate(c.req.raw, "telnyx-send-sms", "messaging-api", { body });
});

// Backwards-compat alias (frontend `useSendSMS` historic shape)
app.post("/sms/send-legacy", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  note(c, "outbound_sms_sent_legacy", { to: body.to });
  return delegate(c.req.raw, "send-sms", "messaging-api", { body });
});

// =======================================================================
// SMS: thread reply
// Migrated from: sms-send-reply
// =======================================================================
app.post("/sms/reply", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  note(c, "outbound_sms_reply", { conversationId: body.conversation_id, to: body.to });
  return delegate(c.req.raw, "sms-send-reply", "messaging-api", { body });
});

// =======================================================================
// SMS Blast: start/kick (UI invocation of the processor)
// Migrated from: sms-blast-processor (ad-hoc UI kick)
// =======================================================================
app.post("/sms/blast/start", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  note(c, "sms_blast_started", { blast_id: body.blast_id, source: "ui" });
  return delegate(c.req.raw, "sms-blast-processor", "messaging-api", { body });
});

// =======================================================================
// SMS Blast: dry-run preview render
// Migrated from: sms-blast-processor (preview mode)
// =======================================================================
app.post("/sms/blast/preview", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  note(c, "sms_blast_preview", { blast_id: body.blast_id });
  return delegate(c.req.raw, "sms-blast-processor", "messaging-api", {
    body: { ...body, preview: true, dry_run: true },
  });
});

// =======================================================================
// SMS Templates: render with merge vars
// Migrated from: communication-template-engine
// =======================================================================
app.post("/sms/templates/render", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return delegate(c.req.raw, "communication-template-engine", "messaging-api", { body });
});

// =======================================================================
// SMS DNC check
// Migrated from: dnc-scrub (or _shared/dnc/* — keep stable surface)
// =======================================================================
app.post("/sms/dnc/check", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { phone, phones } = body ?? {};
  const list: string[] = phones ?? (phone ? [phone] : []);
  if (list.length === 0) return jsonErr(c, "bad_request", "phone or phones[] required");
  const svc = serviceClient();
  const tenantId = c.get("tenantId");
  const { data, error } = await svc
    .from("opt_outs")
    .select("phone, channel, created_at")
    .in("phone", list)
    .or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
  if (error) return jsonErr(c, "dnc_lookup_failed", error.message, 500);
  const blocked = new Set((data ?? []).map((r: any) => r.phone));
  const results = list.map((p) => ({ phone: p, blocked: blocked.has(p) }));
  if (results.some((r) => r.blocked)) {
    note(c, "dnc_blocked", { count: results.filter((r) => r.blocked).length });
  }
  return jsonOk(c, { results });
});

// =======================================================================
// Multi-channel send (sms/email/voice) — communication-router fan-out
// Migrated from: send-communication, communication-router
// =======================================================================
app.post("/communication/send", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  note(c, "communication_send", { channel: body.channel, contactId: body.contact_id });
  return delegate(c.req.raw, "send-communication", "messaging-api", { body });
});

// =======================================================================
// Conversation: list messages for contact
// Backed directly by sms_messages / inbound_messages tables
// =======================================================================
app.get("/conversations/:contact_id", async (c) => {
  const contactId = c.req.param("contact_id");
  const sb = userClient(c);
  const { data, error } = await sb
    .from("sms_messages")
    .select("*")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) return jsonErr(c, "fetch_failed", error.message, 500);
  return jsonOk(c, { messages: data ?? [] });
});

// =======================================================================
// Conversation: send message in-thread
// Migrated from: sms-send-reply (with contact_id binding)
// =======================================================================
app.post("/conversations/:contact_id/message", async (c) => {
  const contactId = c.req.param("contact_id");
  const body = await c.req.json().catch(() => ({}));
  note(c, "outbound_sms_thread", { contactId });
  return delegate(c.req.raw, "sms-send-reply", "messaging-api", {
    body: { ...body, contact_id: contactId },
  });
});

// =======================================================================
// AI SMS response generation (one-shot)
// Migrated from: sms-conversation-ai, ai-inbound-router (SMS path)
// =======================================================================
app.post("/ai/sms-response", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  note(c, "ai_reply_generated", { contactId: body.contact_id });
  return delegate(c.req.raw, "sms-conversation-ai", "messaging-api", { body });
});

serveRouter(app);
