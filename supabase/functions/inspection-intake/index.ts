// inspection-intake — public POST endpoint for 4-Point / Wind Mitigation
// requests submitted from a company's website (hosted form OR external form).
//
// Flow:
//   1. Validate payload
//   2. Insert inspection_requests row (service role)
//   3. Create Stripe Checkout Session with metadata { inspection_request_id, tenant_id }
//   4. Return { request_id, payment_url } — caller redirects the browser
//
// Payment confirmation happens in stripe-webhook (checkout.session.completed
// with metadata.inspection_request_id).

import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import Stripe from "npm:stripe@14.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const PUBLIC_APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "https://pitch-crm.ai";

const SERVICE_LABELS: Record<string, string> = {
  four_point: "4-Point Inspection",
  wind_mitigation: "Wind Mitigation Inspection",
  combo: "4-Point + Wind Mitigation Combo",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function s(v: unknown, max = 255): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const tenant_id = s(body.tenant_id ?? body.company_id);
  const service_type = s(body.service_type);
  const first_name = s(body.first_name);
  const last_name = s(body.last_name);
  const email = s(body.email);
  const phone = s(body.phone, 32);
  const address_line1 = s(body.address ?? body.address_line1);
  const city = s(body.city);
  const state = s(body.state, 32);
  const zip = s(body.zip ?? body.zip_code ?? body.postal_code, 16);

  if (!tenant_id) return json({ error: "missing_tenant_id" }, 400);
  if (!SERVICE_LABELS[service_type]) return json({ error: "invalid_service_type" }, 400);
  if (!first_name || !last_name) return json({ error: "missing_name" }, 400);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "invalid_email" }, 400);
  if (!phone) return json({ error: "missing_phone" }, 400);
  if (!address_line1 || !city || !state || !zip) return json({ error: "missing_address" }, 400);

  if (!STRIPE_KEY) return json({ error: "stripe_not_configured" }, 500);

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify tenant exists
  const { data: tenant, error: tenantErr } = await svc
    .from("tenants")
    .select("id, name")
    .eq("id", tenant_id)
    .maybeSingle();
  if (tenantErr || !tenant) return json({ error: "unknown_tenant" }, 404);

  const price_cents = Number.isFinite(Number(body.price_cents))
    ? Math.max(100, Math.floor(Number(body.price_cents)))
    : 20000; // default $200

  const insertPayload = {
    tenant_id,
    service_type,
    price_cents,
    first_name,
    last_name,
    email,
    phone,
    address_line1,
    address_line2: s(body.address_line2, 255) || null,
    city,
    state,
    zip,
    year_built: s(body.year_built, 8) || null,
    insurance_company: s(body.insurance_company) || null,
    notes: s(body.notes, 2000) || null,
    source: s(body.source, 64) || "website",
    payment_provider: "stripe",
    metadata: { source_url: s(body.source_url, 512) || null },
  };

  const { data: row, error: insErr } = await svc
    .from("inspection_requests")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insErr || !row) {
    console.error("[inspection-intake] insert failed", insErr);
    return json({ error: "db_insert_failed" }, 500);
  }

  // Create Stripe Checkout Session
  const stripe = new Stripe(STRIPE_KEY, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const successUrl = `${PUBLIC_APP_URL}/request-inspection/success?rid=${row.id}`;
  const cancelUrl = `${PUBLIC_APP_URL}/request-inspection?c=${tenant_id}&type=${service_type}&canceled=1`;

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: price_cents,
            product_data: {
              name: `${SERVICE_LABELS[service_type]} — ${tenant.name ?? "Inspection"}`,
              description: `${address_line1}, ${city}, ${state} ${zip}`,
            },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        inspection_request_id: row.id,
        tenant_id,
        kind: "inspection_request",
        service_type,
      },
    });
  } catch (e) {
    console.error("[inspection-intake] stripe error", e);
    return json({ error: "stripe_error", detail: (e as Error).message }, 502);
  }

  await svc
    .from("inspection_requests")
    .update({
      payment_link: session.url,
      payment_ref: session.id,
    })
    .eq("id", row.id);

  return json({
    ok: true,
    request_id: row.id,
    payment_url: session.url,
  });
});
