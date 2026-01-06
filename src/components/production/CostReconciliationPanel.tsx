import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  CheckCircle, 
  AlertTriangle, 
  Lock, 
  FileText,
  TrendingUp,
  TrendingDown,
  Loader2,
  ExternalLink,
  PlayCircle
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface CostReconciliationPanelProps {
  projectId: string;
}

export const CostReconciliationPanel: React.FC<CostReconciliationPanelProps> = ({ 
  projectId 
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch reconciliation data
  const { data: reconciliation, isLoading } = useQuery({
    queryKey: ['cost-reconciliation', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_cost_reconciliation')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();

      if (error) throw error;
      return data;
    }
  });

  // Fetch invoices
  const { data: invoices = [] } = useQuery({
    queryKey: ['project-invoices', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_cost_invoices')
        .select('*, profiles:created_by(first_name, last_name)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    }
  });

  // Initiate verification mutation
  const initiateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('request-cost-verification', {
        body: { project_id: projectId }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: 'Verification Initiated',
        description: 'Cost verification has been started. You can now upload invoices.'
      });
      queryClient.invalidateQueries({ queryKey: ['cost-reconciliation', projectId] });
    },
    onError: (error: any) => {
      toast({
        title: 'Initiation Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('approve-cost-reconciliation', {
        body: { project_id: projectId }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: 'Reconciliation Approved',
        description: 'Cost reconciliation has been finalized'
      });
      queryClient.invalidateQueries({ queryKey: ['cost-reconciliation', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-invoices', projectId] });
    },
    onError: (error: any) => {
      toast({
        title: 'Approval Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getVarianceColor = (variance: number | null) => {
    if (!variance) return 'text-muted-foreground';
    return variance <= 0 ? 'text-success' : 'text-destructive';
  };

  const getVarianceIcon = (variance: number | null) => {
    if (!variance || variance === 0) return null;
    return variance < 0 ? (
      <TrendingDown className="h-4 w-4 text-success" />
    ) : (
      <TrendingUp className="h-4 w-4 text-destructive" />
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!reconciliation) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">
            Cost verification not yet initiated for this project
          </p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Click below to start cost verification and upload actual invoices
          </p>
          <Button 
            onClick={() => initiateMutation.mutate()}
            disabled={initiateMutation.isPending}
          >
            {initiateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Initiating...
              </>
            ) : (
              <>
                <PlayCircle className="h-4 w-4 mr-2" />
                Initiate Cost Verification
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isCompleted = reconciliation.status === 'completed';
  const materialVariance = reconciliation.material_variance || 0;
  const laborVariance = reconciliation.labor_variance || 0;
  const totalVariance = reconciliation.total_variance || 0;
  const originalProfit = reconciliation.original_profit || 0;
  const finalProfit = reconciliation.final_profit || 0;
  const profitVariance = finalProfit - originalProfit;
  const originalMargin = reconciliation.original_selling_price > 0 
    ? (originalProfit / reconciliation.original_selling_price) * 100 
    : 0;
  const finalMargin = reconciliation.original_selling_price > 0 
    ? (finalProfit / reconciliation.original_selling_price) * 100 
    : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Cost Reconciliation
          </CardTitle>
          <div className="flex items-center gap-2">
            {isCompleted ? (
              <Badge variant="default" className="bg-success">
                <Lock className="h-3 w-3 mr-1" />
                Verified
              </Badge>
            ) : (
              <Badge variant="secondary">
                {reconciliation.status === 'in_progress' ? 'In Progress' : 'Pending'}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Cost Comparison Table */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium">Category</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Original</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Actual</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Variance</th>
                  <th className="text-center px-4 py-3 text-sm font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="px-4 py-3 font-medium">Materials</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(reconciliation.original_material_cost)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(reconciliation.actual_material_cost)}</td>
                  <td className={`px-4 py-3 text-right ${getVarianceColor(materialVariance)}`}>
                    <div className="flex items-center justify-end gap-1">
                      {getVarianceIcon(materialVariance)}
                      {materialVariance >= 0 ? '+' : ''}{formatCurrency(materialVariance)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {reconciliation.actual_material_cost > 0 ? (
                      <CheckCircle className="h-4 w-4 text-success mx-auto" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-warning mx-auto" />
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium">Labor</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(reconciliation.original_labor_cost)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(reconciliation.actual_labor_cost)}</td>
                  <td className={`px-4 py-3 text-right ${getVarianceColor(laborVariance)}`}>
                    <div className="flex items-center justify-end gap-1">
                      {getVarianceIcon(laborVariance)}
                      {laborVariance >= 0 ? '+' : ''}{formatCurrency(laborVariance)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {reconciliation.actual_labor_cost > 0 ? (
                      <CheckCircle className="h-4 w-4 text-success mx-auto" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-warning mx-auto" />
                    )}
                  </td>
                </tr>
                <tr className="bg-muted/30">
                  <td className="px-4 py-3 font-medium">Overhead</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(reconciliation.original_overhead)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(reconciliation.actual_overhead || reconciliation.original_overhead)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">$0.00</td>
                  <td className="px-4 py-3 text-center text-xs text-muted-foreground">Auto-calc</td>
                </tr>
              </tbody>
              <tfoot className="bg-muted/50 font-semibold">
                <tr>
                  <td className="px-4 py-3">Total Cost</td>
                  <td className="px-4 py-3 text-right">
                    {formatCurrency(
                      (reconciliation.original_material_cost || 0) + 
                      (reconciliation.original_labor_cost || 0) +
                      (reconciliation.original_overhead || 0)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatCurrency(
                      (reconciliation.actual_material_cost || 0) + 
                      (reconciliation.actual_labor_cost || 0) +
                      (reconciliation.actual_overhead || reconciliation.original_overhead || 0)
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right ${getVarianceColor(totalVariance)}`}>
                    {totalVariance >= 0 ? '+' : ''}{formatCurrency(totalVariance)}
                  </td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <Separator className="my-4" />

          {/* Profit Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Contract Value</p>
              <p className="text-lg font-semibold">{formatCurrency(reconciliation.original_selling_price)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Original Profit</p>
              <p className="text-lg font-semibold">{formatCurrency(originalProfit)}</p>
              <p className="text-xs text-muted-foreground">{originalMargin.toFixed(1)}% margin</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Final Profit</p>
              <p className={`text-lg font-semibold ${finalProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(finalProfit)}
              </p>
              <p className="text-xs text-muted-foreground">{finalMargin.toFixed(1)}% margin</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Profit Impact</p>
              <p className={`text-lg font-semibold ${getVarianceColor(-profitVariance)}`}>
                {profitVariance >= 0 ? '+' : ''}{formatCurrency(profitVariance)}
              </p>
            </div>
          </div>

          {/* Approve Button */}
          {!isCompleted && (
            <div className="mt-6 flex justify-end">
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || invoices.length === 0}
              >
                {approveMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Approving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve & Finalize
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Uploaded Invoices */}
      {invoices.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Uploaded Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invoices.map((invoice: any) => (
                <div 
                  key={invoice.id} 
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <FileText className={`h-5 w-5 ${invoice.invoice_type === 'material' ? 'text-blue-500' : 'text-orange-500'}`} />
                    <div>
                      <p className="font-medium text-sm">
                        {invoice.vendor_name || invoice.crew_name || 'Unnamed'}
                        {invoice.invoice_number && ` - ${invoice.invoice_number}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {invoice.invoice_type === 'material' ? 'Material' : 'Labor'} •{' '}
                        {invoice.invoice_date || 'No date'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">
                      {formatCurrency(invoice.invoice_amount)}
                    </span>
                    {invoice.document_url && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => window.open(invoice.document_url, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    )}
                    <Badge variant={invoice.status === 'approved' ? 'default' : 'secondary'}>
                      {invoice.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
