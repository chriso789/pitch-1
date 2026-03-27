import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, DollarSign, Package, Hammer, Receipt, TrendingUp } from 'lucide-react';
import { PaymentsTab } from './PaymentsTab';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

interface TotalsTabProps {
  pipelineEntryId: string;
}

export const TotalsTab: React.FC<TotalsTabProps> = ({ pipelineEntryId }) => {
  const { activeTenantId } = useActiveTenantId();

  const { data: barData, isLoading: barLoading } = useQuery({
    queryKey: ['totals-bar-data', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('api_estimate_hyperlink_bar', {
        p_pipeline_entry_id: pipelineEntryId,
      });
      if (error) throw error;
      return data as { materials: number; labor: number; sale_price: number; sales_tax_amount: number } | null;
    },
    enabled: !!pipelineEntryId,
  });

  const { data: payments } = useQuery({
    queryKey: ['totals-payments', pipelineEntryId, activeTenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_payments')
        .select('amount')
        .eq('pipeline_entry_id', pipelineEntryId)
        .eq('tenant_id', activeTenantId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!pipelineEntryId && !!activeTenantId,
  });

  const sellingPrice = barData?.sale_price ?? 0;
  const materialCost = barData?.materials ?? 0;
  const laborCost = barData?.labor ?? 0;
  const totalPaid = (payments || []).reduce((s, p) => s + Number(p.amount), 0);
  const balance = sellingPrice - totalPaid;

  if (barLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-primary" />
              <p className="text-xs text-muted-foreground">Contract Value</p>
            </div>
            <p className="text-lg font-bold">{fmt(sellingPrice)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-blue-500" />
              <p className="text-xs text-muted-foreground">Material Cost</p>
            </div>
            <p className="text-lg font-bold">{fmt(materialCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Hammer className="h-4 w-4 text-orange-500" />
              <p className="text-xs text-muted-foreground">Labor Cost</p>
            </div>
            <p className="text-lg font-bold">{fmt(laborCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="h-4 w-4 text-green-500" />
              <p className="text-xs text-muted-foreground">Total Paid</p>
            </div>
            <p className="text-lg font-bold text-green-600">{fmt(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-red-500" />
              <p className="text-xs text-muted-foreground">Balance Due</p>
            </div>
            <p className={`text-lg font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {fmt(balance)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payments & Invoices */}
      <PaymentsTab pipelineEntryId={pipelineEntryId} sellingPrice={sellingPrice} />
    </div>
  );
};
