// Authenticated: evaluates a signup and creates a pending payout row if eligible.
import { corsHeaders, json, requireUser, svcClient, assertTenantAccess } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { sb: usb, error } = await requireUser(req);
  if (error) return error;
  try {
    const { signup_id } = await req.json();
    if (!signup_id) return json({ error: "signup_id required" }, 400);
    const sb = svcClient();
    const { data: signup, error: e1 } = await sb.from("crm_referral_company_signups").select("*").eq("id", signup_id).single();
    if (e1) throw e1;
    if (!(await assertTenantAccess(usb!, signup.tenant_id))) return json({ error: "Forbidden" }, 403);

    if (!signup.payout_eligible) return json({ eligible: false, reason: "Signup not yet eligible" });
    if (signup.payout_id) return json({ eligible: true, reason: "Already has payout", payout_id: signup.payout_id });
    if (signup.fraud_flag) return json({ eligible: false, reason: "Fraud flagged" });

    const { data: partner } = await sb.from("crm_referral_partners").select("*").eq("id", signup.partner_id).single();
    const { data: settings } = await sb.from("crm_referral_program_settings").select("*").eq("tenant_id", signup.tenant_id).maybeSingle();
    if (!settings?.program_enabled) return json({ eligible: false, reason: "Program disabled" });

    const payoutType = partner?.payout_type || settings.default_payout_type;
    const payoutValue = Number(partner?.payout_value ?? settings.default_payout_value ?? 0);

    let amount = 0;
    let basis = "";
    switch (payoutType) {
      case "flat_fee":
      case "fixed":
        amount = payoutValue; basis = `flat ${payoutValue}`; break;
      case "first_invoice_percentage":
      case "percent_first_invoice":
        amount = Number(signup.first_invoice_amount || 0) * (payoutValue / 100);
        basis = `${payoutValue}% of first invoice ${signup.first_invoice_amount}`; break;
      case "first_year_percentage":
      case "percent_first_year":
        amount = Number(signup.first_year_value || 0) * (payoutValue / 100);
        basis = `${payoutValue}% of first-year value ${signup.first_year_value}`; break;
      case "stored_credit":
      case "account_credit":
        amount = payoutValue; basis = `credit ${payoutValue}`; break;
      default:
        amount = payoutValue; basis = `default ${payoutValue}`;
    }
    amount = Math.round(amount * 100) / 100;

    if (settings.min_payout_threshold && amount < Number(settings.min_payout_threshold)) {
      return json({ eligible: false, reason: `Below min threshold ${settings.min_payout_threshold}` });
    }

    const { data: payout, error: e2 } = await sb.from("crm_referral_payouts").insert({
      tenant_id: signup.tenant_id, partner_id: signup.partner_id, signup_id: signup.id,
      payout_amount: amount, payout_status: "pending", payout_type: payoutType,
      calculation_basis: basis, payment_method: partner?.payment_method || null,
    }).select().single();
    if (e2) throw e2;

    await sb.from("crm_referral_company_signups").update({ payout_id: payout.id }).eq("id", signup.id);
    return json({ eligible: true, payout, amount });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
