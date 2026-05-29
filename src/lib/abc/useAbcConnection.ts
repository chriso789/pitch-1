// React Query hooks for the ABC v2 surface. Tenant scoping is enforced
// server-side in `abc-api` via `requireTenant` — these hooks just key on
// the effective tenant so a company-switcher change re-fetches cleanly.

import { useQuery } from "@tanstack/react-query";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import {
  getAbcAccounts,
  searchAbcCatalog,
  getAbcFamily,
  type AbcShipToAccount,
} from "@/lib/abc/abcApi";

export function useAbcAccounts() {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ["abc", "accounts", tenantId],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await getAbcAccounts();
      if (error) throw new Error(error);
      return (data?.accounts ?? []) as AbcShipToAccount[];
    },
  });
}

export function useAbcCatalogSearch(q: string, enabled = true) {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ["abc", "catalog", "search", tenantId, q],
    enabled: !!tenantId && enabled && q.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await searchAbcCatalog(q);
      if (error) throw new Error(error);
      return data!;
    },
  });
}

export function useAbcFamily(itemNumber: string | null | undefined) {
  const tenantId = useEffectiveTenantId();
  return useQuery({
    queryKey: ["abc", "catalog", "family", tenantId, itemNumber],
    enabled: !!tenantId && !!itemNumber,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await getAbcFamily(itemNumber!);
      if (error) throw new Error(error);
      return data!;
    },
  });
}
