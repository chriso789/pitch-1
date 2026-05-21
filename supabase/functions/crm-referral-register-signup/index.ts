// Public endpoint: creates a crm_referral_company_signups row when a referred
// company signs up for the CRM. Called from the public /signup-ref landing page
// (or from the signup flow itself after creating the new tenant).
import { corsHeaders, json, svcClient } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { partner_code, company_name, company_email, company_phone, company_id, admin_user_id, subscription_plan, metadata } = body || {};
    if (!partner_code || !company_name || !company_email) {
      return json({ error: "partner_code, company_name, company_email required" }, 400);
    }

    const sb = svcClient();
    const { data: link } = await sb.rpc("get_public_crm_referral_link", { _code: partner_code });
    const row = Array.isArray(link) ? link[0] : link;
    if (!row || !row.is_active) return json({ error: "Invalid or inactive referral link" }, 404);

    const { data: linkRow } = await sb.from("crm_referral_links").select("tenant_id").eq("id", row.link_id).maybeSingle();
    if (!linkRow) return json({ error: "Link not found" }, 404);

    // Fraud: duplicate email check
    const settings = await sb.from("crm_referral_program_settings").select("*").eq("tenant_id", linkRow.tenant_id).maybeSingle();
    if (settings.data?.duplicate_company_check) {
      const dup = await sb.from("crm_referral_company_signups")
        .select("id").eq("tenant_id", linkRow.tenant_id).ilike("company_email", company_email).maybeSingle();
      if (dup.data) return json({ error: "Duplicate signup detected" }, 409);
    }

    const { data: signup, error } = await sb.from("crm_referral_company_signups").insert({
      tenant_id: linkRow.tenant_id,
      partner_id: row.partner_id,
      link_id: row.link_id,
      company_id: company_id || null,
      admin_user_id: admin_user_id || null,
      company_name,
      company_email,
      company_phone: company_phone || null,
      subscription_plan: subscription_plan || null,
      signup_status: "pending",
      metadata: metadata || {},
    }).select().single();
    if (error) throw error;

    await sb.from("crm_referral_signup_events").insert({
      tenant_id: linkRow.tenant_id,
      partner_id: row.partner_id,
      link_id: row.link_id,
      event_type: "signup",
      utm_source: row.utm_source, utm_medium: row.utm_medium, utm_campaign: row.utm_campaign,
    });

    // Increment partner totals
    await sb.from("crm_referral_links").update({ signup_count: ((await sb.from("crm_referral_links").select("signup_count").eq("id", row.link_id).single()).data?.signup_count ?? 0) + 1 }).eq("id", row.link_id);
    await sb.from("crm_referral_partners").update({ total_signups: ((await sb.from("crm_referral_partners").select("total_signups").eq("id", row.partner_id).single()).data?.total_signups ?? 0) + 1 }).eq("id", row.partner_id);

    return json({ success: true, signup_id: signup.id });
  } catch (e) {
    console.error("crm-referral-register-signup", e);
    return json({ error: (e as Error).message }, 500);
  }
});
