import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus,
  FileEdit,
  Package,
  Wrench,
  Receipt,
  DollarSign,
  Loader2,
  Trash2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { InvoiceUploadCard } from '@/components/production/InvoiceUploadCard';
import { format } from 'date-fns';

interface ChangeOrdersTabProps {
  pipelineEntryId: string;
  projectId?: string;
}

interface ChangeOrder {
  id: string;
  co_number: string;
  title: string;
  description: string | null;
  reason: string | null;
  cost_impact: number | null;
  status: string;
  created_at: string;
  project_id: string | null;
}

interface COInvoice {
  id: string;
  change_order_id: string;
  invoice_type: 'material' | 'labor' | 'overhead';
  vendor_name: string | null;
  crew_name: string | null;
  invoice_number: string | null;
  invoice_amount: number;
  invoice_date: string | null;
  status: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n || 0);

export const ChangeOrdersTab: React.FC<ChangeOrdersTabProps> = ({
  pipelineEntryId,
  projectId,
}) => {
  const { activeTenantId } = useActiveTenantId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: '',
    reason: '',
    description: '',
    cost_impact: '0',
  });

  const { data: resolvedProjectId } = useQuery({
    queryKey: ['co-resolve-project', pipelineEntryId, projectId],
    queryFn: async () => {
      if (projectId) return projectId;
      const { data } = await supabase
        .from('projects')
        .select('id')
        .eq('pipeline_entry_id', pipelineEntryId)
        .maybeSingle();
      return data?.id || null;
    },
    enabled: !!pipelineEntryId,
  });

  const effectiveProjectId = projectId || resolvedProjectId || null;

  const { data: changeOrders, isLoading } = useQuery({
    queryKey: ['change-orders', effectiveProjectId, pipelineEntryId],
    queryFn: async () => {
      if (!effectiveProjectId) return [] as ChangeOrder[];
      const { data, error } = await (supabase as any)
        .from('change_orders')
        .select('*')
        .eq('project_id', effectiveProjectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ChangeOrder[];
    },
    enabled: !!effectiveProjectId,
  });

  const coIds = useMemo(() => (changeOrders || []).map((c) => c.id), [changeOrders]);
  const { data: coInvoices } = useQuery({
    queryKey: ['co-invoices', coIds],
    queryFn: async () => {
      if (coIds.length === 0) return [] as COInvoice[];
      const { data, error } = await supabase
        .from('project_cost_invoices' as any)
        .select(
          'id, change_order_id, invoice_type, vendor_name, crew_name, invoice_number, invoice_amount, invoice_date, status'
        )
        .in('change_order_id', coIds);
      if (error) throw error;
      return (data || []) as COInvoice[];
    },
    enabled: coIds.length > 0,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['change-orders'] });
    queryClient.invalidateQueries({ queryKey: ['co-invoices'] });
  };

  const handleCreate = async () => {
    if (!form.title.trim()) {
      toast({ title: 'Title required', variant: 'destructive' });
      return;
    }
    if (!effectiveProjectId) {
      toast({
        title: 'No project',
        description:
          'Change orders require a project. Convert this lead to a project first.',
        variant: 'destructive',
      });
      return;
    }
    setSubmitting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const co_number = `CO-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await (supabase as any).from('change_orders').insert({
        tenant_id: activeTenantId,
        project_id: effectiveProjectId,
        co_number,
        title: form.title,
        description: form.description || null,
        reason: form.reason || null,
        cost_impact: parseFloat(form.cost_impact || '0'),
        requested_by: user?.id,
        status: 'draft',
      });
      if (error) throw error;
      toast({ title: 'Change order created' });
      setCreateOpen(false);
      setForm({ title: '', reason: '', description: '', cost_impact: '0' });
      refresh();
    } catch (e: any) {
      toast({
        title: 'Error creating change order',
        description: e.message,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this change order? Linked invoices will remain but be unlinked.')) return;
    const { error } = await (supabase as any)
      .from('change_orders')
      .delete()
      .eq('id', id);
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Change order deleted' });
    refresh();
  };

  const totalsFor = (coId: string) => {
    const inv = (coInvoices || []).filter((i) => i.change_order_id === coId);
    const material = inv.filter((i) => i.invoice_type === 'material').reduce((s, i) => s + Number(i.invoice_amount), 0);
    const labor = inv.filter((i) => i.invoice_type === 'labor').reduce((s, i) => s + Number(i.invoice_amount), 0);
    const overhead = inv.filter((i) => i.invoice_type === 'overhead').reduce((s, i) => s + Number(i.invoice_amount), 0);
    return { material, labor, overhead, total: material + labor + overhead };
  };

  if (!effectiveProjectId) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-2">
          <FileEdit className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Change orders are available once this lead is converted to a project.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Change Orders</h3>
          <p className="text-xs text-muted-foreground">
            Track scope, budget, materials &amp; labor outside the original estimate.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New Change Order
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (changeOrders || []).length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No change orders yet. Create one to track additional work outside the
            original estimate.
          </CardContent>
        </Card>
      ) : (
        <Accordion type="single" collapsible className="space-y-2">
          {(changeOrders || []).map((co) => {
            const t = totalsFor(co.id);
            const budget = Number(co.cost_impact || 0);
            const variance = budget - t.total;
            return (
              <AccordionItem
                key={co.id}
                value={co.id}
                className="border rounded-md bg-card"
              >
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex flex-1 items-center justify-between gap-2 pr-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileEdit className="h-4 w-4 text-primary flex-shrink-0" />
                      <div className="min-w-0 text-left">
                        <div className="font-medium truncate text-sm">
                          {co.co_number} — {co.title}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(co.created_at), 'MMM d, yyyy')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <Badge variant="outline" className="text-xs capitalize">
                        {co.status}
                      </Badge>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Budget</div>
                        <div className="text-sm font-semibold">{fmt(budget)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Spent</div>
                        <div className="text-sm font-semibold">{fmt(t.total)}</div>
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <SummaryTile label="Budget" value={fmt(budget)} icon={<DollarSign className="h-3 w-3" />} />
                    <SummaryTile label="Materials" value={fmt(t.material)} icon={<Package className="h-3 w-3" />} />
                    <SummaryTile label="Labor" value={fmt(t.labor)} icon={<Wrench className="h-3 w-3" />} />
                    <SummaryTile label="Overhead" value={fmt(t.overhead)} icon={<Receipt className="h-3 w-3" />} />
                    <SummaryTile
                      label="Variance"
                      value={fmt(variance)}
                      valueClass={variance >= 0 ? 'text-green-600' : 'text-red-600'}
                    />
                  </div>

                  {co.reason && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Reason:</span>{' '}
                      {co.reason}
                    </p>
                  )}

                  <Tabs defaultValue="material" className="w-full">
                    <TabsList className="grid grid-cols-3 w-full">
                      <TabsTrigger value="material" className="text-xs">
                        <Package className="h-3 w-3 mr-1" /> Materials
                      </TabsTrigger>
                      <TabsTrigger value="labor" className="text-xs">
                        <Wrench className="h-3 w-3 mr-1" /> Labor
                      </TabsTrigger>
                      <TabsTrigger value="overhead" className="text-xs">
                        <Receipt className="h-3 w-3 mr-1" /> Overhead
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="material" className="mt-3">
                      <InvoiceUploadCard
                        projectId={effectiveProjectId}
                        pipelineEntryId={pipelineEntryId}
                        changeOrderId={co.id}
                        invoiceType="material"
                        onSuccess={refresh}
                      />
                    </TabsContent>
                    <TabsContent value="labor" className="mt-3">
                      <InvoiceUploadCard
                        projectId={effectiveProjectId}
                        pipelineEntryId={pipelineEntryId}
                        changeOrderId={co.id}
                        invoiceType="labor"
                        onSuccess={refresh}
                      />
                    </TabsContent>
                    <TabsContent value="overhead" className="mt-3">
                      <InvoiceUploadCard
                        projectId={effectiveProjectId}
                        pipelineEntryId={pipelineEntryId}
                        changeOrderId={co.id}
                        invoiceType="overhead"
                        onSuccess={refresh}
                      />
                    </TabsContent>
                  </Tabs>

                  {(coInvoices || []).filter((i) => i.change_order_id === co.id).length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">
                        Recorded invoices
                      </div>
                      <div className="border rounded-md divide-y">
                        {(coInvoices || [])
                          .filter((i) => i.change_order_id === co.id)
                          .map((i) => (
                            <div
                              key={i.id}
                              className="flex items-center justify-between px-3 py-2 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="capitalize">
                                  {i.invoice_type}
                                </Badge>
                                <span>
                                  {i.vendor_name || i.crew_name || '—'}{' '}
                                  {i.invoice_number ? `· #${i.invoice_number}` : ''}
                                </span>
                              </div>
                              <span className="font-medium">{fmt(Number(i.invoice_amount))}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => handleDelete(co.id)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete CO
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Change Order</DialogTitle>
            <DialogDescription>
              Track additional scope, budget, and invoices outside the original
              estimate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Add skylights to north slope"
              />
            </div>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Why is this change needed?"
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <Label>Budget (Cost Impact $)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.cost_impact}
                onChange={(e) => setForm({ ...form, cost_impact: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Additional details..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

interface SummaryTileProps {
  label: string;
  value: string;
  icon?: React.ReactNode;
  valueClass?: string;
}

const SummaryTile: React.FC<SummaryTileProps> = ({ label, value, icon, valueClass }) => (
  <div className="border rounded-md p-2 bg-muted/40">
    <div className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground tracking-wide">
      {icon}
      {label}
    </div>
    <div className={`text-sm font-semibold ${valueClass || ''}`}>{value}</div>
  </div>
);

export default ChangeOrdersTab;
