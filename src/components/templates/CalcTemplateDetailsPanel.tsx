import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CalcTemplate } from './hooks/useCalcTemplateEditor';

interface CalcTemplateDetailsPanelProps {
  template: CalcTemplate;
  onUpdate: (updates: Partial<CalcTemplate>) => void;
  saving: boolean;
}

const ROOF_TYPES = [
  { value: 'shingle', label: 'Shingle' },
  { value: 'metal', label: 'Metal' },
  { value: 'tile', label: 'Tile' },
  { value: 'flat', label: 'Flat' },
];

const CATEGORIES = [
  { value: 'standard', label: 'Standard' },
  { value: 'premium', label: 'Premium' },
  { value: 'budget', label: 'Budget' },
  { value: 'insurance', label: 'Insurance' },
];

export const CalcTemplateDetailsPanel: React.FC<CalcTemplateDetailsPanelProps> = ({
  template,
  onUpdate,
  saving,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Template Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure the template properties and pricing settings.
        </p>
      </div>

      <div className="space-y-4">
        {/* Template Name */}
        <div className="space-y-2">
          <Label htmlFor="name">Template Name</Label>
          <Input
            id="name"
            value={template.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="e.g., Standard Shingle Template"
          />
        </div>

        {/* Roof Type */}
        <div className="space-y-2">
          <Label>Roof Type</Label>
          <Select
            value={template.roof_type}
            onValueChange={(value) => onUpdate({ roof_type: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROOF_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Category */}
        <div className="space-y-2">
          <Label>Category</Label>
          <Select
            value={template.template_category}
            onValueChange={(value) => onUpdate({ template_category: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Target Profit Margin */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Target Profit Margin</Label>
            <span className="text-sm font-medium">{template.target_profit_percentage}%</span>
          </div>
          <Slider
            value={[template.target_profit_percentage]}
            onValueChange={([value]) => onUpdate({ target_profit_percentage: value })}
            min={0}
            max={100}
            step={1}
          />
          <p className="text-xs text-muted-foreground">
            This margin is applied to all items unless overridden.
          </p>
        </div>

        {/* Active Status */}
        <div className="flex items-center justify-between py-2">
          <div>
            <Label htmlFor="is_active">Active</Label>
            <p className="text-xs text-muted-foreground">
              Only active templates appear in estimate creation.
            </p>
          </div>
          <Switch
            id="is_active"
            checked={template.is_active}
            onCheckedChange={(checked) => onUpdate({ is_active: checked })}
          />
        </div>
      </div>

      {/* Info Box */}
      <div className="rounded-lg border bg-muted/50 p-4">
        <h3 className="font-medium mb-2">About This Template</h3>
        <p className="text-sm text-muted-foreground">
          Templates define the line items that will be included when generating estimates.
          Each item can have a quantity formula that automatically calculates based on
          the property measurements.
        </p>
      </div>
    </div>
  );
};
