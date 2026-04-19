import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import Stripe from "npm:stripe@14.21.0";
import { corsHeaders } from "../_shared/cors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") as string, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BILLING_ROLES = ["owner", "corporate", "office_admin", "master"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    // Resolve active tenant
    const { data: profile } = await supabase
      .from("profiles")
      .select("active_tenant_id, tenant_id, email, first_name, last_name")
      .eq("id", user.id)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "No tenant for user" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller has a billing-management role
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const userRoles = (roleRows ?? []).map((r: { role: string }) => r.role);
    const canManage = userRoles.some((r) => BILLING_ROLES.includes(r));
    if (!canManage) {
      return new Response(
        JSON.stringify({ error: "Forbidden: billing role required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Load tenant info
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name")
      .eq("id", tenantId)
      .single();

    // Find or create Stripe Connect account for this tenant
    const { data: existing } = await supabase
      .from("tenant_stripe_accounts")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    let stripeAccountId = existing?.stripe_account_id;

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: profile?.email ?? undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          name: tenant?.name ?? undefined,
        },
        metadata: {
          tenant_id: tenantId,
          tenant_name: tenant?.name ?? "",
          created_by_user_id: user.id,
        },
      });
      stripeAccountId = account.id;

      await supabase.from("tenant_stripe_accounts").insert({
        tenant_id: tenantId,
        stripe_account_id: stripeAccountId,
        account_type: "express",
        country: account.country ?? "US",
        default_currency: account.default_currency ?? "usd",
        charges_enabled: account.charges_enabled ?? false,
        payouts_enabled: account.payouts_enabled ?? false,
        details_submitted: account.details_submitted ?? false,
        onboarding_complete: account.details_submitted ?? false,
        created_by: user.id,
      });
    }

    const origin = req.headers.get("origin") ?? "https://pitch-crm.ai";
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${origin}/settings?tab=payments&refresh=true`,
      return_url: `${origin}/settings?tab=payments&success=true`,
      type: "account_onboarding",
    });

    return new Response(
      JSON.stringify({
        success: true,
        account_id: stripeAccountId,
        onboarding_url: accountLink.url,
        expires_at: accountLink.expires_at,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("stripe-connect-tenant-onboard error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message ?? "Failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
