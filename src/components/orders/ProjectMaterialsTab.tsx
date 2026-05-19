import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Truck, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PushToSupplierDialog } from './PushToSupplierDialog';
import { LiveOrderTracker } from './LiveOrderTracker';
import { SrsDiagnosticsPanel } from './SrsDiagnosticsPanel';

interface Props {
  projectId: string;
  estimateId?: string;
  jobNumber?: string;
  customerName?: string;
  projectAddress?: string;
}

export function ProjectMaterialsTab({
  projectId, estimateId, jobNumber, customerName, projectAddress,
}: Props) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushOpen, setPushOpen] = useState(false);

  const loadItems = async () => {
    if (!estimateId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('estimate_line_items')
      .select('id, item_name, description, quantity, unit_type, unit_cost, srs_item_code, item_category')
      .eq('estimate_id', estimateId)
      .order('sort_order', { ascending: true });

    const mapped = (data || [])
      .filter((r: any) => (r.item_category || '').toLowerCase().includes('material') || r.srs_item_code)
      .map((r: any) => ({
        id: r.id,
        item_name: r.item_name,
        description: r.description,
        quantity: Number(r.quantity || 0),
        unit: r.unit_type || 'EA',
        unit_cost: Number(r.unit_cost || 0),
        srs_item_code: r.srs_item_code || null,
      }));
    setItems(mapped);
    setLoading(false);
  };

  useEffect(() => { loadItems(); }, [estimateId]);

  const subtotal = useMemo(
    () => items.reduce((s, i) => s + i.quantity * i.unit_cost, 0),
    [items]
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Materials</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {items.length} line item{items.length === 1 ? '' : 's'} · estimated $
              {subtotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>
          <Button onClick={() => setPushOpen(true)} disabled={loading || items.length === 0}>
            <Truck className="mr-2 h-4 w-4" />
            Push to Supplier
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No material line items on this project's estimate yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase">
                  <tr>
                    <th className="p-2 text-left">Item</th>
                    <th className="p-2 text-left">SKU</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-left">UoM</th>
                    <th className="p-2 text-right">Unit $</th>
                    <th className="p-2 text-right">Line $</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{it.item_name}</td>
                      <td className="p-2"><code className="text-xs">{it.srs_item_code || '—'}</code></td>
                      <td className="p-2 text-right">{it.quantity}</td>
                      <td className="p-2">{it.unit}</td>
                      <td className="p-2 text-right">${it.unit_cost.toFixed(2)}</td>
                      <td className="p-2 text-right">${(it.quantity * it.unit_cost).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <LiveOrderTracker projectId={projectId} />

      <SrsDiagnosticsPanel projectId={projectId} />

      <PushToSupplierDialog
        open={pushOpen}
        onOpenChange={setPushOpen}
        projectId={projectId}
        estimateId={estimateId}
        jobNumber={jobNumber}
        customerName={customerName}
        projectAddress={projectAddress}
        items={items}
      />
    </div>
  );
}
