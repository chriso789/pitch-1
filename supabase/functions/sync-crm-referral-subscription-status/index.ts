// Authenticated/internal endpoint. Updates a referred signup's subscription
// status, re-evaluates payout eligibility, and creates a pending payout if eligible.
import { corsHeaders, json, requireUser, svcClient } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const u = await requireUser(req);
    if ("error" in u) return u.error;
    const b = await req.json();
    const { referred_company_id, subscription_id, payment_customer_id, status, paid_amount, event_at } = b || {};
    if (!status) return json({ error: "status required" }, 400);

    const sb = svcClient();
    let q = sb.from("crm_referral_company_signups").select("*").limit(1);
    if (referred_company_id) q = q.eq("referred_company_id", referred_company_id);
    else if (subscription_id) q = q.eq("subscription_id", subscription_id);
    else if (payment_customer_id) q = q.eq("payment_customer_id", payment_customer_id);
    else return json({ error: "Need referred_company_id, subscription_id, or payment_customer_id" }, 400);

    const { data: signup } = await q.maybeSingle();
    if (!signup) return json({ success: false, reason: "not_found" });

    const updates: any = { updated_at: new Date().toISOString() };
    const now = event_at || new Date().toISOString();
    let newStatus = signup.signup_status;

    if (["active", "paid", "active_paid"].includes(status)) {
      newStatus = "active_paid";
      updates.signup_status = "active_paid";
      if (!signup.active_paid_at) updates.active_paid_at = now;
      if (!signup.first_payment_at) updates.first_payment_at = now;
      if (paid_amount) updates.qualifying_revenue = Number(signup.qualifying_revenue || 0) + Number(paid_amount);
    } else if (status === "cancelled") {
      newStatus = "cancelled";
      updates.signup_status = "cancelled";
      updates.cancelled_at = now;
    }

    await sb.from("crm_referral_company_signups").update(updates).eq("id", signup.id);
    if (newStatus !== signup.signup_status) {
      await sb.from("crm_referral_status_history").insert({
        tenant_id: signup.tenant_id, partner_id: signup.partner_id,
        referral_company_signup_id: signup.id,
        old_status: signup.signup_status, new_status: newStatus,
        reason: "sync-crm-referral-subscription-status", changed_by: u.userId,
      });
    }

    // Eligibility + pending payout
    if (newStatus === "active_paid") {
      const { data: settings } = await sb.from("crm_referral_program_settings")
        .select("*").eq("tenant_id", signup.tenant_id).maybeSingle();
      const minPaid = Number(settings?.minimum_paid_amount ?? 0);
      const qualRev = Number(updates.qualifying_revenue ?? signup.qualifying_revenue ?? 0);
      const eligible = qualRev >= minPaid;
      await sb.from("crm_referral_company_signups").update({
        payout_eligible: eligible,
        payout_eligibility_reason: eligible ? "meets_minimum_paid" : `below_minimum_paid (${qualRev} < ${minPaid})`,
      }).eq("id", signup.id);

      if (eligible) {
        const { data: existing } = await sb.from("crm_referral_payouts")
          .select("id").eq("referral_company_signup_id", signup.id).maybeSingle();
        if (!existing) {
          let amount = Number(settings?.fixed_signup_fee ?? 500);
          if (settings?.default_reward_type === "percentage_first_payment") {
            amount = qualRev * Number(settings?.percentage_first_payment_rate ?? 0);
          }
          await sb.from("crm_referral_payouts").insert({
            tenant_id: signup.tenant_id,
            partner_id: signup.partner_id,
            referral_company_signup_id: signup.id,
            referred_company_id: signup.referred_company_id,
            payout_method: "ach",
            payout_amount: amount,
            payout_status: "pending",
          });
        }
      }
    }

    return json({ success: true, status: newStatus });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
