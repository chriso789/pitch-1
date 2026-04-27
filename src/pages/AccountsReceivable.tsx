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
import { Loader2, DollarSign, Clock, CheckCircle, Package, Hammer, Filter, MoreVertical, FileText, CreditCard, Send, Eye, CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, differenceInDays, subDays, startOfMonth, startOfQuarter, startOfYear } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

type TimeFilter = 'all' | 'month' | '30days' | 'quarter' | 'year';

const TIME_FILTERS: { value: TimeFilter; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'month', label: 'This Month' },
  { value: '30days', label: 'Last 30 Days' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year', label: 'This Year' },
];

// Known post-approval stage keys as a fallback hint
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

export default function AccountsReceivable() {
  const activeTenantId = useEffectiveTenantId();
  const navigate = useNavigate();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const { stages, isLoading: stagesLoading } = usePipelineStages();

  // Dynamically compute AR-eligible statuses from the tenant's pipeline stages
  const arStatuses = useMemo(() => {
    // Find the first post-approval stage (contracted or project)
    const contractedStage = stages.find(s =>
      ['contracted', 'project'].includes(s.key) && !s.is_terminal
    );
    const threshold = contractedStage?.stage_order ?? 7;

    const dynamicKeys = stages
      .filter(s => s.stage_order >= threshold && s.is_active && !s.is_terminal)
      .map(s => s.key);

    // Merge with known post-approval keys for safety
    const merged = new Set([...dynamicKeys, ...POST_APPROVAL_KEYS]);
    return Array.from(merged);
  }, [stages]);

  // Fetch receivable-stage pipeline entries
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

  // Fetch invoices for all projects
  const { data: invoices } = useQuery({
    queryKey: ['ar-invoices', activeTenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_invoices')
        .select('id, pipeline_entry_id, invoice_number, amount, balance, status, due_date, created_at')
        .eq('tenant_id', activeTenantId!)
        .in('status', ['draft', 'sent', 'partial']);
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  // Fetch payments
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

  // Fetch estimates by pipeline_entry_id (not metadata — metadata keys are often missing)
  const projectIds = useMemo(() => (projects || []).map((p: any) => p.id), [projects]);

  const { data: estimates } = useQuery({
    queryKey: ['ar-estimates', activeTenantId, projectIds],
    queryFn: async () => {
      if (projectIds.length === 0) return [];
      const { data, error } = await (supabase
        .from('enhanced_estimates') as any)
        .select('id, pipeline_entry_id, selling_price, material_cost, labor_cost')
        .in('pipeline_entry_id', projectIds);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!activeTenantId && projectIds.length > 0,
  });

  const now = new Date();
  const filterDate = getFilterDate(timeFilter);

  const arData = useMemo(() => {
    if (!projects) return { items: [], totalOutstanding: 0, totalMaterial: 0, totalLabor: 0, buckets: { current: 0, days30: 0, days60: 0, days90: 0 } };

    // Group estimates by pipeline_entry_id, then pick the selected one or highest-priced
    const estimateMap = new Map<string, { selling_price: number; material_cost: number; labor_cost: number }>();
    const groupedEstimates = new Map<string, any[]>();
    (estimates || []).forEach(e => {
      const list = groupedEstimates.get(e.pipeline_entry_id) || [];
      list.push(e);
      groupedEstimates.set(e.pipeline_entry_id, list);
    });
    groupedEstimates.forEach((list, entryId) => {
      const project = (projects || []).find((p: any) => p.id === entryId);
      const selectedId = project?.metadata?.selected_estimate_id ?? project?.metadata?.enhanced_estimate_id;
      const picked = list.find(e => e.id === selectedId)
        || list.sort((a, b) => Number(b.selling_price) - Number(a.selling_price))[0];
      if (picked) {
        estimateMap.set(entryId, {
          selling_price: Number(picked.selling_price) || 0,
          material_cost: Number(picked.material_cost) || 0,
          labor_cost: Number(picked.labor_cost) || 0,
        });
      }
    });

    const paymentMap = new Map<string, number>();
    (payments || []).forEach(p => {
      paymentMap.set(p.pipeline_entry_id, (paymentMap.get(p.pipeline_entry_id) || 0) + Number(p.amount));
    });

    const invoiceMap = new Map<string, typeof invoices>();
    (invoices || []).forEach(inv => {
      const list = invoiceMap.get(inv.pipeline_entry_id) || [];
      list.push(inv);
      invoiceMap.set(inv.pipeline_entry_id, list);
    });

    let filtered = projects;
    if (filterDate) {
      filtered = projects.filter(p => new Date(p.created_at) >= filterDate);
    }

    let totalOutstanding = 0;
    let totalMaterial = 0;
    let totalLabor = 0;
    const buckets = { current: 0, days30: 0, days60: 0, days90: 0 };

    const items = filtered.map(project => {
      const est = estimateMap.get(project.id);
      const contractValue = est?.selling_price || 0;
      const totalPaid = paymentMap.get(project.id) || 0;
      const projectInvoices = invoiceMap.get(project.id) || [];
      const balance = contractValue - totalPaid;

      totalMaterial += est?.material_cost || 0;
      totalLabor += est?.labor_cost || 0;

      if (balance > 0) {
        totalOutstanding += balance;
        // Aging: use earliest unpaid invoice due_date, or project created_at
        const oldestDue = projectInvoices
          .filter(i => Number(i.balance) > 0 && i.due_date)
          .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())[0];

        const age = oldestDue?.due_date ? differenceInDays(now, new Date(oldestDue.due_date)) : 0;
        if (age <= 0) buckets.current += balance;
        else if (age <= 30) buckets.days30 += balance;
        else if (age <= 60) buckets.days60 += balance;
        else buckets.days90 += balance;
      }

      const contact = Array.isArray(project.contacts) ? project.contacts[0] : project.contacts;
      return {
        id: project.id,
        name: project.lead_name || 
          (contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : 'Unknown'),
        address: contact ? [contact.address_street, contact.address_city, contact.address_state].filter(Boolean).join(', ') : '',
        contractValue,
        totalPaid,
        balance,
        invoiceCount: projectInvoices.length,
        hasInvoice: projectInvoices.length > 0,
      };
    }).filter(p => p.balance > 0)
      .sort((a, b) => b.balance - a.balance);

    return { items, totalOutstanding, totalMaterial, totalLabor, buckets };
  }, [projects, estimates, payments, invoices, filterDate]);

  if (projectsLoading || stagesLoading) {
    return (
      <GlobalLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Accounts Receivable</h1>
            <p className="text-muted-foreground">Track outstanding balances, costs, and payments across all projects</p>
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

        {/* Summary Cards - Row 1: Totals */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Outstanding</p>
              <p className="text-xl font-bold">{fmt(arData.totalOutstanding)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Material Cost</p>
              <p className="text-xl font-bold text-blue-600">{fmt(arData.totalMaterial)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Labor Cost</p>
              <p className="text-xl font-bold text-orange-600">{fmt(arData.totalLabor)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Summary Cards - Row 2: Aging Buckets */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Current</p>
              <p className="text-xl font-bold text-green-600">{fmt(arData.buckets.current)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">1-30 Days</p>
              <p className="text-xl font-bold text-yellow-600">{fmt(arData.buckets.days30)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">31-60 Days</p>
              <p className="text-xl font-bold text-orange-600">{fmt(arData.buckets.days60)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">90+ Days</p>
              <p className="text-xl font-bold text-red-600">{fmt(arData.buckets.days90)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Project List */}
        <Card>
          <CardHeader>
            <CardTitle>Outstanding Projects ({arData.items.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {arData.items.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                <p className="text-muted-foreground">No outstanding balances — all caught up!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {arData.items.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="cursor-pointer flex-1" onClick={() => navigate(`/lead/${item.id}?tab=total`)}>
                      <p className="text-sm font-medium">{item.name || 'Unknown'}</p>
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
                                method: 'manual',
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
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
}
