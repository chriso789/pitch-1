// ============================================================
// Invoice Line Item Search
// Search past scanned invoice line items (within tenant) by
// color / style / brand / description so reps can pull color
// references for homeowners.
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

export interface InvoiceLineItemFilters {
  search?: string;        // free text — matches description/brand/color/style/category/vendor
  color?: string;
  style?: string;
  brand?: string;
  material_category?: string;
  vendor_name?: string;
  limit?: number;
}

export interface InvoiceLineItemRow {
  id: string;
  invoice_id: string;
  project_id: string | null;
  vendor_name: string | null;
  description: string;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  brand: string | null;
  color: string | null;
  style: string | null;
  material_category: string | null;
  unit_of_measure: string | null;
  sku: string | null;
  created_at: string;
}

export function useInvoiceLineItemSearch(filters: InvoiceLineItemFilters, enabled = true) {
  const tenantId = useEffectiveTenantId();

  return useQuery({
    queryKey: ['invoice-line-items', tenantId, filters],
    enabled: enabled && !!tenantId,
    queryFn: async (): Promise<InvoiceLineItemRow[]> => {
      let q = (supabase as any)
        .from('project_cost_invoice_line_items')
        .select('id, invoice_id, project_id, vendor_name, description, quantity, unit_price, line_total, brand, color, style, material_category, unit_of_measure, sku, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(filters.limit ?? 100);

      if (filters.color) q = q.ilike('color', `%${filters.color}%`);
      if (filters.style) q = q.ilike('style', `%${filters.style}%`);
      if (filters.brand) q = q.ilike('brand', `%${filters.brand}%`);
      if (filters.material_category) q = q.ilike('material_category', `%${filters.material_category}%`);
      if (filters.vendor_name) q = q.ilike('vendor_name', `%${filters.vendor_name}%`);
      if (filters.search) {
        const s = filters.search.replace(/[%_]/g, ' ').trim();
        q = q.or(
          [
            `description.ilike.%${s}%`,
            `brand.ilike.%${s}%`,
            `color.ilike.%${s}%`,
            `style.ilike.%${s}%`,
            `material_category.ilike.%${s}%`,
            `vendor_name.ilike.%${s}%`,
          ].join(',')
        );
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as InvoiceLineItemRow[];
    },
    staleTime: 60_000,
  });
}
