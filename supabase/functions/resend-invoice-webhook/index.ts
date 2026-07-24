// Phase 2 Slice B — resend-invoice-webhook
// Dedicated webhook endpoint for Resend events tied to invoice_email_deliveries.
// Verifies Svix signature and dedupes on provider_event_id. Never modifies QBO
// or accounting state. Does not touch communication_history/onboarding logs.
//
// Deployed with verify_jwt = false (public endpoint) — signature is required.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getEmailProvider } from "../_shared/email/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature, webhook-id, webhook-timestamp, webhook-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const EVENT_TO_STATUS: Record<string, string> = {
  sent: "sent",
  delivered: "delivered",
  delayed: "delayed",
  bounced: "bounced",
  complained: "complained",
  failed: "failed",
};

const STATUS_TO_TIMESTAMP_COL: Record<string, string> = {
  sent: "sent_at",
  delivered: "delivered_at",
  delayed: "delayed_at",
  bounced: "bounced_at",
  complained: "complained_at",
  failed: "failed_at",
};

const STATUS_TO_EVENT_TYPE: Record<string, string> = {
  sent: "invoice_email_sent",
  delivered: "invoice_email_delivered",
  delayed: "invoice_email_delayed",
  bounced: "invoice_email_bounced",
  complained: "invoice_email_complained",
  failed: "invoice_email_failed",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const rawBody = await req.text();
  const provider = getEmailProvider("resend");

  // 1. Verify signature (required).
  const verification = await Promise.resolve(provider.verifyWebhook(req.headers, rawBody));
  if (!verification.valid) {
    return json({ ok: false, error: "invalid_signature", reason: verification.reason }, 401);
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const normalized = provider.normalizeWebhookEvent(payload);
  if (!normalized) {
    // Unknown event type — 200 so Resend doesn't retry, but log it.
    console.log("resend-invoice-webhook: unhandled event", (payload as any)?.type);
    return json({ ok: true, ignored: true }, 200);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 2. Dedupe on provider_event_id.
  const dedupeIns = await supabase
    .from("provider_webhook_events")
    .insert({
      provider: "resend",
      provider_event_id: normalized.providerEventId,
      event_type: normalized.status,
    })
    .select("id")
    .maybeSingle();
  if (dedupeIns.error && String(dedupeIns.error.code) === "23505") {
    return json({ ok: true, duplicate: true }, 200);
  }
  if (dedupeIns.error) {
    console.error("dedupe insert failed", dedupeIns.error);
    return json({ ok: false, error: "dedupe_failed" }, 500);
  }

  // 3. Resolve delivery row by provider_message_id.
  if (!normalized.providerMessageId) {
    return json({ ok: true, quarantined: true, reason: "no_message_id" }, 200);
  }
  const { data: delivery } = await supabase
    .from("invoice_email_deliveries")
    .select("id, tenant_id, project_id, pitch_invoice_id, contact_id, portal_token_id, status")
    .eq("provider", "resend")
    .eq("provider_message_id", normalized.providerMessageId)
    .maybeSingle();

  if (!delivery) {
    // Not one of ours — log & 200. (Could be an onboarding/marketing email.)
    console.log(
      "resend-invoice-webhook: unknown message_id",
      normalized.providerMessageId,
    );
    return json({ ok: true, quarantined: true, reason: "unknown_message_id" }, 200);
  }

  // 4. Update delivery status (never overwrite a stronger terminal state).
  const nextStatus = EVENT_TO_STATUS[normalized.status];
  const tsCol = STATUS_TO_TIMESTAMP_COL[normalized.status];
  const patch: Record<string, unknown> = { [tsCol]: normalized.occurredAt };
  // Only advance status field to the new one; do NOT downgrade delivered→sent.
  const currentStatus = String(delivery.status ?? "queued");
  const rank = (s: string) =>
    ["queued", "accepted", "sent", "delivered", "delayed", "bounced", "complained", "failed"].indexOf(s);
  const advance = rank(nextStatus) >= rank(currentStatus)
    || ["bounced", "complained", "failed"].includes(nextStatus);
  if (advance) patch.status = nextStatus;
  if (nextStatus === "bounced" || nextStatus === "failed") {
    patch.failure_reason = normalized.reason ?? nextStatus;
  }

  await supabase
    .from("invoice_email_deliveries")
    .update(patch)
    .eq("id", delivery.id)
    .eq("tenant_id", delivery.tenant_id); // defensive tenant scoping

  // 5. Append event.
  await supabase.from("customer_invoice_events").insert({
    tenant_id: delivery.tenant_id,
    project_id: delivery.project_id,
    pitch_invoice_id: delivery.pitch_invoice_id,
    contact_id: delivery.contact_id,
    portal_token_id: delivery.portal_token_id,
    event_type: STATUS_TO_EVENT_TYPE[normalized.status],
    actor_type: "system",
    delivery_provider: "resend",
    delivery_provider_message_id: normalized.providerMessageId,
    metadata: {
      delivery_id: delivery.id,
      reason: normalized.reason,
      // Never dump raw provider payload here.
    },
  });

  await supabase
    .from("provider_webhook_events")
    .update({ processed_at: new Date().toISOString(), processing_result: "ok" })
    .eq("provider", "resend")
    .eq("provider_event_id", normalized.providerEventId);

  // Fire staff notification (SMS + bell) for failure-class events.
  if (["bounced", "complained", "failed"].includes(normalized.status)) {
    fetch(`${SUPABASE_URL}/functions/v1/invoice-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        tenant_id: delivery.tenant_id,
        pitch_invoice_id: delivery.pitch_invoice_id,
        event_type: STATUS_TO_EVENT_TYPE[normalized.status],
      }),
    }).catch((e) => console.error("[resend-invoice-webhook] notify failed", e));
  }

  return json({ ok: true }, 200);
});
