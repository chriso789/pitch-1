import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

export interface ContactStatus {
  id: string;
  name: string;
  key: string;
  color: string;
  description: string | null;
  status_order: number;
  is_active: boolean;
}

// Default fallback statuses (used when no custom statuses exist)
export const DEFAULT_CONTACT_STATUSES: ContactStatus[] = [
  { id: 'default-1', name: 'Not Home', key: 'not_home', color: '#6b7280', description: null, status_order: 1, is_active: true },
  { id: 'default-2', name: 'Interested', key: 'interested', color: '#22c55e', description: null, status_order: 2, is_active: true },
  { id: 'default-3', name: 'Not Interested', key: 'not_interested', color: '#ef4444', description: null, status_order: 3, is_active: true },
  { id: 'default-4', name: 'Qualified', key: 'qualified', color: '#3b82f6', description: null, status_order: 4, is_active: true },
  { id: 'default-5', name: 'Follow Up', key: 'follow_up', color: '#f59e0b', description: null, status_order: 5, is_active: true },
  { id: 'default-6', name: 'Do Not Contact', key: 'do_not_contact', color: '#ef4444', description: null, status_order: 6, is_active: true },
];

export function useContactStatuses() {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['contact-statuses', tenantId],
    queryFn: async (): Promise<ContactStatus[]> => {
      if (!tenantId) return DEFAULT_CONTACT_STATUSES;

      const { data, error } = await supabase
        .from('contact_statuses')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('status_order', { ascending: true });

      if (error) {
        console.error('Error fetching contact statuses:', error);
        return DEFAULT_CONTACT_STATUSES;
      }

      if (!data || data.length === 0) {
        return DEFAULT_CONTACT_STATUSES;
      }

      return data.map(status => ({
        id: status.id,
        name: status.name,
        key: status.key,
        color: status.color,
        description: status.description,
        status_order: status.status_order,
        is_active: status.is_active,
      }));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: !!tenantId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['contact-statuses'] });
  };

  return {
    statuses: query.data || DEFAULT_CONTACT_STATUSES,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    invalidate,
    refetch: query.refetch,
  };
}
