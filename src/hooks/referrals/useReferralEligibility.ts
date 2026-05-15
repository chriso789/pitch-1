import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { toast } from "sonner";
import {
  adminOverrideReferralEligibility,
  evaluateReferralEligibility,
  createPendingPayoutIfEligible,
  updateReferralFinancials,
  type EligibilityResult,
} from "@/lib/referrals/referralAutomation";

export function useReferralEligibility(submissionId: string | null) {
  return useQuery<EligibilityResult>({
    queryKey: ["referral-eligibility", submissionId],
    enabled: !!submissionId,
    queryFn: () => evaluateReferralEligibility(submissionId!),
    staleTime: 30_000,
  });
}

export function useReferralEligibilityActions() {
  const tenantId = useEffectiveTenantId();
  const qc = useQueryClient();

  const invalidate = (submissionId?: string) => {
    qc.invalidateQueries({ queryKey: ["referral-submissions", tenantId] });
    qc.invalidateQueries({ queryKey: ["referral-payouts", tenantId] });
    qc.invalidateQueries({ queryKey: ["referral-overview", tenantId] });
    if (submissionId) qc.invalidateQueries({ queryKey: ["referral-eligibility", submissionId] });
  };

  const recheck = useMutation({
    mutationFn: (submissionId: string) => createPendingPayoutIfEligible(submissionId),
    onSuccess: (res, submissionId) => {
      invalidate(submissionId);
      if (res?.pendingPayoutCreated) toast.success("Pending referral payout created.");
      else if (res?.eligible) toast.success("Referral is now eligible for payout.");
      else toast.info("Eligibility rechecked");
    },
    onError: (e: any) => toast.error(e?.message || "Recheck failed"),
  });

  const override = useMutation({
    mutationFn: (p: { submissionId: string; eligible: boolean; reason: string }) =>
      adminOverrideReferralEligibility(tenantId!, p.submissionId, p.eligible, p.reason),
    onSuccess: (res, p) => {
      invalidate(p.submissionId);
      toast.success(p.eligible ? "Marked eligible (override)" : "Marked blocked (override)");
      if (res?.pendingPayoutCreated) toast.success("Pending referral payout created.");
    },
    onError: (e: any) => toast.error(e?.message || "Override failed"),
  });

  const updateFinancials = useMutation({
    mutationFn: (p: {
      submissionId: string;
      estimated_value?: number;
      sold_value?: number;
      collected_revenue?: number;
    }) =>
      updateReferralFinancials(tenantId!, p.submissionId, {
        estimated_value: p.estimated_value,
        sold_value: p.sold_value,
        collected_revenue: p.collected_revenue,
      }),
    onSuccess: (res, p) => {
      invalidate(p.submissionId);
      toast.success("Financials updated");
      if (res?.pendingPayoutCreated) toast.success("Pending referral payout created.");
    },
    onError: (e: any) => toast.error(e?.message || "Update failed"),
  });

  return { recheck, override, updateFinancials };
}
