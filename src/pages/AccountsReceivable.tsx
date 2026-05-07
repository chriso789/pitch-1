import React, { useState, useMemo } from 'react';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Loader2, DollarSign, Clock, CheckCircle, Package, Hammer, Filter,
  MoreVertical, FileText, CreditCard, Send, Eye, CheckSquare,
  ChevronDown, ChevronRight, TrendingUp, TrendingDown, AlertTriangle,
  BarChart3, ClipboardList, ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, differenceInDays, subDays, startOfMonth, startOfQuarter, startOfYear } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

type TimeFilter = 'all' | 'month' | '30days' | 'quarter' | 'year';

const TIME_FILTERS: { value: TimeFilter; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'month', label: 'This Month' },
  { value: '30days', label: 'Last 30 Days' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year', label: 'This Year' },
];

const POST_APPROVAL_KEYS = [
  'contracted', 'project', 'completed', 'closed', 'capped_out',
  'in_production', 'production', 'install_scheduled', 'inspection_scheduled',
];

function getFilterDate(filter: TimeFilter): Date | null {
  const now = new Date();
  switch (filter) {
    case 'month': return startOfMonth(now);
    case '30days': return subDays(now, 30);
    case 'quarter': return startOfQuarter(now);
    case 'year': return startOfYear(now);
    default: return null;
  }
}

interface WipProject {
  id: string;
  name: string;
  address: string;
  status: string;
  createdAt: string;
  contractValue: number;
  materialBudget: number;
  laborBudget: number;
  overheadBudget: number;
  totalPaid: number;
  totalInvoiced: number;
  balance: number;
  invoiceCount: number;
  hasInvoice: boolean;
  // WIP fields
  actualMaterialCost: number;
  actualLaborCost: number;
  totalCostIncurred: number;
  estimatedTotalCost: number;
  percentComplete: number;
  earnedRevenue: number;
  overUnderBilling: number;
  projectedProfit: number;
  projectedProfitPct: number;
  budgetVariance: number;
}

type SortField = 'age' | 'contract' | 'costIncurred' | 'billed' | 'balance' | 'percentComplete';
type SortDir = 'asc' | 'desc';

export default function AccountsReceivable() {
  const activeTenantId = useEffectiveTenantId();
  const navigate = useNavigate();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [expandedWip, setExpandedWip] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('age');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const { stages, isLoading: stagesLoading } = usePipelineStages();

  const arStatuses = useMemo(() => {
    const contractedStage = stages.find(s =>
      ['contracted', 'project'].includes(s.key) && !s.is_terminal
    );
    const threshold = contractedStage?.stage_order ?? 7;
    const dynamicKeys = stages
      .filter(s => s.stage_order >= threshold && s.is_active)
      .map(s => s.key);
    const merged = new Set([...dynamicKeys, ...POST_APPROVAL_KEYS]);
    return Array.from(merged);
  }, [stages]);

  // Fetch pipeline entries (include terminal like completed/closed)
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['ar-projects', activeTenantId, arStatuses],
    queryFn: async () => {
      if (arStatuses.length === 0) return [];
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select('id, lead_name, created_at, status, metadata, contacts!pipeline_entries_contact_id_fkey(first_name, last_name, address_street, address_city, address_state)')
        .eq('tenant_id', activeTenantId!)
        .eq('is_deleted', false)
        .in('status', arStatuses)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!activeTenantId && arStatuses.length > 0,
  });

  const { data: invoices } = useQuery({
    queryKey: ['ar-invoices', activeTenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_invoices')
        .select('id, pipeline_entry_id, invoice_number, amount, balance, status, due_date, created_at')
        .eq('tenant_id', activeTenantId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  const { data: payments } = useQuery({
    queryKey: ['ar-payments', activeTenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_payments')
        .select('pipeline_entry_id, amount')
        .eq('tenant_id', activeTenantId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  const projectIds = useMemo(() => (projects || []).map((p: any) => p.id), [projects]);

  const { data: estimates } = useQuery({
    queryKey: ['ar-estimates', activeTenantId, projectIds],
    queryFn: async () => {
      if (projectIds.length === 0) return [];
      const { data, error } = await (supabase
        .from('enhanced_estimates') as any)
        .select('id, pipeline_entry_id, selling_price, material_cost, labor_cost, overhead_amount, overhead_percent, contingency_percent, permit_costs, status')
        .in('pipeline_entry_id', projectIds);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!activeTenantId && projectIds.length > 0,
  });

  // Fetch labor cost tracking for WIP
  const { data: laborTracking } = useQuery({
    queryKey: ['ar-labor-tracking', activeTenantId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('labor_cost_tracking') as any)
        .select('project_id, actual_cost, actual_hours, budgeted_total, budgeted_hours')
        .eq('tenant_id', activeTenantId!);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!activeTenantId,
  });

  const now = new Date();
  const filterDate = getFilterDate(timeFilter);

  const wipProjects = useMemo<WipProject[]>(() => {
    if (!projects) return [];

    const estimateMap = new Map<string, any>();
    const groupedEstimates = new Map<string, any[]>();
    (estimates || []).forEach((e: any) => {
      const list = groupedEstimates.get(e.pipeline_entry_id) || [];
      list.push(e);
      groupedEstimates.set(e.pipeline_entry_id, list);
    });
    groupedEstimates.forEach((list, entryId) => {
      const project = (projects || []).find((p: any) => p.id === entryId);
      const selectedId = project?.metadata?.selected_estimate_id ?? project?.metadata?.enhanced_estimate_id;
      const picked = list.find((e: any) => e.id === selectedId)
        || list.sort((a: any, b: any) => Number(b.selling_price) - Number(a.selling_price))[0];
      if (picked) estimateMap.set(entryId, picked);
    });

    const paymentMap = new Map<string, number>();
    (payments || []).forEach(p => {
      paymentMap.set(p.pipeline_entry_id, (paymentMap.get(p.pipeline_entry_id) || 0) + Number(p.amount));
    });

    const invoiceMap = new Map<string, any[]>();
    (invoices || []).forEach(inv => {
      const list = invoiceMap.get(inv.pipeline_entry_id) || [];
      list.push(inv);
      invoiceMap.set(inv.pipeline_entry_id, list);
    });

    const laborMap = new Map<string, any>();
    (laborTracking || []).forEach((lt: any) => {
      laborMap.set(lt.project_id, lt);
    });

    let filtered = projects;
    if (filterDate) {
      filtered = projects.filter((p: any) => new Date(p.created_at) >= filterDate);
    }

    return filtered.map((project: any) => {
      const est = estimateMap.get(project.id);
      const contractValue = Number(est?.selling_price) || 0;
      const materialBudget = Number(est?.material_cost) || 0;
      const laborBudget = Number(est?.labor_cost) || 0;
      const overheadBudget = Number(est?.overhead_amount) || 0;
      const totalPaid = paymentMap.get(project.id) || 0;
      const projectInvoices = invoiceMap.get(project.id) || [];
      const totalInvoiced = projectInvoices.reduce((sum: number, inv: any) => sum + Number(inv.amount), 0);
      const balance = contractValue - totalPaid;

      // WIP calculations
      const labor = laborMap.get(project.id);
      const actualLaborCost = Number(labor?.actual_cost) || 0;
      // Approximate actual material cost from payments minus labor (simplified)
      const actualMaterialCost = Math.max(0, totalPaid > 0 ? Math.min(materialBudget, totalPaid * (materialBudget / (materialBudget + laborBudget || 1))) : 0);
      const totalCostIncurred = actualLaborCost + actualMaterialCost;
      const estimatedTotalCost = materialBudget + laborBudget + overheadBudget;

      // Percent complete (cost-to-cost method)
      const percentComplete = estimatedTotalCost > 0
        ? Math.min(1, totalCostIncurred / estimatedTotalCost)
        : (project.status === 'completed' || project.status === 'closed' ? 1 : 0);

      // Earned revenue = contract * % complete
      const earnedRevenue = contractValue * percentComplete;

      // Over/Under billing = total invoiced - earned revenue
      const overUnderBilling = totalInvoiced - earnedRevenue;

      // Projected profit
      const projectedProfit = contractValue - estimatedTotalCost;
      const projectedProfitPct = contractValue > 0 ? projectedProfit / contractValue : 0;
      const budgetVariance = estimatedTotalCost > 0 ? (totalCostIncurred - (estimatedTotalCost * percentComplete)) : 0;

      const contact = Array.isArray(project.contacts) ? project.contacts[0] : project.contacts;

      return {
        id: project.id,
        name: project.lead_name ||
          (contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : 'Unknown'),
        address: contact ? [contact.address_street, contact.address_city, contact.address_state].filter(Boolean).join(', ') : '',
        status: project.status,
        createdAt: project.created_at,
        contractValue,
        materialBudget,
        laborBudget,
        overheadBudget,
        totalPaid,
        totalInvoiced,
        balance,
        invoiceCount: projectInvoices.length,
        hasInvoice: projectInvoices.length > 0,
        actualMaterialCost,
        actualLaborCost,
        totalCostIncurred,
        estimatedTotalCost,
        percentComplete,
        earnedRevenue,
        overUnderBilling,
        projectedProfit,
        projectedProfitPct,
        budgetVariance,
      };
    });
  }, [projects, estimates, payments, invoices, laborTracking, filterDate]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'age' ? 'desc' : 'desc');
    }
  };

  const sortedWipProjects = useMemo(() => {
    const list = [...wipProjects];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (sortField) {
        case 'age': return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        case 'contract': return dir * (a.contractValue - b.contractValue);
        case 'costIncurred': return dir * (a.totalCostIncurred - b.totalCostIncurred);
        case 'billed': return dir * (a.totalInvoiced - b.totalInvoiced);
        case 'balance': return dir * (a.balance - b.balance);
        case 'percentComplete': return dir * (a.percentComplete - b.percentComplete);
        default: return 0;
      }
    });
    return list;
  }, [wipProjects, sortField, sortDir]);

  const arItems = useMemo(() => sortedWipProjects.filter(p => p.balance > 0), [sortedWipProjects]);

  const totals = useMemo(() => {
    let totalOutstanding = 0, totalMaterial = 0, totalLabor = 0, totalContract = 0,
      totalEarned = 0, totalCostIncurred = 0, totalOverUnder = 0;
    const buckets = { current: 0, days30: 0, days60: 0, days90: 0 };

    wipProjects.forEach(item => {
      totalContract += item.contractValue;
      totalMaterial += item.materialBudget;
      totalLabor += item.laborBudget;
      totalEarned += item.earnedRevenue;
      totalCostIncurred += item.totalCostIncurred;
      totalOverUnder += item.overUnderBilling;

      if (item.balance > 0) {
        totalOutstanding += item.balance;
        // Simple aging based on created_at
        const age = differenceInDays(now, new Date(item.createdAt));
        if (age <= 30) buckets.current += item.balance;
        else if (age <= 60) buckets.days30 += item.balance;
        else if (age <= 90) buckets.days60 += item.balance;
        else buckets.days90 += item.balance;
      }
    });

    return { totalOutstanding, totalMaterial, totalLabor, totalContract, totalEarned, totalCostIncurred, totalOverUnder, buckets };
  }, [wipProjects]);

  const toggleWip = (id: string) => {
    setExpandedWip(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (projectsLoading || stagesLoading) {
    return (
      <GlobalLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </GlobalLayout>
    );
  }

  const renderProjectActions = (item: WipProject) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => navigate(`/lead/${item.id}?tab=total`)}>
          <Eye className="h-4 w-4 mr-2" /> View Details
        </DropdownMenuItem>
        {!item.hasInvoice && (
          <DropdownMenuItem onClick={() => navigate(`/lead/${item.id}?tab=total&action=create-invoice`)}>
            <FileText className="h-4 w-4 mr-2" /> Create Invoice
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={async () => {
          try {
            const { data, error } = await supabase.functions.invoke('stripe-create-payment-link', {
              body: { pipeline_entry_id: item.id }
            });
            if (error) throw error;
            if (data?.url) {
              navigator.clipboard.writeText(data.url);
              toast.success('Payment link copied to clipboard');
            } else {
              toast.error(data?.error || 'Could not generate payment link');
            }
          } catch (e: any) {
            toast.error(e.message || 'Failed to create payment link');
          }
        }}>
          <CreditCard className="h-4 w-4 mr-2" /> Send Payment Link
        </DropdownMenuItem>
        <DropdownMenuItem onClick={async () => {
          try {
            const { data, error } = await supabase.functions.invoke('zelle-payment-page', {
              body: { pipeline_entry_id: item.id }
            });
            if (error) throw error;
            if (data?.url) {
              navigator.clipboard.writeText(data.url);
              toast.success('Zelle link copied to clipboard');
            } else {
              toast.error(data?.error || 'Could not generate Zelle link');
            }
          } catch (e: any) {
            toast.error(e.message || 'Failed to create Zelle link');
          }
        }}>
          <Send className="h-4 w-4 mr-2" /> Send Zelle Info
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={async () => {
          try {
            const amount = parseFloat(prompt(`Record payment for ${item.name}\nBalance: ${fmt(item.balance)}\n\nEnter amount:`) || '');
            if (!amount || isNaN(amount) || amount <= 0) return;
            const { error } = await (supabase.from('project_payments') as any).insert({
              tenant_id: activeTenantId!,
              pipeline_entry_id: item.id,
              amount,
              payment_method: 'manual',
              payment_date: new Date().toISOString(),
              notes: 'Manually recorded from AR dashboard',
            });
            if (error) throw error;
            toast.success(`Payment of ${fmt(amount)} recorded`);
          } catch (e: any) {
            toast.error(e.message || 'Failed to record payment');
          }
        }}>
          <CheckSquare className="h-4 w-4 mr-2" /> Mark Paid
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderWipDetail = (item: WipProject) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/20 rounded-lg border border-border/50 mt-2">
      {/* Budget */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Budget</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Contract</span><span className="font-medium">{fmt(item.contractValue)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Material</span><span>{fmt(item.materialBudget)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Labor</span><span>{fmt(item.laborBudget)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Overhead</span><span>{fmt(item.overheadBudget)}</span></div>
          <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">Est. Total Cost</span><span className="font-semibold">{fmt(item.estimatedTotalCost)}</span></div>
        </div>
      </div>

      {/* Costs Incurred */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Costs Incurred</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Labor Actual</span><span>{fmt(item.actualLaborCost)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Material Actual</span><span>{fmt(item.actualMaterialCost)}</span></div>
          <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">Total Incurred</span><span className="font-semibold">{fmt(item.totalCostIncurred)}</span></div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Variance</span>
            <span className={cn('font-medium', item.budgetVariance > 0 ? 'text-destructive' : 'text-green-600')}>
              {item.budgetVariance > 0 ? '+' : ''}{fmt(item.budgetVariance)}
            </span>
          </div>
        </div>
      </div>

      {/* Billings */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Billings</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Total Invoiced</span><span>{fmt(item.totalInvoiced)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Total Paid</span><span>{fmt(item.totalPaid)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Outstanding</span><span className="font-semibold">{fmt(item.balance)}</span></div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Over/Under</span>
            <span className={cn('font-medium', item.overUnderBilling > 0 ? 'text-yellow-600' : item.overUnderBilling < 0 ? 'text-blue-600' : '')}>
              {item.overUnderBilling > 0 ? 'Over ' : item.overUnderBilling < 0 ? 'Under ' : ''}{fmt(Math.abs(item.overUnderBilling))}
            </span>
          </div>
        </div>
      </div>

      {/* Completion & Profit */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Progress</p>
        <div className="space-y-2">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">% Complete</span>
              <span className="font-semibold">{pct(item.percentComplete)}</span>
            </div>
            <Progress value={item.percentComplete * 100} className="h-2" />
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Earned Revenue</span><span>{fmt(item.earnedRevenue)}</span></div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Proj. Profit</span>
              <span className={cn('font-bold', item.projectedProfit >= 0 ? 'text-green-600' : 'text-destructive')}>
                {fmt(item.projectedProfit)} ({pct(item.projectedProfitPct)})
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      project: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
      contracted: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
      in_production: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
      production: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
      completed: 'bg-green-500/10 text-green-600 border-green-500/30',
      closed: 'bg-muted text-muted-foreground border-border',
    };
    return (
      <Badge variant="outline" className={cn('text-xs capitalize', colors[status] || '')}>
        {status.replace(/_/g, ' ')}
      </Badge>
    );
  };

  return (
    <GlobalLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Accounts Receivable & WIP</h1>
            <p className="text-muted-foreground">Track outstanding balances, project costs, and work-in-progress across all converted jobs</p>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={timeFilter} onValueChange={(v) => setTimeFilter(v as TimeFilter)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_FILTERS.map(f => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Total Contract Value</p>
              </div>
              <p className="text-xl font-bold">{fmt(totals.totalContract)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Total Outstanding</p>
              </div>
              <p className="text-xl font-bold text-destructive">{fmt(totals.totalOutstanding)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Revenue Earned</p>
              </div>
              <p className="text-xl font-bold text-green-600">{fmt(totals.totalEarned)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                {totals.totalOverUnder > 0 ? <TrendingUp className="h-4 w-4 text-yellow-600" /> : <TrendingDown className="h-4 w-4 text-blue-600" />}
                <p className="text-xs text-muted-foreground">Net Over/Under Billing</p>
              </div>
              <p className={cn('text-xl font-bold', totals.totalOverUnder > 0 ? 'text-yellow-600' : 'text-blue-600')}>
                {totals.totalOverUnder > 0 ? '+' : ''}{fmt(totals.totalOverUnder)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Aging Buckets */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Current</p><p className="text-lg font-bold text-green-600">{fmt(totals.buckets.current)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">1-30 Days</p><p className="text-lg font-bold text-yellow-600">{fmt(totals.buckets.days30)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">31-60 Days</p><p className="text-lg font-bold text-orange-600">{fmt(totals.buckets.days60)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">90+ Days</p><p className="text-lg font-bold text-destructive">{fmt(totals.buckets.days90)}</p></CardContent></Card>
        </div>

        <Tabs defaultValue="all" className="w-full">
          <TabsList>
            <TabsTrigger value="all" className="gap-1.5">
              <ClipboardList className="h-4 w-4" />
              All Projects ({wipProjects.length})
            </TabsTrigger>
            <TabsTrigger value="outstanding" className="gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              Outstanding ({arItems.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>WIP Report — All Converted Projects</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Sorted by {sortField === 'age' ? 'date' : sortField === 'costIncurred' ? 'cost incurred' : sortField === 'percentComplete' ? '% complete' : sortField} · {sortField === 'age' ? (sortDir === 'asc' ? 'oldest first' : 'newest first') : (sortDir === 'desc' ? 'high → low' : 'low → high')}
                </p>
              </CardHeader>
              <CardContent>
                {wipProjects.length === 0 ? (
                  <div className="text-center py-8">
                    <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No converted projects found</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {/* Sortable Header */}
                    <div className="hidden md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr_80px_40px] gap-2 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b">
                      {([
                        { field: 'age' as SortField, label: 'Project', align: 'text-left' },
                        { field: 'contract' as SortField, label: 'Contract', align: 'text-right' },
                        { field: 'costIncurred' as SortField, label: 'Cost Incurred', align: 'text-right' },
                        { field: 'billed' as SortField, label: 'Billed', align: 'text-right' },
                        { field: 'balance' as SortField, label: 'Balance', align: 'text-right' },
                        { field: 'percentComplete' as SortField, label: '% Done', align: 'text-center' },
                      ]).map(col => (
                        <button
                          key={col.field}
                          onClick={() => toggleSort(col.field)}
                          className={cn('flex items-center gap-1 hover:text-foreground transition-colors', col.align, col.align === 'text-right' ? 'justify-end' : col.align === 'text-center' ? 'justify-center' : 'justify-start')}
                        >
                          {col.label}
                          {sortField === col.field ? (
                            sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </button>
                      ))}
                      <span></span>
                    </div>
                    {sortedWipProjects.map(item => (
                      <Collapsible key={item.id} open={expandedWip.has(item.id)} onOpenChange={() => toggleWip(item.id)}>
                        <div className="flex items-center justify-between p-4 hover:bg-muted/30 rounded-lg transition-colors">
                          <CollapsibleTrigger asChild>
                            <div className="hidden md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr_80px_40px] gap-2 items-center flex-1 cursor-pointer">
                              <div className="flex items-center gap-2">
                                {expandedWip.has(item.id) ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                                <div>
                                  <p className="text-sm font-medium">{item.name}</p>
                                  <p className="text-xs text-muted-foreground">{item.address}</p>
                                </div>
                                {statusBadge(item.status)}
                              </div>
                              <p className="text-sm text-right font-medium">{fmt(item.contractValue)}</p>
                              <p className="text-sm text-right">{fmt(item.totalCostIncurred)}</p>
                              <p className="text-sm text-right">{fmt(item.totalInvoiced)}</p>
                              <p className={cn('text-sm text-right font-semibold', item.balance > 0 ? 'text-destructive' : 'text-green-600')}>{fmt(item.balance)}</p>
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-xs font-medium">{pct(item.percentComplete)}</span>
                                <Progress value={item.percentComplete * 100} className="h-1.5 w-16" />
                              </div>
                              <span></span>
                            </div>
                          </CollapsibleTrigger>
                          {/* Mobile view */}
                          <CollapsibleTrigger asChild>
                            <div className="md:hidden flex-1 cursor-pointer">
                              <div className="flex items-center gap-2">
                                {expandedWip.has(item.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                <div>
                                  <p className="text-sm font-medium">{item.name}</p>
                                  <p className="text-xs text-muted-foreground">{fmt(item.contractValue)} · {pct(item.percentComplete)} complete</p>
                                </div>
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          {renderProjectActions(item)}
                        </div>
                        <CollapsibleContent>
                          {renderWipDetail(item)}
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="outstanding">
            <Card>
              <CardHeader>
                <CardTitle>Outstanding Balances ({arItems.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {arItems.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                    <p className="text-muted-foreground">No outstanding balances — all caught up!</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {arItems.map(item => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="cursor-pointer flex-1" onClick={() => navigate(`/lead/${item.id}?tab=total`)}>
                          <p className="text-sm font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.address && `${item.address} · `}
                            Contract: {fmt(item.contractValue)} · Paid: {fmt(item.totalPaid)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-sm font-bold">{fmt(item.balance)}</p>
                            <p className="text-xs text-muted-foreground">balance</p>
                          </div>
                          {!item.hasInvoice && (
                            <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
                              No Invoice
                            </Badge>
                          )}
                          {renderProjectActions(item)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </GlobalLayout>
  );
}
