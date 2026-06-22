// sync-crm-referral-subscription-status
// Internal endpoint. Applies a billing-event-driven status change to the
// referral signup row for a given company, writes both the new audit table
// (crm_referral_subscription_history) and the legacy crm_referral_status_history,
// and lazily creates a pending payout the first time the company transitions
// to active_paid.
//
// Auth modes accepted:
//   1. Bearer JWT (authenticated user) - admin "Mark Active Paid" fallback
//   2. x-internal-secret: <INTERNAL_WORKER_SECRET> - stripe-webhook dispatch
//
// Status mapping (caller passes one of):
//   active_paid | trialing | payment_failed | past_due | canceled | cancelled

import { corsHeaders, json, svcClient, userClient } from "../_shared/crm-referral.ts";

const INTERNAL_SECRET = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";

type IncomingStatus = "active_paid" | "active" | "paid" | "trialing" | "payment_failed" | "past_due" | "canceled" | "cancelled";

interface SyncBody {
  company_id?: string;            // preferred
  subscription_id?: string;       // stripe_subscription_id fallback
  customer_id?: string;           // stripe_customer_id fallback
  status: IncomingStatus;
  paid_amount?: number;
  stripe_event_id?: string;
  stripe_event_type?: string;
  source?: "stripe_webhook" | "manual" | "sync_fn";
  notes?: string;
  event_at?: string;
}

async function authorize(req: Request): Promise<{ userId: string | null; source: "stripe_webhook" | "manual" | "sync_fn" } | { error: Response }> {
  const internal = req.headers.get("x-internal-secret") ?? "";
  if (INTERNAL_SECRET && internal && internal === INTERNAL_SECRET) {
    return { userId: null, source: "stripe_webhook" };
  }
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return { error: json({ error: "Unauthorized" }, 401) };
  const sb = userClient(auth);
  const token = auth.replace("Bearer ", "");
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims) return { error: json({ error: "Unauthorized" }, 401) };
  return { userId: data.claims.sub as string, source: "manual" };
}

function mapStatus(s: IncomingStatus): "active_paid" | "trialing" | "payment_failed" | "churned" | null {
  if (s === "active_paid" || s === "active" || s === "paid") return "active_paid";
  if (s === "trialing") return "trialing";
  if (s === "payment_failed" || s === "past_due") return "payment_failed";
  if (s === "canceled" || s === "cancelled") return "churned";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authz = await authorize(req);
    if ("error" in authz) return authz.error;

    const body = (await req.json().catch(() => ({}))) as SyncBody;
    const { status, paid_amount, stripe_event_id, stripe_event_type, notes, event_at } = body;
    const source = body.source ?? authz.source;
    if (!status) return json({ error: "status required" }, 400);

    const nextStatus = mapStatus(status);
    if (!nextStatus) return json({ error: `unsupported status: ${status}` }, 400);

    const sb = svcClient();

    // Resolve company_id from whatever the caller provided.
    let companyId = body.company_id ?? null;
    if (!companyId && body.subscription_id) {
      const { data } = await sb.from("tenants").select("id").eq("stripe_subscription_id", body.subscription_id).maybeSingle();
      companyId = data?.id ?? null;
    }
    if (!companyId && body.customer_id) {
      const { data } = await sb.from("tenants").select("id").eq("stripe_customer_id", body.customer_id).maybeSingle();
      companyId = data?.id ?? null;
    }
    if (!companyId) {
      return json({ success: false, reason: "company_unresolved" }, 200);
    }

    const { data: signup } = await sb
      .from("crm_referral_company_signups")
      .select("id, tenant_id, partner_id, signup_status, paid_at, first_invoice_amount, payout_eligible")
      .eq("company_id", companyId)
      .maybeSingle();

    if (!signup) {
      return json({ success: false, reason: "signup_not_found", company_id: companyId }, 200);
    }

    const previousStatus = signup.signup_status as string | null;
    const nowIso = event_at || new Date().toISOString();
    const updates: Record<string, unknown> = {
      signup_status: nextStatus,
      updated_at: nowIso,
    };

    if (nextStatus === "active_paid") {
      if (!signup.paid_at) updates.paid_at = nowIso;
      if (paid_amount && (!signup.first_invoice_amount || Number(signup.first_invoice_amount) === 0)) {
        updates.first_invoice_amount = paid_amount;
      }
    } else if (nextStatus === "churned") {
      updates.churned_at = nowIso;
    }

    await sb.from("crm_referral_company_signups").update(updates).eq("id", signup.id);

    // New canonical audit row
    await sb.from("crm_referral_subscription_history").insert({
      signup_id: signup.id,
      tenant_id: signup.tenant_id,
      company_id: companyId,
      previous_status: previousStatus,
      next_status: nextStatus,
      stripe_event_id: stripe_event_id ?? null,
      stripe_event_type: stripe_event_type ?? null,
      source,
      paid_amount: paid_amount ?? null,
      notes: notes ?? null,
    });

    // Legacy compatibility row (kept until consumers migrate)
    if (previousStatus !== nextStatus) {
      await sb.from("crm_referral_status_history").insert({
        tenant_id: signup.tenant_id,
        partner_id: signup.partner_id,
        signup_id: signup.id,
        entity_type: "signup",
        old_status: previousStatus,
        new_status: nextStatus,
        change_reason: `sync-crm-referral-subscription-status:${source}${stripe_event_type ? `:${stripe_event_type}` : ""}`,
        changed_by: authz.userId,
      });
    }

    // Payout creation guard: only the first transition into active_paid, only if no payout exists.
    let payoutCreated = false;
    if (nextStatus === "active_paid" && previousStatus !== "active_paid") {
      const { data: existingPayout } = await sb
        .from("crm_referral_payouts")
        .select("id")
        .eq("signup_id", signup.id)
        .maybeSingle();
      if (!existingPayout) {
        const { data: settings } = await sb
          .from("crm_referral_program_settings")
          .select("default_payout_type, default_payout_value, signup_bonus_amount, first_invoice_percentage")
          .eq("tenant_id", signup.tenant_id)
          .maybeSingle();

        const qualifying = Number(updates.first_invoice_amount ?? signup.first_invoice_amount ?? paid_amount ?? 0);
        let amount = Number(settings?.signup_bonus_amount ?? settings?.default_payout_value ?? 0);
        if (settings?.default_payout_type === "percentage_first_invoice" && settings?.first_invoice_percentage) {
          amount = qualifying * Number(settings.first_invoice_percentage) / 100;
        }

        if (amount > 0) {
          const { error: payoutErr } = await sb.from("crm_referral_payouts").insert({
            tenant_id: signup.tenant_id,
            partner_id: signup.partner_id,
            signup_id: signup.id,
            payout_amount: amount,
            payout_status: "pending",
            payout_type: settings?.default_payout_type ?? "fixed",
            calculation_basis: qualifying,
          });
          if (!payoutErr) payoutCreated = true;
        }
        await sb
          .from("crm_referral_company_signups")
          .update({ payout_eligible: amount > 0, payout_eligible_at: amount > 0 ? nowIso : null })
          .eq("id", signup.id);
      }
    }

    return json({
      success: true,
      signup_id: signup.id,
      previous_status: previousStatus,
      next_status: nextStatus,
      payout_created: payoutCreated,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
