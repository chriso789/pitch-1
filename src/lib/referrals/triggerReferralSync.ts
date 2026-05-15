/**
 * Fire-and-forget wrappers used by CRM mutation paths (lead/job/payment changes)
 * to keep linked referral submissions in sync. These never throw — failures
 * surface as console warnings and a soft toast for admin/dev visibility only.
 */

import { toast } from "sonner";
import {
  syncReferralSubmissionFromLead,
  syncReferralSubmissionFromJob,
} from "./referralAutomation";

const isDev = (import.meta as any).env?.DEV;

function softFail(label: string, err: unknown) {
  // eslint-disable-next-line no-console
  console.warn(`[referral-sync] ${label} failed`, err);
  if (isDev) {
    toast.warning("Referral sync failed", {
      description: `${label} update saved, but referral eligibility may need review.`,
    });
  }
}

export function triggerReferralSyncForLead(leadId: string | null | undefined) {
  if (!leadId) return;
  syncReferralSubmissionFromLead(leadId).catch((e) => softFail("Lead", e));
}

export function triggerReferralSyncForJob(jobId: string | null | undefined) {
  if (!jobId) return;
  syncReferralSubmissionFromJob(jobId).catch((e) => softFail("Job", e));
}

/** Convenience: sync both pipeline_entry (lead) and any job ID at once. */
export function triggerReferralSync(opts: {
  leadId?: string | null;
  jobId?: string | null;
}) {
  triggerReferralSyncForLead(opts.leadId);
  triggerReferralSyncForJob(opts.jobId);
}
