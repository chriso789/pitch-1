// Authenticated: creates a referral link for a partner.
import { corsHeaders, json, requireUser, svcClient, generateCode, assertTenantAccess } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { userId, sb: usb, error } = await requireUser(req);
  if (error) return error;
  try {
    const { tenant_id, partner_id, utm_source, utm_medium, utm_campaign, landing_page } = await req.json();
    if (!tenant_id || !partner_id) return json({ error: "tenant_id, partner_id required" }, 400);
    if (!(await assertTenantAccess(usb!, tenant_id))) return json({ error: "Forbidden" }, 403);

    const sb = svcClient();
    const link_code = generateCode("R", 8);
    const { data, error: e } = await sb.from("crm_referral_links").insert({
      tenant_id, partner_id, link_code,
      utm_source: utm_source || null, utm_medium: utm_medium || null,
      utm_campaign: utm_campaign || null, landing_page: landing_page || null,
      is_active: true,
    }).select().single();
    if (e) throw e;

    const origin = req.headers.get("origin") || "https://pitch-crm.ai";
    return json({ success: true, link: data, signup_url: `${origin}/signup-ref/${link_code}` });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
