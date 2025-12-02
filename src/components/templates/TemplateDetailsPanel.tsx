import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import type { Template } from './hooks/useTemplateEditor';

interface TemplateDetailsPanelProps {
  template: Template;
  onUpdate: (updates: Partial<Template>) => void;
  onUpdateCosts: () => void;
  saving: boolean;
}

const TEMPLATE_TYPES = [
  { value: 'steep_slope', label: 'Steep Slope Roofing' },
  { value: 'low_slope', label: 'Low Slope Roofing' },
  { value: 'flat_roof', label: 'Flat Roof' },
  { value: 'metal', label: 'Metal Roofing' },
];

const AVAILABLE_TRADES = [
  'Roofing',
  'Gutters',
  'Siding',
  'Painting',
  'Interior',
  'Repair',
];

export const TemplateDetailsPanel = ({
  template,
  onUpdate,
  onUpdateCosts,
  saving,
}: TemplateDetailsPanelProps) => {
  const handleTradeToggle = (trade: string, checked: boolean) => {
    const currentTrades = template.available_trades || [];
    const newTrades = checked
      ? [...currentTrades, trade]
      : currentTrades.filter((t) => t !== trade);
    onUpdate({ available_trades: newTrades });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Template Details</h3>
      </div>

      {/* Template Name */}
      <div className="space-y-2">
        <Label htmlFor="template-name">Template Name</Label>
        <Input
          id="template-name"
          value={template.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Enter template name"
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="template-description">Template Description</Label>
        <Textarea
          id="template-description"
          value={template.template_description || ''}
          onChange={(e) => onUpdate({ template_description: e.target.value })}
          placeholder="Describe this template..."
          rows={3}
        />
      </div>

      {/* Template Type */}
      <div className="space-y-2">
        <Label>Template Type</Label>
        <Select
          value={template.template_type}
          onValueChange={(value) => onUpdate({ template_type: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Supplier with Update Costs */}
      <div className="space-y-2">
        <Label>Supplier</Label>
        <div className="flex gap-2">
          <Select
            value={template.supplier_id || ''}
            onValueChange={(value) => onUpdate({ supplier_id: value || null })}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select supplier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="srs">SRS Distribution</SelectItem>
              <SelectItem value="abc">ABC Supply</SelectItem>
              <SelectItem value="beacon">Beacon Building Products</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={onUpdateCosts} disabled={saving}>
            <RefreshCw className={`h-4 w-4 mr-2 ${saving ? 'animate-spin' : ''}`} />
            UPDATE COSTS
          </Button>
        </div>
      </div>

      {/* Use For */}
      <div className="space-y-3">
        <Label>Use this template for</Label>
        <RadioGroup
          value={template.use_for}
          onValueChange={(value) =>
            onUpdate({ use_for: value as 'estimating' | 'ordering' | 'both' })
          }
          className="flex gap-4"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="estimating" id="use-estimating" />
            <Label htmlFor="use-estimating" className="cursor-pointer">
              Estimating
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="ordering" id="use-ordering" />
            <Label htmlFor="use-ordering" className="cursor-pointer">
              Ordering
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="both" id="use-both" />
            <Label htmlFor="use-both" className="cursor-pointer">
              Both
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Profit Margin */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Profit Margin</Label>
          <span className="text-sm font-medium">{template.profit_margin_percent}%</span>
        </div>
        <Slider
          value={[template.profit_margin_percent]}
          onValueChange={([value]) => onUpdate({ profit_margin_percent: value })}
          min={0}
          max={100}
          step={1}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Price = Cost ÷ (1 - Margin%)
        </p>
      </div>

      {/* Available Trades */}
      <div className="space-y-3">
        <Label>Available Trades</Label>
        <div className="grid grid-cols-2 gap-2">
          {AVAILABLE_TRADES.map((trade) => (
            <div key={trade} className="flex items-center space-x-2">
              <Checkbox
                id={`trade-${trade}`}
                checked={template.available_trades?.includes(trade)}
                onCheckedChange={(checked) =>
                  handleTradeToggle(trade, checked as boolean)
                }
              />
              <Label htmlFor={`trade-${trade}`} className="cursor-pointer text-sm">
                {trade}
              </Label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
