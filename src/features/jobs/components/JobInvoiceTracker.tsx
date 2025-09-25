import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { 
  Plus, 
  FileText, 
  DollarSign, 
  Calendar, 
  TrendingUp, 
  TrendingDown, 
  Receipt,
  AlertCircle 
} from 'lucide-react';

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: 'original_estimate' | 'change_order' | 'actual_invoice';
  amount: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  due_date?: string;
  paid_date?: string;
  description?: string;
  created_at: string;
}

interface JobInvoiceTrackerProps {
  jobId: string;
}

interface NewInvoice {
  invoice_number: string;
  invoice_type: 'original_estimate' | 'change_order' | 'actual_invoice';
  amount: number;
  status: 'draft' | 'sent';
  due_date: string;
  description: string;
}

export const JobInvoiceTracker = ({ jobId }: JobInvoiceTrackerProps) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddInvoice, setShowAddInvoice] = useState(false);
  const [newInvoice, setNewInvoice] = useState<NewInvoice>({
    invoice_number: '',
    invoice_type: 'actual_invoice',
    amount: 0,
    status: 'draft',
    due_date: '',
    description: ''
  });

  useEffect(() => {
    fetchInvoices();
  }, [jobId]);

  const fetchInvoices = async () => {
    try {
      // Mock data for now - replace with actual database query
      const mockInvoices: Invoice[] = [
        {
          id: '1',
          invoice_number: 'INV-2024-001',
          invoice_type: 'original_estimate',
          amount: 18450,
          status: 'paid',
          due_date: '2024-01-15',
          paid_date: '2024-01-10',
          description: 'Initial project estimate',
          created_at: '2024-01-01'
        },
        {
          id: '2', 
          invoice_number: 'CO-2024-001',
          invoice_type: 'change_order',
          amount: 2300,
          status: 'sent',
          due_date: '2024-02-15',
          description: 'Additional materials for enhanced gutters',
          created_at: '2024-01-15'
        },
        {
          id: '3',
          invoice_number: 'INV-2024-002',
          invoice_type: 'actual_invoice',
          amount: 19850,
          status: 'sent',
          due_date: '2024-02-20',
          description: 'Final invoice with actual costs',
          created_at: '2024-02-01'
        }
      ];
      
      setInvoices(mockInvoices);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const addInvoice = async () => {
    try {
      // Mock adding invoice - replace with actual database insert
      const newInvoiceData: Invoice = {
        id: Date.now().toString(),
        ...newInvoice,
        created_at: new Date().toISOString()
      };

      setInvoices(prev => [...prev, newInvoiceData]);
      setShowAddInvoice(false);
      setNewInvoice({
        invoice_number: '',
        invoice_type: 'actual_invoice',
        amount: 0,
        status: 'draft',
        due_date: '',
        description: ''
      });

      toast({
        title: 'Success',
        description: 'Invoice added successfully'
      });
    } catch (error) {
      console.error('Error adding invoice:', error);
      toast({
        title: 'Error',
        description: 'Failed to add invoice',
        variant: 'destructive'
      });
    }
  };

  // Calculate totals and variances
  const originalEstimate = invoices.find(i => i.invoice_type === 'original_estimate')?.amount || 0;
  const changeOrders = invoices.filter(i => i.invoice_type === 'change_order').reduce((sum, i) => sum + i.amount, 0);
  const actualTotal = invoices.filter(i => i.invoice_type === 'actual_invoice').reduce((sum, i) => sum + i.amount, 0);
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.amount, 0);
  const totalOutstanding = invoices.filter(i => i.status === 'sent').reduce((sum, i) => sum + i.amount, 0);
  
  const revisedEstimate = originalEstimate + changeOrders;
  const variance = actualTotal - revisedEstimate;
  const variancePercent = revisedEstimate > 0 ? (variance / revisedEstimate) * 100 : 0;

  const getInvoiceTypeColor = (type: string) => {
    const colors = {
      'original_estimate': 'bg-blue-100 text-blue-800',
      'change_order': 'bg-orange-100 text-orange-800',
      'actual_invoice': 'bg-green-100 text-green-800'
    };
    return colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const getStatusColor = (status: string) => {
    const colors = {
      'draft': 'bg-muted text-muted-foreground',
      'sent': 'bg-warning text-warning-foreground',
      'paid': 'bg-success text-success-foreground',
      'overdue': 'bg-destructive text-destructive-foreground'
    };
    return colors[status as keyof typeof colors] || 'bg-muted';
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Invoice Tracking</h3>
          <p className="text-muted-foreground">Track original estimates vs actual costs</p>
        </div>
        <Dialog open={showAddInvoice} onOpenChange={setShowAddInvoice}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Invoice
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Invoice</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="invoice_number">Invoice Number</Label>
                  <Input
                    id="invoice_number"
                    value={newInvoice.invoice_number}
                    onChange={(e) => setNewInvoice(prev => ({ ...prev, invoice_number: e.target.value }))}
                    placeholder="INV-2024-001"
                  />
                </div>
                <div>
                  <Label htmlFor="invoice_type">Type</Label>
                  <Select value={newInvoice.invoice_type} onValueChange={(value: any) => setNewInvoice(prev => ({ ...prev, invoice_type: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
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
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    value={newInvoice.amount}
                    onChange={(e) => setNewInvoice(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <Label htmlFor="due_date">Due Date</Label>
                  <Input
                    id="due_date"
                    type="date"
                    value={newInvoice.due_date}
                    onChange={(e) => setNewInvoice(prev => ({ ...prev, due_date: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={newInvoice.description}
                  onChange={(e) => setNewInvoice(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Invoice description"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowAddInvoice(false)}>
                  Cancel
                </Button>
                <Button onClick={addInvoice}>
                  Add Invoice
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <FileText className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-sm text-muted-foreground">Original Estimate</p>
                <p className="text-lg font-bold">{formatCurrency(originalEstimate)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              <div>
                <p className="text-sm text-muted-foreground">Change Orders</p>
                <p className="text-lg font-bold">{formatCurrency(changeOrders)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Receipt className="h-4 w-4 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">Actual Total</p>
                <p className="text-lg font-bold">{formatCurrency(actualTotal)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              {variance >= 0 ? (
                <TrendingUp className="h-4 w-4 text-destructive" />
              ) : (
                <TrendingDown className="h-4 w-4 text-success" />
              )}
              <div>
                <p className="text-sm text-muted-foreground">Variance</p>
                <p className={`text-lg font-bold ${variance >= 0 ? 'text-destructive' : 'text-success'}`}>
                  {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {variancePercent > 0 ? '+' : ''}{variancePercent.toFixed(1)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payment Status Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4 text-success" />
              <div>
                <p className="text-sm text-muted-foreground">Total Paid</p>
                <p className="text-lg font-bold text-success">{formatCurrency(totalPaid)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 text-warning" />
              <div>
                <p className="text-sm text-muted-foreground">Outstanding</p>
                <p className="text-lg font-bold text-warning">{formatCurrency(totalOutstanding)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoice List */}
      <Card>
        <CardHeader>
          <CardTitle>All Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length > 0 ? (
            <div className="space-y-4">
              {invoices.map((invoice) => (
                <div key={invoice.id} className="p-4 bg-muted/30 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-3">
                      <h4 className="font-medium">{invoice.invoice_number}</h4>
                      <Badge className={getInvoiceTypeColor(invoice.invoice_type)}>
                        {invoice.invoice_type.replace('_', ' ')}
                      </Badge>
                      <Badge className={getStatusColor(invoice.status)}>
                        {invoice.status}
                      </Badge>
                    </div>
                    <p className="text-lg font-bold">{formatCurrency(invoice.amount)}</p>
                  </div>
                  
                  {invoice.description && (
                    <p className="text-sm text-muted-foreground mb-2">{invoice.description}</p>
                  )}
                  
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center space-x-4">
                      {invoice.due_date && (
                        <div className="flex items-center space-x-1">
                          <Calendar className="h-3 w-3" />
                          <span>Due: {new Date(invoice.due_date).toLocaleDateString()}</span>
                        </div>
                      )}
                      {invoice.paid_date && (
                        <div className="flex items-center space-x-1">
                          <DollarSign className="h-3 w-3" />
                          <span>Paid: {new Date(invoice.paid_date).toLocaleDateString()}</span>
                        </div>
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
              <p>No invoices added yet</p>
              <p className="text-sm">Click "Add Invoice" to start tracking</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};