import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AbcBranch {
  branch_number: string;
  name: string | null;
  city: string | null;
  state: string | null;
  is_default?: boolean;
}

export interface AbcShipTo {
  id?: string;
  ship_to_number: string;
  name: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  is_default?: boolean;
}

/**
 * Returns the connected ABC branches and ship-to accounts for this tenant.
 * Both lists are populated by the abc-oauth-callback sync. UI reads from the
 * DB only — no manual entry of branch number / ship-to required for normal
 * tenants.
 */
export function useAbcCatalog(
  tenantId: string | null | undefined,
  environment?: 'sandbox' | 'production' | null,
) {
  const [branches, setBranches] = useState<AbcBranch[]>([]);
  const [shipTos, setShipTos] = useState<AbcShipTo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!tenantId) {
      setBranches([]);
      setShipTos([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let connectionIds: string[] = [];
        if (environment) {
          const c = await (supabase as any)
            .from('abc_user_connections')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('environment', environment)
            .eq('status', 'connected');
          connectionIds = ((c?.data || []) as Array<{ id: string }>).map((row) => row.id);
        }

        let shipToQuery = (supabase as any)
          .from('abc_ship_to_accounts')
          .select('id, ship_to_number, name, address_line1, city, state, postal_code, is_default')
          .eq('tenant_id', tenantId)
          .order('is_default', { ascending: false })
          .order('ship_to_number');
        if (environment) {
          if (connectionIds.length === 0) {
            setBranches([]);
            setShipTos([]);
            return;
          }
          shipToQuery = shipToQuery.in('connection_id', connectionIds);
        }

        const s1 = await shipToQuery;
        if (cancelled) return;

        const shipToRowsRaw = (s1?.data || []) as AbcShipTo[];
        const shipToIds = shipToRowsRaw.map((row) => row.id).filter(Boolean) as string[];

        // Pull ALL branches for these ship-tos so we can (a) pick the ship-to
        // that actually has branches attached and (b) scope branches to that
        // ship-to. Mixing branches across ship-tos triggers ABC 401
        // ("branch X not present in given shipTo").
        let allAccountBranches: Array<any> = [];
        if (shipToIds.length > 0) {
          const b1 = await (supabase as any)
            .from('abc_account_branches')
            .select('branch_number, name, city, state, is_default, is_home_branch, ship_to_id')
            .eq('tenant_id', tenantId)
            .in('ship_to_id', shipToIds);
          allAccountBranches = (b1?.data || []) as any[];
        }
        const shipToIdsWithBranches = new Set(
          allAccountBranches.map((r) => r.ship_to_id).filter(Boolean),
        );

        // Prefer a ship-to that has branches; otherwise keep original order.
        const shipToRows = [...shipToRowsRaw].sort((a, b) => {
          const aHas = a.id && shipToIdsWithBranches.has(a.id) ? 1 : 0;
          const bHas = b.id && shipToIdsWithBranches.has(b.id) ? 1 : 0;
          return bHas - aHas;
        });

        const preferredShipToId = shipToRows[0]?.id || null;
        // In sandbox, ABC's demo pairing is ship-to 2010466-2 + branch 1209.
        // If both branches are on the same ship-to, ABC's other branches will
        // 401 ("branch X not present in given shipTo") even though they show up
        // in the ship-to's branch list. Bias toward the known-good sandbox
        // branch when we're on that account.
        const sandboxDefaultBranch = environment === 'sandbox' ? '1209' : null;
        const preferredShipToNumber = shipToRows[0]?.ship_to_number || null;
        const biasSandboxBranch =
          sandboxDefaultBranch && preferredShipToNumber === '2010466-2';
        const accountRows: AbcBranch[] = allAccountBranches
          .filter((r) => r.ship_to_id === preferredShipToId)
          .sort((a, b) => {
            if (biasSandboxBranch) {
              const aSb = String(a.branch_number) === sandboxDefaultBranch ? 1 : 0;
              const bSb = String(b.branch_number) === sandboxDefaultBranch ? 1 : 0;
              if (aSb !== bSb) return bSb - aSb;
            }
            const ah = (a.is_home_branch || a.is_default) ? 1 : 0;
            const bh = (b.is_home_branch || b.is_default) ? 1 : 0;
            if (ah !== bh) return bh - ah;
            return String(a.branch_number).localeCompare(String(b.branch_number));
          })
          .map((r) => ({
            branch_number: r.branch_number,
            name: r.name,
            city: r.city,
            state: r.state,
            is_default: !!(r.is_default ?? r.is_home_branch),
          }));

        let wideRows: AbcBranch[] = [];
        if (!environment && accountRows.length === 0) {
          const b2 = await (supabase as any)
            .from('abc_branches')
            .select('branch_number, name, city, state')
            .eq('tenant_id', tenantId)
            .order('branch_number');
          wideRows = (b2?.data || []).map((r: any) => ({ ...r, is_default: false })) as AbcBranch[];
        }
        if (cancelled) return;

        const dedup = new Map<string, AbcBranch>();
        for (const row of [...accountRows, ...wideRows]) {
          if (!row.branch_number) continue;
          if (!dedup.has(row.branch_number)) dedup.set(row.branch_number, row);
        }
        setBranches(Array.from(dedup.values()));
        setShipTos(shipToRows);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load ABC catalog');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, environment, nonce]);

  return { branches, shipTos, loading, error, refetch };
}
