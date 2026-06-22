// attach-crm-referral-to-new-company
// Internal endpoint. Claims an existing crm_referral_company_signups row for a
// newly-provisioned company. Idempotent and non-fatal: if no referral match is
// found, returns { attributed: false } and lets owner provisioning continue.
//
// Auth modes accepted:
//   1. Bearer JWT (authenticated user) - legacy callers / admin tools
//   2. x-internal-secret: <INTERNAL_WORKER_SECRET> - service-to-service from
//      provision-tenant-owner (and other internal workers)
//
// Match order: partner_code -> visitor/session cookie event -> owner_email.
// All writes use the real columns of crm_referral_company_signups /
// crm_referral_status_history as they exist in production today.

import { corsHeaders, json, svcClient, userClient } from "../_shared/crm-referral.ts";

const INTERNAL_SECRET = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";

interface AttachBody {
  company_id?: string;     // tenant_id of the newly-created company
  owner_user_id?: string;
  owner_email?: string;
  partner_code?: string;
  visitor_id?: string;
  session_id?: string;
  subscription_plan?: string;
}

async function authorize(req: Request): Promise<{ userId: string | null } | { error: Response }> {
  const internal = req.headers.get("x-internal-secret") ?? "";
  if (INTERNAL_SECRET && internal && internal === INTERNAL_SECRET) {
    return { userId: null };
  }
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }
  const sb = userClient(auth);
  const token = auth.replace("Bearer ", "");
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims) return { error: json({ error: "Unauthorized" }, 401) };
  return { userId: data.claims.sub as string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authz = await authorize(req);
    if ("error" in authz) return authz.error;
    const callerUserId = authz.userId;

    const body = (await req.json().catch(() => ({}))) as AttachBody;
    const { company_id, owner_user_id, owner_email, partner_code, visitor_id, session_id, subscription_plan } = body;
    if (!company_id) return json({ error: "company_id required" }, 400);

    const sb = svcClient();

    // Idempotency: if this company is already attributed, return immediately.
    {
      const { data: existing } = await sb
        .from("crm_referral_company_signups")
        .select("id, signup_status, partner_id")
        .eq("company_id", company_id)
        .maybeSingle();
      if (existing) {
        return json({
          success: true,
          attributed: true,
          idempotent: true,
          signup_id: existing.id,
          partner_id: existing.partner_id,
          status: existing.signup_status,
        });
      }
    }

    // Resolve candidate signup via match order.
    let signup: { id: string; tenant_id: string | null; partner_id: string | null; signup_status: string | null } | null = null;

    // 1) partner_code -> partner_id -> oldest unclaimed signup for that partner
    if (partner_code) {
      const { data: partner } = await sb
        .from("crm_referral_partners")
        .select("id")
        .eq("partner_code", partner_code)
        .maybeSingle();
      if (partner?.id) {
        const { data } = await sb
          .from("crm_referral_company_signups")
          .select("id, tenant_id, partner_id, signup_status")
          .eq("partner_id", partner.id)
          .is("company_id", null)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        signup = data ?? null;
      }
    }

    // 2) visitor/session cookie -> signup_event -> partner_id -> oldest unclaimed signup
    if (!signup && (visitor_id || session_id)) {
      const filter = visitor_id ? `visitor_id.eq.${visitor_id}` : `session_id.eq.${session_id}`;
      const { data: ev } = await sb
        .from("crm_referral_signup_events")
        .select("partner_id")
        .or(filter)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ev?.partner_id) {
        const { data } = await sb
          .from("crm_referral_company_signups")
          .select("id, tenant_id, partner_id, signup_status")
          .eq("partner_id", ev.partner_id)
          .is("company_id", null)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        signup = data ?? null;
      }
    }

    // 3) owner_email -> match on signup company_email (admin-pre-registered signup)
    if (!signup && owner_email) {
      const { data } = await sb
        .from("crm_referral_company_signups")
        .select("id, tenant_id, partner_id, signup_status")
        .ilike("company_email", owner_email)
        .is("company_id", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      signup = data ?? null;
    }

    if (!signup) {
      return json({ success: true, attributed: false, reason: "no_match" });
    }

    const oldStatus = signup.signup_status;
    const updates: Record<string, unknown> = {
      company_id,
      signup_status: "account_created",
      updated_at: new Date().toISOString(),
    };
    if (owner_user_id) updates.admin_user_id = owner_user_id;
    if (subscription_plan) updates.subscription_plan = subscription_plan;

    const { error: updErr } = await sb
      .from("crm_referral_company_signups")
      .update(updates)
      .eq("id", signup.id)
      .is("company_id", null); // optimistic: prevents double-claim race
    if (updErr) return json({ error: updErr.message }, 400);

    await sb.from("crm_referral_status_history").insert({
      tenant_id: signup.tenant_id,
      partner_id: signup.partner_id,
      signup_id: signup.id,
      entity_type: "signup",
      old_status: oldStatus,
      new_status: "account_created",
      change_reason: "attach-crm-referral-to-new-company",
      changed_by: callerUserId,
    });

    return json({
      success: true,
      attributed: true,
      idempotent: false,
      signup_id: signup.id,
      partner_id: signup.partner_id,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
