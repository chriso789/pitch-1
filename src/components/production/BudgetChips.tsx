import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Lock, TrendingUp, DollarSign, Percent } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BudgetChipsProps {
  projectId: string;
  targetMarginPercent?: number;
}

export const BudgetChips = ({ projectId, targetMarginPercent = 30 }: BudgetChipsProps) => {
  const { data: budgets, isLoading } = useQuery({
    queryKey: ['job-budgets', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('api_job_budgets_get', {
        p_job_id: projectId
      });
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 30000, // Refresh every 30s to catch Cap-Out updates
  });

  if (isLoading || !budgets || budgets.length === 0) return null;

  const precap = budgets.find(b => b.kind === 'PRECAP');
  const capout = budgets.find(b => b.kind === 'CAPOUT');

  if (!precap || !capout) return null;

  const getMarginColor = (marginPct: number | null) => {
    if (!marginPct) return 'text-muted-foreground';
    if (marginPct >= targetMarginPercent) return 'text-success';
    if (marginPct >= targetMarginPercent - 2) return 'text-warning';
    return 'text-destructive';
  };

  const formatCurrency = (value: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(value);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Pre-Cap (Locked) */}
      <Card className="p-4 border-2 border-muted">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Pre-Cap (Locked)</h3>
          </div>
          <Badge variant="secondary" className="text-xs">Original Budget</Badge>
        </div>
        
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Sell Price</span>
            <span className="font-medium">{formatCurrency(precap.summary.sell_price)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Planned Cost</span>
            <span className="font-medium">{formatCurrency(precap.summary.planned.subtotal)}</span>
          </div>
          <div className="border-t pt-2 flex justify-between items-center">
            <span className="text-xs font-medium flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Planned Profit
            </span>
            <span className="font-bold">{formatCurrency(precap.summary.profit)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium flex items-center gap-1">
              <Percent className="h-3 w-3" />
              Margin
            </span>
            <span className={cn("font-bold", getMarginColor(precap.summary.margin_pct))}>
              {precap.summary.margin_pct?.toFixed(1)}%
            </span>
          </div>
        </div>
      </Card>

      {/* Cap-Out (Live) */}
      <Card className={cn(
        "p-4 border-2",
        capout.summary.margin_pct && capout.summary.margin_pct >= targetMarginPercent
          ? "border-success/50 bg-success/5"
          : capout.summary.margin_pct && capout.summary.margin_pct >= targetMarginPercent - 2
          ? "border-warning/50 bg-warning/5"
          : "border-destructive/50 bg-destructive/5"
      )}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Cap-Out (Live)</h3>
          </div>
          <Badge variant="default" className="text-xs">Real-Time</Badge>
        </div>
        
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Sell Price</span>
            <span className="font-medium">{formatCurrency(capout.summary.sell_price)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Actual Cost</span>
            <span className="font-medium">
              {formatCurrency(
                capout.summary.actual.materials + 
                capout.summary.actual.labor + 
                capout.summary.actual.misc +
                precap.summary.planned.overhead +
                precap.summary.planned.commission
              )}
            </span>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span className="pl-2">• Materials</span>
              <span>{formatCurrency(capout.summary.actual.materials)}</span>
            </div>
            <div className="flex justify-between">
              <span className="pl-2">• Labor</span>
              <span>{formatCurrency(capout.summary.actual.labor)}</span>
            </div>
          </div>
          <div className="border-t pt-2 flex justify-between items-center">
            <span className="text-xs font-medium flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Actual Profit
            </span>
            <span className={cn("font-bold", getMarginColor(capout.summary.margin_pct))}>
              {formatCurrency(capout.summary.profit)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium flex items-center gap-1">
              <Percent className="h-3 w-3" />
              Margin
            </span>
            <span className={cn("font-bold text-lg", getMarginColor(capout.summary.margin_pct))}>
              {capout.summary.margin_pct?.toFixed(1)}%
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
};