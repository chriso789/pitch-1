// stripe-webhook — public webhook endpoint. Signature-verified, no auth/tenant
// middleware. Receives Stripe events, dedupes via stripe_webhook_events.event_id
// (UNIQUE), and writes canonical project_payments rows keyed by
// (provider, provider_payment_id) so the same Stripe charge can never produce
// two payment rows.
//
// NOTE: Stripe's webhook URL points at this function — do not rename.

import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const stripe = new Stripe(STRIPE_SECRET, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);

  if (url.pathname.endsWith("/__health")) {
    return json({ ok: true, fn: "stripe-webhook" }, 200);
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return json({ error: "webhook_secret_missing" }, 500);
  }

  const signature = req.headers.get("stripe-signature");
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature ?? "", STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("[stripe-webhook] signature verification failed", e instanceof Error ? e.message : e);
    return json({ error: "invalid_signature" }, 400);
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE);
  const obj = event.data.object as Record<string, unknown>;
  const metadata = ((obj as { metadata?: Record<string, string> }).metadata) ?? {};
  const tenantId = metadata.tenant_id ?? null;

  // Idempotency — unique (event_id) prevents double-processing.
  const dedup = await service
    .from("stripe_webhook_events")
    .insert({
      event_id: event.id,
      event_type: event.type,
      tenant_id: tenantId,
      signature_valid: true,
      accepted: true,
      payload: event as unknown as Record<string, unknown>,
    })
    .select("id")
    .maybeSingle();

  if (dedup.error) {
    if (dedup.error.code === "23505") {
      console.log("[stripe-webhook] duplicate event ignored", event.id);
      return json({ received: true, duplicate: true });
    }
    console.error("[stripe-webhook] dedup insert error", dedup.error);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(service, event.data.object as Stripe.Checkout.Session, tenantId);
        break;
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(service, event.data.object as Stripe.PaymentIntent);
        break;
      default:
        console.log("[stripe-webhook] unhandled type", event.type);
    }

    await service
      .from("stripe_webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("event_id", event.id);

    return json({ received: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[stripe-webhook] handler error", msg);
    await service
      .from("stripe_webhook_events")
      .update({ processing_error: msg, processed_at: new Date().toISOString() })
      .eq("event_id", event.id);
    return json({ received: true, error: msg }, 200); // 200 so Stripe doesn't retry forever
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleCheckoutCompleted(
  service: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session,
  tenantId: string | null,
) {
  const metadata = session.metadata ?? {};
  const invoiceId = metadata.invoice_id || null;
  const pipelineEntryId = metadata.pipeline_entry_id || null;
  const amount = (session.amount_total ?? 0) / 100;
  const stripePaymentLinkId = (session as unknown as { payment_link?: string }).payment_link ?? null;
  const providerPaymentId = (session.payment_intent as string | null) ?? session.id;

  if (stripePaymentLinkId) {
    await service
      .from("payment_links")
      .update({ status: "completed", provider_status: "completed", updated_at: new Date().toISOString() })
      .eq("stripe_payment_link_id", stripePaymentLinkId);
  }

  if (!invoiceId || !tenantId) {
    console.warn("[stripe-webhook] checkout.session.completed missing invoice_id/tenant_id metadata");
    return;
  }

  // Insert project_payments. uq_project_payments_provider_payment prevents dupes.
  const insert = await service.from("project_payments").insert({
    tenant_id: tenantId,
    pipeline_entry_id: pipelineEntryId,
    invoice_id: invoiceId,
    amount,
    payment_method: "stripe",
    provider: "stripe",
    provider_payment_id: providerPaymentId,
    provider_event_id: session.id,
    reference_number: providerPaymentId,
    payment_date: new Date().toISOString(),
    notes: `Stripe payment - ${session.customer_details?.email ?? "online"}`,
  });

  if (insert.error) {
    if (insert.error.code === "23505") {
      console.log("[stripe-webhook] duplicate project_payment ignored", providerPaymentId);
      return;
    }
    throw insert.error;
  }

  const { data: invoice } = await service
    .from("project_invoices")
    .select("balance")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invoice) {
    const newBalance = Math.max(0, Number(invoice.balance ?? 0) - amount);
    const newStatus = newBalance === 0 ? "paid" : "partial";
    await service
      .from("project_invoices")
      .update({ balance: newBalance, status: newStatus })
      .eq("id", invoiceId);
  }
}

async function handlePaymentIntentSucceeded(
  service: ReturnType<typeof createClient>,
  pi: Stripe.PaymentIntent,
) {
  console.log("[stripe-webhook] payment_intent.succeeded", pi.id);
}
