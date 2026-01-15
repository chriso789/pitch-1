import React from 'react';
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

interface CalcItemDetailsPanelProps {
  item: CalcTemplateItem;
  profitMargin: number;
  onUpdate: (updates: Partial<CalcTemplateItem>) => void;
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
  const { calculatePrice, formatCurrency } = usePricingCalculation();
  const pricing = calculatePrice(item.unit_cost, profitMargin, 'profit_margin');

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
            value={item.item_name}
            onChange={(e) => onUpdate({ item_name: e.target.value })}
            placeholder="e.g., 3-Tab Shingles"
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={item.description || ''}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="Optional description..."
            rows={2}
          />
        </div>

        {/* Item Type */}
        <div className="space-y-2">
          <Label>Item Type</Label>
          <Select
            value={item.item_type}
            onValueChange={(value) => onUpdate({ item_type: value as 'material' | 'labor' })}
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
            value={item.unit}
            onValueChange={(value) => onUpdate({ unit: value })}
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
            value={item.unit_cost}
            onChange={(e) => onUpdate({ unit_cost: parseFloat(e.target.value) || 0 })}
          />
        </div>

        {/* Measurement Type */}
        <div className="space-y-2">
          <Label>Measurement Type (Auto-calculate from)</Label>
          <Select
            value={item.measurement_type || ''}
            onValueChange={(value) => onUpdate({ measurement_type: value || null })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select measurement..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">None (Manual Qty)</SelectItem>
              {MEASUREMENT_TYPES.map((mt) => (
                <SelectItem key={mt.value} value={mt.value}>
                  {mt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Coverage Per Unit */}
        {item.measurement_type && (
          <div className="space-y-2">
            <Label htmlFor="coverage_per_unit">Coverage Per Unit</Label>
            <Input
              id="coverage_per_unit"
              type="number"
              step="0.01"
              value={item.coverage_per_unit || ''}
              onChange={(e) => onUpdate({ coverage_per_unit: parseFloat(e.target.value) || null })}
              placeholder="e.g., 33.33 sq ft per bundle"
            />
            <p className="text-xs text-muted-foreground">
              How much area/length does 1 {item.unit} cover? Used for auto-calculation.
            </p>
          </div>
        )}

        {/* Quantity Formula */}
        <div className="space-y-2">
          <Label htmlFor="qty_formula">Quantity Formula</Label>
          <Input
            id="qty_formula"
            value={item.qty_formula}
            onChange={(e) => onUpdate({ qty_formula: e.target.value })}
            placeholder="e.g., ceil(roof.squares * 3)"
          />
          <p className="text-xs text-muted-foreground">
            Use tags like roof.squares, lf.ridge, lf.hip. Functions: ceil(), floor(), round()
          </p>
        </div>

        {/* SKU Pattern */}
        <div className="space-y-2">
          <Label htmlFor="sku_pattern">SKU Pattern</Label>
          <Input
            id="sku_pattern"
            value={item.sku_pattern || ''}
            onChange={(e) => onUpdate({ sku_pattern: e.target.value })}
            placeholder="e.g., ABC-SHINGLE-*"
          />
        </div>

        {/* Manufacturer */}
        <div className="space-y-2">
          <Label htmlFor="manufacturer">Manufacturer</Label>
          <Input
            id="manufacturer"
            value={item.manufacturer || ''}
            onChange={(e) => onUpdate({ manufacturer: e.target.value })}
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
            <p className="font-semibold">{formatCurrency(item.unit_cost)}</p>
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
      <Button className="w-full" onClick={onDone}>
        Done Editing
      </Button>
    </div>
  );
};
