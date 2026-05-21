// Public endpoint. Inserts a crm_referral_company_signups row and a
// signup_submitted event. Marks duplicates within duplicate_window_days.
import { corsHeaders, json, svcClient } from "../_shared/crm-referral.ts";

function normEmail(s?: string) { return (s || "").trim().toLowerCase(); }
function normPhone(s?: string) { return (s || "").replace(/[^0-9+]/g, ""); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const b = await req.json();
    const {
      partner_code,
      visitor_id,
      session_id,
      referred_company_name,
      referred_owner_name,
      referred_owner_email,
      referred_owner_phone,
      referred_company_website,
      referred_company_city,
      referred_company_state,
      referred_company_trade,
      selected_plan,
      current_crm,
      number_of_users,
      message,
      consent_to_contact,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid,
    } = b || {};

    if (!partner_code || !referred_company_name || !referred_owner_name || !referred_owner_email || !referred_owner_phone) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (!consent_to_contact) return json({ error: "Consent required" }, 400);

    const email = normEmail(referred_owner_email);
    const phone = normPhone(referred_owner_phone);

    const sb = svcClient();
    const { data: link } = await sb.rpc("get_public_crm_referral_link", { _code: partner_code });
    const row = Array.isArray(link) ? link[0] : link;
    if (!row || !row.is_active) return json({ error: "Invalid or inactive referral link" }, 404);

    const { data: settings } = await sb
      .from("crm_referral_program_settings")
      .select("duplicate_window_days")
      .eq("tenant_id", row.tenant_id)
      .maybeSingle();
    const windowDays = settings?.duplicate_window_days ?? 365;
    const since = new Date(Date.now() - windowDays * 86400000).toISOString();

    const { data: dup } = await sb
      .from("crm_referral_company_signups")
      .select("id")
      .eq("tenant_id", row.tenant_id)
      .gte("created_at", since)
      .or(`referred_owner_email.ilike.${email},referred_owner_phone.eq.${phone},referred_company_name.ilike.${referred_company_name}`)
      .limit(1)
      .maybeSingle();

    const signup_status = dup ? "duplicate" : "lead";

    const { data: inserted, error } = await sb.from("crm_referral_company_signups").insert({
      tenant_id: row.tenant_id,
      partner_id: row.partner_id,
      referral_link_id: row.link_id,
      partner_code,
      referred_company_name,
      referred_owner_name,
      referred_owner_email: email,
      referred_owner_phone: phone,
      referred_company_website,
      referred_company_city,
      referred_company_state,
      referred_company_trade,
      selected_plan,
      signup_status,
    }).select().single();
    if (error) return json({ error: error.message }, 400);

    await sb.from("crm_referral_signup_events").insert({
      tenant_id: row.tenant_id,
      partner_id: row.partner_id,
      referral_link_id: row.link_id,
      partner_code,
      event_type: "signup_submitted",
      visitor_id, session_id,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid,
      metadata: { signup_id: inserted.id, current_crm, number_of_users, message },
    });

    if (dup) {
      await sb.from("crm_referral_flags").insert({
        tenant_id: row.tenant_id,
        partner_id: row.partner_id,
        referral_company_signup_id: inserted.id,
        flag_type: "duplicate_signup",
        severity: "high",
        description: `Duplicate within ${windowDays}d window`,
      });
    }

    return json({ success: true, signup_id: inserted.id, status: signup_status });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
