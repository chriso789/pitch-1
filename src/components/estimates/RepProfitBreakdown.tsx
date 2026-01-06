import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { TrendingUp, DollarSign, Calculator, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface RepProfitBreakdownProps {
  pipelineEntryId?: string;
  sellingPrice: number;
  materialCost: number;
  laborCost: number;
  className?: string;
}

interface SalesRepData {
  personal_overhead_rate: number | null;
  commission_rate: number | null;
  first_name: string | null;
  last_name: string | null;
}

const RepProfitBreakdown: React.FC<RepProfitBreakdownProps> = ({
  pipelineEntryId,
  sellingPrice,
  materialCost,
  laborCost,
  className
}) => {
  // Fetch sales rep's commission settings from profile
  const { data: salesRepData, isLoading } = useQuery({
    queryKey: ['sales-rep-commission', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select(`
          assigned_to,
          profiles!pipeline_entries_assigned_to_fkey(
            first_name,
            last_name,
            personal_overhead_rate,
            commission_rate
          )
        `)
        .eq('id', pipelineEntryId!)
        .single();
      
      if (error) throw error;
      return data?.profiles as SalesRepData | null;
    },
    enabled: !!pipelineEntryId,
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  // Get rates from sales rep profile (with defaults)
  const overheadRate = salesRepData?.personal_overhead_rate ?? 10;
  const commissionRate = salesRepData?.commission_rate ?? 50;
  const repName = salesRepData 
    ? `${salesRepData.first_name || ''} ${salesRepData.last_name || ''}`.trim() 
    : 'Sales Rep';

  // Calculate breakdown
  const totalCost = materialCost + laborCost;
  const overheadAmount = sellingPrice * (overheadRate / 100);
  const grossProfit = sellingPrice - totalCost;
  const netProfit = grossProfit - overheadAmount;
  const repCommission = netProfit * (commissionRate / 100);
  const companyNet = netProfit - repCommission;
  const profitMargin = sellingPrice > 0 ? (netProfit / sellingPrice) * 100 : 0;

  const hasValidData = sellingPrice > 0 && (materialCost > 0 || laborCost > 0);

  if (isLoading) {
    return (
      <Card className={cn("border-primary/20", className)}>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("border-primary/20", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <span>Project Profit Breakdown</span>
          </CardTitle>
          {hasValidData && (
            <Badge 
              variant="outline" 
              className={cn(
                "font-mono",
                profitMargin >= 25 ? "bg-green-500/10 text-green-600 border-green-500/30" :
                profitMargin >= 15 ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" :
                "bg-red-500/10 text-red-600 border-red-500/30"
              )}
            >
              {formatPercent(profitMargin)} Margin
            </Badge>
          )}
        </div>
        {repName && (
          <p className="text-sm text-muted-foreground">
            Commission calculation for {repName}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasValidData ? (
          <div className="text-center py-8">
            <Calculator className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-2">
              Complete materials & labor sections to see profit breakdown
            </p>
            <p className="text-sm text-muted-foreground">
              Lock your actual costs after the job is complete for accurate commission calculation
            </p>
          </div>
        ) : (
          <>
            {/* Revenue Section */}
            <div className="space-y-2">
              <div className="flex justify-between items-center py-2">
                <span className="font-medium">Selling Price</span>
                <span className="font-semibold text-lg">{formatCurrency(sellingPrice)}</span>
              </div>
            </div>

            <Separator />

            {/* Costs Section */}
            <div className="space-y-2">
              <div className="flex justify-between items-center py-1 text-muted-foreground">
                <span>Actual Material Cost</span>
                <span className="text-red-600">-{formatCurrency(materialCost)}</span>
              </div>
              <div className="flex justify-between items-center py-1 text-muted-foreground">
                <span>Actual Labor Cost</span>
                <span className="text-red-600">-{formatCurrency(laborCost)}</span>
              </div>
              <div className="flex justify-between items-center py-1 text-muted-foreground">
                <span>Company Overhead ({overheadRate}%)</span>
                <span className="text-red-600">-{formatCurrency(overheadAmount)}</span>
              </div>
            </div>

            <Separator />

            {/* Gross Profit */}
            <div className="flex justify-between items-center py-2 bg-accent/30 rounded-md px-3 -mx-3">
              <span className="font-medium">Net Profit</span>
              <span className={cn(
                "font-semibold text-lg",
                netProfit >= 0 ? "text-green-600" : "text-red-600"
              )}>
                {formatCurrency(netProfit)}
              </span>
            </div>

            <Separator />

            {/* Commission Split */}
            <div className="space-y-2">
              <div className="flex justify-between items-center py-2 bg-primary/10 rounded-md px-3 -mx-3">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <span className="font-medium">Rep Commission ({commissionRate}%)</span>
                </div>
                <span className="font-bold text-xl text-primary">
                  {formatCurrency(repCommission)}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 text-muted-foreground">
                <span>Company Net</span>
                <span className="font-medium">{formatCurrency(companyNet)}</span>
              </div>
            </div>

            {/* Info Note */}
            <div className="bg-muted/50 rounded-lg p-3 mt-4">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    <strong>Overhead Rate:</strong> {overheadRate}% of selling price (set in your profile settings)
                  </p>
                  <p>
                    <strong>Commission Rate:</strong> {commissionRate}% of net profit (after overhead)
                  </p>
                  <p className="text-primary/80">
                    Lock your actual material & labor costs after job completion for accurate commission tracking.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default RepProfitBreakdown;
