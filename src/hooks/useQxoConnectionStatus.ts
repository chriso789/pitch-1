// Shared QXO connection state — mirrors useAbcConnectionStatus shape.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from './useEffectiveTenantId';

export type QxoConnectionState =
  | 'connected'
  | 'needs_mapping'
  | 'disconnected'
  | 'pending'
  | 'expired'
  | 'error'
  | 'unknown';

export interface QxoConnectionRow {
  site_id: string | null;
  account_id: string | null;
  account_number: string | null;
  profile_id: string | null;
  default_branch_code: string | null;
  job_account: string | null;
  branch_contact_name: string | null;
  branch_contact_phone: string | null;
  branch_contact_email: string | null;
  template_id: string | null;
  template_name: string | null;
  connection_status: string | null;
  last_validated_at: string | null;
  last_sync_at: string | null;
  environment: string | null;
  has_credentials: boolean | null;
}

export interface QxoConnectionStatus {
  state: QxoConnectionState;
  isConnected: boolean;
  needsMapping: boolean;
  hasCredentials: boolean;
  row: QxoConnectionRow | null;
  branchCount: number;
  shipToCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

function deriveState(row: QxoConnectionRow | null): QxoConnectionState {
  if (!row) return 'disconnected';
  const s = (row.connection_status || '').toLowerCase();
  if (s === 'connected') return 'connected';
  if (s === 'needs_mapping') return 'needs_mapping';
  if (s === 'pending' || s === '') return 'pending';
  if (s === 'expired') return 'expired';
  if (s === 'error' || s === 'failed') return 'error';
  return 'unknown';
}

async function safeCount(table: string, tenantId: string): Promise<number> {
  try {
    const { count } = await (supabase as any)
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
    return count ?? 0;
  } catch {
    return 0;
  }
}

export function useQxoConnectionStatus(): QxoConnectionStatus {
  const tenantId = useEffectiveTenantId();
  const [row, setRow] = useState<QxoConnectionRow | null>(null);
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
        .from('qxo_connections')
        .select(
          'site_id, account_id, account_number, profile_id, default_branch_code, job_account, branch_contact_name, branch_contact_phone, branch_contact_email, template_id, template_name, connection_status, last_validated_at, last_sync_at, environment, has_credentials',
        )
        .eq('tenant_id', tenantId)
        .maybeSingle();
      setRow((data as QxoConnectionRow) ?? null);

      const [bc, sc] = await Promise.all([
        safeCount('qxo_branches', tenantId),
        safeCount('qxo_ship_to', tenantId),
      ]);
      setBranchCount(bc);
      setShipToCount(sc);
    } catch (e) {
      console.warn('[useQxoConnectionStatus] load failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return useMemo<QxoConnectionStatus>(() => {
    const state = loading ? 'unknown' : deriveState(row);
    return {
      state,
      isConnected: state === 'connected',
      needsMapping: state === 'needs_mapping',
      hasCredentials: !!row?.has_credentials,
      row,
      branchCount,
      shipToCount,
      loading,
      refresh: load,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, branchCount, shipToCount, loading]);
}
