// Authenticated/internal endpoint. Attaches an existing crm_referral_company_signups
// row to a newly-created company by resolving attribution.
import { corsHeaders, json, requireUser, svcClient } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const u = await requireUser(req);
    if ("error" in u) return u.error;
    const b = await req.json();
    const {
      partner_code, visitor_id, session_id,
      referred_company_id, owner_user_id, owner_email,
      subscription_id, payment_customer_id, selected_plan,
    } = b || {};
    if (!referred_company_id) return json({ error: "referred_company_id required" }, 400);

    const sb = svcClient();
    let signup: any = null;

    if (partner_code) {
      const { data } = await sb.from("crm_referral_company_signups")
        .select("*").eq("partner_code", partner_code)
        .is("referred_company_id", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      signup = data;
    }
    if (!signup && (visitor_id || session_id)) {
      const { data: settings } = await sb.from("crm_referral_program_settings")
        .select("cookie_attribution_days").limit(1).maybeSingle();
      const days = settings?.cookie_attribution_days ?? 90;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const filter = visitor_id ? `visitor_id.eq.${visitor_id}` : `session_id.eq.${session_id}`;
      const { data: ev } = await sb.from("crm_referral_signup_events")
        .select("partner_code").or(filter).gte("created_at", since)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (ev?.partner_code) {
        const { data } = await sb.from("crm_referral_company_signups")
          .select("*").eq("partner_code", ev.partner_code).is("referred_company_id", null)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        signup = data;
      }
    }
    if (!signup && owner_email) {
      const { data } = await sb.from("crm_referral_company_signups")
        .select("*").ilike("referred_owner_email", owner_email)
        .is("referred_company_id", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      signup = data;
    }
    if (!signup) return json({ success: false, attributed: false, reason: "no_match" });

    const oldStatus = signup.signup_status;
    const { error } = await sb.from("crm_referral_company_signups").update({
      referred_company_id,
      referred_owner_user_id: owner_user_id,
      subscription_id, payment_customer_id, selected_plan,
      signup_status: "account_created",
      updated_at: new Date().toISOString(),
    }).eq("id", signup.id);
    if (error) return json({ error: error.message }, 400);

    await sb.from("crm_referral_status_history").insert({
      tenant_id: signup.tenant_id,
      partner_id: signup.partner_id,
      referral_company_signup_id: signup.id,
      old_status: oldStatus,
      new_status: "account_created",
      reason: "attach-crm-referral-to-new-company",
      changed_by: u.userId,
    });

    return json({ success: true, attributed: true, signup_id: signup.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
