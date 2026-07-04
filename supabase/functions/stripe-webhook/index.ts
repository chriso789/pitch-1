// stripe-webhook — public webhook endpoint. Signature-verified, no auth/tenant
// middleware. Receives Stripe events, dedupes via stripe_webhook_events.event_id
// (UNIQUE), and routes:
//
//   - Project invoice payments (checkout.session.completed for one-off invoices,
//     payment_intent.succeeded) -> project_payments / project_invoices
//   - Subscription lifecycle (checkout.session.completed mode=subscription,
//     customer.subscription.*, invoice.paid, invoice.payment_failed,
//     checkout.session.async_payment_*) -> tenants.subscription_* AND
//     sync-crm-referral-subscription-status for referral attribution updates
//
// NOTE: Stripe's webhook URL points at this function — do not rename.

import Stripe from "npm:stripe@14.21.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_WORKER_SECRET = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";

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
  const tenantId = metadata.tenant_id ?? metadata.company_id ?? null;

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
    let resolved: ResolvedContext = { companyId: tenantId, subscriptionId: null, signupId: null, unresolved: false };

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription") {
          resolved = await handleSubscriptionCheckout(service, session, event.id, event.type);
        } else {
          await handleCheckoutCompleted(service, session, tenantId);
        }
        break;
      }
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        resolved = await dispatchSubscriptionStatus(service, {
          customerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
          subscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
          metadata: session.metadata ?? null,
          status: "active_paid",
          paidAmount: (session.amount_total ?? 0) / 100,
          stripeEventId: event.id,
          stripeEventType: event.type,
        });
        break;
      }
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        resolved = await dispatchSubscriptionStatus(service, {
          customerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
          subscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
          metadata: session.metadata ?? null,
          status: "payment_failed",
          stripeEventId: event.id,
          stripeEventType: event.type,
        });
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        resolved = await handleSubscriptionLifecycle(service, sub, event.id, event.type);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const inv = event.data.object as Stripe.Invoice;
        resolved = await dispatchSubscriptionStatus(service, {
          customerId: typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null,
          subscriptionId: typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id ?? null,
          metadata: inv.metadata ?? null,
          status: "active_paid",
          paidAmount: (inv.amount_paid ?? 0) / 100,
          stripeEventId: event.id,
          stripeEventType: event.type,
        });
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        resolved = await dispatchSubscriptionStatus(service, {
          customerId: typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null,
          subscriptionId: typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id ?? null,
          metadata: inv.metadata ?? null,
          status: "payment_failed",
          stripeEventId: event.id,
          stripeEventType: event.type,
        });
        break;
      }
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(service, event.data.object as Stripe.PaymentIntent);
        break;
      default:
        console.log("[stripe-webhook] unhandled type", event.type);
    }

    await service
      .from("stripe_webhook_events")
      .update({
        processed_at: new Date().toISOString(),
        related_company_id: resolved.companyId,
        related_subscription_id: resolved.subscriptionId,
        related_signup_id: resolved.signupId,
        processing_error: resolved.unresolved ? "unresolved_company" : null,
      })
      .eq("event_id", event.id);

    return json({ received: true, resolved });
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

// =============================================================================
// Subscription lifecycle helpers
// =============================================================================

interface ResolvedContext {
  companyId: string | null;
  subscriptionId: string | null;
  signupId: string | null;
  unresolved: boolean;
}

async function resolveCompanyId(
  service: SupabaseClient,
  hints: { metadata?: Stripe.Metadata | Record<string, string> | null; customerId?: string | null; subscriptionId?: string | null },
): Promise<string | null> {
  const md = hints.metadata ?? {};
  const direct = (md as Record<string, string>).company_id || (md as Record<string, string>).tenant_id || null;
  if (direct) return direct;

  if (hints.customerId) {
    const { data } = await service.from("tenants").select("id").eq("stripe_customer_id", hints.customerId).maybeSingle();
    if (data?.id) return data.id;
  }
  if (hints.subscriptionId) {
    const { data } = await service.from("tenants").select("id").eq("stripe_subscription_id", hints.subscriptionId).maybeSingle();
    if (data?.id) return data.id;
  }
  return null;
}

async function handleSubscriptionCheckout(
  service: SupabaseClient,
  session: Stripe.Checkout.Session,
  stripeEventId: string,
  stripeEventType: string,
): Promise<ResolvedContext> {
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
  const companyId = await resolveCompanyId(service, { metadata: session.metadata, customerId, subscriptionId });

  if (companyId && (customerId || subscriptionId)) {
    await service
      .from("tenants")
      .update({
        stripe_customer_id: customerId ?? undefined,
        stripe_subscription_id: subscriptionId ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", companyId);
  }

  // Defer the "paid" verdict to invoice.paid / subscription.updated active.
  // Just link & sync trial-ish state if we have it.
  if (!companyId) {
    console.warn("[stripe-webhook] subscription checkout unresolved company", session.id);
    return { companyId: null, subscriptionId, signupId: null, unresolved: true };
  }
  return { companyId, subscriptionId, signupId: null, unresolved: false };
}

async function handleSubscriptionLifecycle(
  service: SupabaseClient,
  sub: Stripe.Subscription,
  stripeEventId: string,
  stripeEventType: string,
): Promise<ResolvedContext> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  const subscriptionId = sub.id;
  const companyId = await resolveCompanyId(service, { metadata: sub.metadata, customerId, subscriptionId });

  if (companyId) {
    const expiresAtSec = (sub as unknown as { current_period_end?: number }).current_period_end;
    const update: Record<string, unknown> = {
      stripe_customer_id: customerId ?? undefined,
      stripe_subscription_id: subscriptionId,
      subscription_status: sub.status,
      updated_at: new Date().toISOString(),
    };
    if (expiresAtSec) update.subscription_expires_at = new Date(expiresAtSec * 1000).toISOString();
    const priceNickname = sub.items?.data?.[0]?.price?.nickname;
    if (priceNickname) update.subscription_tier = priceNickname;
    await service.from("tenants").update(update).eq("id", companyId);
  }

  // Map Stripe sub.status -> referral signup state
  let referralStatus: "active_paid" | "trialing" | "payment_failed" | "canceled" | null = null;
  if (sub.status === "active") referralStatus = "active_paid";
  else if (sub.status === "trialing") referralStatus = "trialing";
  else if (sub.status === "past_due" || sub.status === "unpaid") referralStatus = "payment_failed";
  else if (sub.status === "canceled" || sub.status === "incomplete_expired") referralStatus = "canceled";

  let signupId: string | null = null;
  if (referralStatus && companyId) {
    const result = await callSync(service, {
      company_id: companyId,
      subscription_id: subscriptionId,
      customer_id: customerId,
      status: referralStatus,
      stripe_event_id: stripeEventId,
      stripe_event_type: stripeEventType,
    });
    signupId = result?.signup_id ?? null;
  }

  return { companyId, subscriptionId, signupId, unresolved: !companyId };
}

async function dispatchSubscriptionStatus(
  service: SupabaseClient,
  args: {
    customerId: string | null;
    subscriptionId: string | null;
    metadata: Stripe.Metadata | Record<string, string> | null;
    status: "active_paid" | "payment_failed" | "trialing" | "canceled";
    paidAmount?: number;
    stripeEventId: string;
    stripeEventType: string;
  },
): Promise<ResolvedContext> {
  const companyId = await resolveCompanyId(service, {
    metadata: args.metadata,
    customerId: args.customerId,
    subscriptionId: args.subscriptionId,
  });

  if (!companyId) {
    console.warn("[stripe-webhook] dispatchSubscriptionStatus unresolved", args.stripeEventId);
    return { companyId: null, subscriptionId: args.subscriptionId, signupId: null, unresolved: true };
  }

  const result = await callSync(service, {
    company_id: companyId,
    subscription_id: args.subscriptionId,
    customer_id: args.customerId,
    status: args.status,
    paid_amount: args.paidAmount,
    stripe_event_id: args.stripeEventId,
    stripe_event_type: args.stripeEventType,
  });

  return {
    companyId,
    subscriptionId: args.subscriptionId,
    signupId: result?.signup_id ?? null,
    unresolved: false,
  };
}

async function callSync(
  _service: SupabaseClient,
  body: Record<string, unknown>,
): Promise<{ signup_id?: string } | null> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-crm-referral-subscription-status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_WORKER_SECRET,
        // Service-role bearer so the function's verify_jwt (if on) doesn't reject us.
        "Authorization": `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ ...body, source: "stripe_webhook" }),
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) console.warn("[stripe-webhook] sync call non-2xx", resp.status, j);
    return j;
  } catch (e) {
    console.error("[stripe-webhook] sync call failed", e instanceof Error ? e.message : e);
    return null;
  }
}

// =============================================================================
// Project invoice payment helpers (existing behavior, unchanged)
// =============================================================================

async function handleCheckoutCompleted(
  service: SupabaseClient,
  session: Stripe.Checkout.Session,
  tenantId: string | null,
) {
  const metadata = session.metadata ?? {};

  // Inspection request payment (public /request-inspection flow)
  if (metadata.kind === "inspection_request" && metadata.inspection_request_id) {
    const amountPaid = session.amount_total ?? 0;
    const { error } = await service
      .from("inspection_requests")
      .update({
        status: "paid",
        payment_status: "paid",
        amount_paid_cents: amountPaid,
        paid_at: new Date().toISOString(),
        payment_ref: session.id,
      })
      .eq("id", metadata.inspection_request_id);
    if (error) console.error("[stripe-webhook] inspection_request update failed", error);
    return;
  }

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
  _service: SupabaseClient,
  pi: Stripe.PaymentIntent,
) {
  console.log("[stripe-webhook] payment_intent.succeeded", pi.id);
}
