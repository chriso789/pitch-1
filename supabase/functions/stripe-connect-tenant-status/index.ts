import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import Stripe from "npm:stripe@14.21.0";
import { corsHeaders } from "../_shared/cors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") as string, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const { data: profile } = await supabase
      .from("profiles")
      .select("active_tenant_id, tenant_id")
      .eq("id", user.id)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id;
    if (!tenantId) {
      return new Response(JSON.stringify({ connected: false, account: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row } = await supabase
      .from("tenant_stripe_accounts")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!row) {
      return new Response(
        JSON.stringify({ connected: false, account: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Refresh from Stripe
    let stripeAccount;
    try {
      stripeAccount = await stripe.accounts.retrieve(row.stripe_account_id);
    } catch (e) {
      console.error("Stripe retrieve failed:", e);
      return new Response(
        JSON.stringify({
          connected: true,
          account: {
            id: row.stripe_account_id,
            onboarding_complete: row.onboarding_complete,
            charges_enabled: row.charges_enabled,
            payouts_enabled: row.payouts_enabled,
            details_submitted: row.details_submitted,
            requirements_due: row.requirements_due ?? [],
            requirements_pending: row.requirements_pending ?? [],
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requirementsDue = stripeAccount.requirements?.currently_due ?? [];
    const requirementsPending = stripeAccount.requirements?.pending_verification ?? [];

    await supabase
      .from("tenant_stripe_accounts")
      .update({
        charges_enabled: stripeAccount.charges_enabled ?? false,
        payouts_enabled: stripeAccount.payouts_enabled ?? false,
        details_submitted: stripeAccount.details_submitted ?? false,
        onboarding_complete: stripeAccount.details_submitted ?? false,
        requirements_due: requirementsDue,
        requirements_pending: requirementsPending,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId);

    return new Response(
      JSON.stringify({
        connected: true,
        account: {
          id: stripeAccount.id,
          onboarding_complete: stripeAccount.details_submitted ?? false,
          charges_enabled: stripeAccount.charges_enabled ?? false,
          payouts_enabled: stripeAccount.payouts_enabled ?? false,
          details_submitted: stripeAccount.details_submitted ?? false,
          requirements_due: requirementsDue,
          requirements_pending: requirementsPending,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("stripe-connect-tenant-status error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message ?? "Failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
