import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  TrendingUp, DollarSign, Calculator, Info, Loader2, 
  FileText, Upload, CheckCircle, Receipt, Package, Wrench,
  ArrowUpRight, ArrowDownRight, Minus, ClipboardCheck, BarChart3,
  CreditCard, FileEdit, Pencil, X, Check, Trash2, Eye
} from 'lucide-react';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { InvoiceUploadCard } from '@/components/production/InvoiceUploadCard';
import { BudgetTracker } from '@/features/projects/components/BudgetTracker';
import { CostReconciliationPanel } from '@/components/production/CostReconciliationPanel';
import { PaymentsTab } from '@/components/estimates/PaymentsTab';
import { ChangeOrdersTab } from '@/components/estimates/ChangeOrdersTab';
import { CustomerPortalButton } from '@/components/lead-details/CustomerPortalButton';
import { format } from 'date-fns';
import { openInvoiceDocument } from '@/lib/invoices/openInvoiceDocument';
import { InvoicePreviewDialog } from '@/components/invoices/InvoicePreviewDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ProfitCenterPanelProps {
  pipelineEntryId: string;
  projectId?: string;
  contactId?: string;
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
  id: string | null;
  invoice_type: 'material' | 'labor' | 'overhead' | 'other';
  vendor_name: string | null;
  crew_name: string | null;
  notes?: string | null;
  invoice_number: string | null;
  document_name?: string | null;
  invoice_amount: number;
  invoice_date: string | null;
  status: string;
  created_at: string;
  document_url?: string | null;
}

const isValidUuid = (value?: string | null) =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const ProfitCenterPanel: React.FC<ProfitCenterPanelProps> = ({
  pipelineEntryId,
  projectId,
  contactId,
  className
}) => {
  const queryClient = useQueryClient();
  const { profile } = useActiveTenantId();
  const effectiveTenantId = useEffectiveTenantId();
  const userRole = (profile as any)?.role as string | undefined;
  const canDeleteInvoices = ['master', 'owner', 'corporate', 'admin', 'office_staff'].includes(userRole || '');
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [renamingInvoiceId, setRenamingInvoiceId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isSavingRename, setIsSavingRename] = useState(false);
  const [activeTab, setActiveTab] = useState('summary');
  const [isEditingPrice, setIsEditingPrice] = useState(false);
  const [editPrice, setEditPrice] = useState('');
  const [isSavingPrice, setIsSavingPrice] = useState(false);
  const [previewInvoice, setPreviewInvoice] = useState<{ url: string; name: string } | null>(null);

  // Listen for invoice updates from DocumentsTab / InvoiceUploadCard / etc.
  useEffect(() => {
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-invoices-totals', pipelineEntryId] });
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ['project-budget-items', projectId] });
      }
    };

    const handleInvoiceUpdate = (event: CustomEvent) => {
      // Match by pipelineEntryId OR projectId — uploads from BudgetTracker or
      // production tools may only know the projectId.
      const detail = event.detail || {};
      if (
        detail.pipelineEntryId === pipelineEntryId ||
        (projectId && detail.projectId === projectId)
      ) {
        refresh();
      }
    };

    window.addEventListener('invoice-updated', handleInvoiceUpdate as EventListener);
    window.addEventListener('invoice-deleted', handleInvoiceUpdate as EventListener);

    // Realtime: any insert/update/delete on project_cost_invoices for this
    // pipeline entry should refresh the Actual / Other Charges columns
    // immediately — no manual refresh required.
    if (!pipelineEntryId || !effectiveTenantId) {
      return () => {
        window.removeEventListener('invoice-updated', handleInvoiceUpdate as EventListener);
        window.removeEventListener('invoice-deleted', handleInvoiceUpdate as EventListener);
      };
    }

    const channel = supabase
      .channel(`profit-center-invoices-${effectiveTenantId}-${pipelineEntryId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_cost_invoices',
          filter: `tenant_id=eq.${effectiveTenantId}`,
        },
        (payload: any) => {
          const newRow = payload?.new || {};
          const oldRow = payload?.old || {};
          if (
            newRow.pipeline_entry_id === pipelineEntryId ||
            oldRow.pipeline_entry_id === pipelineEntryId ||
            (projectId && newRow.project_id === projectId) ||
            (projectId && oldRow.project_id === projectId)
          ) {
            refresh();
          }
        },
      )
      .subscribe();

    return () => {
      window.removeEventListener('invoice-updated', handleInvoiceUpdate as EventListener);
      window.removeEventListener('invoice-deleted', handleInvoiceUpdate as EventListener);
      supabase.removeChannel(channel);
    };
  }, [pipelineEntryId, projectId, effectiveTenantId, queryClient]);

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
            commission_rate,
            commission_structure
          )
        `)
        .eq('id', pipelineEntryId)
        .single();
      
      if (error) throw error;
      return data?.profiles as (SalesRepData & { commission_structure: string | null }) | null;
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
      return data as { materials: number; labor: number; sale_price: number; sales_tax_amount: number; selected_estimate_id: string | null } | null;
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch invoices for this pipeline entry
  const { data: invoices, isLoading: isLoadingInvoices } = useQuery({
    queryKey: ['pipeline-invoices', pipelineEntryId, projectId || null, effectiveTenantId],
    queryFn: async () => {
      let query = supabase
        .from('project_cost_invoices')
        .select('*')
        .eq('tenant_id', effectiveTenantId!)
        .in('status', ['pending', 'approved', 'verified'])
        .order('created_at', { ascending: false });

      query = projectId
        ? query.or(`pipeline_entry_id.eq.${pipelineEntryId},project_id.eq.${projectId}`)
        : query.eq('pipeline_entry_id', pipelineEntryId);

      const { data, error } = await query;
      
      if (error) throw error;
      return data as InvoiceData[];
    },
    enabled: !!pipelineEntryId && !!effectiveTenantId,
  });

  const updateInvoiceTypeMutation = useMutation({
    mutationFn: async ({ invoiceId, invoiceType }: { invoiceId: string; invoiceType: InvoiceData['invoice_type'] }) => {
      if (!effectiveTenantId) throw new Error('Tenant not resolved');
      const { error } = await supabase
        .from('project_cost_invoices')
        .update({ invoice_type: invoiceType })
        .eq('id', invoiceId)
        .eq('tenant_id', effectiveTenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Invoice category updated');
      queryClient.invalidateQueries({ queryKey: ['pipeline-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-invoices-totals', pipelineEntryId] });
      if (projectId) queryClient.invalidateQueries({ queryKey: ['project-budget-items', projectId] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update invoice category'),
  });

  const verifyInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      if (!effectiveTenantId) throw new Error('Tenant not resolved');
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('project_cost_invoices')
        .update({
          status: 'verified',
          approved_by: userData.user?.id || null,
          approved_at: new Date().toISOString(),
        })
        .eq('id', invoiceId)
        .eq('tenant_id', effectiveTenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Invoice verified');
      queryClient.invalidateQueries({ queryKey: ['pipeline-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-invoices-totals', pipelineEntryId] });
      if (projectId) queryClient.invalidateQueries({ queryKey: ['project-budget-items', projectId] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to verify invoice'),
  });

  // Fetch pipeline entry job/CLJ number for invoice labeling
  const { data: pipelineEntry } = useQuery({
    queryKey: ['pipeline-entry-clj', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select('clj_formatted_number, lead_name')
        .eq('id', pipelineEntryId)
        .maybeSingle();
      if (error) throw error;
      return data as { clj_formatted_number: string | null; lead_name: string | null } | null;
    },
    enabled: !!pipelineEntryId,
  });
  const jobLabel = pipelineEntry?.clj_formatted_number || null;

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

  // Fetch combine-estimates state from pipeline_entries metadata
  const { data: combineState } = useQuery({
    queryKey: ['pipeline-entry-combine', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .maybeSingle();
      if (error) throw error;
      const meta = (data?.metadata as any) || {};
      return {
        combine: !!meta.combine_estimates,
        ids: Array.isArray(meta.selected_estimate_ids) ? (meta.selected_estimate_ids as string[]) : [],
      };
    },
    enabled: !!pipelineEntryId,
  });

  // When combine mode is on, fetch each selected estimate so we can break down per-trade profit
  const { data: combinedEstimates } = useQuery({
    queryKey: ['profit-center-combined-estimates', pipelineEntryId, combineState?.ids?.join(',')],
    queryFn: async () => {
      const ids = combineState?.ids || [];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('enhanced_estimates')
        .select('id, estimate_number, display_name, material_cost, labor_cost, selling_price, sales_tax_amount')
        .in('id', ids);
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        estimate_number: string | null;
        display_name: string | null;
        material_cost: number | null;
        labor_cost: number | null;
        selling_price: number | null;
        sales_tax_amount: number | null;
      }>;
    },
    enabled: !!pipelineEntryId && !!combineState?.combine && (combineState?.ids?.length || 0) > 0,
  });

  const isCombined = !!combineState?.combine && (combinedEstimates?.length || 0) > 1;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  const personalOverhead = salesRepData?.personal_overhead_rate ?? 0;
  const baseOverhead = salesRepData?.overhead_rate ?? 10;
  const overheadRate = personalOverhead > 0 ? personalOverhead : baseOverhead;
  const commissionRate = salesRepData?.commission_rate ?? 50;
  const commissionStructure = (salesRepData as any)?.commission_structure as string | null;
  const commissionStructureLabel =
    commissionStructure === 'percent_of_contract' ? 'Percent of Contract'
    : commissionStructure === 'profit_split' ? 'Profit Split'
    : commissionStructure
      ? commissionStructure.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : 'Profit Split';
  const repName = salesRepData 
    ? `${salesRepData.first_name || ''} ${salesRepData.last_name || ''}`.trim() 
    : 'Sales Rep';

  // Combined sums when multiple estimates are merged into a single contract
  const combinedSums = isCombined && combinedEstimates ? {
    materials: combinedEstimates.reduce((s, e) => s + Number(e.material_cost || 0), 0),
    labor: combinedEstimates.reduce((s, e) => s + Number(e.labor_cost || 0), 0),
    selling: combinedEstimates.reduce((s, e) => s + Number(e.selling_price || 0), 0),
    salesTax: combinedEstimates.reduce((s, e) => s + Number(e.sales_tax_amount || 0), 0),
  } : null;

  // Per-trade breakdown rows (one per combined estimate) — planned/original numbers
  const tradeBreakdown = (isCombined && combinedEstimates) ? combinedEstimates.map((e) => {
    const selling = Number(e.selling_price || 0);
    const tax = Number(e.sales_tax_amount || 0);
    const mat = Number(e.material_cost || 0);
    const lab = Number(e.labor_cost || 0);
    const preTax = selling - tax;
    const oh = preTax * (overheadRate / 100);
    const gp = preTax - mat - lab - oh;
    const margin = preTax > 0 ? (gp / preTax) * 100 : 0;
    return {
      id: e.id,
      label: e.display_name?.trim() || e.estimate_number || 'Estimate',
      selling,
      materials: mat,
      labor: lab,
      overhead: oh,
      grossProfit: gp,
      margin,
    };
  }) : [];

  // Original costs (from estimate/locked) — use combined sums if combine mode is on
  const originalMaterialCost = combinedSums ? combinedSums.materials : (estimateData?.materials || 0);
  const originalLaborCost = combinedSums ? combinedSums.labor : (estimateData?.labor || 0);
  const sellingPrice = combinedSums ? combinedSums.selling : (estimateData?.sale_price || 0);

  // Actual costs (from invoices)
  const actualMaterialCost = (invoices || [])
    .filter(inv => inv.invoice_type === 'material')
    .reduce((sum, inv) => sum + inv.invoice_amount, 0);
  
  const actualLaborCost = (invoices || [])
    .filter(inv => inv.invoice_type === 'labor')
    .reduce((sum, inv) => sum + inv.invoice_amount, 0);
  
  // Other charges = overhead invoices (permits, dumps, etc.) — additive on top of percentage overhead
  const otherChargesTotal = (invoices || [])
    .filter(inv => inv.invoice_type === 'overhead' || inv.invoice_type === 'other')
    .reduce((sum, inv) => sum + inv.invoice_amount, 0);

  const otherChargesInvoices = (invoices || []).filter(inv => inv.invoice_type === 'overhead' || inv.invoice_type === 'other');
  const hasOtherCharges = otherChargesTotal > 0;

  const hasActualMaterial = actualMaterialCost > 0;
  const hasActualLabor = actualLaborCost > 0;
  
  const effectiveMaterialCost = hasActualMaterial ? actualMaterialCost : originalMaterialCost;
  const effectiveLaborCost = hasActualLabor ? actualLaborCost : originalLaborCost;

  const materialVariance = actualMaterialCost - originalMaterialCost;
  const laborVariance = actualLaborCost - originalLaborCost;

  const salesTaxAmount = combinedSums ? combinedSums.salesTax : ((estimateData as any)?.sales_tax_amount || 0);
  const preTaxSellingPrice = sellingPrice - salesTaxAmount;
  const overheadAmount = preTaxSellingPrice * (overheadRate / 100);
  // Total cost = materials + labor + percentage overhead + other charges (permits, dumps, etc.)
  const totalCost = effectiveMaterialCost + effectiveLaborCost + overheadAmount + otherChargesTotal;
  const grossProfit = preTaxSellingPrice - totalCost;
  const repCommission = grossProfit * (commissionRate / 100);
  const companyNet = grossProfit - repCommission;
  const profitMargin = preTaxSellingPrice > 0 ? (grossProfit / preTaxSellingPrice) * 100 : 0;

  const materialInvoiceCount = (invoices || []).filter(inv => inv.invoice_type === 'material').length;
  const laborInvoiceCount = (invoices || []).filter(inv => inv.invoice_type === 'labor').length;
  const otherChargesInvoiceCount = otherChargesInvoices.length;

  const hasValidData = sellingPrice > 0 && (originalMaterialCost > 0 || originalLaborCost > 0);

  const handleInvoiceSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['pipeline-invoices', pipelineEntryId] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-invoices-totals', pipelineEntryId] });
  };

  const handleDeleteInvoice = async (invoiceId: string, invoiceType: InvoiceData['invoice_type']) => {
    if (!canDeleteInvoices) return;
    if (!effectiveTenantId) {
      toast.error('Tenant not resolved');
      return;
    }
    if (!isValidUuid(invoiceId)) {
      toast.error('Invoice is still loading. Please refresh and try again.');
      return;
    }
    if (!window.confirm('Delete this imported invoice? This cannot be undone.')) return;
    setDeletingInvoiceId(invoiceId);
    try {
      const { error } = await supabase
        .from('project_cost_invoices')
        .delete()
        .eq('id', invoiceId)
        .eq('tenant_id', effectiveTenantId);
      if (error) throw error;
      toast.success('Invoice deleted');
      queryClient.invalidateQueries({ queryKey: ['pipeline-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-invoices-totals', pipelineEntryId] });
      window.dispatchEvent(new CustomEvent('invoice-updated', { detail: { pipelineEntryId } }));
      window.dispatchEvent(new CustomEvent('invoice-deleted', { detail: { pipelineEntryId, invoiceType } }));
    } catch (err: any) {
      console.error('[ProfitCenterPanel] delete invoice failed', err);
      toast.error(err?.message || 'Failed to delete invoice');
    } finally {
      setDeletingInvoiceId(null);
    }
  };

  const handleStartRename = (invoice: InvoiceData) => {
    if (!isValidUuid(invoice.id)) return;
    setRenamingInvoiceId(invoice.id);
    setRenameValue(invoice.document_name?.trim() || invoice.vendor_name?.trim() || invoice.crew_name?.trim() || '');
  };

  const handleCancelRename = () => {
    setRenamingInvoiceId(null);
    setRenameValue('');
  };

  const handleSaveRename = async () => {
    if (!renamingInvoiceId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast.error('Name cannot be empty');
      return;
    }
    setIsSavingRename(true);
    try {
      if (!effectiveTenantId) throw new Error('Tenant not resolved');
      const { error } = await supabase
        .from('project_cost_invoices')
        .update({ document_name: trimmed })
        .eq('id', renamingInvoiceId)
        .eq('tenant_id', effectiveTenantId);
      if (error) throw error;
      toast.success('Invoice renamed');
      queryClient.invalidateQueries({ queryKey: ['pipeline-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-invoices-totals', pipelineEntryId] });
      window.dispatchEvent(new CustomEvent('invoice-updated', { detail: { pipelineEntryId } }));
      setRenamingInvoiceId(null);
      setRenameValue('');
    } catch (err: any) {
      console.error('[ProfitCenterPanel] rename invoice failed', err);
      toast.error(err?.message || 'Failed to rename invoice');
    } finally {
      setIsSavingRename(false);
    }
  };

  const handleStartEditPrice = () => {
    setEditPrice(sellingPrice.toFixed(2));
    setIsEditingPrice(true);
  };

  const handleSavePrice = async () => {
    const newPrice = parseFloat(editPrice);
    if (isNaN(newPrice) || newPrice <= 0) {
      toast.error('Enter a valid price');
      return;
    }

    const estimateId = (estimateData as any)?.selected_estimate_id;
    if (!estimateId) {
      toast.error('No estimate selected to update');
      return;
    }

    setIsSavingPrice(true);
    try {
      // Fetch current estimate to get cost data
      const { data: estimate, error: fetchError } = await supabase
        .from('enhanced_estimates')
        .select('material_cost, labor_cost, overhead_percent, sales_tax_amount')
        .eq('id', estimateId)
        .single();

      if (fetchError || !estimate) throw new Error('Could not fetch estimate');

      const directCost = (estimate.material_cost || 0) + (estimate.labor_cost || 0);
      const tax = estimate.sales_tax_amount || 0;
      const preTax = newPrice - tax;
      const ohRate = estimate.overhead_percent || overheadRate;
      const ohAmount = preTax * (ohRate / 100);
      const profit = preTax - directCost - ohAmount;
      const profitPct = preTax > 0 ? (profit / preTax) * 100 : 0;

      const { error } = await supabase
        .from('enhanced_estimates')
        .update({
          selling_price: newPrice,
          overhead_amount: Math.round(ohAmount * 100) / 100,
          actual_profit_amount: Math.round(profit * 100) / 100,
          actual_profit_percent: Math.round(profitPct * 100) / 100,
        })
        .eq('id', estimateId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['estimate-costs', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['hyperlink-data', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['profit-center-data', pipelineEntryId] });
      toast.success(`Selling price updated to ${formatCurrency(newPrice)}`);
      setIsEditingPrice(false);
    } catch (err: any) {
      toast.error(`Failed to update price: ${err.message}`);
    } finally {
      setIsSavingPrice(false);
    }
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
  const tabCount = isProject ? 4 : 3;

  return (
    <>
    <Card className={cn("border-primary/20", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <span>Profit Center</span>
          </CardTitle>
        </div>
          {repName && (
          <p className="text-sm text-muted-foreground">
            Commission calculation for {repName}
          </p>
        )}
        {projectId && contactId && (
          <div className="mt-2">
            <CustomerPortalButton projectId={projectId} contactId={contactId} />
          </div>
        )}
      </CardHeader>

      {/* Compact Financial Stats Row - Only for projects */}
      {isProject && hasValidData && (
        <div className="px-6 pb-2">
          <div className="grid grid-cols-3 gap-3">
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
          </div>
        </div>
      )}
      
      <CardContent className="pt-0">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="relative">
            <TabsList className={cn(
              "flex overflow-x-auto w-full justify-start mb-4",
              isProject ? "bg-muted p-1 rounded-md" : "grid w-full grid-cols-4"
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
              <TabsTrigger value="change_orders" className="text-xs flex-shrink-0">
                <FileEdit className="h-3 w-3 mr-1" />
                Change Orders
              </TabsTrigger>
              {isProject && (
                <>
                  <TabsTrigger value="payments" className="text-xs flex-shrink-0">
                    <CreditCard className="h-3 w-3 mr-1" />
                    Payments
                  </TabsTrigger>
                  <TabsTrigger value="budget" className="text-xs flex-shrink-0">
                    <BarChart3 className="h-3 w-3 mr-1" />
                    Budget
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
                {/* Selling Price with Adjust Button */}
                <div className="flex justify-between items-center py-2">
                  <span className="font-medium">Selling Price</span>
                  {isEditingPrice ? (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-36 h-8 text-right font-semibold"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSavePrice();
                          if (e.key === 'Escape') setIsEditingPrice(false);
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-green-600"
                        onClick={handleSavePrice}
                        disabled={isSavingPrice}
                      >
                        {isSavingPrice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setIsEditingPrice(false)}
                        disabled={isSavingPrice}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-lg">{formatCurrency(sellingPrice)}</span>
                      {!isCombined && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={handleStartEditPrice}
                          title="Adjust final price"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
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

                  <div className="grid grid-cols-4 gap-2 text-sm py-1.5">
                    <span className="flex items-center gap-1">
                      <Calculator className="h-3 w-3 text-purple-500" />
                      Overhead ({formatPercent(overheadRate)})
                    </span>
                    <span className="text-right text-muted-foreground">{formatCurrency(overheadAmount)}</span>
                    <span className="text-right text-muted-foreground">-</span>
                    <span className="text-right"><span className="text-muted-foreground">-</span></span>
                  </div>

                  {/* Other Charges Row */}
                  {hasOtherCharges && (
                    <div className="grid grid-cols-4 gap-2 text-sm py-1.5">
                      <span className="flex items-center gap-1">
                        <Receipt className="h-3 w-3 text-amber-500" />
                        Other Charges
                      </span>
                      <span className="text-right text-muted-foreground">-</span>
                      <span className="text-right font-medium">
                        {formatCurrency(otherChargesTotal)}
                      </span>
                      <span className="text-right"><span className="text-muted-foreground">-</span></span>
                    </div>
                  )}

                  {/* Other charges breakdown */}
                  {hasOtherCharges && otherChargesInvoices.map((inv) => (
                    <div key={inv.id} className="grid grid-cols-4 gap-2 text-xs py-1 pl-5 text-muted-foreground">
                      <span className="truncate">{inv.vendor_name || inv.crew_name || inv.notes || 'Charge'}</span>
                      <span className="text-right">-</span>
                      <span className="text-right">{formatCurrency(inv.invoice_amount)}</span>
                      <span className="text-right">-</span>
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Gross Profit */}
                <div className="flex justify-between items-center py-2 bg-accent/30 rounded-md px-3 -mx-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Gross Profit</span>
                    {hasValidData && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono text-xs",
                          profitMargin >= 25 ? "bg-green-500/10 text-green-600 border-green-500/30" :
                          profitMargin >= 15 ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" :
                          "bg-red-500/10 text-red-600 border-red-500/30"
                        )}
                      >
                        {formatPercent(profitMargin)} Margin
                      </Badge>
                    )}
                  </div>
                  <span className={cn(
                    "font-semibold text-lg",
                    grossProfit >= 0 ? "text-green-600" : "text-red-600"
                  )}>
                    {formatCurrency(grossProfit)}
                  </span>
                </div>

                {/* Rep Commission */}
                <div className="flex justify-between items-center py-2 bg-primary/10 rounded-md px-3 -mx-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <DollarSign className="h-4 w-4 text-primary shrink-0" />
                    <span className="font-medium">Rep Commission</span>
                    <Badge variant="secondary" className="text-xs font-normal">
                      {commissionStructureLabel} · {commissionRate}%
                    </Badge>
                  </div>
                  <span className="font-bold text-xl text-primary">
                    {formatCurrency(repCommission)}
                  </span>
                </div>

                {/* Per-Trade Breakdown (only when combining multiple estimates) */}
                {isCombined && tradeBreakdown.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-primary" />
                        Profit by Trade
                      </h4>
                      <Badge variant="secondary" className="text-xs">
                        {tradeBreakdown.length} estimates combined
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Each combined estimate's planned profit is shown separately so you can track margin per trade.
                    </p>
                    <div className="space-y-2">
                      {tradeBreakdown.map((t) => (
                        <div key={t.id} className="border rounded-lg p-3 bg-muted/30">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-sm truncate">{t.label}</span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "font-mono text-xs",
                                t.margin >= 25 ? "bg-green-500/10 text-green-600 border-green-500/30" :
                                t.margin >= 15 ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" :
                                "bg-red-500/10 text-red-600 border-red-500/30"
                              )}
                            >
                              {formatPercent(t.margin)} Margin
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Selling Price</span>
                              <span className="font-medium">{formatCurrency(t.selling)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground flex items-center gap-1">
                                <Package className="h-3 w-3 text-blue-500" />Materials
                              </span>
                              <span>{formatCurrency(t.materials)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground flex items-center gap-1">
                                <Wrench className="h-3 w-3 text-orange-500" />Labor
                              </span>
                              <span>{formatCurrency(t.labor)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground flex items-center gap-1">
                                <Calculator className="h-3 w-3 text-purple-500" />Overhead
                              </span>
                              <span>{formatCurrency(t.overhead)}</span>
                            </div>
                            <div className="flex justify-between col-span-2 pt-1 border-t border-border/60">
                              <span className="font-medium">Gross Profit</span>
                              <span className={cn(
                                "font-semibold",
                                t.grossProfit >= 0 ? "text-green-600" : "text-red-600"
                              )}>
                                {formatCurrency(t.grossProfit)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}


                {/* Invoice Status */}
                {(materialInvoiceCount > 0 || laborInvoiceCount > 0 || otherChargesInvoiceCount > 0) && (
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {materialInvoiceCount} material, {laborInvoiceCount} labor, {otherChargesInvoiceCount} other charge invoice(s) uploaded
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
                  {invoices.map((invoice) => {
                    const vendorLabel = invoice.vendor_name?.trim() || invoice.crew_name?.trim() || invoice.document_name?.trim() || (invoice.invoice_type === 'material' ? 'Supplier' : invoice.invoice_type === 'labor' ? 'Crew' : 'Vendor');
                    const displayName = `${vendorLabel}${jobLabel ? ` — ${jobLabel}` : ''}`;
                    const invoiceDateLabel = invoice.invoice_date
                      ? new Date(invoice.invoice_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : null;
                    const typeLabel = invoice.invoice_type === 'material' ? 'Material' : invoice.invoice_type === 'labor' ? 'Labor' : invoice.invoice_type === 'overhead' ? 'Overhead' : 'Other';
                    const canDeleteInvoice = canDeleteInvoices && isValidUuid(invoice.id);
                    const canRenameInvoice = isValidUuid(invoice.id);
                    const canEditInvoice = isValidUuid(invoice.id);
                    const isVerified = invoice.status === 'verified' || invoice.status === 'approved';
                    const isRenaming = renamingInvoiceId === invoice.id;
                    return (
                      <div key={invoice.id || `${invoice.invoice_type}-${invoice.created_at}-${invoice.invoice_amount}`} className="flex items-center justify-between p-2.5 bg-muted/50 rounded-md text-sm">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {invoice.invoice_type === 'material' ? (
                            <Package className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                          ) : invoice.invoice_type === 'labor' ? (
                            <Wrench className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                          ) : (
                            <Receipt className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            {isRenaming ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveRename();
                                    if (e.key === 'Escape') handleCancelRename();
                                  }}
                                  autoFocus
                                  className="h-7 text-sm"
                                  placeholder="Invoice name"
                                />
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" onClick={handleSaveRename} disabled={isSavingRename} title="Save">
                                  {isSavingRename ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancelRename} disabled={isSavingRename} title="Cancel">
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <>
                                <span className="font-medium truncate block">
                                  {displayName || typeLabel + ' Invoice'}
                                </span>
                                {(invoice.invoice_number || invoiceDateLabel) && (
                                  <span className="text-xs text-muted-foreground">
                                    {invoice.invoice_number ? `#${invoice.invoice_number}` : ''}
                                    {invoice.invoice_number && invoiceDateLabel ? ' · ' : ''}
                                    {invoiceDateLabel || ''}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {!isRenaming && (
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="font-medium">{formatCurrency(invoice.invoice_amount)}</span>
                            {canEditInvoice && (
                              <Select
                                value={invoice.invoice_type}
                                onValueChange={(value) => updateInvoiceTypeMutation.mutate({
                                  invoiceId: invoice.id!,
                                  invoiceType: value as InvoiceData['invoice_type'],
                                })}
                                disabled={updateInvoiceTypeMutation.isPending}
                              >
                                <SelectTrigger className="h-7 w-[116px] text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="material">Material</SelectItem>
                                  <SelectItem value="labor">Labor</SelectItem>
                                  <SelectItem value="overhead">Overhead</SelectItem>
                                  <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
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
                            {!isVerified && canEditInvoice && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => verifyInvoiceMutation.mutate(invoice.id!)}
                                disabled={verifyInvoiceMutation.isPending}
                                title="Verify invoice"
                              >
                                {verifyInvoiceMutation.isPending ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                )}
                                Verify
                              </Button>
                            )}
                            {invoice.document_url && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-primary"
                                onClick={() => setPreviewInvoice({ url: invoice.document_url!, name: (invoice as any).document_name || invoice.vendor_name || 'Invoice' })}
                                title="Preview invoice"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canRenameInvoice && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-primary"
                                onClick={() => handleStartRename(invoice)}
                                title="Rename invoice"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canDeleteInvoice && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => handleDeleteInvoice(invoice.id!, invoice.invoice_type)}
                                disabled={deletingInvoiceId === invoice.id}
                                title="Delete invoice"
                              >
                                {deletingInvoiceId === invoice.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                  {hasOtherCharges && (
                    <div className="flex justify-between items-center py-1 text-muted-foreground">
                      <span>Other Charges</span>
                      <span className="text-red-600">-{formatCurrency(otherChargesTotal)}</span>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Gross Profit */}
                <div className="flex justify-between items-center py-2 bg-accent/30 rounded-md px-3 -mx-3">
                  <span className="font-medium">Gross Profit</span>
                  <span className={cn(
                    "font-semibold text-lg",
                    grossProfit >= 0 ? "text-green-600" : "text-red-600"
                  )}>
                    {formatCurrency(grossProfit)}
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

          {/* Change Orders Tab */}
          <TabsContent value="change_orders" className="mt-0">
            <ChangeOrdersTab pipelineEntryId={pipelineEntryId} projectId={projectId} />
          </TabsContent>

          {/* Payments Tab - Project only */}
          {isProject && (
            <TabsContent value="payments" className="mt-0">
              <PaymentsTab pipelineEntryId={pipelineEntryId} sellingPrice={sellingPrice} />
            </TabsContent>
          )}

          {/* Budget Tab - Project only */}
          {isProject && (
            <TabsContent value="budget" className="mt-0">
              <BudgetTracker projectId={projectId!} pipelineEntryId={pipelineEntryId} budgetItems={budgetItems || []} onRefresh={() => {
                queryClient.invalidateQueries({ queryKey: ['project-budget-items', projectId] });
              }} />
            </TabsContent>
          )}

        </Tabs>
      </CardContent>
    </Card>
    <InvoicePreviewDialog
      open={!!previewInvoice}
      onOpenChange={(o) => !o && setPreviewInvoice(null)}
      urlOrPath={previewInvoice?.url}
      title={previewInvoice?.name}
    />
    </>
  );
};

export default ProfitCenterPanel;
