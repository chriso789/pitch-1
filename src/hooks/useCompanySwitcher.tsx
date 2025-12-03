import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface AccessibleCompany {
  tenant_id: string;
  tenant_name: string;
  tenant_subdomain: string;
  is_primary: boolean;
  is_active: boolean;
  access_level: string;
  location_count: number;
}

export const useCompanySwitcher = () => {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: companiesData, isLoading: loading, refetch } = useQuery({
    queryKey: ['accessible-companies'],
    queryFn: async () => {
      // Parallel execution of both calls
      const [tenantsResult, userResult] = await Promise.all([
        supabase.rpc('get_user_accessible_tenants'),
        supabase.auth.getUser()
      ]);
      
      if (tenantsResult.error) throw tenantsResult.error;
      
      const companies = (tenantsResult.data as AccessibleCompany[]) || [];
      const user = userResult.data?.user;
      
      // Get active tenant from companies list (primary one)
      let activeTenantId: string | null = null;
      
      if (user) {
        const activeCompany = companies.find((c) => c.is_primary);
        activeTenantId = activeCompany?.tenant_id || null;
        
        // If no primary found, try to get from profile
        if (!activeTenantId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('tenant_id')
            .eq('id', user.id)
            .single();
          activeTenantId = profile?.tenant_id || null;
        }
      }
      
      return { companies, activeTenantId };
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });

  // Update local state when data changes
  const companies = companiesData?.companies || [];
  const computedActiveCompanyId = activeCompanyId || companiesData?.activeTenantId || null;

  const switchCompany = async (tenantId: string) => {
    try {
      // @ts-ignore - RPC function not yet in generated types
      const { data, error } = await supabase.rpc('switch_active_tenant', {
        p_tenant_id: tenantId
      });

      if (error) throw error;

      const result = data as { success: boolean; tenant_name?: string; error?: string };

      if (result.success) {
        setActiveCompanyId(tenantId);
        
        // Clear all cached queries to force refresh with new tenant data
        queryClient.clear();
        
        toast({
          title: "Company Switched",
          description: `Now viewing ${result.tenant_name}`,
        });
        
        // Force page reload to ensure all components refresh with new tenant
        window.location.reload();
      } else {
        throw new Error(result.error || 'Failed to switch company');
      }
    } catch (error: any) {
      toast({
        title: "Switch Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const activeCompany = companies.find(c => c.tenant_id === computedActiveCompanyId);

  return {
    companies,
    activeCompany,
    activeCompanyId: computedActiveCompanyId,
    loading,
    switchCompany,
    refetch,
  };
};
