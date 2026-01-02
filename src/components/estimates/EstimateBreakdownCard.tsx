// Comprehensive estimate breakdown card with sections and fixed price support
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { 
  DollarSign, 
  Percent, 
  TrendingUp, 
  Users, 
  Hammer, 
  Package,
  AlertTriangle,
  Lock
} from 'lucide-react';
import type { PricingBreakdown, PricingConfig } from '@/hooks/useEstimatePricing';

interface EstimateBreakdownCardProps {
  breakdown: PricingBreakdown;
  config: PricingConfig;
  isFixedPrice: boolean;
  fixedPrice: number | null;
  onConfigChange: (config: Partial<PricingConfig>) => void;
  onFixedPriceChange: (price: number | null) => void;
  className?: string;
}

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
};

const formatPercent = (value: number): string => {
  return `${value.toFixed(1)}%`;
};

export function EstimateBreakdownCard({
  breakdown,
  config,
  isFixedPrice,
  fixedPrice,
  onConfigChange,
  onFixedPriceChange,
  className = '',
}: EstimateBreakdownCardProps) {
  const [fixedPriceInput, setFixedPriceInput] = useState(
    fixedPrice?.toString() || ''
  );

  const handleFixedPriceToggle = (enabled: boolean) => {
    if (enabled) {
      // Default to calculated selling price when enabling
      const defaultPrice = Math.round(breakdown.sellingPrice);
      setFixedPriceInput(defaultPrice.toString());
      onFixedPriceChange(defaultPrice);
    } else {
      setFixedPriceInput('');
      onFixedPriceChange(null);
    }
  };

  const handleFixedPriceInputChange = (value: string) => {
    setFixedPriceInput(value);
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue > 0) {
      onFixedPriceChange(numValue);
    }
  };

  const profitMarginColor = breakdown.actualProfitMargin >= 30 
    ? 'text-green-600' 
    : breakdown.actualProfitMargin >= 20 
      ? 'text-yellow-600' 
      : breakdown.actualProfitMargin >= 15 
        ? 'text-orange-500' 
        : 'text-red-600';

  const isLowMargin = breakdown.actualProfitMargin < 15;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <TrendingUp className="h-5 w-5" />
          Estimate Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Cost Breakdown */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Package className="h-4 w-4" />
              Materials Cost
            </span>
            <span className="font-medium">{formatCurrency(breakdown.materialsTotal)}</span>
          </div>
          
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Hammer className="h-4 w-4" />
              Labor Cost
            </span>
            <span className="font-medium">{formatCurrency(breakdown.laborTotal)}</span>
          </div>
          
          <Separator className="my-2" />
          
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Direct Cost</span>
            <span className="font-medium">{formatCurrency(breakdown.directCost)}</span>
          </div>
          
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              Overhead ({formatPercent(config.overheadPercent)})
            </span>
            <span className="font-medium">{formatCurrency(breakdown.overheadAmount)}</span>
          </div>
          
          <Separator className="my-2" />
          
          <div className="flex items-center justify-between">
            <span className="font-medium">Total Cost</span>
            <span className="font-semibold">{formatCurrency(breakdown.totalCost)}</span>
          </div>
        </div>

        {/* Profit Section */}
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-muted-foreground" />
              <span>Profit</span>
              <Badge variant="outline" className={profitMarginColor}>
                {formatPercent(breakdown.actualProfitMargin)}
              </Badge>
            </span>
            <span className={`font-semibold ${profitMarginColor}`}>
              {formatCurrency(breakdown.profitAmount)}
            </span>
          </div>

          {isLowMargin && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950 p-2 rounded">
              <AlertTriangle className="h-4 w-4" />
              Low profit margin warning
            </div>
          )}
        </div>

        {/* Rep Commission */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Users className="h-4 w-4" />
              Rep Commission ({formatPercent(config.repCommissionPercent)})
            </span>
            <span className="font-medium text-blue-600">
              {formatCurrency(breakdown.repCommissionAmount)}
            </span>
          </div>
        </div>

        <Separator />

        {/* Selling Price */}
        <div className="flex items-center justify-between py-2">
          <span className="text-lg font-semibold flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            SELLING PRICE
          </span>
          <span className="text-2xl font-bold text-primary">
            {formatCurrency(breakdown.sellingPrice)}
          </span>
        </div>

        <Separator />

        {/* Fixed Price Override */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="fixed-price-toggle" className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Fixed Price Override
            </Label>
            <Switch
              id="fixed-price-toggle"
              checked={isFixedPrice}
              onCheckedChange={handleFixedPriceToggle}
            />
          </div>

          {isFixedPrice && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={fixedPriceInput}
                  onChange={(e) => handleFixedPriceInputChange(e.target.value)}
                  placeholder="Enter fixed price"
                  className="font-mono"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Profit margin will adjust based on fixed price
              </p>
            </div>
          )}
        </div>

        {/* Profit Margin Slider (when not fixed) */}
        {!isFixedPrice && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <Label>Target Profit Margin</Label>
              <span className="font-mono text-sm">
                {formatPercent(config.profitMarginPercent)}
              </span>
            </div>
            <Slider
              value={[config.profitMarginPercent]}
              onValueChange={([value]) => onConfigChange({ profitMarginPercent: value })}
              min={10}
              max={50}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>10%</span>
              <span>30%</span>
              <span>50%</span>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
