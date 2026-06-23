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
 * Keys that are admin-toggleable from the Company Feature Control panel.
 * Only these keys are strictly enforced. Keys NOT in this set always pass
 * (so we don't accidentally hide ungated parts of the app).
 *
 * Keep this in sync with FEATURES in
 * src/components/admin/CompanyFeatureControl.tsx.
 */
export const GATED_FEATURE_KEYS: ReadonlySet<string> = new Set([
  'pipeline',
  'estimates',
  'dialer',
  'smart_docs',
  'measurements',
  'projects',
  'storm_canvass',
  'territory',
  'photos',
  'payments',
]);

/**
 * Hook that fetches the current tenant's features_enabled array
 * and exposes a hasFeature(key) check.
 *
 * Rules:
 *  - Master/owner/corporate roles bypass all gates.
 *  - Ungated keys (not in GATED_FEATURE_KEYS) always return true.
 *  - For gated keys: must be present in tenants.features_enabled.
 *  - `null` features_enabled is treated as legacy (all gated keys enabled);
 *    an explicit empty array `[]` means everything off.
 */
export const useFeatureAccess = () => {
  const { activeTenantId, profile } = useActiveTenantId();
  const userRole = profile?.role;

  const { data, isLoading } = useQuery({
    queryKey: ['tenant-features', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return { features: null as string[] | null };
      const { data, error } = await supabase
        .from('tenants')
        .select('features_enabled')
        .eq('id', activeTenantId)
        .single();
      if (error) {
        console.error('[useFeatureAccess] Error fetching features:', error);
        return { features: null as string[] | null };
      }
      return { features: (data?.features_enabled as string[] | null) ?? null };
    },
    enabled: !!activeTenantId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const featuresEnabled = data?.features ?? null;
  const isBypassRole =
    userRole === 'master' || userRole === 'owner' || userRole === 'corporate';

  const hasFeature = (featureKey: string): boolean => {
    if (isBypassRole) return true;
    if (!GATED_FEATURE_KEYS.has(featureKey)) return true;
    if (isLoading) return true; // optimistic while loading
    if (featuresEnabled === null) return true; // legacy tenant, never configured
    return featuresEnabled.includes(featureKey);
  };

  return {
    hasFeature,
    featuresEnabled: featuresEnabled ?? [],
    isLoading,
    isBypassRole,
  };
};
