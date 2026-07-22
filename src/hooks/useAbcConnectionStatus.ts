// Shared source of truth for tenant ABC account state across the supplier UI.
// Developer portal/API setup rows live in abc_integrations / abc_connections,
// but those are NOT tenant supplier-account connections. A tenant is connected
// only when it has a connected abc_user_connections row from a real ABC login.
//
// Key invariants:
//   * One row per (tenant_id, environment) — but a tenant may legitimately
//     have BOTH a sandbox/staging row AND a production row, so we fetch all
//     and prefer a connected row.
//   * Environment labels are normalized: 'staging' / 'testing' → 'sandbox'.
//     Treat sandbox and staging as the same logical "non-production" bucket.
//   * Status is a single discriminated value the UI can switch on without
//     having to re-derive it differently in three places.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from './useEffectiveTenantId';

export type AbcEnvironment = 'sandbox' | 'production';

export type AbcConnectionState =
  | 'connected'
  | 'disconnected'
  | 'pending'
  | 'expired'
  | 'error'
  | 'unknown';

export interface AbcConnectionRow {
  id: string | null;
  user_id: string | null;
  okta_subject: string | null;
  token_expires_at: string | null;
  status: string | null;
  environment: string | null;
  updated_at: string | null;
}

export interface AbcConnectionStatus {
  /** Discriminated state the UI should branch on. */
  state: AbcConnectionState;
  /** True iff a usable connected row exists (sandbox/staging counts). */
  isConnected: boolean;
  /** The preferred row (connected > most-recent), or null. */
  row: AbcConnectionRow | null;
  /** Normalized environment of the preferred row. */
  environment: AbcEnvironment | null;
  /** Default branch code from the preferred row, if any. */
  defaultBranchCode: string | null;
  /** Raw rows for diagnostics — never render directly in tenant UI. */
  rows: AbcConnectionRow[];
  /** Loading flag. Treat as `unknown` while true. */
  loading: boolean;
  /** Manual refresh. */
  refresh: () => Promise<void>;
}

export function normalizeAbcEnvironment(
  value?: string | null,
): AbcEnvironment {
  const v = (value || '').toLowerCase();
  if (v === 'production' || v === 'prod' || v === 'live') return 'production';
  // staging / testing / sandbox all collapse to sandbox
  return 'sandbox';
}

function deriveState(row: AbcConnectionRow | null): AbcConnectionState {
  if (!row) return 'disconnected';
  const s = (row.status || '').toLowerCase();
  if (s === 'connected') return 'connected';
  if (s === 'pending' || s === '') return 'pending';
  if (s === 'expired') return 'expired';
  if (s === 'error' || s === 'failed') return 'error';
  return 'unknown';
}

export function useAbcConnectionStatus(): AbcConnectionStatus {
  const tenantId = useEffectiveTenantId();
  const [rows, setRows] = useState<AbcConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!tenantId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('abc_user_connections')
      .select(
        'id, user_id, okta_subject, token_expires_at, status, environment, updated_at',
      )
      .eq('tenant_id', tenantId as any)
      .eq('status', 'connected')
      .order('updated_at', { ascending: false });
    setRows((data || []) as AbcConnectionRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return useMemo<AbcConnectionStatus>(() => {
    const connectedRows = rows.filter(
      (r) => (r.status || '').toLowerCase() === 'connected',
    );
    const connected =
      connectedRows.find((r) => normalizeAbcEnvironment(r.environment) === 'production') ||
      connectedRows[0] ||
      null;
    const preferred = connected || rows[0] || null;
    const state = loading ? 'unknown' : deriveState(preferred);
    return {
      state,
      isConnected: state === 'connected',
      row: preferred,
      environment: preferred ? normalizeAbcEnvironment(preferred.environment) : null,
      defaultBranchCode: null,
      rows,
      loading,
      refresh: load,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, loading]);
}
