import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { TrendingUp, DollarSign, Calculator, Info, Loader2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { calculateCommission } from '@/lib/commission-calculator';

interface RepProfitBreakdownProps {
  pipelineEntryId?: string;
  sellingPrice: number;
  materialCost: number;
  laborCost: number;
  salesTaxAmount?: number;
  className?: string;
}

interface RepProfile {
  personal_overhead_rate: number | null;
  commission_rate: number | null;
  commission_structure: 'profit_split' | 'percentage_contract_price' | null;
  first_name: string | null;
  last_name: string | null;
}

interface PipelineRepData {
  assigned_to: string | null;
  secondary_assigned_to: string | null;
  primary_rep_split_percent: number | null;
  profiles: RepProfile | null;
  secondary_rep: RepProfile | null;
}

const RepProfitBreakdown: React.FC<RepProfitBreakdownProps> = ({
  pipelineEntryId,
  sellingPrice,
  materialCost,
  laborCost,
  salesTaxAmount = 0,
  className
}) => {
  // Fetch both primary and secondary rep's commission settings
  const { data: repData, isLoading } = useQuery({
    queryKey: ['sales-rep-commission', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select(`
          assigned_to,
          secondary_assigned_to,
          primary_rep_split_percent,
          profiles!pipeline_entries_assigned_to_fkey(
            first_name,
            last_name,
            personal_overhead_rate,
            commission_rate,
            commission_structure
          ),
          secondary_rep:profiles!pipeline_entries_secondary_assigned_to_fkey(
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
      return data as unknown as PipelineRepData;
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

  // Primary rep data
  const primaryRep = repData?.profiles;
  const primaryOverheadRate = primaryRep?.personal_overhead_rate ?? 10;
  const primaryCommissionRate = primaryRep?.commission_rate ?? 50;
  const primaryCommissionStructure = primaryRep?.commission_structure || 'profit_split';
  const primaryRepName = primaryRep 
    ? `${primaryRep.first_name || ''} ${primaryRep.last_name || ''}`.trim() 
    : 'Primary Rep';

  // Secondary rep data
  const secondaryRep = repData?.secondary_rep;
  const hasSecondaryRep = !!repData?.secondary_assigned_to && !!secondaryRep;
  const secondaryOverheadRate = secondaryRep?.personal_overhead_rate ?? 10;
  const secondaryCommissionRate = secondaryRep?.commission_rate ?? 50;
  const secondaryCommissionStructure = secondaryRep?.commission_structure || 'profit_split';
  const secondaryRepName = secondaryRep 
    ? `${secondaryRep.first_name || ''} ${secondaryRep.last_name || ''}`.trim() 
    : 'Secondary Rep';

  // Split percentage (default 100% to primary if no secondary)
  const primarySplitPercent = hasSecondaryRep 
    ? (repData?.primary_rep_split_percent ?? 50) 
    : 100;
  const secondarySplitPercent = 100 - primarySplitPercent;

  // Overhead comes from the profit-split rep (primary by default)
  // For two profit-split reps, they must have the same overhead
  const overheadRate = primaryOverheadRate;

  // Calculate costs and profits (overhead on pre-tax selling price)
  const totalCost = materialCost + laborCost;
  const grossProfit = sellingPrice - totalCost;
  const preTaxSellingPrice = sellingPrice - salesTaxAmount;
  const overheadAmount = preTaxSellingPrice * (overheadRate / 100);
  const profitAfterOverhead = grossProfit - overheadAmount;

  // Step 1: If secondary rep is "percentage_contract_price" (Percent of Contract), 
  // deduct their commission FIRST before calculating primary's profit split
  let profitAvailableForSplit = profitAfterOverhead;
  let secondaryRepCommission = 0;

  if (hasSecondaryRep && secondaryCommissionStructure === 'percentage_contract_price') {
    // Secondary rep with "Percent of Contract" gets paid from selling price first
    secondaryRepCommission = sellingPrice * (secondaryCommissionRate / 100);
    profitAvailableForSplit = profitAfterOverhead - secondaryRepCommission;
  }

  // Step 2: Calculate primary rep commission
  let primaryRepCommission = 0;
  if (primaryCommissionStructure === 'profit_split') {
    // Profit split: percentage of remaining profit after overhead and secondary deduction
    primaryRepCommission = Math.max(0, profitAvailableForSplit * (primaryCommissionRate / 100));
  } else {
    // Percent of Contract: percentage of selling price
    primaryRepCommission = sellingPrice * (primaryCommissionRate / 100);
  }

  // Step 3: If both reps are profit-split with same overhead, apply split percentages
  if (hasSecondaryRep && 
      secondaryCommissionStructure === 'profit_split' && 
      primaryOverheadRate === secondaryOverheadRate) {
    // Both are profit-split with same overhead - split the commission pool
    const totalProfitSplitCommission = Math.max(0, profitAfterOverhead * (primaryCommissionRate / 100));
    primaryRepCommission = (totalProfitSplitCommission * primarySplitPercent) / 100;
    secondaryRepCommission = (totalProfitSplitCommission * secondarySplitPercent) / 100;
  }

  const netProfit = profitAfterOverhead;
  const totalRepCommission = primaryRepCommission + secondaryRepCommission;
  const companyNet = netProfit - totalRepCommission;
  const profitMargin = sellingPrice > 0 ? (netProfit / sellingPrice) * 100 : 0;

  const hasValidData = sellingPrice > 0 && (materialCost > 0 || laborCost > 0);

  // Commission type labels
  const primaryCommissionTypeLabel = primaryCommissionStructure === 'percentage_contract_price'
    ? `${formatPercent(primaryCommissionRate)} of Contract`
    : `${formatPercent(primaryCommissionRate)} of Profit`;
  const secondaryCommissionTypeLabel = secondaryCommissionStructure === 'percentage_contract_price'
    ? `${formatPercent(secondaryCommissionRate)} of Contract`
    : `${formatPercent(secondaryCommissionRate)} of Profit`;

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
        {hasSecondaryRep ? (
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3" />
            Split: {primaryRepName} ({primarySplitPercent}%) / {secondaryRepName} ({secondarySplitPercent}%)
          </p>
        ) : primaryRepName && (
          <p className="text-sm text-muted-foreground">
            Commission calculation for {primaryRepName}
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
              {/* Primary Rep Commission */}
              <div className="flex justify-between items-center py-2 bg-primary/10 rounded-md px-3 -mx-3">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-primary" />
                    <span className="font-medium">{primaryRepName}</span>
                    {hasSecondaryRep && (
                      <Badge variant="outline" className="text-xs">
                        {primarySplitPercent}%
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {primaryCommissionTypeLabel}
                  </span>
                </div>
                <span className="font-bold text-xl text-primary">
                  {formatCurrency(primaryRepCommission)}
                </span>
              </div>

              {/* Secondary Rep Commission */}
              {hasSecondaryRep && (
                <div className="flex justify-between items-center py-2 bg-secondary/50 rounded-md px-3 -mx-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-secondary-foreground" />
                      <span className="font-medium">{secondaryRepName}</span>
                      <Badge variant="outline" className="text-xs">
                        {secondarySplitPercent}%
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {secondaryCommissionTypeLabel}
                    </span>
                  </div>
                  <span className="font-bold text-xl text-secondary-foreground">
                    {formatCurrency(secondaryRepCommission)}
                  </span>
                </div>
              )}

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
