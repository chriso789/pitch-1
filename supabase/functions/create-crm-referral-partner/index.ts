// Spec-named admin endpoint. Creates (or reuses) a partner row and emits a
// default referral link. Forwards heavy lifting to crm-referral-create-link.
import { corsHeaders, json, requireUser, svcClient, generateCode } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const u = await requireUser(req);
    if ("error" in u) return u.error;
    const body = await req.json();
    const {
      referring_company_id,
      referring_user_id,
      partner_contact_id,
      partner_name,
      partner_email,
      partner_phone,
      partner_type = "contractor",
      campaign_name,
    } = body || {};
    if (!partner_name || !referring_company_id) {
      return json({ error: "partner_name and referring_company_id required" }, 400);
    }

    const sb = svcClient();
    const sanitized = String(partner_name).toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || "PARTNER";
    const partner_code = `CRM-${sanitized}-${generateCode("", 4)}`;

    const { data: partner, error: pErr } = await sb
      .from("crm_referral_partners")
      .insert({
        tenant_id: referring_company_id,
        referring_company_id,
        referring_user_id: referring_user_id ?? u.userId,
        partner_contact_id,
        partner_name,
        partner_email,
        partner_phone,
        partner_type,
        partner_code,
        status: "active",
        created_by: u.userId,
      })
      .select()
      .single();
    if (pErr) return json({ error: pErr.message }, 400);

    const { data: link, error: lErr } = await sb
      .from("crm_referral_links")
      .insert({
        tenant_id: referring_company_id,
        partner_id: partner.id,
        referring_company_id,
        referring_user_id: referring_user_id ?? u.userId,
        partner_code,
        campaign_name,
        status: "active",
        created_by: u.userId,
      })
      .select()
      .single();
    if (lErr) return json({ error: lErr.message }, 400);

    const base = Deno.env.get("PUBLIC_APP_URL") || "https://pitch-crm.ai";
    return json({
      success: true,
      partner_id: partner.id,
      partner_code,
      signup_referral_url: `${base}/signup-ref/${partner_code}`,
      partner_dashboard_url: `${base}/app/settings/company-referrals`,
      link_id: link.id,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
