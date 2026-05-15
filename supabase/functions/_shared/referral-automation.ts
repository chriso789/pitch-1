// Shared server-side referral automation logic. Used by sync-referral-status
// and evaluate-referral-eligibility edge functions.
//
// Tenancy: every read/write is scoped by tenant_id taken from the referral
// submission row itself.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// ---------- Status mapping (server copy, kept in sync with src/lib/referrals/referralStatusMapping.ts) ----------

export type ReferralSubmissionStatus =
  | "new"
  | "contacted"
  | "appointment_set"
  | "estimate_sent"
  | "sold"
  | "completed"
  | "rejected"
  | "duplicate"
  | "invalid";

export type ReferralJobBucket = "sold" | "completed" | "cancelled" | "paid";

const LEAD_MAP: Record<ReferralSubmissionStatus, string[]> = {
  rejected: ["reject", "lost", "dead", "disqualif", "no sale", "not interested"],
  duplicate: ["duplicate", "dupe"],
  invalid: ["invalid", "spam", "fake"],
  completed: ["complete", "closed won", "won", "finished", "done", "installed"],
  sold: ["sold", "signed", "contract", "approved", "deposit"],
  estimate_sent: ["estimate", "quote", "proposal", "bid", "sent"],
  appointment_set: ["appointment", "appt", "scheduled", "inspection", "demo"],
  contacted: ["contacted", "follow", "in progress", "qualifying", "working", "nurtur"],
  new: ["new", "lead", "fresh", "open", "incoming"],
};

const JOB_MAP: Record<ReferralJobBucket, string[]> = {
  cancelled: ["cancel", "void", "rescind"],
  paid: ["paid", "payment received", "fully paid"],
  completed: ["complete", "closed", "finished", "done", "installed"],
  sold: ["sold", "signed", "contract", "approved", "deposit", "active", "in progress", "production"],
};

const norm = (s: unknown) => (s == null ? "" : String(s)).toLowerCase().trim();

export function mapLeadStatus(raw: unknown, fallback: ReferralSubmissionStatus = "new"): ReferralSubmissionStatus {
  const v = norm(raw);
  if (!v) return fallback;
  for (const [bucket, patterns] of Object.entries(LEAD_MAP) as [ReferralSubmissionStatus, string[]][]) {
    if (patterns.some((p) => v.includes(p))) return bucket;
  }
  return fallback;
}

export function mapJobStatus(raw: unknown): ReferralJobBucket | null {
  const v = norm(raw);
  if (!v) return null;
  for (const [bucket, patterns] of Object.entries(JOB_MAP) as [ReferralJobBucket, string[]][]) {
    if (patterns.some((p) => v.includes(p))) return bucket;
  }
  return null;
}

// ---------- Types ----------

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
  blockingReasons: string[];
  recommendedNextStep: string;
  payoutAmount: number | null;
  payoutMethod: string | null;
  pendingPayoutId: string | null;
  triggerRule: string;
  pendingPayoutCreated: boolean;
}

// ---------- Admin client factory ----------

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// ---------- History helper ----------

async function recordHistory(
  client: SupabaseClient,
  tenantId: string,
  submissionId: string,
  oldStatus: string | null,
  newStatus: string,
  reason: string | null,
  changedBy: string | null = null,
) {
  await client.from("referral_status_history").insert({
    tenant_id: tenantId,
    referral_submission_id: submissionId,
    old_status: oldStatus,
    new_status: newStatus,
    reason,
    changed_by: changedBy,
  });
}

// ---------- Sync: lead ----------

export async function syncSubmissionFromLead(client: SupabaseClient, leadId: string) {
  const { data: subs } = await client
    .from("referral_submissions")
    .select("*")
    .eq("crm_lead_id", leadId);
  if (!subs || subs.length === 0) return null;

  const results: any[] = [];
  for (const sub of subs) {
    const { data: lead } = await client
      .from("pipeline_entries")
      .select("id, status, tenant_id")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) continue;

    const newStatus = mapLeadStatus(lead.status, sub.status as ReferralSubmissionStatus);
    if (newStatus !== sub.status) {
      await client
        .from("referral_submissions")
        .update({ status: newStatus })
        .eq("id", sub.id);
      await recordHistory(
        client,
        sub.tenant_id,
        sub.id,
        sub.status,
        newStatus,
        `Synced from CRM lead status "${lead.status}"`,
      );
    }
    results.push({ submissionId: sub.id, oldStatus: sub.status, newStatus });
  }
  return results;
}

// ---------- Sync: job ----------

export async function syncSubmissionFromJob(client: SupabaseClient, jobId: string) {
  const { data: subs } = await client
    .from("referral_submissions")
    .select("*")
    .eq("crm_job_id", jobId);
  if (!subs || subs.length === 0) return null;

  // Try jobs table first, then projects.
  let row: any = null;
  let source: "jobs" | "projects" | null = null;
  const { data: job } = await client
    .from("jobs")
    .select("id, status, tenant_id, pipeline_entry_id")
    .eq("id", jobId)
    .maybeSingle();
  if (job) {
    row = job;
    source = "jobs";
  } else {
    const { data: project } = await client
      .from("projects")
      .select("id, status, tenant_id, pipeline_entry_id")
      .eq("id", jobId)
      .maybeSingle();
    if (project) {
      row = project;
      source = "projects";
    }
  }
  if (!row) return null;

  const bucket = mapJobStatus(row.status);
  const now = new Date().toISOString();

  // Sum collected revenue from payments where possible.
  let collected = 0;
  const { data: paymentRows } = await client
    .from("payments")
    .select("amount, status, project_id")
    .eq("project_id", jobId);
  if (paymentRows && paymentRows.length) {
    collected = paymentRows
      .filter((p: any) => !p.status || ["paid", "completed", "succeeded", "received"].includes(String(p.status).toLowerCase()))
      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
  } else if (row.pipeline_entry_id) {
    const { data: pp } = await client
      .from("project_payments")
      .select("amount, pipeline_entry_id")
      .eq("pipeline_entry_id", row.pipeline_entry_id);
    if (pp && pp.length) collected = pp.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  }

  const results: any[] = [];
  for (const sub of subs) {
    const update: Record<string, unknown> = { collected_revenue: collected };
    let newStatus: ReferralSubmissionStatus = sub.status;

    if (bucket === "cancelled") {
      update.cancelled_at = now;
      newStatus = "rejected";
    } else if (bucket === "paid") {
      update.completed_at = sub.completed_at ?? now;
      newStatus = "completed";
    } else if (bucket === "completed") {
      update.completed_at = sub.completed_at ?? now;
      newStatus = "completed";
    } else if (bucket === "sold") {
      update.sold_at = sub.sold_at ?? now;
      newStatus = "sold";
    }

    if (newStatus !== sub.status) update.status = newStatus;

    await client.from("referral_submissions").update(update).eq("id", sub.id);

    if (newStatus !== sub.status) {
      await recordHistory(
        client,
        sub.tenant_id,
        sub.id,
        sub.status,
        newStatus,
        `Synced from ${source} status "${row.status}"`,
      );
    }
    results.push({ submissionId: sub.id, oldStatus: sub.status, newStatus, collected });
  }
  return results;
}

// ---------- Eligibility ----------

export async function evaluateEligibility(
  client: SupabaseClient,
  submissionId: string,
): Promise<EligibilityResult & { submission: any; settings: any }> {
  const { data: submission } = await client
    .from("referral_submissions")
    .select("*")
    .eq("id", submissionId)
    .maybeSingle();
  if (!submission) throw new Error("Submission not found");

  const { data: settings } = await client
    .from("referral_program_settings")
    .select("*")
    .eq("tenant_id", submission.tenant_id)
    .maybeSingle();

  const blocking: string[] = [];
  const trigger: string = settings?.payout_trigger || "job_paid";
  let next = "Waiting for status update.";

  // Admin override short-circuits.
  if (submission.admin_override_eligible === false) {
    return finalize({
      eligible: false,
      reason: submission.admin_override_reason || "Blocked by admin override.",
      blockingReasons: [submission.admin_override_reason || "Blocked by admin override."],
      recommendedNextStep: "Admin must lift override to make eligible.",
      payoutAmount: null,
      payoutMethod: null,
      pendingPayoutId: null,
      triggerRule: trigger,
      submission,
      settings,
    });
  }

  // Hard blocks.
  if (!settings?.is_enabled) blocking.push("Referral program is disabled.");
  if (["duplicate", "invalid", "rejected"].includes(submission.status)) {
    blocking.push(`Referral marked ${submission.status}.`);
  }

  // Fraud flags.
  const { data: hasFlag } = await client.rpc("referral_submission_has_blocking_flags", {
    _referral_submission_id: submissionId,
  });
  if (hasFlag) blocking.push("Referral has unresolved high-severity fraud flag.");

  // Self-referral.
  if (
    settings?.block_self_referrals &&
    submission.referrer_contact_id &&
    submission.crm_contact_id &&
    submission.referrer_contact_id === submission.crm_contact_id
  ) {
    blocking.push("Self-referral is not allowed.");
  }

  // Existing payouts.
  const { data: existingPayouts } = await client
    .from("referral_payouts")
    .select("id, payout_status, payout_method, payout_amount")
    .eq("referral_submission_id", submissionId);
  const finalized = (existingPayouts || []).find((p: any) =>
    ["approved", "paid", "stored_as_credit"].includes(p.payout_status),
  );
  if (finalized) blocking.push(`Payout already exists (${finalized.payout_status}).`);

  // Yearly cap.
  if (settings?.max_rewards_per_referrer_per_year && submission.referrer_contact_id) {
    const { data: yr } = await client.rpc("get_referrer_rewards_paid_this_year", {
      _tenant_id: submission.tenant_id,
      _referrer_contact_id: submission.referrer_contact_id,
    });
    const count = Array.isArray(yr) ? Number(yr[0]?.reward_count ?? 0) : Number((yr as any)?.reward_count ?? 0);
    if (count >= Number(settings.max_rewards_per_referrer_per_year)) {
      blocking.push("Maximum referrer rewards for this year reached.");
    }
  }

  // Reward expiration window.
  if (settings?.reward_expiration_days && submission.created_at) {
    const ageDays = (Date.now() - new Date(submission.created_at).getTime()) / 86400000;
    if (ageDays > Number(settings.reward_expiration_days)) {
      blocking.push("Referral has expired (reward window passed).");
    }
  }

  // Minimum days before payout.
  if (settings?.minimum_days_before_payout && submission.created_at) {
    const ageDays = (Date.now() - new Date(submission.created_at).getTime()) / 86400000;
    if (ageDays < Number(settings.minimum_days_before_payout)) {
      blocking.push(
        `Minimum waiting period not met (${Math.ceil(Number(settings.minimum_days_before_payout) - ageDays)} day(s) remaining).`,
      );
    }
  }

  // Trigger gate.
  let triggerSatisfied = false;
  switch (trigger) {
    case "lead_submitted":
      triggerSatisfied = !!submission.consent_to_contact && submission.status !== "duplicate";
      if (!triggerSatisfied && !submission.consent_to_contact) blocking.push("Consent to contact missing.");
      next = triggerSatisfied ? "Ready for payout." : "Awaiting valid lead submission.";
      break;
    case "appointment_completed":
      triggerSatisfied =
        !!submission.appointment_completed_at ||
        ["appointment_set", "estimate_sent", "sold", "completed"].includes(submission.status);
      next = triggerSatisfied ? "Ready for payout." : "Waiting for appointment to be completed.";
      if (!triggerSatisfied) blocking.push("Waiting for appointment to be completed.");
      break;
    case "job_sold":
      triggerSatisfied = !!submission.sold_at || ["sold", "completed"].includes(submission.status);
      next = triggerSatisfied ? "Ready for payout." : "Waiting for job to be sold.";
      if (!triggerSatisfied) blocking.push("Waiting for job to be sold.");
      break;
    case "job_completed":
      triggerSatisfied = !!submission.completed_at || submission.status === "completed";
      next = triggerSatisfied ? "Ready for payout." : "Waiting for job to be completed.";
      if (!triggerSatisfied) blocking.push("Waiting for job to be completed.");
      break;
    case "job_paid":
    default: {
      const minRev = Number(settings?.minimum_collected_revenue ?? 0);
      triggerSatisfied = Number(submission.collected_revenue || 0) >= minRev && Number(submission.collected_revenue || 0) > 0;
      if (!triggerSatisfied) {
        blocking.push(
          minRev > 0
            ? `Collected revenue is below minimum threshold ($${minRev}).`
            : "Waiting for job to be paid.",
        );
        next = "Waiting for job to be paid.";
      } else next = "Ready for payout.";
      break;
    }
  }

  // Admin override eligible (true) bypasses trigger blocks but not finalized payout.
  if (submission.admin_override_eligible === true && !finalized) {
    return finalize({
      eligible: true,
      reason: "Eligible via admin override.",
      blockingReasons: [],
      recommendedNextStep: "Create or approve payout.",
      payoutAmount: null,
      payoutMethod: null,
      pendingPayoutId: (existingPayouts || []).find((p: any) => p.payout_status === "pending")?.id ?? null,
      triggerRule: trigger,
      submission,
      settings,
    });
  }

  const eligible = blocking.length === 0;

  // Payout amount via RPC.
  const { data: amt } = await client.rpc("calculate_referral_reward", {
    _tenant_id: submission.tenant_id,
    _referral_submission_id: submissionId,
  });
  const payoutAmount = amt == null ? null : Number(amt);

  // Preferred method.
  let payoutMethod: string | null = null;
  if (submission.referrer_contact_id) {
    const { data: profile } = await client
      .from("referral_payout_profiles")
      .select("preferred_payout_method")
      .eq("tenant_id", submission.tenant_id)
      .eq("referrer_contact_id", submission.referrer_contact_id)
      .maybeSingle();
    payoutMethod = profile?.preferred_payout_method ?? null;
  }

  return finalize({
    eligible,
    reason: eligible ? "Eligible for payout." : blocking[0] || "Blocked.",
    blockingReasons: blocking,
    recommendedNextStep: eligible ? "Create or approve payout." : next,
    payoutAmount,
    payoutMethod,
    pendingPayoutId: (existingPayouts || []).find((p: any) => p.payout_status === "pending")?.id ?? null,
    triggerRule: trigger,
    submission,
    settings,
  });
}

function finalize(
  o: Omit<EligibilityResult, "pendingPayoutCreated"> & { submission: any; settings: any },
): EligibilityResult & { submission: any; settings: any } {
  return { ...o, pendingPayoutCreated: false };
}

// ---------- Pending payout creation ----------

export async function createPendingPayoutIfEligible(
  client: SupabaseClient,
  submissionId: string,
): Promise<EligibilityResult> {
  const result = await evaluateEligibility(client, submissionId);
  const { submission, settings } = result;

  // Persist eligibility on the submission.
  await client
    .from("referral_submissions")
    .update({
      payout_eligible: result.eligible,
      payout_eligibility_reason: result.eligible ? "Eligible for payout." : result.reason,
    })
    .eq("id", submissionId);

  if (!result.eligible) {
    return stripInternals(result);
  }

  // Skip if a finalized payout exists.
  const { data: existingPayouts } = await client
    .from("referral_payouts")
    .select("*")
    .eq("referral_submission_id", submissionId);
  const finalized = (existingPayouts || []).find((p: any) =>
    ["approved", "paid", "stored_as_credit"].includes(p.payout_status),
  );
  if (finalized) return stripInternals(result);

  const method = result.payoutMethod || "manual_review";
  const amount = result.payoutAmount;

  // If there is a pending payout, refresh amount/method instead of creating a new one.
  const pending = (existingPayouts || []).find((p: any) => p.payout_status === "pending");
  if (pending) {
    await client
      .from("referral_payouts")
      .update({
        payout_amount: amount ?? pending.payout_amount,
        payout_method: pending.payout_method || method,
      })
      .eq("id", pending.id);
    return { ...stripInternals(result), pendingPayoutId: pending.id, payoutMethod: method };
  }

  // Determine status by settings + method.
  let status = "pending";
  let notes: string | null = null;
  const requireApproval = settings?.require_admin_approval !== false;

  if (!requireApproval && method === "stored_balance") {
    status = "stored_as_credit";
  } else if (!requireApproval && ["venmo", "zelle", "gift_card"].includes(method)) {
    status = "approved";
  }
  if (method === "manual_review") {
    notes = "Referrer has not selected a payout method.";
  }

  const { data: created, error: insErr } = await client
    .from("referral_payouts")
    .insert({
      tenant_id: submission.tenant_id,
      referral_submission_id: submissionId,
      referral_link_id: submission.referral_link_id,
      referrer_contact_id: submission.referrer_contact_id,
      payout_method: method,
      payout_amount: amount,
      payout_status: status,
      notes,
    })
    .select("*")
    .single();
  if (insErr) throw insErr;

  // For stored-credit auto-approval, post to ledger.
  if (status === "stored_as_credit" && amount) {
    const { data: balRow } = await client.rpc("get_referrer_credit_balance", {
      _tenant_id: submission.tenant_id,
      _referrer_contact_id: submission.referrer_contact_id,
    });
    const newBalance = Number(balRow ?? 0) + Number(amount);
    await client.from("referral_credit_ledger").insert({
      tenant_id: submission.tenant_id,
      referrer_contact_id: submission.referrer_contact_id,
      referral_payout_id: created.id,
      transaction_type: "credit_earned",
      amount,
      balance_after: newBalance,
      notes: "Auto-credited from referral payout.",
    });
  }

  await recordHistory(
    client,
    submission.tenant_id,
    submissionId,
    null,
    "pending_payout_created",
    `Method: ${method}, Amount: ${amount ?? "manual"}`,
  );

  return {
    ...stripInternals(result),
    pendingPayoutId: created.id,
    payoutMethod: method,
    payoutAmount: amount,
    pendingPayoutCreated: true,
  };
}

function stripInternals(r: EligibilityResult & { submission?: any; settings?: any }): EligibilityResult {
  const { submission: _s, settings: _t, ...rest } = r;
  return rest;
}

// ---------- Auth helper ----------

export async function getUserFromRequest(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s+/i, "");
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data } = await client.auth.getUser();
  return data?.user ? { id: data.user.id } : null;
}

export async function userHasTenantAccess(
  client: SupabaseClient,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const { data } = await client
    .from("user_company_access")
    .select("id")
    .eq("user_id", userId)
    .eq("company_id", tenantId)
    .maybeSingle();
  return !!data;
}
