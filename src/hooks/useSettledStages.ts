import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

export interface SettledStageInfo {
  /** Stage flagged as the capped-out / settled point (payout complete). */
  payoutStageKey: string | null;
  payoutStageName: string | null;
  /** Status keys treated as settled: the payout stage and every stage after it. */
  settledKeys: string[];
  isLoading: boolean;
}

/**
 * Resolves the tenant's "Capped Out / Settled" pipeline stage.
 *
 * Projects at (or past) this stage are considered fully settled: they drop out
 * of open Accounts Receivable and out of upcoming/owed rep commissions, while
 * still being viewable through a "paid" filter.
 */
export function useSettledStages(): SettledStageInfo {
  const tenantId = useEffectiveTenantId();

  const { data, isLoading } = useQuery({
    queryKey: ['settled-stages', tenantId],
    queryFn: async () => {
      const { data: stages, error } = await supabase
        .from('pipeline_stages')
        .select('key, name, stage_order, is_payout_point, is_active')
        .eq('tenant_id', tenantId!)
        .order('stage_order');
      if (error) throw error;

      const list = (stages || []) as Array<{
        key: string | null;
        name: string;
        stage_order: number | null;
        is_payout_point: boolean | null;
      }>;

      const payout = list.find(s => s.is_payout_point);
      if (!payout?.key) {
        return { payoutStageKey: null, payoutStageName: null, settledKeys: [] as string[] };
      }

      const threshold = payout.stage_order ?? 0;
      const settledKeys = list
        .filter(s => (s.stage_order ?? 0) >= threshold && !!s.key)
        .map(s => s.key as string);

      return {
        payoutStageKey: payout.key,
        payoutStageName: payout.name,
        settledKeys,
      };
    },
    enabled: !!tenantId,
  });

  return {
    payoutStageKey: data?.payoutStageKey ?? null,
    payoutStageName: data?.payoutStageName ?? null,
    settledKeys: data?.settledKeys ?? [],
    isLoading,
  };
}
