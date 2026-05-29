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
  loadSquareOAuthConfig,
  squareOAuthAuthorizeBase,
  SQUARE_OAUTH_SCOPES,
  signSquareOAuthState,
  verifySquareOAuthState,
  exchangeSquareOAuthCode,
  revokeSquareOAuthToken,
  listSquareLocations,
  redactSquareAccount,
  verifySquareWebhookSignature,
  type SquareEnvironment,
} from "../_shared/square.ts";

const app = createRouter("payment-api");

app.get("/__health", (c) => jsonOk(c, { fn: "payment-api", ok: true }));

// ------------------------------------------------------------------
// PUBLIC routes (registered BEFORE requireAuth/requireTenant middleware)
//   /square/oauth/callback — browser redirect from Square; uses signed state
//   /square/webhook        — Square server-to-server; signature verified
// ------------------------------------------------------------------

const SQUARE_STATE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://pitch-crm.ai";

app.get("/square/oauth/callback", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const settingsUrl = `${APP_URL}/settings?tab=payments`;

  if (errorParam) {
    return Response.redirect(`${settingsUrl}&square=error&reason=${encodeURIComponent(errorParam)}`, 302);
  }
  if (!code || !stateParam) {
    return Response.redirect(`${settingsUrl}&square=error&reason=missing_code_or_state`, 302);
  }
  const state = await verifySquareOAuthState(stateParam, SQUARE_STATE_KEY);
  if (!state) {
    return Response.redirect(`${settingsUrl}&square=error&reason=invalid_state`, 302);
  }

  try {
    const cfg = loadSquareOAuthConfig(state.env);
    if (!cfg.appId || !cfg.appSecret) {
      return Response.redirect(`${settingsUrl}&square=error&reason=missing_app_credentials`, 302);
    }
    const tok = await exchangeSquareOAuthCode(cfg, code);
    const svc = serviceClient();
    await svc.from("tenant_square_accounts").upsert(
      {
        tenant_id: state.tenantId,
        environment: state.env,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token ?? null,
        access_token_expires_at: tok.expires_at ?? null,
        merchant_id: tok.merchant_id,
        scopes: SQUARE_OAUTH_SCOPES,
        status: "connected",
        connected_by: state.userId,
        connected_at: new Date().toISOString(),
        disconnected_at: null,
      },
      { onConflict: "tenant_id" },
    );

    // Best-effort merchant name fetch
    try {
      const merchRes = await fetch(
        `${state.env === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com"}/v2/merchants/${tok.merchant_id}`,
        { headers: { Authorization: `Bearer ${tok.access_token}`, "Square-Version": "2024-09-19" } },
      );
      if (merchRes.ok) {
        const j = await merchRes.json();
        const name = j?.merchant?.business_name ?? null;
        if (name) {
          await svc.from("tenant_square_accounts")
            .update({ merchant_name: name })
            .eq("tenant_id", state.tenantId);
        }
      }
    } catch { /* ignore */ }

    return Response.redirect(`${settingsUrl}&square=connected`, 302);
  } catch (err) {
    console.error("[payment-api] square oauth callback failed", err);
    return Response.redirect(`${settingsUrl}&square=error&reason=exchange_failed`, 302);
  }
});

app.post("/square/webhook", async (c) => {
  const cfg = loadSquareOAuthConfig();
  const sig = c.req.header("x-square-hmacsha256-signature");
  const raw = await c.req.text();
  const notificationUrl =
    Deno.env.get("SQUARE_WEBHOOK_NOTIFICATION_URL") ??
    `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/payment-api/square/webhook`;

  const valid = await verifySquareWebhookSignature({
    signatureHeader: sig,
    notificationUrl,
    body: raw,
    signatureKey: cfg.webhookSignatureKey,
  });

  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(raw); } catch { /* keep empty */ }
  const eventId = String((payload as any)?.event_id ?? crypto.randomUUID());
  const eventType = String((payload as any)?.type ?? "unknown");
  const merchantId = String((payload as any)?.merchant_id ?? "") || null;

  const svc = serviceClient();

  // Idempotent record of the event regardless of validity
  await svc.from("square_webhook_events").upsert(
    {
      event_id: eventId,
      event_type: eventType,
      merchant_id: merchantId,
      signature_valid: valid,
      accepted: false,
      payload,
      received_at: new Date().toISOString(),
    },
    { onConflict: "event_id" },
  );

  if (!valid) return jsonErr(c, "invalid_signature", "Square webhook signature failed", 401);

  if (eventType === "oauth.authorization.revoked" && merchantId) {
    const { data: acct } = await svc
      .from("tenant_square_accounts")
      .select("tenant_id")
      .eq("merchant_id", merchantId)
      .maybeSingle();
    if (acct?.tenant_id) {
      await svc.from("tenant_square_accounts")
        .update({
          status: "needs_reauth",
          access_token: null,
          refresh_token: null,
          disconnected_at: new Date().toISOString(),
          last_webhook_at: new Date().toISOString(),
        })
        .eq("tenant_id", acct.tenant_id);
    }
    await svc.from("square_webhook_events")
      .update({ accepted: true, processed_at: new Date().toISOString() })
      .eq("event_id", eventId);
    return jsonOk(c, { handled: "oauth.authorization.revoked" });
  }

  // Payment-collection events ignored in Phase 2 (not yet enabled).
  await svc.from("square_webhook_events")
    .update({ accepted: true, processed_at: new Date().toISOString(), processing_error: "phase2_collection_disabled" })
    .eq("event_id", eventId);
  return jsonOk(c, { handled: false, reason: "collection_disabled" });
});

app.use("/*", requireAuth);
app.use("/*", requireTenant);

// Master-only gate for Square OAuth admin actions
async function requireMaster(c: any, next: any) {
  const userId = c.get("userId");
  const svc = serviceClient();
  const { data } = await svc.from("profiles").select("role").eq("id", userId).maybeSingle();
  const role = (data as any)?.role ?? "";
  if (role !== "master" && role !== "platform_admin") {
    return jsonErr(c, "forbidden", "Square admin actions are restricted to platform admins.", 403);
  }
  await next();
}

// ------------------------------------------------------------------
// AUTHENTICATED Square OAuth admin routes
// ------------------------------------------------------------------

app.post("/square/oauth/start", requireMaster, async (c) => {
  let body: { environment?: string } = {};
  try { body = await c.req.json(); } catch { /* optional */ }
  const env: SquareEnvironment = body.environment === "production" ? "production" : "sandbox";
  const cfg = loadSquareOAuthConfig(env);
  if (!cfg.appId) return jsonErr(c, "missing_app_credentials", "SQUARE_APP_ID not configured", 503);

  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const state = await signSquareOAuthState(
    {
      tenantId,
      userId,
      env,
      nonce: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 600, // 10 min
    },
    SQUARE_STATE_KEY,
  );

  const authorizeUrl = new URL(squareOAuthAuthorizeBase(env));
  authorizeUrl.searchParams.set("client_id", cfg.appId);
  authorizeUrl.searchParams.set("scope", SQUARE_OAUTH_SCOPES.join(" "));
  authorizeUrl.searchParams.set("session", "false");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("redirect_uri", cfg.redirectUri);

  return jsonOk(c, { authorize_url: authorizeUrl.toString(), environment: env, redirect_uri: cfg.redirectUri });
});
app.get("/square/oauth/start", requireMaster, async (c) => {
  // Convenience GET (sandbox default) so the frontend can pass a single URL fetch.
  const cfg = loadSquareOAuthConfig("sandbox");
  if (!cfg.appId) return jsonErr(c, "missing_app_credentials", "SQUARE_APP_ID not configured", 503);
  const tenantId = c.get("tenantId")!;
  const userId = c.get("userId")!;
  const state = await signSquareOAuthState(
    { tenantId, userId, env: "sandbox", nonce: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 600 },
    SQUARE_STATE_KEY,
  );
  const authorizeUrl = new URL(squareOAuthAuthorizeBase("sandbox"));
  authorizeUrl.searchParams.set("client_id", cfg.appId);
  authorizeUrl.searchParams.set("scope", SQUARE_OAUTH_SCOPES.join(" "));
  authorizeUrl.searchParams.set("session", "false");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("redirect_uri", cfg.redirectUri);
  return jsonOk(c, { authorize_url: authorizeUrl.toString(), environment: "sandbox", redirect_uri: cfg.redirectUri });
});

app.get("/square/status", async (c) => {
  const tenantId = c.get("tenantId")!;
  const svc = serviceClient();
  const account = await getTenantSquareAccount(svc, tenantId);
  return jsonOk(c, redactSquareAccount(account));
});

app.post("/square/disconnect", requireMaster, async (c) => {
  const tenantId = c.get("tenantId")!;
  const svc = serviceClient();
  const account = await getTenantSquareAccount(svc, tenantId);
  if (account?.access_token && account.merchant_id) {
    try {
      const cfg = loadSquareOAuthConfig(account.environment);
      await revokeSquareOAuthToken(cfg, account.access_token, account.merchant_id);
    } catch (err) {
      console.warn("[payment-api] square revoke failed (continuing)", err);
    }
  }
  await svc.from("tenant_square_accounts")
    .update({
      status: "disconnected",
      access_token: null,
      refresh_token: null,
      selected_location_id: null,
      selected_location_name: null,
      disconnected_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);
  return jsonOk(c, { disconnected: true });
});

app.get("/square/locations", requireMaster, async (c) => {
  const tenantId = c.get("tenantId")!;
  const svc = serviceClient();
  const account = await getTenantSquareAccount(svc, tenantId);
  if (!account || account.status !== "connected" || !account.access_token) {
    return jsonErr(c, "not_connected", "Square is not connected for this tenant", 412);
  }
  try {
    const locations = await listSquareLocations(account);
    return jsonOk(c, { locations });
  } catch (err) {
    console.error("[payment-api] listSquareLocations failed", err);
    return jsonErr(c, "locations_failed", err instanceof Error ? err.message : String(err), 502);
  }
});

app.post("/square/location", requireMaster, async (c) => {
  let body: { location_id?: string; location_name?: string } = {};
  try { body = await c.req.json(); } catch {
    return jsonErr(c, "invalid_json", "Body must be JSON", 400);
  }
  const locationId = String(body.location_id ?? "");
  if (!locationId) return jsonErr(c, "location_id_required", "location_id required", 400);
  const tenantId = c.get("tenantId")!;
  const svc = serviceClient();
  const { error } = await svc.from("tenant_square_accounts")
    .update({
      selected_location_id: locationId,
      selected_location_name: body.location_name ?? null,
    })
    .eq("tenant_id", tenantId);
  if (error) return jsonErr(c, "update_failed", error.message, 500);
  return jsonOk(c, { selected_location_id: locationId });
});



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
