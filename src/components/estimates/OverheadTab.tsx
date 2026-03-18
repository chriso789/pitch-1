import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Settings, Receipt, Trash2, Loader2, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { InvoiceUploadCard } from '@/components/production/InvoiceUploadCard';
import { toast } from 'sonner';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';

interface OverheadTabProps {
  pipelineEntryId: string;
}

export const OverheadTab: React.FC<OverheadTabProps> = ({ pipelineEntryId }) => {
  const queryClient = useQueryClient();
  const { activeTenantId } = useActiveTenantId();
  const [dumpPrice, setDumpPrice] = useState(350);
  const [dumpCount, setDumpCount] = useState(1);

  // Fetch sales rep overhead rate
  const { data: repData } = useQuery({
    queryKey: ['sales-rep-overhead-tab', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select('assigned_to, profiles!pipeline_entries_assigned_to_fkey(overhead_rate, personal_overhead_rate)')
        .eq('id', pipelineEntryId)
        .single();
      if (error) throw error;
      const profile = data?.profiles as { overhead_rate: number | null; personal_overhead_rate: number | null } | null;
      const personal = profile?.personal_overhead_rate ?? 0;
      const base = profile?.overhead_rate ?? 10;
      return personal > 0 ? personal : base;
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch estimate data for selling price
  const { data: estimateData } = useQuery({
    queryKey: ['estimate-costs', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('api_estimate_hyperlink_bar', { p_pipeline_entry_id: pipelineEntryId });
      if (error) throw error;
      return data as { sale_price: number; sales_tax_amount: number } | null;
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch overhead invoices
  const { data: overheadInvoices, isLoading } = useQuery({
    queryKey: ['overhead-invoices', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_cost_invoices')
        .select('*')
        .eq('pipeline_entry_id', pipelineEntryId)
        .eq('invoice_type', 'overhead')
        .in('status', ['pending', 'approved', 'verified'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!pipelineEntryId,
  });

  const overheadRate = repData ?? 10;
  const sellingPrice = estimateData?.sale_price || 0;
  const salesTax = (estimateData as any)?.sales_tax_amount || 0;
  const preTaxPrice = sellingPrice - salesTax;
  const percentageOverhead = preTaxPrice * (overheadRate / 100);
  const invoicesTotal = (overheadInvoices || []).reduce((sum, inv) => sum + (inv.invoice_amount || 0), 0);
  const grandTotal = percentageOverhead + invoicesTotal;
  const dumpTotal = dumpPrice * dumpCount;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  // Add dump fee as overhead invoice
  const addDumpFeeMutation = useMutation({
    mutationFn: async () => {
      if (!activeTenantId) throw new Error('No tenant');
      const { error } = await supabase
        .from('project_cost_invoices')
        .insert({
          pipeline_entry_id: pipelineEntryId,
          invoice_type: 'overhead',
          vendor_name: 'Dump Fee',
          notes: `Dump Fee - ${dumpCount} dump(s) @ ${formatCurrency(dumpPrice)} each`,
          invoice_amount: dumpTotal,
          status: 'approved',
          tenant_id: activeTenantId,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['overhead-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-invoices', pipelineEntryId] });
      toast.success(`Dump fee of ${formatCurrency(dumpTotal)} added`);
    },
    onError: () => toast.error('Failed to add dump fee'),
  });

  // Delete invoice
  const deleteMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase
        .from('project_cost_invoices')
        .delete()
        .eq('id', invoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['overhead-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-invoices', pipelineEntryId] });
      toast.success('Charge removed');
    },
  });

  const handleInvoiceSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['overhead-invoices', pipelineEntryId] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-invoices', pipelineEntryId] });
  };

  return (
    <div className="space-y-4">
      {/* Company Overhead */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4 text-primary" />
            Company Overhead
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Overhead Rate</span>
              <span className="font-medium">{overheadRate}%</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Selling Price (pre-tax)</span>
              <span className="font-medium">{formatCurrency(preTaxPrice)}</span>
            </div>
            <Separator />
            <div className="flex justify-between items-center">
              <span className="font-medium">Company Overhead Amount</span>
              <span className="font-bold text-lg">{formatCurrency(percentageOverhead)}</span>
            </div>
            <p className="text-xs text-muted-foreground">Includes: Insurance, Office, Admin, Equipment</p>
          </div>
        </CardContent>
      </Card>

      {/* Dump Fee Calculator */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4 text-amber-600" />
            Dump Fee
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Price per Dump</label>
              <Input
                type="number"
                value={dumpPrice}
                onChange={(e) => setDumpPrice(Number(e.target.value) || 0)}
                className="h-9"
              />
            </div>
            <div className="w-20">
              <label className="text-xs text-muted-foreground mb-1 block">Dumps</label>
              <Input
                type="number"
                value={dumpCount}
                onChange={(e) => setDumpCount(Math.max(1, Number(e.target.value) || 1))}
                className="h-9"
                min={1}
              />
            </div>
            <div className="w-24 text-right">
              <label className="text-xs text-muted-foreground mb-1 block">Total</label>
              <p className="font-bold text-sm h-9 flex items-center justify-end">{formatCurrency(dumpTotal)}</p>
            </div>
            <Button
              size="sm"
              onClick={() => addDumpFeeMutation.mutate()}
              disabled={addDumpFeeMutation.isPending || dumpTotal <= 0}
              className="h-9"
            >
              {addDumpFeeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Other Charges / Overhead Invoices */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4 text-purple-600" />
            Other Charges
            {overheadInvoices && overheadInvoices.length > 0 && (
              <Badge variant="outline" className="ml-auto font-mono">
                {overheadInvoices.length} item{overheadInvoices.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : overheadInvoices && overheadInvoices.length > 0 ? (
            <div className="space-y-2">
              {overheadInvoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md text-sm">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Receipt className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{inv.vendor_name || inv.notes || 'Charge'}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-medium">{formatCurrency(inv.invoice_amount)}</span>
                    <Badge variant="outline" className={cn(
                      "text-xs",
                      inv.status === 'verified' ? "bg-green-500/10 text-green-600 border-green-500/30" :
                      inv.status === 'approved' ? "bg-blue-500/10 text-blue-600 border-blue-500/30" :
                      "bg-yellow-500/10 text-yellow-600 border-yellow-500/30"
                    )}>
                      {inv.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => deleteMutation.mutate(inv.id)}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              ))}
              <Separator />
              <div className="flex justify-between items-center">
                <span className="font-medium text-sm">Other Charges Total</span>
                <span className="font-bold">{formatCurrency(invoicesTotal)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">No other charges yet</p>
          )}

          <InvoiceUploadCard
            pipelineEntryId={pipelineEntryId}
            invoiceType="overhead"
            onSuccess={handleInvoiceSuccess}
          />
        </CardContent>
      </Card>

      {/* Grand Total */}
      <Card className="border-primary/20">
        <CardContent className="py-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span>Company Overhead ({overheadRate}%)</span>
              <span>{formatCurrency(percentageOverhead)}</span>
            </div>
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span>Other Charges</span>
              <span>{formatCurrency(invoicesTotal)}</span>
            </div>
            <Separator />
            <div className="flex justify-between items-center">
              <span className="font-semibold">Total Overhead + Charges</span>
              <span className="font-bold text-lg">{formatCurrency(grandTotal)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

