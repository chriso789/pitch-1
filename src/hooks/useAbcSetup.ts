// Single source of truth for "is this tenant's ABC pricing setup complete?".
// Reads the selected Ship-To / Branch persisted on abc_connections by the
// post-OAuth setup wizard. UI must consult this before issuing any ABC price
// call — until `ready === true`, the locked-cell gate renders.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from './useEffectiveTenantId';

export interface AbcSetupRow {
  id: string;
  connection_status: string | null;
  selected_ship_to_number: string | null;
  selected_branch_number: string | null;
  selected_ship_to_snapshot: any;
  selected_branch_snapshot: any;
  setup_completed_at: string | null;
  updated_at: string | null;
}

export interface AbcSetup {
  ready: boolean;
  shipToNumber: string | null;
  branchNumber: string | null;
  shipToSnapshot: any;
  branchSnapshot: any;
  connection: AbcSetupRow | null;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
}

export function useAbcSetup(): AbcSetup {
  const tenantId = useEffectiveTenantId();
  const query = useQuery({
    queryKey: ['abc', 'setup', tenantId],
    enabled: !!tenantId,
    staleTime: 30_000,
    queryFn: async (): Promise<AbcSetupRow | null> => {
      const { data, error } = await supabase
        .from('abc_connections')
        .select(
          'id, connection_status, selected_ship_to_number, selected_branch_number, selected_ship_to_snapshot, selected_branch_snapshot, setup_completed_at, updated_at',
        )
        .eq('tenant_id', tenantId as any)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      const rows = (data || []) as AbcSetupRow[];
      const connected = rows.find(
        (r) => (r.connection_status || '').toLowerCase() === 'connected',
      );
      return connected || rows[0] || null;
    },
  });

  const conn = query.data ?? null;
  const ready = !!(
    conn?.setup_completed_at &&
    conn?.selected_ship_to_number &&
    conn?.selected_branch_number
  );

  return {
    ready,
    shipToNumber: conn?.selected_ship_to_number ?? null,
    branchNumber: conn?.selected_branch_number ?? null,
    shipToSnapshot: conn?.selected_ship_to_snapshot ?? null,
    branchSnapshot: conn?.selected_branch_snapshot ?? null,
    connection: conn,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
