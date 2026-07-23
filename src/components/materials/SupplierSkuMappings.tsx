import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Trash2, Plus, Info } from 'lucide-react';
import { toast } from 'sonner';
import {
  useMaterialSupplierSkus,
  type SupplierKind,
} from '@/hooks/useMaterialSupplierSkus';

interface Props {
  materialId: string;
}

const SUPPLIERS: { value: SupplierKind; label: string }[] = [
  { value: 'abc', label: 'ABC Supply' },
  { value: 'srs', label: 'SRS Distribution' },
  { value: 'qxo', label: 'QXO' },
  { value: 'other', label: 'Other' },
];

interface DraftRow {
  supplier: SupplierKind;
  supplier_item_number: string;
  manufacturer: string;
  product_family: string;
  color: string;
  uom: string;
}

const emptyDraft = (): DraftRow => ({
  supplier: 'abc',
  supplier_item_number: '',
  manufacturer: '',
  product_family: '',
  color: '',
  uom: '',
});

export function SupplierSkuMappings({ materialId }: Props) {
  const { mappings, isLoading, upsert, remove } = useMaterialSupplierSkus(materialId);
  const [draft, setDraft] = useState<DraftRow>(emptyDraft());

  const handleAdd = async () => {
    if (!draft.supplier_item_number.trim()) {
      toast.error('Supplier item number is required');
      return;
    }
    try {
      await upsert.mutateAsync({
        material_id: materialId,
        supplier: draft.supplier,
        supplier_item_number: draft.supplier_item_number.trim(),
        manufacturer: draft.manufacturer.trim() || null,
        product_family: draft.product_family.trim() || null,
        color: draft.color.trim() || null,
        uom: draft.uom.trim() || null,
        mapping_source: 'manual',
      });
      toast.success('Supplier SKU saved');
      setDraft(emptyDraft());
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save supplier SKU');
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      toast.success('Removed');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove');
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <div className="text-xs text-muted-foreground leading-snug">
          Map this material to each supplier's item number. Pricing is <strong>never stored
          here</strong> — live prices are fetched only when you order from a specific supplier,
          per ABC Supply integration rules.
        </div>
      </div>

      <div className="space-y-2">
        {isLoading && (
          <div className="text-xs text-muted-foreground">Loading mappings…</div>
        )}
        {!isLoading && mappings.length === 0 && (
          <div className="text-xs text-muted-foreground italic">
            No supplier mappings yet.
          </div>
        )}
        {mappings.map((m) => (
          <div
            key={m.id}
            className="flex flex-wrap items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-sm"
          >
            <Badge variant="outline" className="uppercase text-[10px]">
              {m.supplier}
            </Badge>
            <span className="font-mono text-xs">{m.supplier_item_number}</span>
            {m.uom && (
              <span className="text-xs text-muted-foreground">UOM: {m.uom}</span>
            )}
            {m.color && (
              <span className="text-xs text-muted-foreground">Color: {m.color}</span>
            )}
            {m.manufacturer && (
              <span className="text-xs text-muted-foreground">
                {m.manufacturer}
                {m.product_family ? ` · ${m.product_family}` : ''}
              </span>
            )}
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {m.mapping_source.replace('_', ' ')}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => handleRemove(m.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
        <div className="sm:col-span-1">
          <Label className="text-xs">Supplier</Label>
          <Select
            value={draft.supplier}
            onValueChange={(v) => setDraft({ ...draft, supplier: v as SupplierKind })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPLIERS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs">Item # *</Label>
          <Input
            className="h-9"
            value={draft.supplier_item_number}
            onChange={(e) =>
              setDraft({ ...draft, supplier_item_number: e.target.value })
            }
            placeholder="0133180"
          />
        </div>
        <div className="sm:col-span-1">
          <Label className="text-xs">UOM</Label>
          <Input
            className="h-9"
            value={draft.uom}
            onChange={(e) => setDraft({ ...draft, uom: e.target.value })}
            placeholder="BDL"
          />
        </div>
        <div className="sm:col-span-1">
          <Label className="text-xs">Color</Label>
          <Input
            className="h-9"
            value={draft.color}
            onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            placeholder="Charcoal"
          />
        </div>
        <div className="sm:col-span-1 flex items-end">
          <Button
            type="button"
            size="sm"
            className="h-9 w-full"
            onClick={handleAdd}
            disabled={upsert.isPending}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
        <div className="sm:col-span-3">
          <Label className="text-xs">Manufacturer</Label>
          <Input
            className="h-9"
            value={draft.manufacturer}
            onChange={(e) => setDraft({ ...draft, manufacturer: e.target.value })}
            placeholder="GAF"
          />
        </div>
        <div className="sm:col-span-3">
          <Label className="text-xs">Product Family</Label>
          <Input
            className="h-9"
            value={draft.product_family}
            onChange={(e) => setDraft({ ...draft, product_family: e.target.value })}
            placeholder="Timberline HDZ"
          />
        </div>
      </div>
    </div>
  );
}

export default SupplierSkuMappings;
