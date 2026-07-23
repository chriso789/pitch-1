import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Truck } from 'lucide-react';
import { PushToSupplierDialog } from './PushToSupplierDialog';

interface MaterialItem {
  id?: string;
  template_item_id?: string | null;
  item_name: string;
  qty: number;
  unit: string;
  unit_cost: number;
  notes?: string;
  color_specs?: string;
  srs_item_code?: string;
  abc_item_number?: string | null;
  abc_color?: string | null;
  abc_uom?: string | null;
  abc_price?: number | null;
  abc_price_status?: string | null;
  abc_price_timestamp?: string | null;
  abc_availability?: string | null;
  requires_color?: boolean;
}

interface Props {
  estimateId?: string;
  jobId?: string;
  jobNumber?: string;
  customerName?: string;
  projectAddress?: string;
  items: MaterialItem[];
}

export function PushToSupplierButton({
  estimateId, jobId, jobNumber, customerName, projectAddress, items,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!items.length || !jobId}
        className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
      >
        <Truck className="h-4 w-4" />
        Push to Supplier
      </Button>
      {jobId && (
        <PushToSupplierDialog
          open={open}
          onOpenChange={setOpen}
          projectId={jobId}
          estimateId={estimateId}
          jobNumber={jobNumber}
          customerName={customerName}
          projectAddress={projectAddress}
          items={items.map(i => ({
            id: i.id,
            template_item_id: i.template_item_id,
            item_name: i.item_name,
            description: i.notes,
            quantity: i.qty,
            unit: i.unit,
            unit_cost: i.unit_cost,
            srs_item_code: i.srs_item_code,
            abc_item_number: i.abc_item_number,
            abc_color: i.abc_color,
            abc_uom: i.abc_uom,
            abc_price: i.abc_price,
            abc_price_status: i.abc_price_status as any,
            abc_price_timestamp: i.abc_price_timestamp,
            abc_availability: i.abc_availability,
            color_specs: i.color_specs,
            requires_color: !!i.requires_color,
          }))}
        />
      )}
    </>
  );
}
