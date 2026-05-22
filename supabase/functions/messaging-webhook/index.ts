// messaging-webhook — public webhook surface for SMS/messaging providers.
//
// IMPORTANT: provider URLs (Telnyx etc.) historically point at the legacy
// per-function webhook URLs. Those legacy functions still exist and perform
// signature verification + DB writes. This grouped function provides parity
// routes (new providers can be pointed here) by delegating into the legacy
// verified handlers. Signature headers are forwarded verbatim so HMAC
// verification continues to work end-to-end.

import { createRouter, jsonOk, jsonErr } from "../_shared/router.ts";
import { delegate } from "../_shared/delegate.ts";
import { logAuditAsync } from "../_shared/audit.ts";

const app = createRouter("messaging-webhook");

app.get("/__health", (c) => jsonOk(c, { fn: "messaging-webhook", ok: true }));

function note(c: any, event: string, details: Record<string, unknown> = {}) {
  logAuditAsync({
    function_name: "messaging-webhook",
    route: c.get("routePath"),
    method: c.req.method,
    status: 0,
    request_id: c.get("requestId") ?? null,
    notes: JSON.stringify({ event, ...details }),
  });
}

// =====================================================================
// Telnyx inbound SMS — provider POSTs with telnyx-signature-ed25519
// Legacy handler: telnyx-inbound-webhook (does sig verify + sms_messages insert)
// =====================================================================
app.post("/telnyx/inbound", async (c) => {
  note(c, "inbound_sms_received");
  // anon-bearer so legacy fn's own JWT path isn't invoked; sig header passes through.
  return delegate(c.req.raw, "telnyx-inbound-webhook", "messaging-webhook", { anon: true });
});

// =====================================================================
// Telnyx delivery status callback
// Legacy handler: telnyx-sms-status-webhook
// =====================================================================
app.post("/telnyx/status", async (c) => {
  note(c, "sms_status_callback");
  return delegate(c.req.raw, "telnyx-sms-status-webhook", "messaging-webhook", { anon: true });
});

// =====================================================================
// Telnyx call events that touch SMS/contact records
// Legacy handler: telnyx-call-webhook
// =====================================================================
app.post("/telnyx/call-event", async (c) => {
  note(c, "telnyx_call_event");
  return delegate(c.req.raw, "telnyx-call-webhook", "messaging-webhook", { anon: true });
});

// =====================================================================
// Generic inbound (Twilio/SendGrid/etc.) — legacy messaging-inbound-webhook
// =====================================================================
app.post("/generic/inbound", async (c) => {
  note(c, "generic_inbound_received");
  return delegate(c.req.raw, "messaging-inbound-webhook", "messaging-webhook", { anon: true });
});

// Signature failure helper (callable by legacy fns if they want to log here)
app.post("/__sig_failure", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  note(c, "webhook_signature_failure", body);
  return jsonOk(c, { logged: true });
});

Deno.serve(app.fetch);
