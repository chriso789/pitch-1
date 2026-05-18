import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Truck, Loader2, Package, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

type SupplierKey = 'srs' | 'qxo' | 'abc';

interface SupplierOption {
  key: SupplierKey;
  label: string;
  defaultBranch?: string | null;
  environment?: string | null;
  status?: 'connected' | 'error' | 'not_configured' | 'coming_soon';
  statusNote?: string;
}

interface MaterialItem {
  item_name: string;
  description?: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  srs_item_code?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  estimateId?: string;
  jobNumber?: string;
  customerName?: string;
  projectAddress?: string;
  items: MaterialItem[];
  onSubmitted?: () => void;
}

export function PushToSupplierDialog({
  open, onOpenChange, projectId, estimateId, jobNumber,
  customerName, projectAddress, items, onSubmitted,
}: Props) {
  const { toast } = useToast();
  const tenantId = useEffectiveTenantId();
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [selected, setSelected] = useState<SupplierKey | null>(null);
  const [branchCode, setBranchCode] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<'delivery' | 'pickup'>('delivery');
  const [deliveryDate, setDeliveryDate] = useState<string>(() => {
    const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [shipAddress, setShipAddress] = useState(projectAddress || '');
  const [notes, setNotes] = useState('');
  const [editableItems, setEditableItems] = useState<MaterialItem[]>(items);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setEditableItems(items);
  }, [items]);

  useEffect(() => {
    setShipAddress(projectAddress || '');
  }, [projectAddress]);

  useEffect(() => {
    if (!open || !tenantId) return;
    let cancelled = false;

    (async () => {
      setLoadingSuppliers(true);
      const found: SupplierOption[] = [];

      const [srsRes, qxoRes] = await Promise.all([
        supabase
          .from('srs_connections')
          .select('default_branch_code, environment, connection_status, valid_indicator')
          .eq('tenant_id', tenantId as any)
          .maybeSingle(),
        supabase
          .from('qxo_connections')
          .select('default_branch_code, environment, connection_status')
          .eq('tenant_id', tenantId as any)
          .maybeSingle(),
      ]);

      if (srsRes.data && (srsRes.data.connection_status === 'connected' || srsRes.data.valid_indicator)) {
        found.push({
          key: 'srs',
          label: `SRS Distribution${srsRes.data.environment === 'production' ? '' : ' (QA)'}`,
          defaultBranch: srsRes.data.default_branch_code,
          environment: srsRes.data.environment,
          status: 'connected',
        });
      } else {
        found.push({
          key: 'srs',
          label: 'SRS Distribution',
          status: 'not_configured',
          statusNote: 'Connect in Settings → Integrations',
        });
      }

      if (qxoRes.data && qxoRes.data.connection_status === 'connected') {
        found.push({
          key: 'qxo',
          label: `QXO / Beacon${qxoRes.data.environment === 'production' ? '' : ' (Test)'}`,
          defaultBranch: qxoRes.data.default_branch_code,
          environment: qxoRes.data.environment,
          status: 'connected',
        });
      } else {
        found.push({
          key: 'qxo',
          label: 'QXO / Beacon',
          environment: qxoRes.data?.environment,
          status: qxoRes.data ? 'error' : 'not_configured',
          statusNote: qxoRes.data
            ? 'Connection error — re-authenticate in Settings → Integrations'
            : 'Connect in Settings → Integrations',
        });
      }

      // ABC Supply: always show as a coming-soon option so users know it's planned.
      found.push({
        key: 'abc',
        label: 'ABC Supply',
        defaultBranch: null,
        environment: null,
        status: 'coming_soon',
        statusNote: 'Coming soon',
      });

      if (cancelled) return;
      setSuppliers(found);
      const connected = found.filter(s => s.status === 'connected');
      if (connected.length === 1) {
        setSelected(connected[0].key);
        setBranchCode(connected[0].defaultBranch || '');
      } else if (connected.length === 0) {
        setSelected(null);
      }
      setLoadingSuppliers(false);
    })();

    return () => { cancelled = true; };
  }, [open, tenantId]);

  const totalCost = useMemo(
    () => editableItems.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_cost || 0), 0),
    [editableItems]
  );

  const updateItem = (idx: number, patch: Partial<MaterialItem>) => {
    setEditableItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handleSelectSupplier = (key: SupplierKey) => {
    setSelected(key);
    const s = suppliers.find(s => s.key === key);
    setBranchCode(s?.defaultBranch || '');
  };

  const parseAddress = (raw: string) => {
    const m = raw.match(/^(.*?),\s*(.*?),\s*([A-Z]{2})\s*(\d{5})/i);
    return m
      ? { address1: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), postalCode: m[4] }
      : { address1: raw.trim() };
  };

  const submit = async () => {
    if (!tenantId || !selected) return;
    if (selected === 'abc') {
      toast({
        title: 'ABC Supply coming soon',
        description: 'ABC Supply integration is on the roadmap. Use SRS or QXO for now.',
      });
      return;
    }
    if (!editableItems.length) {
      toast({ title: 'No items to push', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      if (selected === 'srs') {
        // 1. Create the srs_orders draft + items linked to the project
        const orderNumber = `PITCH-${jobNumber || 'JOB'}-${Date.now()}`;
        const { data: orderRow, error: orderErr } = await supabase
          .from('srs_orders')
          .insert({
            tenant_id: tenantId as any,
            project_id: projectId,
            estimate_id: estimateId || null,
            order_number: orderNumber,
            branch_code: branchCode || null,
            status: 'draft',
            delivery_method: deliveryMethod,
            delivery_date: deliveryDate,
            delivery_address: shipAddress,
            notes: notes || null,
            total_amount: totalCost,
          } as any)
          .select('id')
          .single();
        if (orderErr) throw orderErr;

        const itemsPayload = editableItems
          .filter(i => i.srs_item_code && Number(i.quantity) > 0)
          .map(i => ({
            order_id: orderRow.id,
            srs_product_id: Number(i.srs_item_code),
            product_name: i.item_name,
            product_description: i.description || i.item_name,
            quantity: Number(i.quantity),
            uom: (i.unit || 'EA').toUpperCase(),
            unit_price: Number(i.unit_cost || 0),
            total_price: Number(i.quantity || 0) * Number(i.unit_cost || 0),
          }));

        if (!itemsPayload.length) {
          throw new Error('No items have an SRS product code. Map SKUs in the estimate first.');
        }

        const { error: itemsErr } = await supabase.from('srs_order_items').insert(itemsPayload);
        if (itemsErr) throw itemsErr;

        // 2. Submit through the proxy
        const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
          body: { action: 'submit_order', tenant_id: tenantId, order_id: orderRow.id },
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'SRS rejected the order');

        toast({
          title: 'Pushed to SRS',
          description: `Order ${orderNumber} submitted (SRS ID ${data.srsOrderId || 'pending'}).`,
        });
      } else if (selected === 'qxo') {
        const addr = shipAddress ? parseAddress(shipAddress) : null;
        const { data, error } = await supabase.functions.invoke('qxo-submit-order', {
          body: {
            tenant_id: tenantId,
            project_id: projectId,
            job_id: projectId,
            job_name: customerName,
            job_number: jobNumber,
            delivery_address: addr,
            special_instruction: notes || (customerName ? `For ${customerName}` : undefined),
            on_hold: false,
            check_for_availability: 'yes',
            items: editableItems.map(i => ({
              item_name: i.item_name,
              qty: Number(i.quantity),
              unit: i.unit,
              unit_cost: Number(i.unit_cost),
              unit_price: Number(i.unit_cost),
              notes: i.description,
            })),
          },
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.message || data?.error || 'QXO rejected the order');

        toast({
          title: 'Pushed to QXO',
          description: data.beacon_order_id
            ? `Beacon order ${data.beacon_order_id} created (PO ${data.po_number}).`
            : `PO ${data.po_number} submitted.`,
        });
      }

      onSubmitted?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Push failed', description: e.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Push Order to Supplier
          </DialogTitle>
        </DialogHeader>

        {loadingSuppliers ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">Checking connected suppliers…</span>
          </div>
        ) : suppliers.filter(s => s.key !== 'abc').length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            <AlertCircle className="mx-auto mb-2 h-6 w-6 text-amber-500" />
            No supplier accounts are connected for this tenant. Connect SRS or QXO in Settings → Integrations. (ABC Supply integration is coming soon.)
          </div>
        ) : (
          <div className="space-y-5">
            {/* Supplier picker */}
            <div>
              <Label className="mb-2 block">Supplier</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {suppliers.map(s => (
                  <Card
                    key={s.key}
                    onClick={() => handleSelectSupplier(s.key)}
                    className={`cursor-pointer transition ${
                      selected === s.key ? 'ring-2 ring-primary' : 'hover:bg-muted/50'
                    }`}
                  >
                    <CardContent className="flex items-center justify-between p-4">
                      <div>
                        <div className="font-medium">{s.label}</div>
                        {s.defaultBranch && (
                          <div className="text-xs text-muted-foreground">Branch {s.defaultBranch}</div>
                        )}
                      </div>
                      <Badge variant={selected === s.key ? 'default' : 'outline'}>
                        {selected === s.key ? 'Selected' : 'Choose'}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {selected && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="branch">Branch code</Label>
                    <Input id="branch" value={branchCode} onChange={e => setBranchCode(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="dmethod">Delivery method</Label>
                    <Select value={deliveryMethod} onValueChange={(v: any) => setDeliveryMethod(v)}>
                      <SelectTrigger id="dmethod"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="delivery">Delivery</SelectItem>
                        <SelectItem value="pickup">Pickup / Will-call</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="ddate">Requested date</Label>
                    <Input id="ddate" type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
                  </div>
                </div>

                <div>
                  <Label htmlFor="addr">Ship-to address</Label>
                  <Input id="addr" value={shipAddress} onChange={e => setShipAddress(e.target.value)} />
                </div>

                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <Label>Items ({editableItems.length})</Label>
                    <span className="text-xs text-muted-foreground">
                      Pricing will be quoted by the supplier
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs uppercase">
                        <tr>
                          <th className="p-2 text-left">Item</th>
                          <th className="p-2 text-left">SKU</th>
                          <th className="p-2 text-right">Qty</th>
                          <th className="p-2 text-left">UoM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editableItems.map((it, i) => (
                          <tr key={i} className="border-t">
                            <td className="p-2">{it.item_name}</td>
                            <td className="p-2">
                              <code className="text-xs">{it.srs_item_code || '—'}</code>
                            </td>
                            <td className="p-2 text-right">
                              <Input
                                type="number"
                                value={it.quantity}
                                onChange={e => updateItem(i, { quantity: Number(e.target.value) })}
                                className="h-7 w-20 text-right"
                              />
                            </td>
                            <td className="p-2">{it.unit}</td>
                          </tr>
                        ))}
                        {editableItems.length === 0 && (
                          <tr>
                            <td colSpan={4} className="p-6 text-center text-muted-foreground">
                              <Package className="mx-auto mb-2 h-5 w-5" />
                              No material line items found on this project's estimate.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {selected === 'srs' && editableItems.some(i => !i.srs_item_code) && (
                    <p className="mt-2 text-xs text-amber-600">
                      Items without an SRS SKU will be skipped. Map SKUs in the estimate to include them.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!selected || submitting || editableItems.length === 0}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
            Push to {selected ? selected.toUpperCase() : 'Supplier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
