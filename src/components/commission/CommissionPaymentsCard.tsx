import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/commission-calculator';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { BadgeDollarSign, Plus, Trash2 } from 'lucide-react';

interface CommissionPaymentsCardProps {
  tenantId: string;
  /** Rep the payments belong to. */
  repId: string;
  /** Scope to a single job when provided; otherwise shows every payment for the rep. */
  pipelineEntryId?: string;
  projectId?: string;
  /** Commission earned for this scope, used to show what is still outstanding. */
  commissionEarned?: number;
  isManager?: boolean;
}

interface PaymentRow {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  source: string;
  reference: string | null;
  notes: string | null;
}

const METHODS = ['check', 'direct_deposit', 'cash', 'payroll', 'other'] as const;

const METHOD_LABELS: Record<string, string> = {
  check: 'Check',
  direct_deposit: 'Direct Deposit',
  cash: 'Cash',
  payroll: 'Payroll',
  other: 'Other',
};

/**
 * Commission payments are a pay-history record only — they never post to job
 * costs or profit. They exist so reps can see what they have actually been paid
 * against what they earned, whether it was entered by hand or synced from
 * QuickBooks.
 */
export function CommissionPaymentsCard({
  tenantId,
  repId,
  pipelineEntryId,
  projectId,
  commissionEarned,
  isManager = false,
}: CommissionPaymentsCardProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [method, setMethod] = useState<string>('check');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const queryKey = ['commission-payments', tenantId, repId, pipelineEntryId ?? 'all'];

  const { data: payments = [] } = useQuery({
    queryKey,
    queryFn: async () => {
      let q = supabase
        .from('commission_payments')
        .select('id, amount, payment_date, payment_method, source, reference, notes')
        .eq('tenant_id', tenantId)
        .eq('user_id', repId)
        .order('payment_date', { ascending: false });
      if (pipelineEntryId) q = q.eq('pipeline_entry_id', pipelineEntryId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as PaymentRow[];
    },
    enabled: !!tenantId && !!repId,
  });

  const totalPaid = useMemo(
    () => payments.reduce((s, p) => s + Number(p.amount || 0), 0),
    [payments],
  );
  const outstanding =
    commissionEarned !== undefined ? Math.max(0, commissionEarned - totalPaid) : undefined;

  const addPayment = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (!value || Number.isNaN(value)) throw new Error('Enter a payment amount');
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('commission_payments').insert({
        tenant_id: tenantId,
        user_id: repId,
        pipeline_entry_id: pipelineEntryId ?? null,
        project_id: projectId ?? null,
        amount: value,
        payment_date: paymentDate,
        payment_method: method,
        source: 'manual',
        reference: reference || null,
        notes: notes || null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Commission payment recorded');
      setOpen(false);
      setAmount('');
      setReference('');
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['commission-payments'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not record the payment'),
  });

  const deletePayment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('commission_payments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Payment removed');
      queryClient.invalidateQueries({ queryKey: ['commission-payments'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not remove the payment'),
  });

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BadgeDollarSign className="h-4 w-4" />
          Commission Paid
          <Badge variant="secondary" className="text-[10px]">Does not affect job cost</Badge>
        </CardTitle>
        {isManager && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" /> Record Payment
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record Commission Payment</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="cp-amount">Amount</Label>
                    <Input
                      id="cp-amount"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cp-date">Payment Date</Label>
                    <Input
                      id="cp-date"
                      type="date"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {METHODS.map(m => (
                        <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cp-ref">Check / QuickBooks Reference</Label>
                  <Input
                    id="cp-ref"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Check #1042"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cp-notes">Notes</Label>
                  <Textarea
                    id="cp-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => addPayment.mutate()} disabled={addPayment.isPending}>
                  Save Payment
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-xs text-muted-foreground">Total Paid</div>
            <div className="text-lg font-bold text-green-600">{formatCurrency(totalPaid)}</div>
          </div>
          {commissionEarned !== undefined && (
            <>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <div className="text-xs text-muted-foreground">Commission Earned</div>
                <div className="text-lg font-bold">{formatCurrency(commissionEarned)}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <div className="text-xs text-muted-foreground">Still Owed</div>
                <div className="text-lg font-bold text-amber-600">
                  {formatCurrency(outstanding ?? 0)}
                </div>
              </div>
            </>
          )}
        </div>

        {payments.length === 0 ? (
          <p className="text-center py-4 text-sm text-muted-foreground">
            No commission payments recorded yet
          </p>
        ) : (
          <div className="rounded-md border max-h-[300px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {isManager && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {format(new Date(p.payment_date), 'MM/dd/yyyy')}
                    </TableCell>
                    <TableCell className="text-sm">
                      {METHOD_LABELS[p.payment_method] || p.payment_method}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[160px]">
                      {p.reference || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.source === 'quickbooks' ? 'default' : 'secondary'} className="text-[10px]">
                        {p.source === 'quickbooks' ? 'QuickBooks' : 'Manual'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium text-green-600">
                      {formatCurrency(Number(p.amount || 0))}
                    </TableCell>
                    {isManager && (
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => deletePayment.mutate(p.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
