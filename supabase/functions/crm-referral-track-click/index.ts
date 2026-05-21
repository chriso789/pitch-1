// Public endpoint: records a click/view on a /signup-ref/:partnerCode link.
import { corsHeaders, json, svcClient } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { partner_code, event_type = "click", visitor_id, session_id, referrer_url, utm_source, utm_medium, utm_campaign } = body || {};
    if (!partner_code) return json({ error: "partner_code required" }, 400);

    const sb = svcClient();
    const { data: link, error: linkErr } = await sb.rpc("get_public_crm_referral_link", { _code: partner_code });
    if (linkErr) throw linkErr;
    const row = Array.isArray(link) ? link[0] : link;
    if (!row || !row.is_active) return json({ error: "Invalid or inactive link" }, 404);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const ipHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
    const ipHash = Array.from(new Uint8Array(ipHashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);

    // Look up tenant_id from link
    const { data: linkRow } = await sb.from("crm_referral_links").select("tenant_id").eq("id", row.link_id).maybeSingle();
    if (!linkRow) return json({ error: "Link not found" }, 404);

    await sb.from("crm_referral_signup_events").insert({
      tenant_id: linkRow.tenant_id,
      partner_id: row.partner_id,
      link_id: row.link_id,
      event_type,
      visitor_id: visitor_id || null,
      session_id: session_id || null,
      ip_hash: ipHash,
      user_agent: req.headers.get("user-agent") || null,
      referrer_url: referrer_url || null,
      utm_source: utm_source || row.utm_source,
      utm_medium: utm_medium || row.utm_medium,
      utm_campaign: utm_campaign || row.utm_campaign,
    });

    if (event_type === "click") {
      await sb.rpc("increment", { tbl: "crm_referral_links", col: "click_count", id: row.link_id }).catch(() => {});
      // Fallback if RPC missing:
      await sb.from("crm_referral_links")
        .update({ click_count: (await sb.from("crm_referral_links").select("click_count").eq("id", row.link_id).single()).data?.click_count + 1 || 1 })
        .eq("id", row.link_id);
    }

    return json({ success: true, partner_display_name: row.partner_display_name });
  } catch (e) {
    console.error("crm-referral-track-click", e);
    return json({ error: (e as Error).message }, 500);
  }
});
