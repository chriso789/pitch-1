import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, Building2, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Vendor {
  id: string;
  name: string;
}

interface VendorProductRow {
  vendor_id: string;
  vendor_sku: string | null;
  vendor_product_name: string | null;
  auto_matched: boolean;
  confidence: number | null;
  last_seen_on_invoice_at: string | null;
}

interface Props {
  productId: string;
  onUpdated?: () => void;
}

/**
 * Per-product SKU map across every supplier (SRS, ABC, QXO, …).
 * Inline-edits write to `vendor_products` via upsert. Auto-matched rows
 * coming from invoice scraping can be confirmed in one click.
 */
export function SupplierSkuPanel({ productId, onUpdated }: Props) {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [rows, setRows] = useState<Record<string, VendorProductRow>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingVendor, setSavingVendor] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !productId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [vRes, vpRes] = await Promise.all([
        supabase
          .from('vendors')
          .select('id, name')
          .eq('tenant_id', tenantId as any)
          .order('name'),
        supabase
          .from('vendor_products')
          .select('vendor_id, vendor_sku, vendor_product_name, auto_matched, confidence, last_seen_on_invoice_at')
          .eq('tenant_id', tenantId as any)
          .eq('product_id', productId),
      ]);
      if (cancelled) return;
      const vendorList: Vendor[] = (vRes.data || []).map((v: any) => ({ id: v.id, name: v.name }));
      const rowMap: Record<string, VendorProductRow> = {};
      (vpRes.data || []).forEach((r: any) => { rowMap[r.vendor_id] = r as VendorProductRow; });
      setVendors(vendorList);
      setRows(rowMap);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenantId, productId]);

  const saveSku = async (vendorId: string, opts?: { confirm?: boolean }) => {
    if (!tenantId) return;
    const newSku = (edits[vendorId] ?? rows[vendorId]?.vendor_sku ?? '').trim();
    setSavingVendor(vendorId);
    try {
      const { error } = await supabase
        .from('vendor_products')
        .upsert(
          {
            tenant_id: tenantId,
            vendor_id: vendorId,
            product_id: productId,
            vendor_sku: newSku || null,
            is_active: true,
            auto_matched: opts?.confirm ? false : (rows[vendorId]?.auto_matched ?? false),
            confidence: opts?.confirm ? 1 : rows[vendorId]?.confidence ?? null,
          } as any,
          { onConflict: 'tenant_id,vendor_id,product_id' },
        );
      if (error) throw error;
      setRows((prev) => ({
        ...prev,
        [vendorId]: {
          vendor_id: vendorId,
          vendor_sku: newSku || null,
          vendor_product_name: prev[vendorId]?.vendor_product_name ?? null,
          auto_matched: opts?.confirm ? false : (prev[vendorId]?.auto_matched ?? false),
          confidence: opts?.confirm ? 1 : prev[vendorId]?.confidence ?? null,
          last_seen_on_invoice_at: prev[vendorId]?.last_seen_on_invoice_at ?? null,
        },
      }));
      setEdits((p) => { const { [vendorId]: _, ...rest } = p; return rest; });
      toast({ title: opts?.confirm ? 'SKU confirmed' : 'SKU saved' });
      onUpdated?.();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSavingVendor(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading supplier SKUs…
      </div>
    );
  }

  if (!vendors.length) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No suppliers configured for this tenant yet. Add SRS, ABC, or QXO under Settings → Integrations.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Supplier SKUs</h4>
        <span className="text-xs text-muted-foreground">One SKU per supplier — auto-used when pushing orders</span>
      </div>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase">
            <tr>
              <th className="p-2 text-left">Supplier</th>
              <th className="p-2 text-left">Supplier SKU</th>
              <th className="p-2 text-left">Source</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => {
              const row = rows[v.id];
              const dirty = edits[v.id] !== undefined && edits[v.id] !== (row?.vendor_sku || '');
              return (
                <tr key={v.id} className="border-t">
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span>{v.name}</span>
                    </div>
                  </td>
                  <td className="p-2">
                    <Input
                      value={edits[v.id] ?? row?.vendor_sku ?? ''}
                      onChange={(e) => setEdits((p) => ({ ...p, [v.id]: e.target.value }))}
                      placeholder="—"
                      className="h-8"
                    />
                  </td>
                  <td className="p-2">
                    {row?.auto_matched ? (
                      <Badge variant="outline" className="gap-1">
                        <Sparkles className="h-3 w-3" />
                        From invoice {row.confidence != null ? `· ${Math.round(row.confidence * 100)}%` : ''}
                      </Badge>
                    ) : row?.vendor_sku ? (
                      <Badge variant="secondary">Verified</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not mapped</span>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    <div className="flex justify-end gap-1">
                      {row?.auto_matched && !dirty && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => saveSku(v.id, { confirm: true })}
                          disabled={savingVendor === v.id}
                        >
                          <Check className="mr-1 h-3 w-3" /> Confirm
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => saveSku(v.id)}
                        disabled={savingVendor === v.id || !dirty}
                      >
                        {savingVendor === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
