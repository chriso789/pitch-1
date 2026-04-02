import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger 
} from '@/components/ui/dialog';
import { 
  DollarSign, Plus, CreditCard, FileText, Loader2, Receipt, ChevronDown, Trash2 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface PaymentsTabProps {
  pipelineEntryId: string;
  sellingPrice: number;
}

interface InvoiceLineItem {
  description: string;
  qty: number;
  unit: string;
  unit_cost: number;
  line_total: number;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  sent: { label: 'Sent', className: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  partial: { label: 'Partial', className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30' },
  paid: { label: 'Paid', className: 'bg-green-500/10 text-green-600 border-green-500/30' },
  void: { label: 'Void', className: 'bg-red-500/10 text-red-600 border-red-500/30' },
};

export const PaymentsTab: React.FC<PaymentsTabProps> = ({ pipelineEntryId, sellingPrice }) => {
  const queryClient = useQueryClient();
  const { activeTenantId } = useActiveTenantId();
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('check');
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [paymentNotes, setPaymentNotes] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Invoice builder state
  const [invoiceLineItems, setInvoiceLineItems] = useState<(InvoiceLineItem & { selected: boolean })[]>([]);
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());

  // Fetch estimates for this pipeline entry to auto-populate line items
  const { data: estimates } = useQuery({
    queryKey: ['estimate-line-items', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enhanced_estimates')
        .select('id, line_items, selling_price, status')
        .eq('pipeline_entry_id', pipelineEntryId)
        .in('status', ['approved', 'sent', 'accepted'])
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data || [];
    },
  });

  // Build line items from estimate when dialog opens
  useEffect(() => {
    if (!showInvoiceDialog) return;
    
    const estimate = estimates?.[0];
    if (!estimate?.line_items) {
      setInvoiceLineItems([]);
      return;
    }

    const items: (InvoiceLineItem & { selected: boolean })[] = [];
    const lineItems = estimate.line_items as any;

    // Parse materials
    if (Array.isArray(lineItems.materials)) {
      lineItems.materials.forEach((mat: any) => {
        items.push({
          selected: true,
          description: mat.item_name || mat.description || 'Material',
          qty: Number(mat.qty) || 1,
          unit: mat.unit || 'ea',
          unit_cost: Number(mat.unit_cost) || 0,
          line_total: Number(mat.line_total) || 0,
        });
      });
    }

    // Parse labor
    if (Array.isArray(lineItems.labor)) {
      lineItems.labor.forEach((lab: any) => {
        items.push({
          selected: true,
          description: lab.item_name || lab.description || 'Labor',
          qty: Number(lab.qty) || 1,
          unit: lab.unit || 'ea',
          unit_cost: Number(lab.unit_cost) || 0,
          line_total: Number(lab.line_total) || 0,
        });
      });
    }

    setInvoiceLineItems(items);
  }, [showInvoiceDialog, estimates]);

  const invoiceSubtotal = useMemo(() => 
    invoiceLineItems.filter(i => i.selected).reduce((sum, i) => sum + i.line_total, 0),
    [invoiceLineItems]
  );

  const { data: invoices, isLoading: loadingInvoices } = useQuery({
    queryKey: ['project-ar-invoices', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_invoices')
        .select('*')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: payments, isLoading: loadingPayments } = useQuery({
    queryKey: ['project-ar-payments', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_payments')
        .select('*')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('payment_date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const totalPaid = (payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  const contractBalance = sellingPrice - totalPaid;

  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      const selectedItems = invoiceLineItems.filter(i => i.selected);
      if (selectedItems.length === 0) throw new Error('Select at least one line item');
      
      const amount = selectedItems.reduce((sum, i) => sum + i.line_total, 0);
      if (amount <= 0) throw new Error('Invoice total must be greater than zero');

      // Get auth user directly to avoid profile mismatch
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const invoiceCount = (invoices || []).length + 1;
      const invoiceNumber = `INV-${pipelineEntryId.slice(0, 6).toUpperCase()}-${String(invoiceCount).padStart(3, '0')}`;
      
      const lineItemsPayload: InvoiceLineItem[] = selectedItems.map(({ selected, ...item }) => item);

      const { error } = await supabase.from('project_invoices').insert({
        tenant_id: activeTenantId!,
        pipeline_entry_id: pipelineEntryId,
        invoice_number: invoiceNumber,
        amount,
        balance: amount,
        status: 'draft',
        due_date: invoiceDueDate || null,
        notes: invoiceNotes || null,
        created_by: user.id,
        line_items: lineItemsPayload as any,
      });
      if (error) {
        console.error('Invoice creation error:', error);
        throw new Error(error.message || 'Failed to create invoice');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
      setShowInvoiceDialog(false);
      setInvoiceNotes('');
      setInvoiceDueDate('');
      toast.success('Invoice created');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create invoice'),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(paymentAmount);
      if (isNaN(amount) || amount <= 0) throw new Error('Invalid amount');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('project_payments').insert({
        tenant_id: activeTenantId!,
        pipeline_entry_id: pipelineEntryId,
        invoice_id: selectedInvoiceId || null,
        amount,
        payment_method: paymentMethod,
        reference_number: paymentRef || null,
        payment_date: paymentDate,
        notes: paymentNotes || null,
        created_by: user.id,
      });
      if (error) {
        console.error('Payment creation error:', error);
        throw new Error(error.message || 'Failed to record payment');
      }

      if (selectedInvoiceId) {
        const invoice = (invoices || []).find(i => i.id === selectedInvoiceId);
        if (invoice) {
          const newBalance = Math.max(0, Number(invoice.balance) - amount);
          const newStatus = newBalance === 0 ? 'paid' : 'partial';
          await supabase.from('project_invoices')
            .update({ balance: newBalance, status: newStatus })
            .eq('id', selectedInvoiceId);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['project-ar-payments', pipelineEntryId] });
      setShowPaymentDialog(false);
      setPaymentAmount('');
      setPaymentRef('');
      setPaymentNotes('');
      setSelectedInvoiceId(null);
      toast.success('Payment recorded');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to record payment'),
  });

  const updateLineItem = (index: number, field: keyof InvoiceLineItem, value: any) => {
    setInvoiceLineItems(prev => {
      const updated = [...prev];
      (updated[index] as any)[field] = value;
      if (field === 'qty' || field === 'unit_cost') {
        updated[index].line_total = Number(updated[index].qty) * Number(updated[index].unit_cost);
      }
      return updated;
    });
  };

  const toggleLineItem = (index: number) => {
    setInvoiceLineItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], selected: !updated[index].selected };
      return updated;
    });
  };

  const addCustomLineItem = () => {
    setInvoiceLineItems(prev => [...prev, {
      selected: true,
      description: '',
      qty: 1,
      unit: 'ea',
      unit_cost: 0,
      line_total: 0,
    }]);
  };

  const removeLineItem = (index: number) => {
    setInvoiceLineItems(prev => prev.filter((_, i) => i !== index));
  };

  const toggleInvoiceExpand = (id: string) => {
    setExpandedInvoices(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (loadingInvoices || loadingPayments) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const openInvoices = (invoices || []).filter(i => i.status !== 'paid' && i.status !== 'void');

  return (
    <div className="space-y-6">
      {/* Balance Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Contract Value</p>
          <p className="text-sm font-bold">{formatCurrency(sellingPrice)}</p>
        </div>
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Paid</p>
          <p className="text-sm font-bold text-green-600">{formatCurrency(totalPaid)}</p>
        </div>
        <div className={cn("rounded-lg p-3", contractBalance > 0 ? "bg-yellow-500/10" : "bg-green-500/10")}>
          <p className="text-xs text-muted-foreground">Balance Due</p>
          <p className={cn("text-sm font-bold", contractBalance > 0 ? "text-yellow-600" : "text-green-600")}>
            {formatCurrency(contractBalance)}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="flex-1">
              <FileText className="h-4 w-4 mr-1" />
              Create Invoice
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Invoice</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Line Items Table */}
              <div>
                <Label className="text-sm font-semibold">Line Items</Label>
                {invoiceLineItems.length === 0 && (
                  <p className="text-sm text-muted-foreground py-3">No estimate found. Add line items manually.</p>
                )}
                <div className="mt-2 space-y-1">
                  {/* Header */}
                  {invoiceLineItems.length > 0 && (
                    <div className="grid grid-cols-[28px_1fr_60px_60px_80px_90px_28px] gap-1 text-xs font-medium text-muted-foreground px-1">
                      <div></div>
                      <div>Description</div>
                      <div className="text-right">Qty</div>
                      <div>Unit</div>
                      <div className="text-right">Cost</div>
                      <div className="text-right">Total</div>
                      <div></div>
                    </div>
                  )}
                  {invoiceLineItems.map((item, idx) => (
                    <div key={idx} className={cn(
                      "grid grid-cols-[28px_1fr_60px_60px_80px_90px_28px] gap-1 items-center px-1 py-1 rounded",
                      !item.selected && "opacity-50"
                    )}>
                      <Checkbox
                        checked={item.selected}
                        onCheckedChange={() => toggleLineItem(idx)}
                      />
                      <Input
                        value={item.description}
                        onChange={e => updateLineItem(idx, 'description', e.target.value)}
                        className="h-8 text-xs"
                        placeholder="Description"
                      />
                      <Input
                        type="number"
                        value={item.qty}
                        onChange={e => updateLineItem(idx, 'qty', parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs text-right"
                      />
                      <Input
                        value={item.unit}
                        onChange={e => updateLineItem(idx, 'unit', e.target.value)}
                        className="h-8 text-xs"
                      />
                      <Input
                        type="number"
                        value={item.unit_cost}
                        onChange={e => updateLineItem(idx, 'unit_cost', parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs text-right"
                        step="0.01"
                      />
                      <p className="text-xs text-right font-medium">{formatCurrency(item.line_total)}</p>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeLineItem(idx)}>
                        <Trash2 className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={addCustomLineItem}>
                  <Plus className="h-3 w-3 mr-1" /> Add Line Item
                </Button>
              </div>

              <Separator />

              {/* Subtotal */}
              <div className="flex justify-end">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Invoice Total</p>
                  <p className="text-lg font-bold">{formatCurrency(invoiceSubtotal)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Due Date</Label>
                  <Input type="date" value={invoiceDueDate} onChange={e => setInvoiceDueDate(e.target.value)} />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Input value={invoiceNotes} onChange={e => setInvoiceNotes(e.target.value)} placeholder="Optional notes" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button 
                onClick={() => createInvoiceMutation.mutate()} 
                disabled={createInvoiceMutation.isPending || invoiceSubtotal <= 0}
              >
                {createInvoiceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                Create Invoice — {formatCurrency(invoiceSubtotal)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
          <DialogTrigger asChild>
            <Button size="sm" className="flex-1">
              <DollarSign className="h-4 w-4 mr-1" />
              Record Payment
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Payment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label>Amount</Label>
                <Input type="number" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="ach">ACH</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="financing">Financing</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
              </div>
              <div>
                <Label>Reference #</Label>
                <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="Check #, confirmation, etc." />
              </div>
              {openInvoices.length > 0 && (
                <div>
                  <Label>Apply to Invoice</Label>
                  <Select value={selectedInvoiceId || 'none'} onValueChange={v => setSelectedInvoiceId(v === 'none' ? null : v)}>
                    <SelectTrigger><SelectValue placeholder="None (general payment)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (general payment)</SelectItem>
                      {openInvoices.map(inv => (
                        <SelectItem key={inv.id} value={inv.id}>
                          {inv.invoice_number} — {formatCurrency(Number(inv.balance))} due
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Notes</Label>
                <Input value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} placeholder="Optional notes" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => recordPaymentMutation.mutate()} disabled={recordPaymentMutation.isPending}>
                {recordPaymentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CreditCard className="h-4 w-4 mr-1" />}
                Record
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Separator />

      {/* Invoices List */}
      <div>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          Invoices ({(invoices || []).length})
        </h4>
        {(invoices || []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No invoices yet</p>
        ) : (
          <div className="space-y-2">
            {(invoices || []).map(inv => {
              const lineItems = Array.isArray((inv as any).line_items) ? (inv as any).line_items as InvoiceLineItem[] : [];
              const hasLineItems = lineItems.length > 0;
              const isExpanded = expandedInvoices.has(inv.id);

              return (
                <div key={inv.id} className="bg-muted/30 rounded-lg overflow-hidden">
                  <div
                    className={cn("flex items-center justify-between p-3", hasLineItems && "cursor-pointer")}
                    onClick={() => hasLineItems && toggleInvoiceExpand(inv.id)}
                  >
                    <div className="flex items-center gap-2">
                      {hasLineItems && (
                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                      )}
                      <div>
                        <p className="text-sm font-medium">{inv.invoice_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(inv.created_at), 'MMM d, yyyy')}
                          {inv.due_date && ` · Due ${format(new Date(inv.due_date), 'MMM d')}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="text-sm font-medium">{formatCurrency(Number(inv.amount))}</p>
                        {Number(inv.balance) !== Number(inv.amount) && (
                          <p className="text-xs text-muted-foreground">Bal: {formatCurrency(Number(inv.balance))}</p>
                        )}
                      </div>
                      <Badge variant="outline" className={cn("text-xs", statusConfig[inv.status]?.className)}>
                        {statusConfig[inv.status]?.label || inv.status}
                      </Badge>
                    </div>
                  </div>
                  {hasLineItems && isExpanded && (
                    <div className="px-3 pb-3 border-t border-border/50">
                      <div className="mt-2 space-y-1">
                        {lineItems.map((li, idx) => (
                          <div key={idx} className="flex justify-between text-xs py-0.5">
                            <span className="text-muted-foreground truncate mr-2">{li.description}</span>
                            <span className="font-medium whitespace-nowrap">
                              {li.qty} {li.unit} × {formatCurrency(li.unit_cost)} = {formatCurrency(li.line_total)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Separator />

      {/* Payment History */}
      <div>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          Payment History ({(payments || []).length})
        </h4>
        {(payments || []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No payments recorded</p>
        ) : (
          <div className="space-y-2">
            {(payments || []).map(pmt => (
              <div key={pmt.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-green-600">+{formatCurrency(Number(pmt.amount))}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(pmt.payment_date), 'MMM d, yyyy')}
                    {pmt.payment_method && ` · ${pmt.payment_method}`}
                    {pmt.reference_number && ` · Ref: ${pmt.reference_number}`}
                  </p>
                </div>
                {pmt.notes && (
                  <p className="text-xs text-muted-foreground max-w-[150px] truncate">{pmt.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
