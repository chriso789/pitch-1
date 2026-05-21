import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCompanyReferralSettings, saveCompanyReferralSettings } from "@/lib/companyReferrals/companyReferralApi";

export function useCompanyReferralSettings(tenantId?: string | null) {
  return useQuery({
    queryKey: ["companyReferralSettings", tenantId],
    queryFn: () => getCompanyReferralSettings(tenantId!),
    enabled: !!tenantId,
  });
}

export function useSaveCompanyReferralSettings(tenantId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => saveCompanyReferralSettings(tenantId!, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companyReferralSettings", tenantId] }),
  });
}
