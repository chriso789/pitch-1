import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, DollarSign, Calculator } from 'lucide-react';

interface ProfitBreakdownProps {
  calculations: any;
}

export const ProfitBreakdownDisplay: React.FC<ProfitBreakdownProps> = ({ 
  calculations
}) => {
  if (!calculations) return null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const grossProfit = calculations.selling_price - calculations.material_total - calculations.labor_total;
  const profitMargin = calculations.selling_price > 0 ? (grossProfit / calculations.selling_price) * 100 : 0;

  return (
    <Card className="border-success/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-success" />
          Profit Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Contract & Costs */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Contract Value:</span>
            <span className="font-medium">{formatCurrency(calculations.selling_price)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Material Cost:</span>
            <span>{formatCurrency(calculations.material_total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Labor Cost:</span>
            <span>{formatCurrency(calculations.labor_total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Overhead:</span>
            <span>{formatCurrency(calculations.overhead_amount)}</span>
          </div>
        </div>

        <hr className="border-border" />

        {/* Profit Calculations */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-medium">Gross Profit:</span>
            <span className="font-bold text-success">{formatCurrency(grossProfit)}</span>
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-border">
            <span className="text-sm text-muted-foreground">Profit Margin:</span>
            <Badge variant={profitMargin >= 20 ? "default" : profitMargin >= 10 ? "secondary" : "destructive"}>
              {profitMargin.toFixed(1)}%
            </Badge>
          </div>
        </div>

        {/* Transparency Note */}
        <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/20 p-2 rounded">
          <Calculator className="h-3 w-3 inline mr-1" />
          All parties can see this breakdown for complete transparency
        </div>
      </CardContent>
    </Card>
  );
};