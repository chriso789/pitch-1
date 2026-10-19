import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Server-verified Image Trainer (platform developer) access check.
 * Uses the `has_training_access` database function (user_roles table) —
 * never client storage. Database RLS remains the real enforcement.
 */
export function useHasTrainingAccess(level: 'reviewer' | 'developer' = 'reviewer') {
  return useQuery({
    queryKey: ['training-access', level],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user?.id) return false;
      const { data, error } = await supabase.rpc('has_training_access', {
        _user_id: auth.user.id,
        _level: level,
      } as never);
      if (error) return false;
      return data === true;
    },
    staleTime: 60_000,
  });
}
