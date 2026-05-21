// Spec-named admin endpoint. Calculates payout amount, writes the payout row,
// and (for account_credit) writes a credit ledger entry.
import { corsHeaders, json, requireUser, svcClient } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const u = await requireUser(req);
    if ("error" in u) return u.error;
    const { referral_company_signup_id, payout_method = "ach", payout_amount, notes } = (await req.json()) || {};
    if (!referral_company_signup_id) return json({ error: "referral_company_signup_id required" }, 400);

    const sb = svcClient();
    const { data: signup } = await sb.from("crm_referral_company_signups")
      .select("*").eq("id", referral_company_signup_id).maybeSingle();
    if (!signup) return json({ error: "signup not found" }, 404);

    const { data: settings } = await sb.from("crm_referral_program_settings")
      .select("*").eq("tenant_id", signup.tenant_id).maybeSingle();

    let amount = payout_amount;
    if (amount == null) {
      amount = Number(settings?.fixed_signup_fee ?? 500);
      if (settings?.default_reward_type === "percentage_first_payment") {
        amount = Number(signup.qualifying_revenue || 0) * Number(settings?.percentage_first_payment_rate ?? 0);
      }
    }

    const { data: existing } = await sb.from("crm_referral_payouts")
      .select("*").eq("referral_company_signup_id", signup.id).maybeSingle();

    const payoutStatus = payout_method === "account_credit" ? "account_credit_applied" : "approved";
    let payout;
    if (existing) {
      const { data } = await sb.from("crm_referral_payouts").update({
        payout_method, payout_amount: amount, payout_status: payoutStatus,
        approval_user_id: u.userId, approved_at: new Date().toISOString(), notes,
      }).eq("id", existing.id).select().single();
      payout = data;
    } else {
      const { data } = await sb.from("crm_referral_payouts").insert({
        tenant_id: signup.tenant_id, partner_id: signup.partner_id,
        referral_company_signup_id: signup.id, referred_company_id: signup.referred_company_id,
        payout_method, payout_amount: amount, payout_status: payoutStatus,
        approval_user_id: u.userId, approved_at: new Date().toISOString(), notes,
      }).select().single();
      payout = data;
    }

    if (payout_method === "account_credit" && payout) {
      const { data: prev } = await sb.from("crm_referral_account_credit_ledger")
        .select("balance_after").eq("partner_id", signup.partner_id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const newBalance = Number(prev?.balance_after || 0) + Number(amount);
      await sb.from("crm_referral_account_credit_ledger").insert({
        tenant_id: signup.tenant_id, partner_id: signup.partner_id,
        referring_company_id: signup.tenant_id, crm_referral_payout_id: payout.id,
        transaction_type: "credit_earned", amount, balance_after: newBalance,
        notes: notes ?? "Referral credit", created_by: u.userId,
      });
    }

    return json({ success: true, payout });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
