import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { usePricingCalculation } from './hooks/usePricingCalculation';
import type { TemplateItem } from './hooks/useTemplateEditor';

interface ItemDetailsPanelProps {
  item: TemplateItem;
  profitMargin: number;
  onUpdate: (updates: Partial<TemplateItem>) => void;
  onDone: () => void;
  onAddLabor: () => void;
}

const UNITS = ['SQ', 'LF', 'EA', 'BX', 'RL', 'BDL', 'GAL', 'PC'];

const MEASUREMENT_TYPES = [
  { value: 'roof_area', label: 'Total Roof Area (SQ)' },
  { value: 'ridges', label: 'Ridges (LF)' },
  { value: 'hips', label: 'Hips (LF)' },
  { value: 'valleys', label: 'Valleys (LF)' },
  { value: 'rakes', label: 'Rakes (LF)' },
  { value: 'eaves', label: 'Eaves (LF)' },
];

export const ItemDetailsPanel = ({
  item,
  profitMargin,
  onUpdate,
  onDone,
  onAddLabor,
}: ItemDetailsPanelProps) => {
  const { calculatePrice, formatCurrency } = usePricingCalculation();

  const pricing = calculatePrice(
    item.unit_cost,
    profitMargin,
    item.pricing_type,
    item.fixed_price ?? undefined
  );

  const isLabor = item.item_type === 'labor';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          {isLabor ? 'Labor Details' : 'Material Details'}
        </h3>
        <div className="flex gap-2">
          {!isLabor && (
            <Button variant="outline" size="sm" onClick={onAddLabor}>
              ADD LABOR
            </Button>
          )}
          <Button size="sm" onClick={onDone}>
            DONE
          </Button>
        </div>
      </div>

      {/* Item Name (Read-only) */}
      <div className="space-y-2">
        <Label>Item Name</Label>
        <Input value={item.name} disabled className="bg-muted" />
      </div>

      {/* Estimate Item Name */}
      <div className="space-y-2">
        <Label htmlFor="estimate-item-name">Estimate Item Name</Label>
        <Input
          id="estimate-item-name"
          value={item.estimate_item_name || ''}
          onChange={(e) => onUpdate({ estimate_item_name: e.target.value })}
          placeholder="Name shown on estimate"
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="item-description">Item Description</Label>
        <Textarea
          id="item-description"
          value={item.description || ''}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="Describe this item..."
          rows={3}
        />
      </div>

      {/* Cost and Unit */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="unit-cost">Cost</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              $
            </span>
            <Input
              id="unit-cost"
              type="number"
              step="0.01"
              value={item.unit_cost}
              onChange={(e) => onUpdate({ unit_cost: parseFloat(e.target.value) || 0 })}
              className="pl-7"
            />
          </div>
        </div>
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
                <SelectItem key={unit} value={unit}>
                  {unit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Pricing Options */}
      <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
        <Label>Pricing Options</Label>
        <RadioGroup
          value={item.pricing_type}
          onValueChange={(value) =>
            onUpdate({ pricing_type: value as 'profit_margin' | 'fixed' })
          }
          className="space-y-4"
        >
          {/* Profit Margin Option */}
          <div className="flex items-start space-x-3">
            <RadioGroupItem value="profit_margin" id="pricing-margin" className="mt-1" />
            <div className="flex-1">
              <Label htmlFor="pricing-margin" className="cursor-pointer font-medium">
                Use Profit Margin
              </Label>
              {item.pricing_type === 'profit_margin' && (
                <div className="mt-2 p-3 bg-background rounded border">
                  <div className="text-sm text-muted-foreground">
                    {formatCurrency(item.unit_cost)} ÷ (1 - {profitMargin}%) ={' '}
                    <span className="font-bold text-primary text-lg">
                      {formatCurrency(pricing.price)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Fixed Price Option */}
          <div className="flex items-start space-x-3">
            <RadioGroupItem value="fixed" id="pricing-fixed" className="mt-1" />
            <div className="flex-1">
              <Label htmlFor="pricing-fixed" className="cursor-pointer font-medium">
                Fixed Price
              </Label>
              {item.pricing_type === 'fixed' && (
                <div className="mt-2">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      $
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.fixed_price || ''}
                      onChange={(e) =>
                        onUpdate({ fixed_price: parseFloat(e.target.value) || null })
                      }
                      className="pl-7"
                      placeholder="Enter fixed price"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </RadioGroup>
      </div>

      {/* Waste Percentage */}
      <div className="space-y-2">
        <Label htmlFor="waste-pct">Waste %</Label>
        <div className="relative">
          <Input
            id="waste-pct"
            type="number"
            min="0"
            max="100"
            value={item.waste_pct}
            onChange={(e) => onUpdate({ waste_pct: parseFloat(e.target.value) || 0 })}
            className="pr-8"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            %
          </span>
        </div>
      </div>

      {/* Measurement Type */}
      <div className="space-y-3">
        <Label>Measurement Type</Label>
        <p className="text-xs text-muted-foreground">
          Select which roof measurement to use for quantity calculation
        </p>
        <div className="grid grid-cols-2 gap-2">
          {MEASUREMENT_TYPES.map((type) => (
            <div key={type.value} className="flex items-center space-x-2">
              <Checkbox
                id={`measurement-${type.value}`}
                checked={item.measurement_type === type.value}
                onCheckedChange={(checked) =>
                  onUpdate({ measurement_type: checked ? type.value : null })
                }
              />
              <Label
                htmlFor={`measurement-${type.value}`}
                className="cursor-pointer text-sm"
              >
                {type.label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      {/* Price Summary */}
      <div className="p-4 border rounded-lg bg-primary/5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Final Price</span>
          <span className="text-2xl font-bold text-primary">
            {formatCurrency(pricing.price)}
          </span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-muted-foreground">Profit</span>
          <span className="text-sm text-green-600">
            +{formatCurrency(pricing.profitAmount)} ({pricing.profitPercent.toFixed(1)}%)
          </span>
        </div>
      </div>
    </div>
  );
};
