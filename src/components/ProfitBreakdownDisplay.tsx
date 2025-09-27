import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, DollarSign, Calculator } from 'lucide-react';

interface ProfitBreakdownProps {
  calculations: any;
  salesRep?: any;
}

export const ProfitBreakdownDisplay: React.FC<ProfitBreakdownProps> = ({ 
  calculations,
  salesRep 
}) => {
  if (!calculations) return null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const grossProfit = calculations.selling_price - calculations.material_total - calculations.labor_total;
  const repOverhead = salesRep?.overhead_rate ? (calculations.selling_price * (salesRep.overhead_rate / 100)) : 0;
  const netProfit = grossProfit - repOverhead;
  
  const repCommission = salesRep?.commission_structure === 'profit_split' 
    ? netProfit * ((salesRep?.commission_rate || 0) / 100)
    : calculations.selling_price * ((salesRep?.commission_rate || 0) / 100);
  
  const companyProfit = netProfit - repCommission;
  const profitMargin = calculations.selling_price > 0 ? (netProfit / calculations.selling_price) * 100 : 0;

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

          {salesRep && (
            <>
              <div className="text-xs text-muted-foreground">
                <div className="flex justify-between mb-1">
                  <span>Sales Rep: {salesRep.first_name} {salesRep.last_name}</span>
                  <Badge variant="outline" className="text-xs">
                    {salesRep.commission_structure === 'profit_split' ? 'Profit Split' : 'Sales %'}
                  </Badge>
                </div>
              </div>
              
              <div className="space-y-2 text-sm bg-muted/30 p-3 rounded">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rep Overhead ({salesRep.overhead_rate}%):</span>
                  <span>{formatCurrency(repOverhead)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Net Profit:</span>
                  <span className="font-medium">{formatCurrency(netProfit)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rep Commission ({salesRep.commission_rate}%):</span>
                  <span className="font-bold text-success">{formatCurrency(repCommission)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-2">
                  <span className="font-medium">Company Profit:</span>
                  <span className="font-bold text-primary">{formatCurrency(companyProfit)}</span>
                </div>
              </div>
            </>
          )}

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