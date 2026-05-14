import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useAuth } from "@/contexts/AuthContext";
import * as api from "@/lib/referrals/adminApi";
import { toast } from "sonner";

export function useReferralActions() {
  const tenantId = useEffectiveTenantId();
  const { user } = useAuth();
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["referral-overview", tenantId] });
    qc.invalidateQueries({ queryKey: ["referral-links", tenantId] });
    qc.invalidateQueries({ queryKey: ["referral-submissions", tenantId] });
    qc.invalidateQueries({ queryKey: ["referral-payouts", tenantId] });
    qc.invalidateQueries({ queryKey: ["referral-credits", tenantId] });
    qc.invalidateQueries({ queryKey: ["referral-flags", tenantId] });
  };

  const createLink = useMutation({
    mutationFn: (payload: { referrer_contact_id: string; source_job_id?: string; campaign_id?: string; custom_note?: string }) =>
      api.createReferralLink({ tenant_id: tenantId!, ...payload }),
    onSuccess: () => {
      toast.success("Referral link created");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || "Failed to create link"),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => api.deactivateReferralLink(id),
    onSuccess: () => { toast.success("Link deactivated"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Failed"),
  });

  const reactivate = useMutation({
    mutationFn: (id: string) => api.reactivateReferralLink(id),
    onSuccess: () => { toast.success("Link reactivated"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Failed"),
  });

  const updateStatus = useMutation({
    mutationFn: (p: { submissionId: string; status: string; reason?: string }) =>
      api.updateReferralSubmissionStatus(tenantId!, p.submissionId, p.status, p.reason),
    onSuccess: () => { toast.success("Status updated"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Failed"),
  });

  const rejectSubmission = useMutation({
    mutationFn: (p: { submissionId: string; reason: string }) =>
      api.rejectReferralSubmission(tenantId!, p.submissionId, p.reason),
    onSuccess: () => { toast.success("Referral rejected"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Failed"),
  });

  const markValid = useMutation({
    mutationFn: (p: { submissionId: string; reason?: string }) =>
      api.markReferralValid(tenantId!, p.submissionId, p.reason),
    onSuccess: () => { toast.success("Marked valid"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Failed"),
  });

  const approvePayout = useMutation({
    mutationFn: (p: { referral_submission_id: string; payout_method?: string; payout_amount?: number; notes?: string }) =>
      api.approveReferralPayout(p),
    onSuccess: () => { toast.success("Payout approved"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Failed"),
  });

  const markPaid = useMutation({
    mutationFn: (p: { referral_payout_id: string; payment_reference?: string; notes?: string }) =>
      api.markReferralPayoutPaid(p),
    onSuccess: () => { toast.success("Payout marked paid"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Failed"),
  });

  const applyCredit = useMutation({
    mutationFn: (p: { referrer_contact_id: string; job_id: string; amount: number; notes?: string }) =>
      api.applyReferralCreditToJob(p),
    onSuccess: () => { toast.success("Credit applied"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Failed"),
  });

  const resolveFlag = useMutation({
    mutationFn: (id: string) => api.resolveReferralFlag(id, user?.id || ""),
    onSuccess: () => { toast.success("Flag resolved"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Failed"),
  });

  const logSend = useMutation({
    mutationFn: (p: Parameters<typeof api.logReferralSend>[0]) => api.logReferralSend(p),
  });

  return {
    createLink, deactivate, reactivate, updateStatus, rejectSubmission, markValid,
    approvePayout, markPaid, applyCredit, resolveFlag, logSend,
  };
}
