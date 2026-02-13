import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { 
  Plus, FileText, DollarSign, Calendar, TrendingUp, TrendingDown, Receipt, AlertCircle, Loader2
} from 'lucide-react';

interface JobInvoiceTrackerProps {
  jobId: string;
}

export const JobInvoiceTracker = ({ jobId }: JobInvoiceTrackerProps) => {
  const { activeTenantId: tenantId, profile } = useActiveTenantId();
  const queryClient = useQueryClient();
  const [showAddInvoice, setShowAddInvoice] = useState(false);
  const [newInvoice, setNewInvoice] = useState({
    invoice_number: '',
    invoice_type: 'actual_invoice',
    invoice_amount: 0,
    status: 'draft',
    invoice_date: new Date().toISOString().split('T')[0],
    notes: '',
    vendor_name: '',
  });

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['project-cost-invoices', jobId],
    queryFn: async () => {
      // jobId could be a project_id or pipeline_entry_id
      const { data, error } = await supabase
        .from('project_cost_invoices')
        .select('*')
        .or(`project_id.eq.${jobId},pipeline_entry_id.eq.${jobId}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (invoice: typeof newInvoice) => {
      const { error } = await supabase.from('project_cost_invoices').insert({
        pipeline_entry_id: jobId,
        tenant_id: tenantId!,
        created_by: profile?.id,
        invoice_number: invoice.invoice_number || null,
        invoice_type: invoice.invoice_type,
        invoice_amount: invoice.invoice_amount,
        status: invoice.status,
        invoice_date: invoice.invoice_date || null,
        notes: invoice.notes || null,
        vendor_name: invoice.vendor_name || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-cost-invoices', jobId] });
      setShowAddInvoice(false);
      setNewInvoice({ invoice_number: '', invoice_type: 'actual_invoice', invoice_amount: 0, status: 'draft', invoice_date: new Date().toISOString().split('T')[0], notes: '', vendor_name: '' });
      toast({ title: 'Success', description: 'Invoice added successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to add invoice', variant: 'destructive' });
    },
  });

  const originalEstimate = invoices.filter((i: any) => i.invoice_type === 'original_estimate').reduce((s: number, i: any) => s + (i.invoice_amount || 0), 0);
  const changeOrders = invoices.filter((i: any) => i.invoice_type === 'change_order').reduce((s: number, i: any) => s + (i.invoice_amount || 0), 0);
  const actualTotal = invoices.filter((i: any) => i.invoice_type === 'actual_invoice').reduce((s: number, i: any) => s + (i.invoice_amount || 0), 0);
  const totalPaid = invoices.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + (i.invoice_amount || 0), 0);
  const totalOutstanding = invoices.filter((i: any) => i.status === 'sent' || i.status === 'pending').reduce((s: number, i: any) => s + (i.invoice_amount || 0), 0);
  const revisedEstimate = originalEstimate + changeOrders;
  const variance = actualTotal - revisedEstimate;
  const variancePercent = revisedEstimate > 0 ? (variance / revisedEstimate) * 100 : 0;

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  const typeColor = (t: string) => ({
    original_estimate: 'bg-blue-100 text-blue-800',
    change_order: 'bg-orange-100 text-orange-800',
    actual_invoice: 'bg-green-100 text-green-800',
  }[t] || 'bg-muted text-muted-foreground');

  const statusColor = (s: string) => ({
    draft: 'bg-muted text-muted-foreground',
    sent: 'bg-warning/20 text-warning',
    pending: 'bg-warning/20 text-warning',
    paid: 'bg-green-100 text-green-800',
    approved: 'bg-green-100 text-green-800',
    overdue: 'bg-destructive/20 text-destructive',
    rejected: 'bg-destructive/20 text-destructive',
  }[s] || 'bg-muted');

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Invoice Tracking</h3>
          <p className="text-muted-foreground text-sm">Track original estimates vs actual costs</p>
        </div>
        <Dialog open={showAddInvoice} onOpenChange={setShowAddInvoice}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-2" />Add Invoice</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add New Invoice</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Invoice Number</Label>
                  <Input value={newInvoice.invoice_number} onChange={(e) => setNewInvoice(p => ({ ...p, invoice_number: e.target.value }))} placeholder="INV-001" />
                </div>
                <div>
                  <Label>Type</Label>
                  <Select value={newInvoice.invoice_type} onValueChange={(v) => setNewInvoice(p => ({ ...p, invoice_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original_estimate">Original Estimate</SelectItem>
                      <SelectItem value="change_order">Change Order</SelectItem>
                      <SelectItem value="actual_invoice">Actual Invoice</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Amount</Label>
                  <Input type="number" step="0.01" value={newInvoice.invoice_amount} onChange={(e) => setNewInvoice(p => ({ ...p, invoice_amount: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={newInvoice.invoice_date} onChange={(e) => setNewInvoice(p => ({ ...p, invoice_date: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Vendor</Label>
                <Input value={newInvoice.vendor_name} onChange={(e) => setNewInvoice(p => ({ ...p, vendor_name: e.target.value }))} placeholder="Vendor name" />
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={newInvoice.notes} onChange={(e) => setNewInvoice(p => ({ ...p, notes: e.target.value }))} placeholder="Description" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowAddInvoice(false)}>Cancel</Button>
                <Button onClick={() => addMutation.mutate(newInvoice)} disabled={addMutation.isPending}>
                  {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Add Invoice
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-500" />
          <div><p className="text-sm text-muted-foreground">Original Estimate</p><p className="text-lg font-bold">{fmt(originalEstimate)}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-orange-500" />
          <div><p className="text-sm text-muted-foreground">Change Orders</p><p className="text-lg font-bold">{fmt(changeOrders)}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-2">
          <Receipt className="h-4 w-4 text-green-500" />
          <div><p className="text-sm text-muted-foreground">Actual Total</p><p className="text-lg font-bold">{fmt(actualTotal)}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-2">
          {variance >= 0 ? <TrendingUp className="h-4 w-4 text-destructive" /> : <TrendingDown className="h-4 w-4 text-green-600" />}
          <div>
            <p className="text-sm text-muted-foreground">Variance</p>
            <p className={`text-lg font-bold ${variance >= 0 ? 'text-destructive' : 'text-green-600'}`}>{variance >= 0 ? '+' : ''}{fmt(variance)}</p>
            <p className="text-xs text-muted-foreground">{variancePercent > 0 ? '+' : ''}{variancePercent.toFixed(1)}%</p>
          </div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-green-600" />
          <div><p className="text-sm text-muted-foreground">Total Paid</p><p className="text-lg font-bold text-green-600">{fmt(totalPaid)}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-orange-500" />
          <div><p className="text-sm text-muted-foreground">Outstanding</p><p className="text-lg font-bold text-orange-500">{fmt(totalOutstanding)}</p></div>
        </CardContent></Card>
      </div>

      {/* Invoice List */}
      <Card>
        <CardHeader><CardTitle>All Invoices</CardTitle></CardHeader>
        <CardContent>
          {invoices.length > 0 ? (
            <div className="space-y-4">
              {invoices.map((invoice: any) => (
                <div key={invoice.id} className="p-4 bg-muted/30 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <h4 className="font-medium">{invoice.invoice_number || 'No Number'}</h4>
                      <Badge className={typeColor(invoice.invoice_type)}>{invoice.invoice_type?.replace(/_/g, ' ')}</Badge>
                      <Badge className={statusColor(invoice.status)}>{invoice.status}</Badge>
                    </div>
                    <p className="text-lg font-bold">{fmt(invoice.invoice_amount)}</p>
                  </div>
                  {invoice.vendor_name && <p className="text-sm text-muted-foreground mb-1">Vendor: {invoice.vendor_name}</p>}
                  {invoice.notes && <p className="text-sm text-muted-foreground mb-2">{invoice.notes}</p>}
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center gap-4">
                      {invoice.invoice_date && (
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Date: {new Date(invoice.invoice_date).toLocaleDateString()}</span>
                      )}
                    </div>
                    <span>Created: {new Date(invoice.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Receipt className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No invoices yet</p>
              <p className="text-sm">Click "Add Invoice" to start tracking</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
