import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Target, TrendingUp, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface ProfitSliderProps {
  value: number;
  onChange: (value: number) => void;
  estimateId?: string;
  disabled?: boolean;
  sellingPrice?: number;
  costPreProfit?: number;
  className?: string;
}

const ProfitSlider: React.FC<ProfitSliderProps> = ({
  value,
  onChange,
  estimateId,
  disabled = false,
  sellingPrice = 0,
  costPreProfit = 0,
  className
}) => {
  const [isMarkupMode, setIsMarkupMode] = useState(false);

  // Convert between margin and markup
  const marginToMarkup = (margin: number): number => {
    return margin / (1 - margin / 100);
  };

  const markupToMargin = (markup: number): number => {
    return (markup / (1 + markup / 100)) * 100;
  };

  const currentMarkup = marginToMarkup(value);
  const profitDollarAmount = sellingPrice - costPreProfit;

  const handleSliderChange = async (newValues: number[]) => {
    const newValue = newValues[0];
    const finalValue = isMarkupMode ? markupToMargin(newValue) : newValue;
    
    onChange(finalValue);

    // If we have an estimate ID, trigger real-time calculation
    if (estimateId && !disabled) {
      try {
        await supabase.rpc('api_estimate_compute_pricing', {
          p_estimate_id: estimateId,
          p_mode: isMarkupMode ? 'markup' : 'margin',
          p_pct: finalValue / 100
        });
      } catch (error) {
        console.error('Error updating pricing:', error);
      }
    }
  };

  const getSliderValue = () => {
    return isMarkupMode ? currentMarkup : value;
  };

  const getSliderRange = () => {
    return isMarkupMode ? { min: 11, max: 150, step: 1 } : { min: 10, max: 60, step: 1 };
  };

  const formatPercentage = (val: number) => `${val.toFixed(1)}%`;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const sliderRange = getSliderRange();

  return (
    <Card className={cn("border-primary/20", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <Target className="h-5 w-5 text-primary" />
            <span>Profit Controls</span>
          </CardTitle>
          <div className="flex items-center space-x-2">
            <Label htmlFor="markup-mode" className="text-sm">
              {isMarkupMode ? 'Markup Mode' : 'Margin Mode'}
            </Label>
            <Switch
              id="markup-mode"
              checked={isMarkupMode}
              onCheckedChange={setIsMarkupMode}
              disabled={disabled}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Main Slider */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label 
              htmlFor="profit-slider"
              className="text-sm font-medium"
            >
              {isMarkupMode ? 'Target Markup (%)' : 'Target Gross Margin (%)'}
            </Label>
            <Badge variant="outline" className="font-mono">
              {formatPercentage(getSliderValue())}
            </Badge>
          </div>
          
          <Slider
            id="profit-slider"
            value={[getSliderValue()]}
            onValueChange={handleSliderChange}
            min={sliderRange.min}
            max={sliderRange.max}
            step={sliderRange.step}
            disabled={disabled}
            className={cn(
              "w-full",
              disabled && "opacity-50 cursor-not-allowed"
            )}
            aria-label={isMarkupMode ? "Target markup percentage" : "Target gross margin percentage"}
          />
          
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{sliderRange.min}%</span>
            <span>{sliderRange.max}%</span>
          </div>
        </div>

        {/* Educational Display */}
        <div className="bg-accent/50 rounded-lg p-4 space-y-3">
          <div className="flex items-center space-x-2">
            <Info className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Profit Breakdown</span>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Margin:</div>
              <div className="font-semibold text-primary">
                {formatPercentage(value)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Equivalent Markup:</div>
              <div className="font-semibold">
                {formatPercentage(currentMarkup)}
              </div>
            </div>
          </div>

          {sellingPrice > 0 && (
            <div className="pt-2 border-t border-border/50">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Profit Amount:</span>
                <span className="font-semibold text-success">
                  {formatCurrency(profitDollarAmount)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Help Text */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>Margin:</strong> Profit as % of sale price (industry standard)
          </p>
          <p>
            <strong>Markup:</strong> Profit as % of cost (shown for reference)
          </p>
          {disabled && (
            <p className="text-warning font-medium">
              Complete materials & labor calculations to enable profit controls
            </p>
          )}
        </div>

        {/* Keyboard Shortcuts */}
        <div className="text-xs text-muted-foreground/60">
          <p>Keyboard: ← → (±1%), Page Up/Down (±5%)</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default ProfitSlider;