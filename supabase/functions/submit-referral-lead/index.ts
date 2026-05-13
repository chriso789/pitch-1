import {
  getRequestIp,
  getSupabaseAdminClient,
  hashIp,
  jsonResponse,
  referralCors,
  resolveReferralLinkByCode,
} from "../_shared/referralSecurity.ts";
import {
  detectDuplicateReferral,
  detectSelfReferral,
  validateReferralLeadPayload,
} from "../_shared/referralValidation.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: referralCors });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json();
    const v = validateReferralLeadPayload(body);
    if (!v.ok) return jsonResponse({ error: v.error }, 400);
    const payload = v.value;

    const supabase = getSupabaseAdminClient();
    const link = await resolveReferralLinkByCode(supabase, payload.referral_code);
    if (!link) return jsonResponse({ error: "invalid_code" }, 404);

    const { data: settings } = await supabase
      .from("referral_program_settings")
      .select("*")
      .eq("tenant_id", link.tenant_id)
      .maybeSingle();

    let referrerContact: any = null;
    if (link.customer_id) {
      const { data } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, email, phone")
        .eq("id", link.customer_id)
        .maybeSingle();
      referrerContact = data;
    }

    const dupWindow = settings?.duplicate_window_days ?? 180;
    const isDuplicate = await detectDuplicateReferral(supabase, link.tenant_id, payload, dupWindow);
    const isSelf = detectSelfReferral(referrerContact, payload);

    let status: string = "new";
    if (isDuplicate) status = "duplicate";
    if (isSelf && settings && settings.block_self_referrals !== false) status = "invalid";

    const ip = getRequestIp(req);
    const ip_hash = await hashIp(ip);

    const { data: submission, error: subErr } = await supabase
      .from("referral_submissions")
      .insert({
        tenant_id: link.tenant_id,
        referral_link_id: link.id,
        referrer_contact_id: link.customer_id,
        source_job_id: link.source_job_id ?? null,
        referred_first_name: payload.referred_first_name,
        referred_last_name: payload.referred_last_name ?? "",
        referred_email: payload.referred_email ?? null,
        referred_phone: payload.referred_phone,
        referred_property_address: (body.referred_property_address as string) ?? null,
        referred_city: (body.referred_city as string) ?? null,
        referred_state: (body.referred_state as string) ?? null,
        referred_zip: (body.referred_zip as string) ?? null,
        project_type: (body.project_type as string) ?? null,
        roof_type_interest: (body.roof_type_interest as string) ?? null,
        service_needed: (body.service_needed as string) ?? null,
        message: (body.message as string) ?? null,
        preferred_contact_method: (body.preferred_contact_method as string) ?? "phone",
        consent_to_contact: payload.consent_to_contact,
        status,
        ip_hash,
        user_agent: req.headers.get("user-agent"),
        utm_source: (body.utm_source as string) ?? null,
        utm_medium: (body.utm_medium as string) ?? null,
        utm_campaign: (body.utm_campaign as string) ?? null,
      })
      .select("id, status")
      .single();
    if (subErr) throw subErr;

    if (isDuplicate) {
      await supabase.from("referral_flags").insert({
        tenant_id: link.tenant_id,
        referral_submission_id: submission.id,
        referral_link_id: link.id,
        flag_type: "duplicate_phone",
        severity: "medium",
        description: "Phone or email matched a prior submission within duplicate window",
      });
    }
    if (isSelf) {
      await supabase.from("referral_flags").insert({
        tenant_id: link.tenant_id,
        referral_submission_id: submission.id,
        referral_link_id: link.id,
        flag_type: "self_referral",
        severity: "high",
        description: "Submitter contact info matches the referrer",
      });
    }

    await supabase.from("referral_events").insert({
      tenant_id: link.tenant_id,
      referral_link_id: link.id,
      referrer_contact_id: link.customer_id,
      event_type: "form_submit",
      visitor_id: (body.visitor_id as string) ?? null,
      session_id: (body.session_id as string) ?? null,
      ip_hash,
      user_agent: req.headers.get("user-agent"),
      utm_source: (body.utm_source as string) ?? null,
      utm_medium: (body.utm_medium as string) ?? null,
      utm_campaign: (body.utm_campaign as string) ?? null,
      metadata: { submission_id: submission.id, status },
    });

    const publicMessage = isDuplicate
      ? "We may already have your information, but our team has been notified."
      : "Thanks! We'll be in touch shortly.";

    return jsonResponse({
      success: true,
      referral_submission_id: submission.id,
      status: submission.status,
      message: publicMessage,
    });
  } catch (e) {
    console.error("[submit-referral-lead]", e);
    return jsonResponse({ error: "internal_error", message: (e as Error).message }, 500);
  }
});
