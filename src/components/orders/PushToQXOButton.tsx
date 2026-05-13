import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Truck, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

interface MaterialItem {
  item_name: string;
  qty: number;
  unit: string;
  unit_cost: number;
  notes?: string;
  color_specs?: string;
  srs_item_code?: string;
}

interface Props {
  estimateId?: string;
  jobId?: string;
  jobNumber?: string;
  customerName?: string;
  projectAddress?: string;
  items: MaterialItem[];
}

export function PushToQXOButton({
  estimateId, jobId, jobNumber, customerName, projectAddress, items,
}: Props) {
  const { toast } = useToast();
  const effectiveTenantId = useEffectiveTenantId();
  const [pushing, setPushing] = useState(false);

  const handlePush = async () => {
    if (!effectiveTenantId) {
      toast({ title: 'No tenant context', variant: 'destructive' });
      return;
    }
    if (!items.length) {
      toast({ title: 'No items to push', variant: 'destructive' });
      return;
    }
    setPushing(true);
    try {
      const addr = projectAddress
        ? (() => {
            // Best-effort parse: "123 Main St, City, ST 12345"
            const m = projectAddress.match(/^(.*?),\s*(.*?),\s*([A-Z]{2})\s*(\d{5})/i);
            return m
              ? { address1: m[1], city: m[2], state: m[3].toUpperCase(), postalCode: m[4] }
              : { address1: projectAddress };
          })()
        : null;
      const { data, error } = await supabase.functions.invoke('qxo-submit-order', {
        body: {
          tenant_id: effectiveTenantId,
          project_id: jobId,
          job_id: jobId,
          job_name: customerName,
          job_number: jobNumber,
          delivery_address: addr,
          special_instruction: customerName ? `For ${customerName}` : undefined,
          on_hold: true,
          check_for_availability: 'no',
          items: items.map((i) => ({
            ...i,
            unit_price: i.unit_cost,
          })),
        },
      });
      if (error) throw error;
      if (!data?.success) {
        toast({
          title: 'QXO push failed',
          description: data?.message || data?.error || 'Beacon rejected the order.',
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Pushed to QXO',
        description: data.beacon_order_id
          ? `Beacon order ${data.beacon_order_id} created (PO ${data.po_number}).`
          : `PO ${data.po_number} submitted.`,
      });
    } catch (e: any) {
      toast({ title: 'Push failed', description: e.message, variant: 'destructive' });
    } finally {
      setPushing(false);
    }
  };

  return (
    <Button
      size="sm"
      onClick={handlePush}
      disabled={pushing || items.length === 0}
      className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
    >
      {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
      Push to QXO
    </Button>
  );
}
