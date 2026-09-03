import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

/**
 * Tenant-level "Company Lead Fee" percentage. Charged to the project as a cost
 * whenever a lead is marked as company generated.
 */
export function useCompanyLeadFeeRate(tenantIdOverride?: string | null) {
  const effectiveTenantId = useEffectiveTenantId();
  const tenantId = tenantIdOverride ?? effectiveTenantId;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['company-lead-fee-rate', tenantId],
    queryFn: async () => {
      if (!tenantId) return 0;
      const { data, error } = await supabase
        .from('tenants')
        .select('company_lead_fee_rate')
        .eq('id', tenantId)
        .maybeSingle();
      if (error) throw error;
      return Number((data as any)?.company_lead_fee_rate ?? 0);
    },
    enabled: !!tenantId,
    staleTime: 60_000,
  });

  return { companyLeadFeeRate: data ?? 0, isLoading, refetch, tenantId };
}
