import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CompanyInfo {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  license_number?: string;
  logo_url?: string;
}

export function useCompanyInfo() {
  return useQuery({
    queryKey: ['company-info'],
    queryFn: async (): Promise<CompanyInfo | null> => {
      // Get user's active tenant
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile) return null;

      const tenantId = profile.active_tenant_id || profile.tenant_id;
      if (!tenantId) return null;

      const { data: tenant } = await supabase
        .from('tenants')
        .select('name, phone, email, logo_url, address_street, address_city, address_state, address_zip, settings')
        .eq('id', tenantId)
        .single();

      if (!tenant) return null;

      // Build full address
      const addressParts = [
        tenant.address_street,
        tenant.address_city,
        tenant.address_state,
        tenant.address_zip
      ].filter(Boolean);
      
      const address = addressParts.length > 0 ? addressParts.join(', ') : undefined;
      const settings = tenant.settings as Record<string, any> || {};

      return {
        name: tenant.name,
        phone: tenant.phone || settings?.phone,
        email: tenant.email || settings?.email,
        address: address || settings?.address,
        license_number: settings?.license_number,
        logo_url: tenant.logo_url
      };
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}