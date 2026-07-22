// Single source of truth for "is this tenant's ABC pricing setup complete?".
// Reads the selected Ship-To / Branch persisted only after a real tenant ABC
// user connection exists. Developer portal/API setup rows must not unlock
// tenant pricing or ordering.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from './useEffectiveTenantId';

export interface AbcSetupRow {
  id: string;
  environment: string | null;
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
  environment: 'sandbox' | 'production' | null;
  connection: AbcSetupRow | null;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
}

function normalizeAbcSetupEnvironment(value?: string | null): 'sandbox' | 'production' {
  const v = (value || '').toLowerCase();
  return v === 'production' || v === 'prod' || v === 'live' ? 'production' : 'sandbox';
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
          'id, environment, connection_status, selected_ship_to_number, selected_branch_number, selected_ship_to_snapshot, selected_branch_snapshot, setup_completed_at, updated_at',
        )
        .eq('tenant_id', tenantId as any)
        .eq('connection_status', 'connected')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      const rows = (data || []) as AbcSetupRow[];
      if (rows.length === 0) return null;

      const { data: userRows, error: userErr } = await (supabase as any)
        .from('abc_user_connections')
        .select('environment')
        .eq('tenant_id', tenantId as any)
        .eq('status', 'connected');
      if (userErr) throw userErr;
      const connectedEnvironments = new Set(
        ((userRows || []) as Array<{ environment: string | null }>).map((r) => normalizeAbcSetupEnvironment(r.environment)),
      );
      if (connectedEnvironments.size === 0) return null;
      const accountRows = rows.filter((r) => connectedEnvironments.has(normalizeAbcSetupEnvironment(r.environment)));
      const connectedRows = rows.filter(
        (r) => (r.connection_status || '').toLowerCase() === 'connected',
      );
      const connected =
        accountRows.find((r) => normalizeAbcSetupEnvironment(r.environment) === 'production') ||
        connectedRows.find((r) => connectedEnvironments.has(normalizeAbcSetupEnvironment(r.environment))) ||
        accountRows[0];
      return connected || null;
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
    environment: conn ? normalizeAbcSetupEnvironment(conn.environment) : null,
    connection: conn,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
