import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PlatformFeatureFlag {
  feature_key: string;
  disabled: boolean;
  reason: string | null;
  disabled_by: string | null;
  disabled_at: string | null;
  updated_at: string;
}

const QUERY_KEY = ['platform-feature-flags'] as const;

/**
 * Universal kill-switch flags set by master admins. When a feature is
 * disabled here, it is unavailable to ALL tenants regardless of their
 * per-tenant feature_enabled settings.
 *
 * Master role bypasses the kill switch so they can still access the
 * feature to fix it.
 */
export const usePlatformFeatureFlags = () => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<Record<string, PlatformFeatureFlag>> => {
      const { data, error } = await (supabase as any)
        .from('platform_feature_flags')
        .select('*');
      if (error) {
        console.error('[usePlatformFeatureFlags] fetch error', error);
        return {};
      }
      const map: Record<string, PlatformFeatureFlag> = {};
      (data ?? []).forEach((row: PlatformFeatureFlag) => {
        map[row.feature_key] = row;
      });
      return map;
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  // Realtime — so a kill-switch flip propagates everywhere instantly.
  useEffect(() => {
    const channel = supabase
      .channel('platform-feature-flags')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'platform_feature_flags' },
        () => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const flags = query.data ?? {};

  return {
    flags,
    isLoading: query.isLoading,
    isPlatformDisabled: (key: string): boolean => !!flags[key]?.disabled,
    getReason: (key: string): string | null => flags[key]?.reason ?? null,
  };
};
