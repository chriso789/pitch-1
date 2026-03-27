import React from 'react';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, DollarSign, Clock, AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, differenceInDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

export default function AccountsReceivable() {
  const { activeTenantId } = useActiveTenantId();
  const navigate = useNavigate();

  const { data: invoices, isLoading } = useQuery({
    queryKey: ['ar-all-invoices', activeTenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_invoices')
        .select('*, pipeline_entries!inner(id, contact_name, address)')
        .eq('tenant_id', activeTenantId!)
        .in('status', ['draft', 'sent', 'partial'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  const { data: payments } = useQuery({
    queryKey: ['ar-all-payments', activeTenantId],
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

  if (isLoading) {
    return (
      <GlobalLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </GlobalLayout>
    );
  }

  const now = new Date();
  const totalOutstanding = (invoices || []).reduce((sum, inv) => sum + Number(inv.balance), 0);

  // Aging buckets
  const buckets = { current: 0, days30: 0, days60: 0, days90: 0 };
  (invoices || []).forEach(inv => {
    const age = inv.due_date ? differenceInDays(now, new Date(inv.due_date)) : 0;
    const bal = Number(inv.balance);
    if (age <= 0) buckets.current += bal;
    else if (age <= 30) buckets.days30 += bal;
    else if (age <= 60) buckets.days60 += bal;
    else buckets.days90 += bal;
  });

  return (
    <GlobalLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Accounts Receivable</h1>
          <p className="text-muted-foreground">Track outstanding invoices and payments across all projects</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Outstanding</p>
              <p className="text-xl font-bold">{formatCurrency(totalOutstanding)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Current</p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(buckets.current)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">1-30 Days</p>
              <p className="text-xl font-bold text-yellow-600">{formatCurrency(buckets.days30)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">31-60 Days</p>
              <p className="text-xl font-bold text-orange-600">{formatCurrency(buckets.days60)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">90+ Days</p>
              <p className="text-xl font-bold text-red-600">{formatCurrency(buckets.days90)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Invoice List */}
        <Card>
          <CardHeader>
            <CardTitle>Outstanding Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            {(invoices || []).length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                <p className="text-muted-foreground">No outstanding invoices — all caught up!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(invoices || []).map(inv => {
                  const entry = inv.pipeline_entries as any;
                  const age = inv.due_date ? differenceInDays(now, new Date(inv.due_date)) : 0;
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between p-4 bg-muted/30 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/lead/${inv.pipeline_entry_id}?tab=estimate`)}
                    >
                      <div>
                        <p className="text-sm font-medium">{entry?.contact_name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">
                          {inv.invoice_number}
                          {entry?.address && ` · ${entry.address}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-bold">{formatCurrency(Number(inv.balance))}</p>
                          {inv.due_date && (
                            <p className={cn("text-xs", age > 0 ? "text-red-500" : "text-muted-foreground")}>
                              {age > 0 ? `${age}d overdue` : `Due ${format(new Date(inv.due_date), 'MMM d')}`}
                            </p>
                          )}
                        </div>
                        <Badge variant="outline" className={cn("text-xs",
                          inv.status === 'sent' && "bg-blue-500/10 text-blue-600 border-blue-500/30",
                          inv.status === 'partial' && "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
                          inv.status === 'draft' && "bg-muted text-muted-foreground",
                        )}>
                          {inv.status}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
}
