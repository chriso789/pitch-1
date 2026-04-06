import React from 'react';
import { useForm } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

interface FormData {
  name: string;
  sku: string;
  brand: string;
  category: string;
  unit_of_measure: string;
  unit_cost: string;
  unit_price: string;
  barcode: string;
  description: string;
}

interface InventoryItemFormProps {
  onSuccess: () => void;
}

const CATEGORIES = [
  'Roofing', 'Siding', 'Gutters', 'Underlayment', 'Fasteners',
  'Flashing', 'Ventilation', 'Insulation', 'Tools', 'Safety Equipment', 'Other'
];

const UNITS = ['each', 'bundle', 'box', 'roll', 'square', 'linear ft', 'sq ft', 'pallet', 'case'];

export function InventoryItemForm({ onSuccess }: InventoryItemFormProps) {
  const tenantId = useEffectiveTenantId();
  const { register, handleSubmit, setValue, watch, formState: { isSubmitting } } = useForm<FormData>({
    defaultValues: {
      unit_of_measure: 'each',
      category: '',
    }
  });

  const onSubmit = async (data: FormData) => {
    if (!tenantId) return;

    const { error } = await supabase.from('inventory_items').insert({
      tenant_id: tenantId,
      name: data.name,
      sku: data.sku,
      brand: data.brand || null,
      category: data.category || null,
      unit_of_measure: data.unit_of_measure || 'each',
      unit_cost: data.unit_cost ? parseFloat(data.unit_cost) : null,
      unit_price: data.unit_price ? parseFloat(data.unit_price) : null,
      barcode: data.barcode || null,
      description: data.description || null,
    });

    if (error) throw error;
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Item Name *</Label>
          <Input id="name" {...register('name', { required: true })} placeholder="e.g. OC Duration Shingles" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sku">SKU *</Label>
          <Input id="sku" {...register('sku', { required: true })} placeholder="e.g. SHG-OC-DUR-001" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="brand">Brand</Label>
          <Input id="brand" {...register('brand')} placeholder="e.g. Owens Corning" />
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <Select value={watch('category')} onValueChange={(v) => setValue('category', v)}>
            <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Unit of Measure</Label>
          <Select value={watch('unit_of_measure')} onValueChange={(v) => setValue('unit_of_measure', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="unit_cost">Unit Cost ($)</Label>
          <Input id="unit_cost" type="number" step="0.01" {...register('unit_cost')} placeholder="0.00" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="unit_price">Unit Price ($)</Label>
          <Input id="unit_price" type="number" step="0.01" {...register('unit_price')} placeholder="0.00" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="barcode">Barcode / UPC</Label>
        <Input id="barcode" {...register('barcode')} placeholder="Enter barcode or UPC number" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input id="description" {...register('description')} placeholder="Optional description" />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Add Item
      </Button>
    </form>
  );
}
