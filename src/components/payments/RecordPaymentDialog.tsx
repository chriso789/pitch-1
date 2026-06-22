import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CreditCard } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pipelineEntryId: string;
  tenantId: string;
  projectName?: string;
  sellingPrice: number;
  totalPaid: number;
}

export function RecordPaymentDialog({
  open, onOpenChange, pipelineEntryId, tenantId, projectName,
  sellingPrice, totalPaid,
}: Props) {
  const queryClient = useQueryClient();
  const contractBalance = Math.max(0, (Number(sellingPrice) || 0) - (Number(totalPaid) || 0));

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('check');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedEstimateId, setSelectedEstimateId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPaymentAmount('');
      setPaymentMethod('check');
      setPaymentDate(new Date().toISOString().slice(0, 10));
      setPaymentRef('');
      setPaymentNotes('');
      setSelectedInvoiceId(null);
      setSelectedEstimateId(null);
    }
  }, [open]);

  // Detect combined estimates on this project so the user can apply payment to the correct one
  const { data: combinedEstimates } = useQuery({
    queryKey: ['rpd-combined-estimates', pipelineEntryId],
    enabled: open && !!pipelineEntryId,
    queryFn: async () => {
      const { data: pe } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .maybeSingle();
      const meta = (pe?.metadata as any) || {};
      if (!meta.combine_estimates) return [] as any[];
      const ids: string[] = Array.isArray(meta.selected_estimate_ids) ? meta.selected_estimate_ids : [];
      if (ids.length < 2) return [] as any[];
      const { data } = await supabase
        .from('enhanced_estimates')
        .select('id, estimate_number, display_name, selling_price')
        .in('id', ids);
      return data || [];
    },
  });

  const hasCombinedEstimates = (combinedEstimates?.length || 0) > 1;

  const { data: invoices } = useQuery({
    queryKey: ['rpd-invoices', pipelineEntryId],
    enabled: open && !!pipelineEntryId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_invoices')
        .select('id, invoice_number, balance, status, amount')
        .eq('pipeline_entry_id', pipelineEntryId);
      if (error) throw error;
      return data || [];
    },
  });

  const openInvoices = (invoices || []).filter((i: any) => i.status !== 'paid' && i.status !== 'void');

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(paymentAmount);
      if (isNaN(amount) || amount <= 0) throw new Error('Invalid amount');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('project_payments').insert({
        tenant_id: tenantId,
        pipeline_entry_id: pipelineEntryId,
        invoice_id: selectedInvoiceId || null,
        amount,
        payment_method: paymentMethod,
        reference_number: paymentRef || null,
        payment_date: paymentDate,
        notes: paymentNotes || null,
        created_by: user.id,
      } as any);
      if (error) throw new Error(error.message || 'Failed to record payment');

      if (selectedInvoiceId) {
        const invoice = (invoices || []).find((i: any) => i.id === selectedInvoiceId);
        if (invoice) {
          const newBalance = Math.max(0, Number(invoice.balance) - amount);
          const newStatus = newBalance === 0 ? 'paid' : 'partial';
          await supabase.from('project_invoices')
            .update({ balance: newBalance, status: newStatus } as any)
            .eq('id', selectedInvoiceId);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-ar-invoices', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['project-ar-payments', pipelineEntryId] });
      queryClient.invalidateQueries({ queryKey: ['ar-payments'] });
      queryClient.invalidateQueries({ queryKey: ['ar-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['ar-projects'] });
      window.dispatchEvent(new CustomEvent('project-payment-recorded', { detail: { pipelineEntryId } }));
      toast.success('Payment recorded');
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to record payment'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Payment{projectName ? ` — ${projectName}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-3 gap-2 p-3 bg-muted/50 rounded-lg">
            <div>
              <p className="text-[10px] text-muted-foreground">Contract</p>
              <p className="text-xs font-bold">{formatCurrency(sellingPrice)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Paid</p>
              <p className="text-xs font-bold text-green-600">{formatCurrency(totalPaid)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Remaining</p>
              <p className={cn("text-xs font-bold", contractBalance > 0 ? "text-yellow-600" : "text-green-600")}>
                {formatCurrency(contractBalance)}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <Label>Amount</Label>
              <Input type="number" step="0.01" value={paymentAmount}
                onChange={e => setPaymentAmount(e.target.value)} placeholder="0.00" />
            </div>
            {contractBalance > 0 && (
              <div className="flex items-end">
                <Button variant="outline" size="sm" className="h-9 text-xs whitespace-nowrap"
                  onClick={() => setPaymentAmount(contractBalance.toFixed(2))}>
                  Bill Remaining
                </Button>
              </div>
            )}
          </div>

          <div>
            <Label>Payment Method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="ach">ACH</SelectItem>
                <SelectItem value="zelle">Zelle</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="financing">Financing</SelectItem>
                <SelectItem value="quickbooks">QuickBooks</SelectItem>
                <SelectItem value="bank_account">Bank Account</SelectItem>
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
            <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)}
              placeholder="Check #, confirmation, etc." />
          </div>

          {openInvoices.length > 0 && (
            <div>
              <Label>Apply to Invoice</Label>
              <Select value={selectedInvoiceId || 'none'}
                onValueChange={v => setSelectedInvoiceId(v === 'none' ? null : v)}>
                <SelectTrigger><SelectValue placeholder="None (general payment)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (general payment)</SelectItem>
                  {openInvoices.map((inv: any) => (
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
            <Input value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)}
              placeholder="Optional notes" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => recordPaymentMutation.mutate()} disabled={recordPaymentMutation.isPending}>
            {recordPaymentMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
              : <CreditCard className="h-4 w-4 mr-1" />}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
