// Public endpoint. Returns only safe fields for the /signup-ref/:partnerCode page.
import { corsHeaders, json, svcClient } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { partner_code } = (await req.json()) || {};
    if (!partner_code) return json({ error: "partner_code required" }, 400);
    const sb = svcClient();

    const { data: link } = await sb.rpc("get_public_crm_referral_link", { _code: partner_code });
    const row = Array.isArray(link) ? link[0] : link;
    if (!row || !row.is_active) {
      return json({ success: false, signup_enabled: false, error: "Invalid or inactive referral link" }, 404);
    }

    const { data: settings } = await sb
      .from("crm_referral_program_settings")
      .select("public_signup_page_enabled, is_enabled, terms_text")
      .eq("tenant_id", row.tenant_id)
      .maybeSingle();

    const enabled =
      (settings?.is_enabled ?? true) && (settings?.public_signup_page_enabled ?? true);

    return json({
      success: true,
      partner_code,
      referring_partner_name: row.partner_display_name ?? null,
      public_headline: "Referred to Pitch CRM by a contractor who uses it.",
      public_subheadline:
        "Run roofing and construction leads, estimates, jobs, documents, communications, and follow-up from one CRM built for contractors.",
      signup_enabled: enabled,
      terms_summary: settings?.terms_text ?? null,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
