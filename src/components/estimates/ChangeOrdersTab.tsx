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
  Eye,
  Pencil,
  CheckCircle2,
  Download,
  FileText,
  Send,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { InvoiceUploadCard } from '@/components/production/InvoiceUploadCard';
import { ChangeOrderForm } from '@/features/change-orders/components/ChangeOrderForm';
import { ChangeOrderDocumentView, ChangeOrderRecord } from '@/components/change-orders/ChangeOrderDocumentView';
import { saveChangeOrderPdfToDocuments } from '@/components/change-orders/saveChangeOrderPdf';
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
  original_scope?: string | null;
  new_scope?: string | null;
  time_impact_days?: number | null;
  line_items?: any[] | null;
  material_total?: number | null;
  labor_total?: number | null;
  customer_approved?: boolean | null;
  document_id?: string | null;
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
  const [viewCO, setViewCO] = useState<ChangeOrder | null>(null);
  const [editCO, setEditCO] = useState<ChangeOrder | null>(null);
  const [pendingPdfCO, setPendingPdfCO] = useState<ChangeOrder | null>(null);
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
      return (data || []) as unknown as COInvoice[];
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
      const { data: inserted, error } = await (supabase as any)
        .from('change_orders')
        .insert({
          tenant_id: activeTenantId,
          project_id: effectiveProjectId,
          co_number,
          title: form.title,
          description: form.description || null,
          reason: form.reason || null,
          cost_impact: parseFloat(form.cost_impact || '0'),
          requested_by: user?.id,
          status: 'draft',
        })
        .select('*')
        .single();
      if (error) throw error;
      toast({ title: 'Change order created' });
      setCreateOpen(false);
      setForm({ title: '', reason: '', description: '', cost_impact: '0' });
      refresh();
      // Trigger off-screen render + PDF capture so it appears in Documents tab
      if (inserted) setPendingPdfCO(inserted as ChangeOrder);
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

  const handleApprove = async (co: ChangeOrder) => {
    if (!confirm(`Add ${fmt(Number(co.cost_impact || 0))} to the project budget and contract value?`)) return;
    const { error } = await (supabase as any)
      .from('change_orders')
      .update({
        status: 'approved',
        customer_approved: true,
        customer_approved_at: new Date().toISOString(),
        approved_date: new Date().toISOString(),
      })
      .eq('id', co.id);
    if (error) {
      toast({ title: 'Approval failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Change order approved',
      description: 'Cost impact added to project budget and contract value.',
    });
    refresh();
  };

  const handlePushToInvoice = async (co: ChangeOrder) => {
    const amount = Number(co.cost_impact || 0);
    if (amount <= 0) {
      toast({ title: 'Cost impact is $0', description: 'Set a cost impact before invoicing.', variant: 'destructive' });
      return;
    }
    if (!confirm(`Push ${fmt(amount)} to the contract and create a customer invoice?`)) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Bump project contract value
      const { data: proj } = await (supabase as any)
        .from('projects')
        .select('contract_value')
        .eq('id', co.project_id)
        .maybeSingle();
      const newContract = Number(proj?.contract_value || 0) + amount;
      await (supabase as any)
        .from('projects')
        .update({ contract_value: newContract })
        .eq('id', co.project_id);

      // 2. Create a customer invoice for this CO
      const { count } = await (supabase as any)
        .from('project_invoices')
        .select('id', { count: 'exact', head: true })
        .eq('pipeline_entry_id', pipelineEntryId);
      const invoiceNumber = `INV-${pipelineEntryId.slice(0, 6).toUpperCase()}-${String((count || 0) + 1).padStart(3, '0')}`;
      const lineItems = [{
        id: co.id,
        description: `${co.co_number} — ${co.title}`,
        quantity: 1,
        unit_price: amount,
        line_total: amount,
      }];
      const { error: invErr } = await (supabase as any).from('project_invoices').insert({
        tenant_id: activeTenantId,
        pipeline_entry_id: pipelineEntryId,
        invoice_number: invoiceNumber,
        amount,
        balance: amount,
        status: 'draft',
        notes: `Change Order ${co.co_number}: ${co.title}`,
        created_by: user.id,
        line_items: lineItems as any,
      });
      if (invErr) throw invErr;

      // 3. Mark CO as invoiced + approved
      await (supabase as any)
        .from('change_orders')
        .update({
          status: 'invoiced',
          customer_approved: true,
          customer_approved_at: new Date().toISOString(),
          approved_date: new Date().toISOString(),
        })
        .eq('id', co.id);

      toast({
        title: 'Pushed to contract',
        description: `Contract value updated and invoice ${invoiceNumber} created.`,
      });
      refresh();
      queryClient.invalidateQueries({ queryKey: ['project-invoices'] });
    } catch (e: any) {
      toast({ title: 'Push failed', description: e.message, variant: 'destructive' });
    }
  };
  // into the Documents tab. We capture, save, then unmount.
  React.useEffect(() => {
    if (!pendingPdfCO || !activeTenantId) return;
    const t = setTimeout(async () => {
      try {
        await saveChangeOrderPdfToDocuments({
          domId: `co-doc-capture-${pendingPdfCO.id}`,
          changeOrderId: pendingPdfCO.id,
          coNumber: pendingPdfCO.co_number,
          title: pendingPdfCO.title,
          reason: pendingPdfCO.reason,
          pipelineEntryId,
          tenantId: activeTenantId,
          existingDocumentId: pendingPdfCO.document_id,
        });
        toast({ title: 'Document added', description: 'Change order PDF saved to Documents tab.' });
      } catch (e) {
        console.warn('CO PDF capture failed', e);
      } finally {
        setPendingPdfCO(null);
      }
    }, 600); // let fonts/images settle
    return () => clearTimeout(t);
  }, [pendingPdfCO, activeTenantId, pipelineEntryId, toast]);

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

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t">
                    <Button variant="outline" size="sm" onClick={() => setViewCO(co)}>
                      <Eye className="h-3 w-3 mr-1" /> View Document
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditCO(co)}>
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    {!co.customer_approved && (
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => handleApprove(co)}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Add to Project Budget
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => handleDelete(co.id)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {createOpen && effectiveProjectId && (
        <ChangeOrderForm
          defaultProjectId={effectiveProjectId}
          onClose={() => setCreateOpen(false)}
          onSuccess={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      )}

      <EditChangeOrderDialog
        co={editCO}
        onClose={() => setEditCO(null)}
        onSaved={(updated) => {
          setEditCO(null);
          refresh();
          setPendingPdfCO(updated);
        }}
      />

      {/* Branded document viewer */}
      <Dialog open={!!viewCO} onOpenChange={(o) => !o && setViewCO(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {viewCO?.co_number} — {viewCO?.title}
            </DialogTitle>
          </DialogHeader>
          {viewCO && (
            <>
              <ChangeOrderDocumentView
                changeOrder={viewCO as any}
                pipelineEntryId={pipelineEntryId}
                domId={`co-doc-view-${viewCO.id}`}
              />
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (!viewCO || !activeTenantId) return;
                    await saveChangeOrderPdfToDocuments({
                      domId: `co-doc-view-${viewCO.id}`,
                      changeOrderId: viewCO.id,
                      coNumber: viewCO.co_number,
                      title: viewCO.title,
                      reason: viewCO.reason,
                      pipelineEntryId,
                      tenantId: activeTenantId,
                      existingDocumentId: viewCO.document_id,
                    });
                    toast({ title: 'Saved to Documents tab' });
                  }}
                >
                  <Download className="h-4 w-4 mr-1" /> Re-save PDF
                </Button>
                <Button variant="outline" onClick={() => window.print()}>
                  Print
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Off-screen capture surface for the auto-PDF after create/edit */}
      {pendingPdfCO && (
        <div
          style={{
            position: 'fixed',
            left: -10000,
            top: 0,
            width: '8.5in',
            pointerEvents: 'none',
            opacity: 0,
          }}
          aria-hidden
        >
          <ChangeOrderDocumentView
            changeOrder={pendingPdfCO as any}
            pipelineEntryId={pipelineEntryId}
            domId={`co-doc-capture-${pendingPdfCO.id}`}
          />
        </div>
      )}
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

interface EditDialogProps {
  co: ChangeOrder | null;
  onClose: () => void;
  onSaved: (updated: ChangeOrder) => void;
}

const EditChangeOrderDialog: React.FC<EditDialogProps> = ({ co, onClose, onSaved }) => {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [costImpact, setCostImpact] = useState('0');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (co) {
      setTitle(co.title || '');
      setReason(co.reason || '');
      setDescription(co.description || '');
      setCostImpact(String(co.cost_impact ?? 0));
    }
  }, [co]);

  if (!co) return null;

  const save = async () => {
    setSaving(true);
    try {
      const patch = {
        title,
        reason: reason || null,
        description: description || null,
        cost_impact: parseFloat(costImpact || '0'),
      };
      const { data, error } = await (supabase as any)
        .from('change_orders')
        .update(patch)
        .eq('id', co.id)
        .select('*')
        .single();
      if (error) throw error;
      toast({ title: 'Change order updated' });
      onSaved((data || { ...co, ...patch }) as ChangeOrder);
    } catch (e: any) {
      toast({ title: 'Update failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!co} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {co.co_number}</DialogTitle>
          <DialogDescription>
            Update title, reason and cost impact. Saving regenerates the PDF in the Documents tab.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div>
            <Label className="text-xs">Cost Impact ($)</Label>
            <Input
              type="number"
              step="0.01"
              value={costImpact}
              onChange={(e) => setCostImpact(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ChangeOrdersTab;
