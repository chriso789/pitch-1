// payment-api — routed Edge Function.
//
// Canonical invoice payment link route lives here. The frontend never posts an
// amount or tenant_id; it posts an invoice_id + provider, and this function
// resolves tenant / project / contact / balance server-side.

import { createRouter, jsonOk, jsonErr, requireAuth, requireTenant, serviceClient } from "../_shared/router.ts";
import Stripe from "npm:stripe@14.21.0";
import {
  createSquareInvoicePaymentLink,
  getTenantSquareAccount,
} from "../_shared/square.ts";

const app = createRouter("payment-api");

app.get("/__health", (c) => jsonOk(c, { fn: "payment-api", ok: true }));

app.use("/*", requireAuth);
app.use("/*", requireTenant);

// ------------------------------------------------------------------
// POST /create-invoice-payment-link
// Body: { invoice_id: string, provider: 'stripe' | 'zelle' | 'square' }
// Tenant comes from the JWT (requireTenant). Amount comes from the invoice
// balance, never from the client.
// ------------------------------------------------------------------
app.post("/create-invoice-payment-link", async (c) => {
  let body: { invoice_id?: string; provider?: string };
  try {
    body = await c.req.json();
  } catch {
    return jsonErr(c, "invalid_json", "Body must be JSON", 400);
  }
  const invoiceId = String(body.invoice_id ?? "");
  const provider = String(body.provider ?? "").toLowerCase();
  if (!invoiceId) return jsonErr(c, "invoice_id_required", "invoice_id is required", 400);
  if (!["stripe", "zelle", "square"].includes(provider)) {
    return jsonErr(c, "invalid_provider", "provider must be stripe | zelle | square", 400);
  }

  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId") ?? null;
  const service = serviceClient();

  // Resolve invoice scoped to tenant. NEVER trust client amount.
  const { data: invoice, error: invErr } = await service
    .from("project_invoices")
    .select("id, tenant_id, pipeline_entry_id, invoice_number, amount, balance, status")
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (invErr) return jsonErr(c, "invoice_lookup_failed", invErr.message, 500);
  if (!invoice) return jsonErr(c, "invoice_not_found", "Invoice not found for this tenant", 404);

  const balance = Number(invoice.balance ?? 0);
  if (!(balance > 0)) {
    return jsonErr(c, "invoice_zero_balance", "Invoice has no outstanding balance", 400);
  }

  // Resolve contact from pipeline_entry (best-effort, optional).
  let contactId: string | null = null;
  let buyerEmail: string | null = null;
  if (invoice.pipeline_entry_id) {
    const { data: entry } = await service
      .from("pipeline_entries")
      .select("contact_id, contacts:contact_id ( id, email )")
      .eq("id", invoice.pipeline_entry_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (entry?.contact_id) {
      contactId = entry.contact_id as string;
      // @ts-ignore — supabase-js dynamic
      buyerEmail = entry?.contacts?.email ?? null;
    }
  }

  const description = `Invoice ${invoice.invoice_number ?? invoiceId.slice(0, 8)}`;
  const currency = "usd";
  const amountCents = Math.round(balance * 100);

  // ---------------- STRIPE ----------------
  if (provider === "stripe") {
    try {
      const result = await createStripeInvoicePaymentLink(service, {
        tenantId,
        invoice,
        contactId,
        buyerEmail,
        description,
        currency,
        amountCents,
      });

      const { data: linkRow, error: linkErr } = await service
        .from("payment_links")
        .insert({
          tenant_id: tenantId,
          invoice_id: invoiceId,
          pipeline_entry_id: invoice.pipeline_entry_id,
          contact_id: contactId,
          amount: balance,
          currency,
          description,
          status: "active",
          payment_type: "stripe",
          provider: "stripe",
          stripe_payment_link_id: result.providerPaymentLinkId,
          stripe_payment_link_url: result.url,
          provider_payment_link_id: result.providerPaymentLinkId,
          provider_payment_link_url: result.url,
          provider_status: "active",
          created_by: userId,
        })
        .select("id")
        .single();

      if (linkErr) console.error("[payment-api] payment_links insert error", linkErr);

      return jsonOk(c, {
        provider: "stripe",
        invoice_id: invoiceId,
        amount: balance,
        currency,
        url: result.url,
        payment_link_id: linkRow?.id ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[payment-api] stripe link failed", msg);
      return jsonErr(c, "stripe_link_failed", msg, 400);
    }
  }

  // ---------------- ZELLE ----------------
  if (provider === "zelle") {
    // Verify tenant has Zelle enabled.
    const { data: settings } = await service
      .from("tenant_settings")
      .select("zelle_enabled, zelle_email, zelle_phone")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!settings?.zelle_enabled || (!settings.zelle_email && !settings.zelle_phone)) {
      return jsonErr(c, "zelle_not_configured", "Zelle is not enabled for this company", 400);
    }

    const token = crypto.randomUUID().replace(/-/g, "");
    const { data: linkRow, error: linkErr } = await service
      .from("payment_links")
      .insert({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        pipeline_entry_id: invoice.pipeline_entry_id,
        contact_id: contactId,
        amount: balance,
        currency,
        description,
        status: "active",
        payment_type: "zelle",
        provider: "zelle",
        shareable_token: token,
        zelle_confirmation_status: "pending",
        provider_status: "pending",
        created_by: userId,
      })
      .select("id")
      .single();

    if (linkErr) return jsonErr(c, "zelle_link_failed", linkErr.message, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const projectRef = supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
    const url = `https://${projectRef}.functions.supabase.co/zelle-payment-page?token=${token}`;

    return jsonOk(c, {
      provider: "zelle",
      invoice_id: invoiceId,
      amount: balance,
      currency,
      url,
      payment_link_id: linkRow?.id ?? null,
      shareable_token: token,
    });
  }

  // ---------------- SQUARE (disabled) ----------------
  if (provider === "square") {
    const account = await getTenantSquareAccount(service, tenantId);
    if (!account) {
      return jsonErr(
        c,
        "square_not_connected",
        "This company has not connected a Square account.",
        400,
      );
    }
    try {
      // Will throw `square_collection_disabled` in this phase.
      await createSquareInvoicePaymentLink(service, {
        tenantId,
        invoiceId,
        amountCents,
        currency,
        description,
        buyerEmail,
      });
      return jsonErr(c, "square_collection_disabled", "Square collection not yet enabled", 503);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonErr(c, msg === "square_collection_disabled" ? "square_collection_disabled" : "square_link_failed", msg, 503);
    }
  }

  return jsonErr(c, "invalid_provider", "Unsupported provider", 400);
});

// ------------------ Stripe helper ------------------
async function createStripeInvoicePaymentLink(
  service: ReturnType<typeof serviceClient>,
  opts: {
    tenantId: string;
    invoice: { id: string; pipeline_entry_id: string | null; invoice_number: string | null };
    contactId: string | null;
    buyerEmail: string | null;
    description: string;
    currency: string;
    amountCents: number;
  },
): Promise<{ url: string; providerPaymentLinkId: string }> {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) throw new Error("stripe_secret_not_configured");

  const stripe = new Stripe(stripeKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const { data: tenantStripe } = await service
    .from("tenant_stripe_accounts")
    .select("stripe_account_id, charges_enabled, onboarding_complete")
    .eq("tenant_id", opts.tenantId)
    .maybeSingle();

  if (!tenantStripe?.stripe_account_id) throw new Error("stripe_account_not_connected");
  if (!tenantStripe.charges_enabled) throw new Error("stripe_charges_not_enabled");

  const price = await stripe.prices.create(
    {
      currency: opts.currency,
      unit_amount: opts.amountCents,
      product_data: { name: opts.description },
    },
    { stripeAccount: tenantStripe.stripe_account_id },
  );

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    on_behalf_of: tenantStripe.stripe_account_id,
    transfer_data: { destination: tenantStripe.stripe_account_id },
    after_completion: {
      type: "hosted_confirmation",
      hosted_confirmation: { custom_message: "Thank you for your payment!" },
    },
    metadata: {
      tenant_id: opts.tenantId,
      invoice_id: opts.invoice.id,
      pipeline_entry_id: opts.invoice.pipeline_entry_id ?? "",
      contact_id: opts.contactId ?? "",
      connected_account: tenantStripe.stripe_account_id,
    },
  });

  return { url: link.url, providerPaymentLinkId: link.id };
}

// ------------------ Legacy scaffolded routes (kept as 501 for clarity) ----
app.post("/stripe/customer-portal", async (c) => jsonErr(c, "not_migrated", "Use stripe-customer-portal until migrated.", 501));
app.post("/stripe/connect/onboard", async (c) => jsonErr(c, "not_migrated", "Use stripe-connect-tenant-onboard until migrated.", 501));
app.post("/stripe/connect/status", async (c) => jsonErr(c, "not_migrated", "Use stripe-connect-tenant-status until migrated.", 501));
app.post("/stripe/connect/tenant/onboard", async (c) => jsonErr(c, "not_migrated", "Use stripe-connect-tenant-onboard until migrated.", 501));
app.post("/stripe/connect/tenant/status", async (c) => jsonErr(c, "not_migrated", "Use stripe-connect-tenant-status until migrated.", 501));
app.post("/zelle/payment-page", async (c) => jsonErr(c, "not_migrated", "Use zelle-payment-page (public) until migrated.", 501));

Deno.serve(app.fetch);
