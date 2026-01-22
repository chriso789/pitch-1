import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Package, Wrench, AlertCircle } from 'lucide-react';
import { CalcTemplateItem } from './hooks/useCalcTemplateEditor';
import { usePricingCalculation } from './hooks/usePricingCalculation';
import { FormulaBuilder } from './FormulaBuilder';

// Keywords that suggest an item is labor, not material
const LABOR_KEYWORDS = ['steep', 'charge', 'labor', 'tear', 'install', 'cleanup', 'haul', 'additional layer', 'remove', 'repair'];
const MATERIAL_KEYWORDS = ['shingle', 'nail', 'boot', 'flashing', 'underlayment', 'ridge cap', 'drip edge', 'ice', 'water', 'vent'];

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

export const CalcItemDetailsPanel: React.FC<CalcItemDetailsPanelProps> = ({
  item,
  profitMargin,
  onUpdate,
  onDone,
}) => {
  // Buffer changes locally - only save when Done is clicked
  const [localItem, setLocalItem] = useState<CalcTemplateItem>(item);
  
  // String buffers for numeric inputs to prevent cursor jumping while typing
  const [unitCostInput, setUnitCostInput] = useState(String(item.unit_cost ?? 0));
  const [marginOverrideInput, setMarginOverrideInput] = useState(String(item.margin_override ?? 0));
  
  const { calculatePrice, formatCurrency } = usePricingCalculation();
  
  // Calculate effective margin (item override or template default)
  const effectiveMargin = (localItem.margin_override && localItem.margin_override > 0) 
    ? localItem.margin_override 
    : profitMargin;
  const pricing = calculatePrice(localItem.unit_cost, effectiveMargin, 'profit_margin');

  // Check for classification mismatch based on item name keywords
  const classificationWarning = useMemo(() => {
    const nameLower = localItem.item_name.toLowerCase();
    const skuLower = (localItem.sku_pattern || '').toLowerCase();
    
    const suggestsLabor = LABOR_KEYWORDS.some(term => nameLower.includes(term)) || skuLower.startsWith('labor-');
    const suggestsMaterial = MATERIAL_KEYWORDS.some(term => nameLower.includes(term));
    
    if (suggestsLabor && !suggestsMaterial && localItem.item_type === 'material') {
      return 'This item name suggests it may be a labor item. Consider changing the type to "Labor".';
    }
    if (suggestsMaterial && !suggestsLabor && localItem.item_type === 'labor') {
      return 'This item name suggests it may be a material item. Consider changing the type to "Material".';
    }
    return null;
  }, [localItem.item_name, localItem.item_type, localItem.sku_pattern]);

  // Sync local state when switching items (different item id)
  useEffect(() => {
    setLocalItem(item);
    setUnitCostInput(String(item.unit_cost ?? 0));
    setMarginOverrideInput(String(item.margin_override ?? 0));
  }, [item.id]);

  const handleLocalUpdate = (updates: Partial<CalcTemplateItem>) => {
    setLocalItem(prev => ({ ...prev, ...updates }));
  };
  
  // Parse numeric value from string input on blur
  const handleUnitCostBlur = () => {
    const parsed = parseFloat(unitCostInput);
    const value = isNaN(parsed) ? 0 : parsed;
    setUnitCostInput(String(value));
    handleLocalUpdate({ unit_cost: value });
  };
  
  const handleMarginOverrideBlur = () => {
    const parsed = parseFloat(marginOverrideInput);
    const value = isNaN(parsed) ? 0 : Math.min(100, Math.max(0, parsed));
    setMarginOverrideInput(String(value));
    handleLocalUpdate({ margin_override: value });
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
              <Wrench className="h-5 w-5 text-warning" />
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
          
          {/* Classification Warning */}
          {classificationWarning && (
            <Alert variant="default" className="border-warning bg-warning/10">
              <AlertCircle className="h-4 w-4 text-warning" />
              <AlertDescription className="text-sm">
                {classificationWarning}
              </AlertDescription>
            </Alert>
          )}
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
            type="text"
            inputMode="decimal"
            value={unitCostInput}
            onChange={(e) => setUnitCostInput(e.target.value)}
            onBlur={handleUnitCostBlur}
          />
        </div>

        {/* Margin Override */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="margin_override">Item Margin Override</Label>
            <span className="text-xs text-muted-foreground">
              0% = use template default ({profitMargin}%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="margin_override"
              type="text"
              inputMode="decimal"
              value={marginOverrideInput}
              onChange={(e) => setMarginOverrideInput(e.target.value)}
              onBlur={handleMarginOverrideBlur}
              className="w-24"
            />
            <span className="text-muted-foreground">%</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Set to 0% to use the template's default profit margin. Set a specific percentage to override for this item only.
          </p>
        </div>

        {/* Formula Builder */}
        <FormulaBuilder
          value={localItem.qty_formula}
          unit={localItem.unit}
          onChange={(formula) => handleLocalUpdate({ qty_formula: formula })}
        />

        {/* Material-only fields */}
        {localItem.item_type === 'material' && (
          <>
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
          </>
        )}
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
            <p className="font-semibold">
              {effectiveMargin}%
              {localItem.margin_override > 0 && (
                <span className="text-xs text-warning ml-1">(override)</span>
              )}
            </p>
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
