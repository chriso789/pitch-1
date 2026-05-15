/**
 * Client-side wrappers around the referral automation edge functions.
 * The eligibility/sync rules themselves live server-side in
 * supabase/functions/_shared/referral-automation.ts so we never trust the
 * browser to compute payout decisions.
 */

import { supabase } from "@/integrations/supabase/client";
import { insertReferralStatusHistory } from "./referralHistory";

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

async function invoke<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  return data as T;
}

export const syncReferralSubmissionFromLead = (leadId: string) =>
  invoke("sync-referral-status", { type: "lead", lead_id: leadId });

export const syncReferralSubmissionFromJob = (jobId: string) =>
  invoke("sync-referral-status", { type: "job", job_id: jobId });

export const syncReferralSubmissionDirect = (referralSubmissionId: string) =>
  invoke("sync-referral-status", {
    type: "referral_submission",
    referral_submission_id: referralSubmissionId,
  });

export const evaluateReferralEligibility = (
  referralSubmissionId: string,
  options: { create_pending_payout?: boolean } = {},
) =>
  invoke<EligibilityResult>("evaluate-referral-eligibility", {
    referral_submission_id: referralSubmissionId,
    create_pending_payout: options.create_pending_payout ?? false,
  });

export const createPendingPayoutIfEligible = (referralSubmissionId: string) =>
  evaluateReferralEligibility(referralSubmissionId, { create_pending_payout: true });

export async function updateReferralFinancials(
  tenantId: string,
  referralSubmissionId: string,
  payload: { estimated_value?: number; sold_value?: number; collected_revenue?: number },
) {
  const update: Record<string, unknown> = {};
  if (payload.estimated_value !== undefined) update.estimated_value = payload.estimated_value;
  if (payload.sold_value !== undefined) update.sold_value = payload.sold_value;
  if (payload.collected_revenue !== undefined) update.collected_revenue = payload.collected_revenue;
  if (Object.keys(update).length === 0) return null;

  const { error } = await supabase
    .from("referral_submissions")
    .update(update)
    .eq("id", referralSubmissionId)
    .eq("tenant_id", tenantId);
  if (error) throw error;

  await insertReferralStatusHistory({
    tenant_id: tenantId,
    referral_submission_id: referralSubmissionId,
    old_status: null,
    new_status: "financials_updated",
    reason: `Updated: ${Object.keys(update).join(", ")}`,
  });

  return createPendingPayoutIfEligible(referralSubmissionId);
}

export async function adminOverrideReferralEligibility(
  tenantId: string,
  referralSubmissionId: string,
  eligible: boolean,
  reason: string,
) {
  const { error } = await supabase
    .from("referral_submissions")
    .update({
      admin_override_eligible: eligible,
      admin_override_reason: reason,
    })
    .eq("id", referralSubmissionId)
    .eq("tenant_id", tenantId);
  if (error) throw error;

  await insertReferralStatusHistory({
    tenant_id: tenantId,
    referral_submission_id: referralSubmissionId,
    old_status: null,
    new_status: eligible ? "admin_override_eligible" : "admin_override_blocked",
    reason,
  });

  return createPendingPayoutIfEligible(referralSubmissionId);
}

export async function rejectReferralPayout(
  tenantId: string,
  referralSubmissionId: string,
  reason: string,
) {
  const { error: subErr } = await supabase
    .from("referral_submissions")
    .update({ payout_eligible: false, payout_eligibility_reason: reason })
    .eq("id", referralSubmissionId)
    .eq("tenant_id", tenantId);
  if (subErr) throw subErr;

  // Set any existing pending payouts to rejected.
  await supabase
    .from("referral_payouts")
    .update({ payout_status: "rejected", notes: reason })
    .eq("referral_submission_id", referralSubmissionId)
    .eq("tenant_id", tenantId)
    .in("payout_status", ["pending", "approved"]);

  await insertReferralStatusHistory({
    tenant_id: tenantId,
    referral_submission_id: referralSubmissionId,
    old_status: null,
    new_status: "payout_rejected",
    reason,
  });
}
