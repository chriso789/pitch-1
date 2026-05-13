import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { jsonResponse, referralCors } from "../_shared/referralSecurity.ts";
import {
  buildReferralEmailBody,
  buildReferralEmailSubject,
  buildReferralSmsMessage,
} from "../_shared/referralMessages.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: referralCors });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userData?.user) return jsonResponse({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();
    const { tenant_id, referrer_contact_id, source_job_id, campaign_id, custom_note } = body;
    if (!tenant_id || !referrer_contact_id) return jsonResponse({ error: "missing_fields" }, 400);

    // Verify access
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, active_tenant_id")
      .eq("id", userId)
      .maybeSingle();
    let allowed = profile?.tenant_id === tenant_id || profile?.active_tenant_id === tenant_id;
    if (!allowed) {
      const { data: access } = await supabase
        .from("user_company_access")
        .select("tenant_id")
        .eq("user_id", userId)
        .eq("tenant_id", tenant_id)
        .maybeSingle();
      allowed = !!access;
    }
    if (!allowed) {
      const { data: master } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "master")
        .maybeSingle();
      allowed = !!master;
    }
    if (!allowed) return jsonResponse({ error: "forbidden" }, 403);

    // Verify contact
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, first_name, tenant_id")
      .eq("id", referrer_contact_id)
      .maybeSingle();
    if (!contact || contact.tenant_id !== tenant_id) return jsonResponse({ error: "invalid_contact" }, 400);

    // Existing active link?
    let q = supabase
      .from("referral_codes")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("customer_id", referrer_contact_id)
      .eq("is_active", true);
    if (source_job_id) q = q.eq("source_job_id", source_job_id);
    const { data: existing } = await q.limit(1).maybeSingle();

    let link = existing;
    if (!link) {
      const { data: codeData, error: codeErr } = await supabase.rpc("generate_referral_code", {
        _tenant_id: tenant_id,
        _contact_id: referrer_contact_id,
      });
      if (codeErr) throw codeErr;
      const insertRow: Record<string, unknown> = {
        tenant_id,
        customer_id: referrer_contact_id,
        code: codeData,
        is_active: true,
        status: "active",
        source_job_id: source_job_id ?? null,
      };
      if (custom_note) insertRow.landing_message = custom_note;
      const { data: newLink, error: insErr } = await supabase
        .from("referral_codes")
        .insert(insertRow)
        .select("*")
        .single();
      if (insErr) throw insErr;
      link = newLink;
    }

    // Tenant company name for messages
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", tenant_id)
      .maybeSingle();
    const companyName = tenantRow?.name ?? "Our team";

    const origin = req.headers.get("origin") ?? "";
    const PUBLIC_APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? origin ?? "https://pitch-crm.ai";
    const referral_url = `${PUBLIC_APP_URL}/ref/${link.code}`;
    const reward_url = `${PUBLIC_APP_URL}/ref/${link.code}/reward`;

    return jsonResponse({
      success: true,
      referral_link_id: link.id,
      referral_code: link.code,
      referral_url,
      reward_url,
      share_message_sms: buildReferralSmsMessage(companyName, referral_url, reward_url),
      share_message_email_subject: buildReferralEmailSubject(companyName),
      share_message_email_body: buildReferralEmailBody(companyName, referral_url, reward_url),
    });
  } catch (e) {
    console.error("[create-referral-link]", e);
    return jsonResponse({ error: "internal_error", message: (e as Error).message }, 500);
  }
});
