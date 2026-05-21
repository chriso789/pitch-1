// Public endpoint. Inserts a crm_referral_signup_events row and raises a
// suspicious_click_velocity flag when >20 events from the same ip_hash in 10 min.
import { corsHeaders, json, svcClient } from "../_shared/crm-referral.ts";

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const {
      partner_code,
      event_type = "page_view",
      visitor_id,
      session_id,
      landing_url,
      referrer_url,
      user_agent,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      fbclid,
      gclid,
      metadata,
    } = body || {};
    if (!partner_code || !event_type) return json({ error: "partner_code and event_type required" }, 400);

    const sb = svcClient();
    const { data: link } = await sb.rpc("get_public_crm_referral_link", { _code: partner_code });
    const row = Array.isArray(link) ? link[0] : link;

    const salt = Deno.env.get("CRM_REFERRAL_IP_HASH_SALT") || Deno.env.get("REFERRAL_IP_HASH_SALT") || "pitch-crm-default-salt";
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const ip_hash = ip ? await sha256(salt + ip) : null;

    const { data: event } = await sb
      .from("crm_referral_signup_events")
      .insert({
        tenant_id: row?.tenant_id ?? null,
        partner_id: row?.partner_id ?? null,
        referral_link_id: row?.link_id ?? null,
        partner_code,
        event_type,
        visitor_id,
        session_id,
        ip_hash,
        user_agent: user_agent ?? req.headers.get("user-agent"),
        landing_url,
        referrer_url,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        fbclid,
        gclid,
        metadata: metadata ?? {},
      })
      .select()
      .single();

    // Velocity check
    if (ip_hash && row?.partner_id) {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { count } = await sb
        .from("crm_referral_signup_events")
        .select("id", { count: "exact", head: true })
        .eq("partner_code", partner_code)
        .eq("ip_hash", ip_hash)
        .gte("created_at", since);
      if ((count ?? 0) > 20) {
        await sb.from("crm_referral_flags").insert({
          tenant_id: row.tenant_id,
          partner_id: row.partner_id,
          signup_event_id: event?.id,
          flag_type: "suspicious_click_velocity",
          severity: "medium",
          description: `>${count} events from same ip_hash in 10 min`,
        });
      }
    }

    return json({ success: true, event_id: event?.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
