import {
  getRequestIp,
  getSupabaseAdminClient,
  hashIp,
  jsonResponse,
  makeVisitorSafeMetadata,
  parseUaLite,
  referralCors,
  resolveReferralLinkByCode,
} from "../_shared/referralSecurity.ts";

const ALLOWED_EVENT_TYPES = new Set([
  "page_view",
  "click_call_button",
  "click_text_button",
  "click_email_button",
  "click_start_form",
  "form_submit",
  "payout_choice_started",
  "payout_choice_saved",
  "duplicate_submission",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: referralCors });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json();
    const { referral_code, event_type } = body;
    if (!referral_code || !event_type) return jsonResponse({ error: "missing_fields" }, 400);
    if (!ALLOWED_EVENT_TYPES.has(event_type)) return jsonResponse({ error: "invalid_event_type" }, 400);

    const supabase = getSupabaseAdminClient();
    const link = await resolveReferralLinkByCode(supabase, referral_code);
    if (!link) return jsonResponse({ error: "invalid_code" }, 404);

    const ip = getRequestIp(req);
    const ip_hash = await hashIp(ip);
    const ua = body.user_agent ?? req.headers.get("user-agent");
    const { device_type, browser, os } = parseUaLite(ua);

    const insertRow = {
      tenant_id: link.tenant_id,
      referral_link_id: link.id,
      referrer_contact_id: link.customer_id,
      event_type,
      event_source: body.event_source ?? null,
      session_id: body.session_id ?? null,
      visitor_id: body.visitor_id ?? null,
      ip_hash,
      user_agent: ua ?? null,
      device_type,
      browser,
      os,
      landing_url: body.landing_url ?? null,
      referrer_url: body.referrer_url ?? null,
      utm_source: body.utm_source ?? null,
      utm_medium: body.utm_medium ?? null,
      utm_campaign: body.utm_campaign ?? null,
      utm_content: body.utm_content ?? null,
      utm_term: body.utm_term ?? null,
      fbclid: body.fbclid ?? null,
      gclid: body.gclid ?? null,
      msclkid: body.msclkid ?? null,
      ttclid: body.ttclid ?? null,
      metadata: makeVisitorSafeMetadata(body.metadata),
    };

    const { data: inserted, error } = await supabase
      .from("referral_events")
      .insert(insertRow)
      .select("id")
      .single();
    if (error) throw error;

    // Velocity check
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await supabase
      .from("referral_events")
      .select("id", { count: "exact", head: true })
      .eq("referral_link_id", link.id)
      .eq("ip_hash", ip_hash)
      .gte("created_at", tenMinAgo);
    if ((count ?? 0) > 20) {
      await supabase.from("referral_flags").insert({
        tenant_id: link.tenant_id,
        referral_link_id: link.id,
        event_id: inserted.id,
        flag_type: "suspicious_click_velocity",
        severity: "medium",
        description: `>20 events from same ip_hash in 10 minutes (${count})`,
      });
    }

    return jsonResponse({ success: true, event_id: inserted.id });
  } catch (e) {
    console.error("[referral-track-event]", e);
    return jsonResponse({ error: "internal_error", message: (e as Error).message }, 500);
  }
});
