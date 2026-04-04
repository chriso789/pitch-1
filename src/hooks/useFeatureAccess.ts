import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';

/**
 * Feature key → sidebar/route mapping.
 * These keys match the values stored in tenants.features_enabled[].
 */
export const FEATURE_KEYS = {
  pipeline: 'pipeline',
  contacts: 'contacts',
  estimates: 'estimates',
  production: 'production',
  accounts_receivable: 'accounts_receivable',
  calendar: 'calendar',
  storm_canvass: 'storm_canvass',
  communications: 'communications',
  smart_docs: 'smart_docs',
  presentations: 'presentations',
  permits: 'permits',
  crew_portal: 'crew_portal',
  homeowner_portal: 'homeowner_portal',
  dialer: 'dialer',
  measurements: 'measurements',
  projects: 'projects',
  territory: 'territory',
  photos: 'photos',
  payments: 'payments',
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

/**
 * Hook that fetches the current tenant's features_enabled array
 * and exposes a hasFeature(key) check.
 * 
 * Master/owner roles bypass feature gates — they always have access.
 */
export const useFeatureAccess = () => {
  const { activeTenantId, profile } = useActiveTenantId();
  const userRole = profile?.role;

  const { data: featuresEnabled, isLoading } = useQuery({
    queryKey: ['tenant-features', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await supabase
        .from('tenants')
        .select('features_enabled')
        .eq('id', activeTenantId)
        .single();
      if (error) {
        console.error('[useFeatureAccess] Error fetching features:', error);
        return [];
      }
      return (data?.features_enabled as string[]) || [];
    },
    enabled: !!activeTenantId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Master and owner roles bypass all feature gates
  const isBypassRole = userRole === 'master' || userRole === 'owner' || userRole === 'corporate';

  const hasFeature = (featureKey: string): boolean => {
    if (isBypassRole) return true;
    if (isLoading) return true; // Don't hide items while loading
    if (!featuresEnabled || featuresEnabled.length === 0) return true; // No restrictions if empty
    return featuresEnabled.includes(featureKey);
  };

  return {
    hasFeature,
    featuresEnabled: featuresEnabled || [],
    isLoading,
    isBypassRole,
  };
};
