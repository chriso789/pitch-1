import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Package, Wrench } from 'lucide-react';
import { CalcTemplateItem } from './hooks/useCalcTemplateEditor';
import { usePricingCalculation } from './hooks/usePricingCalculation';
import { FormulaBuilder } from './FormulaBuilder';

interface CalcItemDetailsPanelProps {
  item: CalcTemplateItem;
  profitMargin: number;
  onUpdate: (updatedItem: CalcTemplateItem) => void;
  onDone: () => void;
}

const UNITS = [
  { value: 'SQ', label: 'SQ (Square - 100 sq ft)' },
  { value: 'BDL', label: 'BDL (Bundle)' },
  { value: 'LF', label: 'LF (Linear Feet)' },
  { value: 'EA', label: 'EA (Each)' },
  { value: 'RL', label: 'RL (Roll)' },
  { value: 'BX', label: 'BX (Box)' },
  { value: 'GAL', label: 'GAL (Gallon)' },
  { value: 'PC', label: 'PC (Piece)' },
];

const MEASUREMENT_TYPES = [
  { value: 'roof_area', label: 'Roof Area (Squares)' },
  { value: 'ridges', label: 'Ridges (LF)' },
  { value: 'hips', label: 'Hips (LF)' },
  { value: 'valleys', label: 'Valleys (LF)' },
  { value: 'rakes', label: 'Rakes (LF)' },
  { value: 'eaves', label: 'Eaves (LF)' },
  { value: 'drip_edge', label: 'Drip Edge (LF)' },
  { value: 'step_flash', label: 'Step Flashing (LF)' },
];

export const CalcItemDetailsPanel: React.FC<CalcItemDetailsPanelProps> = ({
  item,
  profitMargin,
  onUpdate,
  onDone,
}) => {
  // Buffer changes locally - only save when Done is clicked
  const [localItem, setLocalItem] = useState<CalcTemplateItem>(item);
  const { calculatePrice, formatCurrency } = usePricingCalculation();
  const pricing = calculatePrice(localItem.unit_cost, profitMargin, 'profit_margin');

  // Sync local state when switching items
  useEffect(() => {
    setLocalItem(item);
  }, [item.id]);

  const handleLocalUpdate = (updates: Partial<CalcTemplateItem>) => {
    setLocalItem(prev => ({ ...prev, ...updates }));
  };

  const handleDone = () => {
    onUpdate(localItem);
    onDone();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onDone}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            {item.item_type === 'material' ? (
              <Package className="h-5 w-5 text-primary" />
            ) : (
              <Wrench className="h-5 w-5 text-orange-500" />
            )}
            <h2 className="text-lg font-semibold">Edit Item</h2>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="space-y-4">
        {/* Item Name */}
        <div className="space-y-2">
          <Label htmlFor="item_name">Item Name</Label>
          <Input
            id="item_name"
            value={localItem.item_name}
            onChange={(e) => handleLocalUpdate({ item_name: e.target.value })}
            placeholder="e.g., 3-Tab Shingles"
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={localItem.description || ''}
            onChange={(e) => handleLocalUpdate({ description: e.target.value })}
            placeholder="Optional description..."
            rows={2}
          />
        </div>

        {/* Item Type */}
        <div className="space-y-2">
          <Label>Item Type</Label>
          <Select
            value={localItem.item_type}
            onValueChange={(value) => handleLocalUpdate({ item_type: value as 'material' | 'labor' })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="material">Material</SelectItem>
              <SelectItem value="labor">Labor</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Unit */}
        <div className="space-y-2">
          <Label>Unit</Label>
          <Select
            value={localItem.unit}
            onValueChange={(value) => handleLocalUpdate({ unit: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((unit) => (
                <SelectItem key={unit.value} value={unit.value}>
                  {unit.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Unit Cost */}
        <div className="space-y-2">
          <Label htmlFor="unit_cost">Unit Cost ($)</Label>
          <Input
            id="unit_cost"
            type="number"
            step="0.01"
            value={localItem.unit_cost}
            onChange={(e) => handleLocalUpdate({ unit_cost: parseFloat(e.target.value) || 0 })}
          />
        </div>

        {/* Formula Builder */}
        <FormulaBuilder
          value={localItem.qty_formula}
          unit={localItem.unit}
          onChange={(formula) => handleLocalUpdate({ qty_formula: formula })}
        />

        {/* SKU Pattern */}
        <div className="space-y-2">
          <Label htmlFor="sku_pattern">SKU Pattern</Label>
          <Input
            id="sku_pattern"
            value={localItem.sku_pattern || ''}
            onChange={(e) => handleLocalUpdate({ sku_pattern: e.target.value })}
            placeholder="e.g., ABC-SHINGLE-*"
          />
        </div>

        {/* Manufacturer */}
        <div className="space-y-2">
          <Label htmlFor="manufacturer">Manufacturer</Label>
          <Input
            id="manufacturer"
            value={localItem.manufacturer || ''}
            onChange={(e) => handleLocalUpdate({ manufacturer: e.target.value })}
            placeholder="e.g., GAF, Owens Corning"
          />
        </div>
      </div>

      {/* Pricing Summary */}
      <div className="rounded-lg border bg-muted/50 p-4">
        <h3 className="font-medium mb-3">Pricing Summary</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Unit Cost</p>
            <p className="font-semibold">{formatCurrency(localItem.unit_cost)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Margin</p>
            <p className="font-semibold">{profitMargin}%</p>
          </div>
          <div>
            <p className="text-muted-foreground">Sell Price</p>
            <p className="font-semibold text-primary">{formatCurrency(pricing.price)}</p>
          </div>
        </div>
      </div>

      {/* Done Button */}
      <Button className="w-full" onClick={handleDone}>
        Done Editing
      </Button>
    </div>
  );
};
