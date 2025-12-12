import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { setSwitchingFlag, cacheUserProfile } from '@/components/layout/GlobalLoadingHandler';
import { useUserProfile } from '@/contexts/UserProfileContext';

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
  const { profile } = useUserProfile();

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
      
      // Get active tenant from profile
      let activeTenantId: string | null = null;
      
      if (user) {
        // Get from profile's active_tenant_id (switched) or tenant_id (primary fallback)
        const { data: profile } = await supabase
          .from('profiles')
          .select('active_tenant_id, tenant_id')
          .eq('id', user.id)
          .single();
        activeTenantId = profile?.active_tenant_id || profile?.tenant_id || null;
        
        // If no tenant_id in profile and companies available, use first one
        if (!activeTenantId && companies.length > 0) {
          activeTenantId = companies[0]?.tenant_id || null;
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

  const [isSwitching, setIsSwitching] = useState(false);

  const switchCompany = async (tenantId: string) => {
    // Find company name for overlay
    const targetCompany = companies.find(c => c.tenant_id === tenantId);
    
    // Cache user profile before reload - only if fully loaded with valid role
    if (profile && profile.profileLoaded && profile.role) {
      cacheUserProfile({
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
        role: profile.role,
      });
    }
    
    // Show overlay immediately with user's name
    setIsSwitching(true);
    setSwitchingFlag(targetCompany?.tenant_name, profile ? `${profile.first_name} ${profile.last_name}` : undefined);

    try {
      // @ts-ignore - RPC function not yet in generated types
      const { data, error } = await supabase.rpc('switch_active_tenant', {
        p_tenant_id: tenantId
      });

      if (error) throw error;

      const result = data as { success: boolean; tenant_name?: string; error?: string };

      if (result.success) {
        setActiveCompanyId(tenantId);
        queryClient.clear();
        
        // Brief delay for smooth overlay animation before reload
        setTimeout(() => {
          window.location.href = '/dashboard';
        }, 200);
      } else {
        setIsSwitching(false);
        localStorage.removeItem('company-switching');
        throw new Error(result.error || 'Failed to switch company');
      }
    } catch (error: any) {
      setIsSwitching(false);
      localStorage.removeItem('company-switching');
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
    isSwitching,
    switchCompany,
    refetch,
  };
};
