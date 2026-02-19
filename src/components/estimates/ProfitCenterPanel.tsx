import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  TrendingUp, DollarSign, Calculator, Info, Loader2, 
  FileText, Upload, CheckCircle, Receipt, Package, Wrench,
  ArrowUpRight, ArrowDownRight, Minus, ClipboardCheck, BarChart3
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { InvoiceUploadCard } from '@/components/production/InvoiceUploadCard';
import { BudgetTracker } from '@/features/projects/components/BudgetTracker';
import { CostReconciliationPanel } from '@/components/production/CostReconciliationPanel';
import { format } from 'date-fns';

interface ProfitCenterPanelProps {
  pipelineEntryId: string;
  projectId?: string;
  className?: string;
}

interface SalesRepData {
  overhead_rate: number | null;
  personal_overhead_rate: number | null;
  commission_rate: number | null;
  first_name: string | null;
  last_name: string | null;
}

interface InvoiceData {
  id: string;
  invoice_type: 'material' | 'labor' | 'overhead';
  vendor_name: string | null;
  crew_name: string | null;
  overhead_category?: string | null;
  invoice_number: string | null;
  invoice_amount: number;
  invoice_date: string | null;
  status: string;
  created_at: string;
}

const ProfitCenterPanel: React.FC<ProfitCenterPanelProps> = ({
  pipelineEntryId,
  projectId,
  className
}) => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('summary');

  // Listen for invoice updates from DocumentsTab
  useEffect(() => {
    const handleInvoiceUpdate = (event: CustomEvent) => {
      if (event.detail?.pipelineEntryId === pipelineEntryId) {
        queryClient.invalidateQueries({ queryKey: ['pipeline-invoices', pipelineEntryId] });
      }
    };

    window.addEventListener('invoice-updated', handleInvoiceUpdate as EventListener);
    return () => {
      window.removeEventListener('invoice-updated', handleInvoiceUpdate as EventListener);
    };
  }, [pipelineEntryId, queryClient]);

  // Fetch sales rep's commission settings
  const { data: salesRepData, isLoading: isLoadingRep } = useQuery({
    queryKey: ['sales-rep-commission', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select(`
          assigned_to,
          profiles!pipeline_entries_assigned_to_fkey(
            first_name,
            last_name,
            overhead_rate,
            personal_overhead_rate,
            commission_rate
          )
        `)
        .eq('id', pipelineEntryId)
        .single();
      
      if (error) throw error;
      return data?.profiles as SalesRepData | null;
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch estimate data (original/locked costs)
  const { data: estimateData, isLoading: isLoadingEstimate } = useQuery({
    queryKey: ['estimate-costs', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('api_estimate_hyperlink_bar', { p_pipeline_entry_id: pipelineEntryId });
      if (error) throw error;
      return data as { materials: number; labor: number; sale_price: number; sales_tax_amount: number } | null;
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch invoices for this pipeline entry
  const { data: invoices, isLoading: isLoadingInvoices } = useQuery({
    queryKey: ['pipeline-invoices', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_cost_invoices')
        .select('*')
        .eq('pipeline_entry_id', pipelineEntryId)
        .in('status', ['pending', 'approved', 'verified'])
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as InvoiceData[];
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch budget items when projectId is present
  const { data: budgetItems } = useQuery({
    queryKey: ['project-budget-items', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_budget_items')
        .select('*')
        .eq('project_id', projectId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId,
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

  const personalOverhead = salesRepData?.personal_overhead_rate ?? 0;
  const baseOverhead = salesRepData?.overhead_rate ?? 10;
  const overheadRate = personalOverhead > 0 ? personalOverhead : baseOverhead;
  const commissionRate = salesRepData?.commission_rate ?? 50;
  const repName = salesRepData 
    ? `${salesRepData.first_name || ''} ${salesRepData.last_name || ''}`.trim() 
    : 'Sales Rep';

  // Original costs (from estimate/locked)
  const originalMaterialCost = estimateData?.materials || 0;
  const originalLaborCost = estimateData?.labor || 0;
  const sellingPrice = estimateData?.sale_price || 0;

  // Actual costs (from invoices)
  const actualMaterialCost = (invoices || [])
    .filter(inv => inv.invoice_type === 'material')
    .reduce((sum, inv) => sum + inv.invoice_amount, 0);
  
  const actualLaborCost = (invoices || [])
    .filter(inv => inv.invoice_type === 'labor')
    .reduce((sum, inv) => sum + inv.invoice_amount, 0);
  
  const actualOverheadCost = (invoices || [])
    .filter(inv => inv.invoice_type === 'overhead')
    .reduce((sum, inv) => sum + inv.invoice_amount, 0);

  const hasActualMaterial = actualMaterialCost > 0;
  const hasActualLabor = actualLaborCost > 0;
  const hasActualOverhead = actualOverheadCost > 0;
  
  const effectiveMaterialCost = hasActualMaterial ? actualMaterialCost : originalMaterialCost;
  const effectiveLaborCost = hasActualLabor ? actualLaborCost : originalLaborCost;

  const materialVariance = actualMaterialCost - originalMaterialCost;
  const laborVariance = actualLaborCost - originalLaborCost;

  const salesTaxAmount = (estimateData as any)?.sales_tax_amount || 0;
  const preTaxSellingPrice = sellingPrice - salesTaxAmount;
  const totalCost = effectiveMaterialCost + effectiveLaborCost + actualOverheadCost;
  const overheadAmount = preTaxSellingPrice * (overheadRate / 100);
  const grossProfit = sellingPrice - totalCost;
  const netProfit = grossProfit - overheadAmount;
  const repCommission = netProfit * (commissionRate / 100);
  const companyNet = netProfit - repCommission;
  const profitMargin = sellingPrice > 0 ? (netProfit / sellingPrice) * 100 : 0;

  const materialInvoiceCount = (invoices || []).filter(inv => inv.invoice_type === 'material').length;
  const laborInvoiceCount = (invoices || []).filter(inv => inv.invoice_type === 'labor').length;
  const overheadInvoiceCount = (invoices || []).filter(inv => inv.invoice_type === 'overhead').length;

  const hasValidData = sellingPrice > 0 && (originalMaterialCost > 0 || originalLaborCost > 0);

  const handleInvoiceSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['pipeline-invoices', pipelineEntryId] });
  };

  const VarianceIndicator = ({ variance }: { variance: number }) => {
    if (variance === 0 || !hasActualMaterial && !hasActualLabor) {
      return <span className="text-muted-foreground">-</span>;
    }
    if (variance > 0) {
      return (
        <span className="text-red-600 flex items-center gap-1">
          <ArrowUpRight className="h-3 w-3" />
          +{formatCurrency(variance)}
        </span>
      );
    }
    return (
      <span className="text-green-600 flex items-center gap-1">
        <ArrowDownRight className="h-3 w-3" />
        {formatCurrency(variance)}
      </span>
    );
  };

  const isLoading = isLoadingRep || isLoadingEstimate || isLoadingInvoices;

  if (isLoading) {
    return (
      <Card className={cn("border-primary/20", className)}>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Determine tab count based on whether projectId is present
  const isProject = !!projectId;
  const tabCount = isProject ? 5 : 3;

  return (
    <Card className={cn("border-primary/20", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <span>Profit Center</span>
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

      {/* Compact Financial Stats Row - Only for projects */}
      {isProject && hasValidData && (
        <div className="px-6 pb-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-muted/50 rounded-lg p-2.5">
              <p className="text-xs text-muted-foreground">Contract Value</p>
              <p className="text-sm font-bold">{formatCurrency(sellingPrice)}</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-2.5">
              <p className="text-xs text-muted-foreground">Total Costs</p>
              <p className="text-sm font-bold">{formatCurrency(totalCost)}</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-2.5">
              <p className="text-xs text-muted-foreground">Gross Profit</p>
              <p className={cn("text-sm font-bold", grossProfit >= 0 ? "text-green-600" : "text-red-600")}>
                {formatCurrency(grossProfit)}
              </p>
            </div>
            <div className="bg-muted/50 rounded-lg p-2.5">
              <p className="text-xs text-muted-foreground">Net Profit</p>
              <p className={cn("text-sm font-bold", netProfit >= 0 ? "text-green-600" : "text-red-600")}>
                {formatCurrency(netProfit)}
              </p>
            </div>
          </div>
        </div>
      )}
      
      <CardContent className="pt-0">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="relative">
            <TabsList className={cn(
              "flex overflow-x-auto w-full justify-start mb-4",
              isProject ? "bg-muted p-1 rounded-md" : "grid w-full grid-cols-3"
            )}>
              <TabsTrigger value="summary" className="text-xs flex-shrink-0">
                <Calculator className="h-3 w-3 mr-1" />
                Summary
              </TabsTrigger>
              <TabsTrigger value="invoices" className="text-xs flex-shrink-0">
                <Upload className="h-3 w-3 mr-1" />
                Invoices
              </TabsTrigger>
              <TabsTrigger value="breakdown" className="text-xs flex-shrink-0">
                <Receipt className="h-3 w-3 mr-1" />
                Details
              </TabsTrigger>
              {isProject && (
                <>
                  <TabsTrigger value="budget" className="text-xs flex-shrink-0">
                    <BarChart3 className="h-3 w-3 mr-1" />
                    Budget
                  </TabsTrigger>
                  <TabsTrigger value="cost-verification" className="text-xs flex-shrink-0">
                    <ClipboardCheck className="h-3 w-3 mr-1" />
                    Cost Verification
                  </TabsTrigger>
                </>
              )}
            </TabsList>
            {isProject && (
              <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none rounded-r-md" />
            )}
          </div>

          <TabsContent value="summary" className="space-y-4 mt-0">
            {!hasValidData ? (
              <div className="text-center py-8">
                <Calculator className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-2">
                  Complete materials & labor sections to see profit breakdown
                </p>
              </div>
            ) : (
              <>
                {/* Selling Price */}
                <div className="flex justify-between items-center py-2">
                  <span className="font-medium">Selling Price</span>
                  <span className="font-semibold text-lg">{formatCurrency(sellingPrice)}</span>
                </div>

                <Separator />

                {/* Cost Comparison Table */}
                <div className="space-y-1">
                  <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground font-medium pb-1">
                    <span>Cost Type</span>
                    <span className="text-right">Original</span>
                    <span className="text-right">Actual</span>
                    <span className="text-right">Variance</span>
                  </div>
                  
                  <div className="grid grid-cols-4 gap-2 text-sm py-1.5">
                    <span className="flex items-center gap-1">
                      <Package className="h-3 w-3 text-blue-500" />
                      Materials
                    </span>
                    <span className="text-right text-muted-foreground">{formatCurrency(originalMaterialCost)}</span>
                    <span className={cn("text-right font-medium", hasActualMaterial ? "text-foreground" : "text-muted-foreground")}>
                      {hasActualMaterial ? formatCurrency(actualMaterialCost) : '-'}
                    </span>
                    <span className="text-right">
                      <VarianceIndicator variance={hasActualMaterial ? materialVariance : 0} />
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-sm py-1.5">
                    <span className="flex items-center gap-1">
                      <Wrench className="h-3 w-3 text-orange-500" />
                      Labor
                    </span>
                    <span className="text-right text-muted-foreground">{formatCurrency(originalLaborCost)}</span>
                    <span className={cn("text-right font-medium", hasActualLabor ? "text-foreground" : "text-muted-foreground")}>
                      {hasActualLabor ? formatCurrency(actualLaborCost) : '-'}
                    </span>
                    <span className="text-right">
                      <VarianceIndicator variance={hasActualLabor ? laborVariance : 0} />
                    </span>
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

                {/* Rep Commission */}
                <div className="flex justify-between items-center py-2 bg-primary/10 rounded-md px-3 -mx-3">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-primary" />
                    <span className="font-medium">Rep Commission</span>
                  </div>
                  <span className="font-bold text-xl text-primary">
                    {formatCurrency(repCommission)}
                  </span>
                </div>

                {/* Invoice Status */}
                {(materialInvoiceCount > 0 || laborInvoiceCount > 0 || overheadInvoiceCount > 0) && (
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {materialInvoiceCount} material, {laborInvoiceCount} labor, {overheadInvoiceCount} overhead invoice(s) uploaded
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="invoices" className="space-y-4 mt-0">
            <div className="grid gap-4">
              <InvoiceUploadCard
                pipelineEntryId={pipelineEntryId}
                invoiceType="material"
                onSuccess={handleInvoiceSuccess}
              />
              <InvoiceUploadCard
                pipelineEntryId={pipelineEntryId}
                invoiceType="labor"
                onSuccess={handleInvoiceSuccess}
              />
              <InvoiceUploadCard
                pipelineEntryId={pipelineEntryId}
                invoiceType="overhead"
                onSuccess={handleInvoiceSuccess}
              />
            </div>

            {/* Recent Invoices List */}
            {invoices && invoices.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium mb-2">Recent Invoices</h4>
                <div className="space-y-2">
                  {invoices.slice(0, 5).map((invoice) => (
                    <div key={invoice.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md text-sm">
                      <div className="flex items-center gap-2">
                        {invoice.invoice_type === 'material' ? (
                          <Package className="h-3 w-3 text-blue-500" />
                        ) : invoice.invoice_type === 'labor' ? (
                          <Wrench className="h-3 w-3 text-orange-500" />
                        ) : (
                          <Receipt className="h-3 w-3 text-purple-500" />
                        )}
                        <span>{invoice.vendor_name || invoice.crew_name || invoice.overhead_category || 'Unknown'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{formatCurrency(invoice.invoice_amount)}</span>
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-xs",
                            invoice.status === 'verified' ? "bg-green-500/10 text-green-600 border-green-500/30" :
                            invoice.status === 'pending' ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" : ""
                          )}
                        >
                          {invoice.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="breakdown" className="space-y-4 mt-0">
            {!hasValidData ? (
              <div className="text-center py-8">
                <Calculator className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No data available</p>
              </div>
            ) : (
              <>
                {/* Revenue */}
                <div className="flex justify-between items-center py-2">
                  <span className="font-medium">Selling Price</span>
                  <span className="font-semibold">{formatCurrency(sellingPrice)}</span>
                </div>

                <Separator />

                {/* Costs */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center py-1 text-muted-foreground">
                    <span>Material Cost {hasActualMaterial && '(Actual)'}</span>
                    <span className="text-red-600">-{formatCurrency(effectiveMaterialCost)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 text-muted-foreground">
                    <span>Labor Cost {hasActualLabor && '(Actual)'}</span>
                    <span className="text-red-600">-{formatCurrency(effectiveLaborCost)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 text-muted-foreground">
                    <span>Company Overhead ({overheadRate}%)</span>
                    <span className="text-red-600">-{formatCurrency(overheadAmount)}</span>
                  </div>
                </div>

                <Separator />

                {/* Gross Profit */}
                <div className="flex justify-between items-center py-1">
                  <span>Gross Profit</span>
                  <span className="font-medium">{formatCurrency(grossProfit)}</span>
                </div>

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
                    <p className="text-xs text-muted-foreground text-primary/80">
                      Upload actual invoices in the Invoices tab to update profit calculations.
                    </p>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* Budget Tab - Project only */}
          {isProject && (
            <TabsContent value="budget" className="mt-0">
              <BudgetTracker projectId={projectId!} budgetItems={budgetItems || []} onRefresh={() => {
                queryClient.invalidateQueries({ queryKey: ['project-budget-items', projectId] });
              }} />
            </TabsContent>
          )}

          {/* Cost Verification Tab - Project only */}
          {isProject && (
            <TabsContent value="cost-verification" className="space-y-4 mt-0">
              <CostReconciliationPanel projectId={projectId!} />
              <InvoiceUploadCard projectId={projectId!} invoiceType="material" />
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default ProfitCenterPanel;
