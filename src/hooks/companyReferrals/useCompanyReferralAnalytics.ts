import { useQuery } from "@tanstack/react-query";
import { getCompanyReferralAnalytics } from "@/lib/companyReferrals/companyReferralApi";

export function useCompanyReferralAnalytics(tenantId?: string | null) {
  return useQuery({
    queryKey: ["companyReferralAnalytics", tenantId],
    queryFn: () => getCompanyReferralAnalytics(tenantId!),
    enabled: !!tenantId,
  });
}
