// Pitch CRM membership subscriptions — PLATFORM Stripe account only.
//
// Architecture rule: CRM membership charges always use the main Pitch platform
// Stripe account (STRIPE_SECRET_KEY). Tenant-connected Stripe accounts are for
// contractors billing their own homeowners and are never used here.

import Stripe from "npm:stripe@14.21.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const APP_URL = Deno.env.get("APP_URL") ?? "https://pitch-crm.ai";

export function platformStripe(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!key) throw new Error("stripe_secret_key_missing");
  return new Stripe(key, { apiVersion: "2024-06-20", httpClient: Stripe.createFetchHttpClient() });
}

export function stripeMode(): "test" | "live" {
  return (Deno.env.get("STRIPE_SECRET_KEY") ?? "").startsWith("sk_live") ? "live" : "test";
}

export type PlanSeed = {
  slug: string;
  name: string;
  tier: string;
  description: string;
  price_monthly: number; // dollars
  price_yearly: number; // dollars
  trial_days: number;
  sort_order: number;
  features: string[];
  limits: Record<string, number | boolean>;
};

/** Canonical Pitch CRM membership catalog (mirrors src/lib/developer/planTemplates.ts). */
export const PLAN_CATALOG: PlanSeed[] = [
  {
    slug: "crm",
    name: "CRM",
    tier: "crm",
    description: "Full CRM per user — employees, sales reps, production and owners.",
    price_monthly: 50,
    price_yearly: 500,
    trial_days: 14,
    sort_order: 1,
    features: ["CRM & pipeline", "Estimates & invoices", "Smart documents (basic)", "Power dialer 500 min/mo"],
    limits: { sms_monthly: 2000, ai_prompts_monthly: 1500, storage_mb: 25000, roof_reports_monthly: 0 },
  },
  {
    slug: "crm_ai",
    name: "CRM + AI Measuring",
    tier: "crm_ai",
    description: "Everything in CRM plus unlimited AI roof measuring, per user.",
    price_monthly: 80,
    price_yearly: 800,
    trial_days: 14,
    sort_order: 2,
    features: ["Everything in CRM", "Unlimited AI measurements", "API access", "White label", "Priority support"],
    limits: { sms_monthly: 10000, ai_prompts_monthly: 10000, storage_mb: 100000, roof_reports_monthly: -1 },
  },
  {
    // Add-on seat available on every plan — field crew members.
    slug: "crew_login",
    name: "Crew Login",
    tier: "crew_login",
    description: "Field crew login add-on, available on any plan.",
    price_monthly: 10,
    price_yearly: 100,
    trial_days: 0,
    sort_order: 3,
    features: ["Field crew access", "View-only contacts", "Photo & document capture"],
    limits: { sms_monthly: 0, ai_prompts_monthly: 0, storage_mb: 5120, roof_reports_monthly: 0 },
  },
];

type SyncResult = {
  slug: string;
  product_id: string;
  monthly_price_id: string;
  yearly_price_id: string;
  created: boolean;
};

/**
 * Idempotently create/reuse a Stripe Product + recurring monthly and yearly
 * Prices for every plan in the catalog, then mirror the ids into
 * public.subscription_plans. Safe to re-run.
 */
export async function syncPlanCatalog(svc: SupabaseClient): Promise<SyncResult[]> {
  const stripe = platformStripe();
  const mode = stripeMode();
  const out: SyncResult[] = [];

  for (const plan of PLAN_CATALOG) {
    const lookupMonthly = `pitch_crm_${plan.slug}_monthly`;
    const lookupYearly = `pitch_crm_${plan.slug}_yearly`;

    // Reuse an existing product tagged with our slug before creating a new one.
    const search = await stripe.products.search({
      query: `metadata['pitch_plan_slug']:'${plan.slug}' AND active:'true'`,
      limit: 1,
    });
    let product = search.data[0];
    let created = false;
    if (!product) {
      product = await stripe.products.create({
        name: `Pitch CRM — ${plan.name}`,
        description: plan.description,
        metadata: { pitch_plan_slug: plan.slug, pitch_plan_tier: plan.tier, pitch_product: "crm_membership" },
      });
      created = true;
    }

    const monthly = await ensurePrice(stripe, product.id, lookupMonthly, plan.price_monthly, "month", plan.slug);
    const yearly = await ensurePrice(stripe, product.id, lookupYearly, plan.price_yearly, "year", plan.slug);

    await svc.from("subscription_plans").upsert(
      {
        slug: plan.slug,
        name: plan.name,
        tier: plan.tier,
        description: plan.description,
        price_monthly: plan.price_monthly,
        price_yearly: plan.price_yearly,
        trial_days: plan.trial_days,
        sort_order: plan.sort_order,
        is_active: true,
        features: plan.features,
        limits: plan.limits,
        stripe_price_id_monthly: monthly.id,
        stripe_price_id_yearly: yearly.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slug" },
    );

    out.push({
      slug: plan.slug,
      product_id: product.id,
      monthly_price_id: monthly.id,
      yearly_price_id: yearly.id,
      created,
    });
  }

  console.log(`[membership] plan catalog synced in ${mode} mode`, out.map((p) => p.slug).join(","));
  return out;
}

async function ensurePrice(
  stripe: Stripe,
  productId: string,
  lookupKey: string,
  dollars: number,
  interval: "month" | "year",
  slug: string,
): Promise<Stripe.Price> {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const unitAmount = Math.round(dollars * 100);
  const hit = existing.data[0];
  if (hit && hit.unit_amount === unitAmount && hit.product === productId) return hit;
  if (hit) {
    // Price amounts are immutable — retire the old one and mint a replacement.
    await stripe.prices.update(hit.id, { active: false, lookup_key: null as unknown as string });
  }
  return await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: unitAmount,
    recurring: { interval },
    lookup_key: lookupKey,
    metadata: { pitch_plan_slug: slug, pitch_interval: interval },
  });
}

/** Resolve (or create) the platform-account Stripe customer for a tenant. */
export async function resolveTenantCustomer(
  svc: SupabaseClient,
  stripe: Stripe,
  tenantId: string,
  fallbackEmail?: string | null,
): Promise<{ customerId: string; tenantName: string | null }> {
  const { data: tenant } = await svc
    .from("tenants")
    .select("id,name,billing_email,stripe_customer_id")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) throw new Error("tenant_not_found");

  if (tenant.stripe_customer_id) {
    return { customerId: tenant.stripe_customer_id as string, tenantName: (tenant.name as string) ?? null };
  }

  const customer = await stripe.customers.create({
    name: (tenant.name as string) ?? undefined,
    email: (tenant.billing_email as string) ?? fallbackEmail ?? undefined,
    metadata: { pitch_tenant_id: tenantId, pitch_product: "crm_membership" },
  });
  await svc.from("tenants").update({ stripe_customer_id: customer.id }).eq("id", tenantId);
  return { customerId: customer.id, tenantName: (tenant.name as string) ?? null };
}
