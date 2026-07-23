import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type SupplierKind = 'abc' | 'srs' | 'qxo' | 'other';
export type MappingSource =
  | 'system_catalog_match'
  | 'manual'
  | 'invoice_ai'
  | 'order_confirmation';

export interface MaterialSupplierSku {
  id: string;
  tenant_id: string;
  material_id: string;
  supplier: SupplierKind;
  supplier_item_number: string;
  supplier_product_id: string | null;
  manufacturer: string | null;
  product_family: string | null;
  color: string | null;
  uom: string | null;
  mapping_source: MappingSource;
  mapping_confidence: number | null;
  verified_by: string | null;
  verified_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertSupplierSkuInput {
  id?: string;
  material_id: string;
  supplier: SupplierKind;
  supplier_item_number: string;
  supplier_product_id?: string | null;
  manufacturer?: string | null;
  product_family?: string | null;
  color?: string | null;
  uom?: string | null;
  mapping_source?: MappingSource;
  notes?: string | null;
}

const TABLE = 'material_supplier_skus' as any;

export function useMaterialSupplierSkus(materialId: string | undefined | null) {
  const queryClient = useQueryClient();
  const enabled = Boolean(materialId);

  const query = useQuery({
    queryKey: ['material-supplier-skus', materialId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('material_id', materialId as string)
        .order('supplier');
      if (error) throw error;
      return ((data ?? []) as unknown) as MaterialSupplierSku[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['material-supplier-skus', materialId] });

  const upsert = useMutation({
    mutationFn: async (input: UpsertSupplierSkuInput) => {
      // tenant_id is set by the DB trigger/RLS default via get_user_tenant_id() on write policy.
      // We resolve it client-side too so INSERT WITH CHECK passes.
      const { data: tenantRow } = await supabase.rpc('get_user_tenant_id' as any);
      const tenant_id = tenantRow as unknown as string;

      const payload = {
        ...input,
        tenant_id,
        mapping_source: input.mapping_source ?? 'manual',
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from(TABLE)
        .upsert(payload as any, {
          onConflict: 'tenant_id,material_id,supplier,supplier_item_number',
        })
        .select()
        .single();
      if (error) throw error;
      return (data as unknown) as MaterialSupplierSku;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(TABLE).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    mappings: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    upsert,
    remove,
    refetch: query.refetch,
  };
}
