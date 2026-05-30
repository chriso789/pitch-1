// Shared SRS connection state — mirrors useAbcConnectionStatus shape so
// the SRS tenant card, diagnostics panel, and PushToSupplierDialog all
// agree on connection state.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from './useEffectiveTenantId';

export type SrsConnectionState =
  | 'connected'
  | 'disconnected'
  | 'pending'
  | 'expired'
  | 'error'
  | 'unknown';

export interface SrsConnectionRow {
  customer_code: string | null;
  default_branch_code: string | null;
  job_account_number: number | null;
  connection_status: string | null;
  last_validated_at: string | null;
  environment: string | null;
  client_secret_last_four: string | null;
}

export interface SrsConnectionStatus {
  state: SrsConnectionState;
  isConnected: boolean;
  hasCredentials: boolean;
  row: SrsConnectionRow | null;
  branchCount: number;
  shipToCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

function deriveState(row: SrsConnectionRow | null): SrsConnectionState {
  if (!row) return 'disconnected';
  const s = (row.connection_status || '').toLowerCase();
  if (s === 'connected') return 'connected';
  if (s === 'pending' || s === '') return 'pending';
  if (s === 'expired') return 'expired';
  if (s === 'error' || s === 'failed') return 'error';
  return 'unknown';
}

export function useSrsConnectionStatus(): SrsConnectionStatus {
  const tenantId = useEffectiveTenantId();
  const [row, setRow] = useState<SrsConnectionRow | null>(null);
  const [branchCount, setBranchCount] = useState(0);
  const [shipToCount, setShipToCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!tenantId) {
      setRow(null);
      setBranchCount(0);
      setShipToCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await (supabase as any)
        .from('srs_connections')
        .select(
          'customer_code, default_branch_code, job_account_number, connection_status, last_validated_at, environment, client_secret_last_four',
        )
        .eq('tenant_id', tenantId)
        .maybeSingle();
      setRow((data as SrsConnectionRow) ?? null);

      const [{ count: bc }, { count: sc }] = await Promise.all([
        (supabase as any)
          .from('srs_branches')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId),
        (supabase as any)
          .from('srs_ship_to')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .then((r: any) => r, () => ({ count: 0 })),
      ]);
      setBranchCount(bc ?? 0);
      setShipToCount(sc ?? 0);
    } catch (e) {
      console.warn('[useSrsConnectionStatus] load failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return useMemo<SrsConnectionStatus>(() => {
    const state = loading ? 'unknown' : deriveState(row);
    return {
      state,
      isConnected: state === 'connected',
      hasCredentials: !!row?.client_secret_last_four,
      row,
      branchCount,
      shipToCount,
      loading,
      refresh: load,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, branchCount, shipToCount, loading]);
}
