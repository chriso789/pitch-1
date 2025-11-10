import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

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
  const [companies, setCompanies] = useState<AccessibleCompany[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    loadAccessibleCompanies();
  }, []);

  const loadAccessibleCompanies = async () => {
    try {
      // @ts-ignore - RPC function not yet in generated types
      const { data, error } = await supabase.rpc('get_user_accessible_tenants');
      
      if (error) throw error;
      
      setCompanies((data as AccessibleCompany[]) || []);
      
      // Get current active tenant
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile }: any = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();
      
      // Active tenant is tracked in the profile but we get it from companies list
      const companiesData = (data as AccessibleCompany[]) || [];
      const activeCompany = companiesData.find((c: any) => c.is_primary);
      setActiveCompanyId(activeCompany?.tenant_id || profile?.tenant_id);
    } catch (error) {
      console.error('Error loading companies:', error);
    } finally {
      setLoading(false);
    }
  };

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

  const activeCompany = companies.find(c => c.tenant_id === activeCompanyId);

  return {
    companies,
    activeCompany,
    activeCompanyId,
    loading,
    switchCompany,
    refetch: loadAccessibleCompanies,
  };
};
