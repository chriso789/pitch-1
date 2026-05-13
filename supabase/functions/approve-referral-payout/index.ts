import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { jsonResponse, referralCors } from "../_shared/referralSecurity.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: referralCors });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userData?.user) return jsonResponse({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();
    const { referral_submission_id, payout_method, payout_amount, notes } = body;
    if (!referral_submission_id) return jsonResponse({ error: "referral_submission_id required" }, 400);

    const { data: submission } = await supabase
      .from("referral_submissions")
      .select("*")
      .eq("id", referral_submission_id)
      .maybeSingle();
    if (!submission) return jsonResponse({ error: "submission_not_found" }, 404);

    // Access check
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, active_tenant_id")
      .eq("id", userId)
      .maybeSingle();
    let allowed = profile?.tenant_id === submission.tenant_id || profile?.active_tenant_id === submission.tenant_id;
    if (!allowed) {
      const { data: access } = await supabase
        .from("user_company_access")
        .select("tenant_id")
        .eq("user_id", userId)
        .eq("tenant_id", submission.tenant_id)
        .maybeSingle();
      allowed = !!access;
    }
    if (!allowed) return jsonResponse({ error: "forbidden" }, 403);

    const { data: settings } = await supabase
      .from("referral_program_settings")
      .select("*")
      .eq("tenant_id", submission.tenant_id)
      .maybeSingle();

    const { data: profileRow } = await supabase
      .from("referrer_payout_profiles")
      .select("*")
      .eq("tenant_id", submission.tenant_id)
      .eq("referrer_contact_id", submission.referrer_contact_id)
      .maybeSingle();

    const method = payout_method ?? profileRow?.preferred_payout_method ??
      (settings?.allow_stored_balance ? "stored_balance" : null);
    if (!method) return jsonResponse({ error: "no_payout_method" }, 400);

    let amount = payout_amount;
    if (amount == null) {
      if (settings?.default_reward_type === "fixed_amount") {
        amount = settings.fixed_reward_amount;
      } else if (settings?.default_reward_type === "percentage_of_collected_revenue") {
        amount = Number(submission.sold_value ?? 0) * Number(settings.percentage_reward_rate ?? 0) / 100;
      } else {
        return jsonResponse({ error: "payout_amount required" }, 400);
      }
    }

    const isCredit = method === "stored_balance";
    const payoutRow = {
      tenant_id: submission.tenant_id,
      referral_submission_id: submission.id,
      referral_link_id: submission.referral_link_id,
      referrer_contact_id: submission.referrer_contact_id,
      payout_method: method,
      payout_amount: amount,
      payout_status: isCredit ? "stored_as_credit" : "approved",
      approval_user_id: userId,
      approved_at: new Date().toISOString(),
      notes: notes ?? null,
    };

    const { data: payout, error: payErr } = await supabase
      .from("referral_payouts")
      .insert(payoutRow)
      .select("*")
      .single();
    if (payErr) throw payErr;

    if (isCredit) {
      await supabase.from("referral_credit_ledger").insert({
        tenant_id: submission.tenant_id,
        referrer_contact_id: submission.referrer_contact_id,
        referral_payout_id: payout.id,
        transaction_type: "credit_earned",
        amount,
        balance_after: 0, // trigger fills in
        notes: `Reward for submission ${submission.id}`,
        created_by: userId,
      });
    }

    await supabase.from("referral_status_history").insert({
      tenant_id: submission.tenant_id,
      referral_submission_id: submission.id,
      old_status: submission.status,
      new_status: isCredit ? "completed" : submission.status,
      reason: `Payout ${isCredit ? "stored as credit" : "approved"}`,
      changed_by: userId,
    });

    return jsonResponse({ success: true, payout });
  } catch (e) {
    console.error("[approve-referral-payout]", e);
    return jsonResponse({ error: "internal_error", message: (e as Error).message }, 500);
  }
});
