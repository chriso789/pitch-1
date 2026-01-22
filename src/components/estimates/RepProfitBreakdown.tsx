import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { TrendingUp, DollarSign, Calculator, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { calculateCommission } from '@/lib/commission-calculator';

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
  commission_structure: 'profit_split' | 'percentage_contract_price' | null;
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
            commission_rate,
            commission_structure
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
  const commissionStructure = salesRepData?.commission_structure || 'profit_split';
  const repName = salesRepData 
    ? `${salesRepData.first_name || ''} ${salesRepData.last_name || ''}`.trim() 
    : 'Sales Rep';

  // Use centralized commission calculator
  const commissionResult = calculateCommission({
    contractValue: sellingPrice,
    actualMaterialCost: materialCost,
    actualLaborCost: laborCost,
    adjustments: 0,
    repOverheadRate: overheadRate,
    commissionType: commissionStructure === 'percentage_contract_price' 
      ? 'percentage_contract_price' 
      : 'profit_split',
    commissionRate: commissionRate
  });

  const totalCost = materialCost + laborCost;
  const overheadAmount = sellingPrice * (overheadRate / 100);
  const grossProfit = sellingPrice - totalCost;
  const netProfit = commissionResult.netProfit;
  const repCommission = commissionResult.commissionAmount;
  const companyNet = netProfit - repCommission;
  const profitMargin = sellingPrice > 0 ? (netProfit / sellingPrice) * 100 : 0;

  const hasValidData = sellingPrice > 0 && (materialCost > 0 || laborCost > 0);

  // Determine commission type label
  const commissionTypeLabel = commissionStructure === 'percentage_contract_price'
    ? `${formatPercent(commissionRate)} of Contract`
    : `${formatPercent(commissionRate)} of Profit`;

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

            {/* Net Profit */}
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
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-primary" />
                    <span className="font-medium">Rep Commission</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {commissionTypeLabel}
                  </span>
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
                <p className="text-xs text-muted-foreground text-primary/80">
                  Lock your actual material & labor costs after job completion for accurate commission tracking.
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default RepProfitBreakdown;
