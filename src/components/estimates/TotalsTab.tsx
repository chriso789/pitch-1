import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, DollarSign, Package, Hammer, Receipt, TrendingUp, FilePlus2 } from 'lucide-react';
import { PaymentsTab } from './PaymentsTab';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

interface TotalsTabProps {
  pipelineEntryId: string;
}

// Mirror the rollup used in ChangeOrdersTab.totalsFor so an approved CO's
// budget is consistent everywhere (cost / (1 - overhead% - profit%)).
function computeCoBudget(co: any): number {
  const container: any = co?.line_items || {};
  const items: any[] = Array.isArray(container.items) ? container.items : [];
  let material = 0;
  let labor = 0;
  for (const it of items) {
    const qty = Number(it.quantity ?? it.qty ?? 1);
    const price = Number(it.unit_price ?? it.price ?? it.rate ?? 0);
    const total = Number(it.line_total ?? it.total ?? qty * price) || 0;
    const cat = String(it.category ?? it.type ?? it.kind ?? 'material').toLowerCase();
    if (cat.startsWith('lab')) labor += total;
    else if (cat.startsWith('over')) {/* overhead handled via pct */}
    else material += total;
  }
  const overheadPct = Number(container.overhead_pct ?? 10);
  const profitPct = Number(container.profit_pct ?? 25);
  const cost = material + labor;
  const denom = Math.max(0.01, 1 - (overheadPct / 100) - (profitPct / 100));
  const selling = cost > 0 ? cost / denom : 0;
  return Math.max(Number(co?.cost_impact || 0), selling);
}

const APPROVED_STATUSES = new Set(['approved', 'invoiced', 'completed']);

export const TotalsTab: React.FC<TotalsTabProps> = ({ pipelineEntryId }) => {
  const { activeTenantId } = useActiveTenantId();

  const { data: barData, isLoading: barLoading } = useQuery({
    queryKey: ['totals-bar-data', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('api_estimate_hyperlink_bar', {
        p_pipeline_entry_id: pipelineEntryId,
      });
      if (error) throw error;
      return data as {
        materials: number;
        labor: number;
        sale_price: number;
        base_sale_price?: number;
        change_orders_total?: number;
        sales_tax_amount: number;
      } | null;
    },
    enabled: !!pipelineEntryId,
  });

  // Mirror PaymentsTab query (no tenant_id filter) so the summary cards stay
  // in sync with the payments list shown below. Filtering by activeTenantId here
  // can hide payments recorded under a different effective tenant context,
  // leaving Balance Due stuck at the full contract value even though payments
  // exist on the project.
  const { data: payments } = useQuery({
    queryKey: ['project-ar-payments', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_payments')
        .select('amount')
        .eq('pipeline_entry_id', pipelineEntryId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!pipelineEntryId,
  });

  // Pull approved/invoiced change orders so their value rolls into Contract
  // Value & Balance Due even when the RPC didn't include them.
  const { data: changeOrders } = useQuery({
    queryKey: ['totals-change-orders', pipelineEntryId, activeTenantId],
    queryFn: async () => {
      const { data: projects } = await supabase
        .from('projects')
        .select('id')
        .eq('pipeline_entry_id', pipelineEntryId);
      const projectIds = (projects || []).map((p: any) => p.id);
      if (projectIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from('change_orders')
        .select('id, co_number, title, status, cost_impact, customer_approved, line_items, project_id')
        .in('project_id', projectIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!pipelineEntryId && !!activeTenantId,
  });

  const approvedCOs = (changeOrders || []).filter(
    (co: any) => APPROVED_STATUSES.has(String(co.status || '').toLowerCase()) || co.customer_approved === true
  );
  const approvedCoLocalTotal = approvedCOs.reduce((s: number, co: any) => s + computeCoBudget(co), 0);

  // The RPC's sale_price ALREADY includes approved CO cost_impact. Do NOT add it
  // again here or the contract value will be double-counted (e.g. $113k base + $14.4k CO
  // would incorrectly show as $141.8k instead of $127.4k).
  const contractValue = barData?.sale_price ?? 0;
  const baseSellingPrice = barData?.base_sale_price ?? (contractValue - (barData?.change_orders_total ?? 0));
  const coBudgetTotal = barData?.change_orders_total ?? approvedCoLocalTotal;
  const materialCost = barData?.materials ?? 0;
  const laborCost = barData?.labor ?? 0;
  const totalPaid = (payments || []).reduce((s, p) => s + Number(p.amount), 0);
  const balance = contractValue - totalPaid;

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
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-primary" />
              <p className="text-xs text-muted-foreground">Contract Value</p>
            </div>
            <p className="text-lg font-bold">{fmt(contractValue)}</p>
            {coBudgetTotal > 0 && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Base {fmt(baseSellingPrice)} + COs {fmt(coBudgetTotal)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <FilePlus2 className="h-4 w-4 text-indigo-500" />
              <p className="text-xs text-muted-foreground">Approved COs</p>
            </div>
            <p className="text-lg font-bold">{fmt(coBudgetTotal)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {approvedCOs.length} approved
            </p>
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
      <PaymentsTab pipelineEntryId={pipelineEntryId} sellingPrice={contractValue} />
    </div>
  );
};
