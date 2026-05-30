import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AbcBranch {
  branch_number: string;
  name: string | null;
  city: string | null;
  state: string | null;
  is_default?: boolean;
}

export interface AbcShipTo {
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
export function useAbcCatalog(tenantId: string | null | undefined) {
  const [branches, setBranches] = useState<AbcBranch[]>([]);
  const [shipTos, setShipTos] = useState<AbcShipTo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const [b1, b2, s1] = await Promise.all([
          (supabase as any)
            .from('abc_account_branches')
            .select('branch_number, name, city, state, is_default')
            .eq('tenant_id', tenantId)
            .order('is_default', { ascending: false })
            .order('branch_number'),
          (supabase as any)
            .from('abc_branches')
            .select('branch_number, name, city, state')
            .eq('tenant_id', tenantId)
            .order('branch_number'),
          (supabase as any)
            .from('abc_ship_to_accounts')
            .select('ship_to_number, name, address_line1, city, state, postal_code, is_default')
            .eq('tenant_id', tenantId)
            .order('is_default', { ascending: false })
            .order('ship_to_number'),
        ]);
        if (cancelled) return;

        // Prefer account-scoped branches (linked to ship-to). Fall back to
        // the connection-wide abc_branches list if the account map is empty.
        const accountRows = (b1?.data || []) as AbcBranch[];
        const wideRows = (b2?.data || []).map((r: any) => ({ ...r, is_default: false })) as AbcBranch[];
        const dedup = new Map<string, AbcBranch>();
        for (const row of [...accountRows, ...wideRows]) {
          if (!row.branch_number) continue;
          if (!dedup.has(row.branch_number)) dedup.set(row.branch_number, row);
        }
        setBranches(Array.from(dedup.values()));
        setShipTos((s1?.data || []) as AbcShipTo[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load ABC catalog');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return { branches, shipTos, loading, error };
}
