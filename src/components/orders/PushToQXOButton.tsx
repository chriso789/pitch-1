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
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: {
          action: 'place_order',
          tenant_id: effectiveTenantId,
          environment: 'production',
          project_id: jobId,
          job_id: jobId,
          job_name: customerName,
          job_number: jobNumber,
          delivery_address: projectAddress,
          delivery_method: 'roof_load',
          special_instruction: customerName ? `For ${customerName}` : undefined,
          on_hold: true,
          items: items.map((i) => ({
            abc_item_code: i.srs_item_code,
            itemNumber: i.srs_item_code,
            description: i.item_name,
            quantity: i.qty,
            unitOfMeasure: (i.unit || 'EA').toUpperCase(),
            unitPrice: i.unit_cost,
            notes: i.notes,
            color_specs: i.color_specs,
          })),
        },
      });
      if (error) throw error;
      if (!data?.success) {
        toast({
          title: 'ABC push failed',
          description: data?.error_code || data?.interpretation || data?.error || 'ABC rejected the order.',
          variant: 'destructive',
        });
        return;
      }
      const cn = data?.body?.[0]?.confirmationNumber ?? data?.body?.confirmationNumber;
      toast({
        title: 'Pushed to ABC Supply',
        description: cn ? `ABC confirmation ${cn}` : `HTTP ${data.status} accepted.`,
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
