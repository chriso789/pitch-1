// Visual Formula Builder Component
import React, { useState, useEffect, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calculator, Code, Zap } from 'lucide-react';
import {
  MEASUREMENT_TAGS,
  WASTE_OPTIONS,
  ROUNDING_OPTIONS,
  getPresetsForUnit,
  buildFormula,
  parseFormula,
  calculatePreview,
  type ConversionPreset,
} from './formulaConstants';

interface FormulaBuilderProps {
  value: string; // Current formula like "{{ ceil(roof.squares * 3) }}"
  unit: string; // Current unit (BDL, SQ, LF, etc.)
  onChange: (formula: string) => void;
}

export const FormulaBuilder: React.FC<FormulaBuilderProps> = ({
  value,
  unit,
  onChange,
}) => {
  // Builder state
  const [isAutoCalc, setIsAutoCalc] = useState(!!value);
  const [measurementTag, setMeasurementTag] = useState('');
  const [conversionPresetIndex, setConversionPresetIndex] = useState(0);
  const [customMultiplier, setCustomMultiplier] = useState(1);
  const [conversionOperation, setConversionOperation] = useState<'multiply' | 'divide'>('multiply');
  const [wastePercent, setWastePercent] = useState(10);
  const [customWaste, setCustomWaste] = useState(10);
  const [rounding, setRounding] = useState<'ceil' | 'floor' | 'round' | 'none'>('ceil');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Get presets for current unit
  const presets = useMemo(() => getPresetsForUnit(unit), [unit]);

  // Parse existing formula on mount or when value changes externally
  useEffect(() => {
    if (!value) {
      setIsAutoCalc(false);
      return;
    }

    const parsed = parseFormula(value);
    if (parsed) {
      setIsAutoCalc(true);
      setMeasurementTag(parsed.measurementTag);
      setConversionOperation(parsed.conversionOperation);
      setRounding(parsed.rounding);
      
      // Try to match to a preset
      const presetIdx = presets.findIndex(
        p => p.multiplier === parsed.conversionMultiplier && p.operation === parsed.conversionOperation
      );
      if (presetIdx >= 0) {
        setConversionPresetIndex(presetIdx);
      } else {
        // Custom multiplier
        const customIdx = presets.findIndex(p => p.operation === 'custom');
        setConversionPresetIndex(customIdx >= 0 ? customIdx : 0);
        setCustomMultiplier(parsed.conversionMultiplier);
      }

      // Waste
      const wasteOption = WASTE_OPTIONS.find(w => w.value === parsed.wastePercent);
      if (wasteOption) {
        setWastePercent(parsed.wastePercent);
      } else {
        setWastePercent(-1); // Custom
        setCustomWaste(parsed.wastePercent);
      }
    }
  }, [value, presets]);

  // Get current preset
  const currentPreset = presets[conversionPresetIndex] || presets[0];
  const isCustomMultiplier = currentPreset?.operation === 'custom';
  const isCustomWaste = wastePercent === -1;

  // Get effective values
  const effectiveMultiplier = isCustomMultiplier ? customMultiplier : (currentPreset?.multiplier || 1);
  const effectiveWaste = isCustomWaste ? customWaste : wastePercent;
  const effectiveOperation = isCustomMultiplier ? conversionOperation : (currentPreset?.operation === 'custom' ? conversionOperation : currentPreset?.operation || 'multiply');

  // Build formula whenever state changes
  useEffect(() => {
    if (!isAutoCalc) {
      onChange('');
      return;
    }

    if (!measurementTag) return;

    const formula = buildFormula(
      measurementTag,
      effectiveMultiplier,
      effectiveOperation,
      effectiveWaste,
      rounding
    );
    
    onChange(formula);
  }, [isAutoCalc, measurementTag, effectiveMultiplier, effectiveOperation, effectiveWaste, rounding, onChange]);

  // Calculate preview
  const preview = useMemo(() => {
    if (!measurementTag) return null;
    return calculatePreview(
      measurementTag,
      effectiveMultiplier,
      effectiveOperation,
      effectiveWaste,
      rounding
    );
  }, [measurementTag, effectiveMultiplier, effectiveOperation, effectiveWaste, rounding]);

  return (
    <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
      {/* Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-muted-foreground" />
          <Label className="font-medium">Quantity Calculation</Label>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm ${!isAutoCalc ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
            Manual
          </span>
          <Switch
            checked={isAutoCalc}
            onCheckedChange={setIsAutoCalc}
          />
          <span className={`text-sm ${isAutoCalc ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
            Auto-Calc
          </span>
        </div>
      </div>

      {isAutoCalc && (
        <>
          {/* Base Measurement */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Base Measurement</Label>
            <Select value={measurementTag} onValueChange={setMeasurementTag}>
              <SelectTrigger>
                <SelectValue placeholder="Select measurement source..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" disabled>— Area Measurements —</SelectItem>
                {MEASUREMENT_TAGS.filter(t => t.category === 'area').map((tag) => (
                  <SelectItem key={tag.tag} value={tag.tag}>
                    {tag.label} (e.g. {tag.sampleValue} {tag.unit})
                  </SelectItem>
                ))}
                <SelectItem value="none2" disabled>— Linear Measurements —</SelectItem>
                {MEASUREMENT_TAGS.filter(t => t.category === 'linear').map((tag) => (
                  <SelectItem key={tag.tag} value={tag.tag}>
                    {tag.label} (e.g. {tag.sampleValue} {tag.unit})
                  </SelectItem>
                ))}
                <SelectItem value="none3" disabled>— Count Measurements —</SelectItem>
                {MEASUREMENT_TAGS.filter(t => t.category === 'count').map((tag) => (
                  <SelectItem key={tag.tag} value={tag.tag}>
                    {tag.label} (e.g. {tag.sampleValue} {tag.unit})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Conversion */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Conversion to {unit}</Label>
            <Select
              value={String(conversionPresetIndex)}
              onValueChange={(v) => setConversionPresetIndex(parseInt(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset, idx) => (
                  <SelectItem key={idx} value={String(idx)}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Custom multiplier inputs */}
            {isCustomMultiplier && (
              <div className="flex items-center gap-2 mt-2">
                <Select
                  value={conversionOperation}
                  onValueChange={(v) => setConversionOperation(v as 'multiply' | 'divide')}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multiply">× Multiply</SelectItem>
                    <SelectItem value="divide">÷ Divide</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  value={customMultiplier}
                  onChange={(e) => setCustomMultiplier(parseFloat(e.target.value) || 1)}
                  className="w-24"
                  min={0.01}
                  step={0.01}
                />
              </div>
            )}
          </div>

          {/* Waste Factor */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Waste Factor</Label>
            <Select
              value={String(wastePercent)}
              onValueChange={(v) => setWastePercent(parseInt(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WASTE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {isCustomWaste && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm">+</span>
                <Input
                  type="number"
                  value={customWaste}
                  onChange={(e) => setCustomWaste(parseFloat(e.target.value) || 0)}
                  className="w-20"
                  min={0}
                  max={100}
                />
                <span className="text-sm">%</span>
              </div>
            )}
          </div>

          {/* Rounding */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Rounding</Label>
            <Select value={rounding} onValueChange={(v) => setRounding(v as typeof rounding)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROUNDING_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Preview */}
          {preview && measurementTag && (
            <div className="mt-4 p-3 bg-primary/10 rounded-lg border border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Preview Calculation</span>
              </div>
              <div className="text-lg font-mono">
                {preview.steps}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  Result: {preview.result} {unit}
                </Badge>
              </div>
            </div>
          )}

          {/* Advanced: Show Formula */}
          <div className="pt-2 border-t">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Code className="h-4 w-4" />
              {showAdvanced ? 'Hide' : 'Show'} generated formula
            </button>
            
            {showAdvanced && value && (
              <div className="mt-2 p-2 bg-muted rounded font-mono text-xs break-all">
                {value}
              </div>
            )}
          </div>
        </>
      )}

      {!isAutoCalc && (
        <p className="text-sm text-muted-foreground">
          Quantity will be entered manually for each estimate.
        </p>
      )}
    </div>
  );
};
