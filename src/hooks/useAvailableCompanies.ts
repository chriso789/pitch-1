import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/UserProfileContext";

export interface AvailableCompany {
  id: string;
  name: string;
  subdomain: string;
  is_active: boolean;
  phone: string | null;
}

/**
 * Hook to fetch available companies for user assignment
 * Master users see all companies, others see only their accessible companies
 */
export const useAvailableCompanies = () => {
  const { profile } = useUserProfile();
  
  const { data: companies = [], isLoading, error } = useQuery({
    queryKey: ['available-companies', profile?.role],
    queryFn: async () => {
      if (!profile) return [];
      
      // Master users see all companies
      if (profile.role === 'master') {
        const { data, error } = await supabase
          .from('tenants')
          .select('id, name, subdomain, is_active, phone')
          .order('name');
        
        if (error) throw error;
        return data as AvailableCompany[];
      }
      
      // Other users see companies they have access to
      const { data: accessData, error: accessError } = await supabase
        .from('user_company_access')
        .select('tenant_id')
        .eq('user_id', profile.id)
        .eq('is_active', true);
      
      if (accessError) throw accessError;
      
      const tenantIds = accessData?.map(a => a.tenant_id) || [];
      
      // Always include user's primary tenant
      if (profile.tenant_id && !tenantIds.includes(profile.tenant_id)) {
        tenantIds.push(profile.tenant_id);
      }
      
      if (tenantIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from('tenants')
        .select('id, name, subdomain, is_active, phone')
        .in('id', tenantIds)
        .order('name');
      
      if (error) throw error;
      return data as AvailableCompany[];
    },
    enabled: !!profile,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return { companies, isLoading, error };
};

