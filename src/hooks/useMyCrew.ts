import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface MyCrew {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * Resolves the crews row for the currently signed-in user.
 * On first sign-in, claims the unclaimed crews row whose email matches
 * the auth user's email (RLS-gated by "Crew can claim own row by email").
 */
export function useMyCrew() {
  const { user, loading: authLoading } = useAuth();
  const [crew, setCrew] = useState<MyCrew | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    if (!user?.id) {
      setCrew(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Already-claimed row?
      let { data, error: selErr } = await supabase
        .from('crews')
        .select('id, tenant_id, name, email, phone')
        .eq('user_id', user.id)
        .maybeSingle();
      if (selErr) throw selErr;

      // 2. Try to claim by email match
      if (!data && user.email) {
        const { data: claimable } = await supabase
          .from('crews')
          .select('id, tenant_id, name, email, phone')
          .is('user_id', null)
          .ilike('email', user.email)
          .maybeSingle();

        if (claimable) {
          const { data: claimed, error: updErr } = await supabase
            .from('crews')
            .update({ user_id: user.id })
            .eq('id', claimable.id)
            .select('id, tenant_id, name, email, phone')
            .maybeSingle();
          if (updErr) throw updErr;
          data = claimed;
        }
      }

      setCrew(data as MyCrew | null);
    } catch (e) {
      console.error('[useMyCrew] resolve error', e);
      setError(e instanceof Error ? e.message : 'Failed to resolve crew');
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.email]);

  useEffect(() => {
    if (!authLoading) resolve();
  }, [authLoading, resolve]);

  return { crew, loading: authLoading || loading, error, refetch: resolve };
}
