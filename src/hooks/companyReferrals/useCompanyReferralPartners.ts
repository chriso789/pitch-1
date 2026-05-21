import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCompanyReferralPartners, getCompanyReferralSignups, getCompanyReferralPayouts,
  getCompanyReferralCredits, getCompanyReferralFlags, createCrmReferralPartner,
} from "@/lib/companyReferrals/companyReferralApi";

export function useCompanyReferralPartners(tenantId?: string | null) {
  return useQuery({
    queryKey: ["companyReferralPartners", tenantId],
    queryFn: () => getCompanyReferralPartners(tenantId!),
    enabled: !!tenantId,
  });
}
export function useCompanyReferralSignups(tenantId?: string | null) {
  return useQuery({
    queryKey: ["companyReferralSignups", tenantId],
    queryFn: () => getCompanyReferralSignups(tenantId!),
    enabled: !!tenantId,
  });
}
export function useCompanyReferralPayouts(tenantId?: string | null) {
  return useQuery({
    queryKey: ["companyReferralPayouts", tenantId],
    queryFn: () => getCompanyReferralPayouts(tenantId!),
    enabled: !!tenantId,
  });
}
export function useCompanyReferralCredits(tenantId?: string | null) {
  return useQuery({
    queryKey: ["companyReferralCredits", tenantId],
    queryFn: () => getCompanyReferralCredits(tenantId!),
    enabled: !!tenantId,
  });
}
export function useCompanyReferralFlags(tenantId?: string | null) {
  return useQuery({
    queryKey: ["companyReferralFlags", tenantId],
    queryFn: () => getCompanyReferralFlags(tenantId!),
    enabled: !!tenantId,
  });
}
export function useCreateCompanyReferralPartner(tenantId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { partner_name: string; partner_email?: string; partner_phone?: string; partner_type?: string }) =>
      createCrmReferralPartner({ referring_company_id: tenantId!, ...payload }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companyReferralPartners", tenantId] }),
  });
}
