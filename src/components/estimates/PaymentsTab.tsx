import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger 
} from '@/components/ui/dialog';
import { 
  DollarSign, Plus, CreditCard, FileText, CheckCircle, Clock, 
  Send, Loader2, Receipt 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface PaymentsTabProps {
  pipelineEntryId: string;
  sellingPrice: number;
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
  const { activeTenantId, profile } = useActiveTenantId();
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('check');
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [paymentNotes, setPaymentNotes] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

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
      const amount = parseFloat(invoiceAmount);
      if (isNaN(amount) || amount <= 0) throw new Error('Invalid amount');
      const invoiceCount = (invoices || []).length + 1;
      const invoiceNumber = `INV-${pipelineEntryId.slice(0, 6).toUpperCase()}-${String(invoiceCount).padStart(3, '0')}`;
      const { error } = await supabase.from('project_invoices').insert({
        tenant_id: activeTenantId!,
        pipeline_entry_id: pipelineEntryId,
        invoice_number: invoiceNumber,
        amount,
        balance: amount,
        status: 'draft',
        due_date: invoiceDueDate || null,
        notes: invoiceNotes || null,
        created_by: profile?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
      setShowInvoiceDialog(false);
      setInvoiceAmount('');
      setInvoiceNotes('');
      setInvoiceDueDate('');
      toast.success('Invoice created');
    },
    onError: () => toast.error('Failed to create invoice'),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(paymentAmount);
      if (isNaN(amount) || amount <= 0) throw new Error('Invalid amount');
      const { error } = await supabase.from('project_payments').insert({
        tenant_id: activeTenantId!,
        pipeline_entry_id: pipelineEntryId,
        invoice_id: selectedInvoiceId || null,
        amount,
        payment_method: paymentMethod,
        reference_number: paymentRef || null,
        payment_date: paymentDate,
        notes: paymentNotes || null,
        created_by: profile?.id,
      });
      if (error) throw error;

      // Update invoice balance if linked
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
    onError: () => toast.error('Failed to record payment'),
  });

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
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Invoice</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label>Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={invoiceAmount}
                  onChange={e => setInvoiceAmount(e.target.value)}
                  placeholder={contractBalance > 0 ? contractBalance.toFixed(2) : '0.00'}
                />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={invoiceDueDate} onChange={e => setInvoiceDueDate(e.target.value)} />
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={invoiceNotes} onChange={e => setInvoiceNotes(e.target.value)} placeholder="Optional notes" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createInvoiceMutation.mutate()} disabled={createInvoiceMutation.isPending}>
                {createInvoiceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                Create
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
                <Input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                  placeholder="0.00"
                />
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
            {(invoices || []).map(inv => (
              <div key={inv.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div>
                  <p className="text-sm font-medium">{inv.invoice_number}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(inv.created_at), 'MMM d, yyyy')}
                    {inv.due_date && ` · Due ${format(new Date(inv.due_date), 'MMM d')}`}
                  </p>
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
            ))}
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
