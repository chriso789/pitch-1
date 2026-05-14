import { useQuery } from "@tanstack/react-query";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import * as api from "@/lib/referrals/adminApi";

export function useReferralOverview() {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ["referral-overview", tenantId],
    queryFn: () => api.getReferralOverview(tenantId!),
    enabled: !!tenantId,
  });
}

export function useReferralLinks() {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ["referral-links", tenantId],
    queryFn: () => api.getReferralLinks(tenantId!),
    enabled: !!tenantId,
  });
}

export function useReferralSubmissions() {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ["referral-submissions", tenantId],
    queryFn: () => api.getReferralSubmissions(tenantId!),
    enabled: !!tenantId,
  });
}

export function useReferralPayouts() {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ["referral-payouts", tenantId],
    queryFn: () => api.getReferralPayouts(tenantId!),
    enabled: !!tenantId,
  });
}

export function useReferralCreditBalances() {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ["referral-credits", tenantId],
    queryFn: () => api.getReferralCreditBalances(tenantId!),
    enabled: !!tenantId,
  });
}

export function useReferralFlags() {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ["referral-flags", tenantId],
    queryFn: () => api.getReferralFlags(tenantId!),
    enabled: !!tenantId,
  });
}
