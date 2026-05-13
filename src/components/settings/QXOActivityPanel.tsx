import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, FileText, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props { tenantId: string }

const fmtMoney = (n: any) =>
  n == null ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function QXOActivityPanel({ tenantId }: Props) {
  const [tab, setTab] = useState('orders');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>QXO / Beacon Activity</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="quotes">Quotes</TabsTrigger>
          </TabsList>
          <TabsContent value="orders" className="mt-4">
            <OrdersTab tenantId={tenantId} />
          </TabsContent>
          <TabsContent value="invoices" className="mt-4">
            <InvoicesTab tenantId={tenantId} />
          </TabsContent>
          <TabsContent value="quotes" className="mt-4">
            <QuotesTab tenantId={tenantId} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function OrdersTab({ tenantId }: Props) {
  const { toast } = useToast();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['qxo-orders', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('qxo-orders', {
        body: { tenant_id: tenantId, action: 'list', pageSize: 25, pageNo: 1 },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId,
  });

  const orders = data?.orders || [];

  const openPdf = async (orderId: string) => {
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qxo-orders?action=pdf&tenant_id=${tenantId}&orderId=${orderId}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ''}` },
      });
      if (!res.ok) throw new Error('PDF not available');
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e: any) {
      toast({ title: 'PDF failed', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No orders yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2 pr-4">Order</th>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Job</th>
                <th className="py-2 pr-4">PO</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4 text-right">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o: any) => (
                <tr key={o.orderId} className="border-b hover:bg-muted/30">
                  <td className="py-2 pr-4 font-mono">{o.orderId}</td>
                  <td className="py-2 pr-4">{o.orderPlacedDate ? new Date(o.orderPlacedDate).toLocaleDateString() : '—'}</td>
                  <td className="py-2 pr-4">{o.job?.jobName || '—'}</td>
                  <td className="py-2 pr-4">{o.purchaseOrderNo || '—'}</td>
                  <td className="py-2 pr-4"><Badge variant="outline">{o.orderStatusValue || o.orderStatusCode}</Badge></td>
                  <td className="py-2 pr-4 text-right">{fmtMoney(o.total)}</td>
                  <td className="py-2 pr-4">
                    <Button size="sm" variant="ghost" onClick={() => openPdf(o.orderId)}>
                      <FileText className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InvoicesTab({ tenantId }: Props) {
  const { toast } = useToast();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['qxo-invoices-v4', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('qxo-invoices-v4', {
        body: { tenant_id: tenantId, action: 'list', pageSize: 25, pageNo: 1, company: 1 },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId,
  });

  const invoices = data?.invoices || [];

  const openPdf = async (invoiceNumber: string) => {
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qxo-invoices-v4?action=pdf&tenant_id=${tenantId}&invoiceNumbers=${invoiceNumber}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ''}` },
      });
      if (!res.ok) throw new Error('PDF not available');
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e: any) {
      toast({ title: 'PDF failed', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No invoices yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2 pr-4">Invoice</th>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Job</th>
                <th className="py-2 pr-4">PO</th>
                <th className="py-2 pr-4 text-right">Sales</th>
                <th className="py-2 pr-4 text-right">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv: any) => (
                <tr key={inv.orderNumber} className="border-b hover:bg-muted/30">
                  <td className="py-2 pr-4 font-mono">{inv.orderNumber}</td>
                  <td className="py-2 pr-4">{inv.invoiceDate || '—'}</td>
                  <td className="py-2 pr-4">{inv.jobName || '—'}</td>
                  <td className="py-2 pr-4">{inv.purchaseOrderNumber || '—'}</td>
                  <td className="py-2 pr-4 text-right">{fmtMoney(inv.sales)}</td>
                  <td className="py-2 pr-4 text-right">{fmtMoney(inv.salesPlusOtherCharges)}</td>
                  <td className="py-2 pr-4">
                    <Button size="sm" variant="ghost" onClick={() => openPdf(inv.orderNumber)}>
                      <FileText className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QuotesTab({ tenantId }: Props) {
  const { toast } = useToast();
  const [quoteId, setQuoteId] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    if (!quoteId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('qxo-quotes', {
        body: { tenant_id: tenantId, action: 'detail', quoteId },
      });
      if (error) throw error;
      setQuote(data?.quote || null);
      if (!data?.quote) toast({ title: 'Quote not found', variant: 'destructive' });
    } catch (e: any) {
      toast({ title: 'Lookup failed', description: e.message, variant: 'destructive' });
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="Beacon quote ID (e.g. 9387769)"
          value={quoteId}
          onChange={(e) => setQuoteId(e.target.value)}
        />
        <Button onClick={lookup} disabled={loading || !quoteId}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ExternalLink className="h-4 w-4 mr-2" />}
          Look up
        </Button>
      </div>
      {quote && (
        <div className="border rounded-md p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <strong>{quote.displayName || quote.id}</strong>
            <Badge>{quote.statusDescription || quote.status}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-muted-foreground">
            <div>Job: {quote.jobName} ({quote.jobNumber})</div>
            <div>Created: {quote.creationDate}</div>
            <div>Expires: {quote.expires}</div>
            <div>Total: {fmtMoney(quote.total)}</div>
          </div>
          {quote.quoteNotes && (
            <p className="text-xs text-muted-foreground italic">{quote.quoteNotes}</p>
          )}
          {Array.isArray(quote.quoteItems) && quote.quoteItems.length > 0 && (
            <div className="mt-2">
              <p className="font-medium text-xs mb-1">Items</p>
              <ul className="text-xs space-y-1">
                {quote.quoteItems.map((it: any, i: number) => (
                  <li key={i} className="flex justify-between">
                    <span>{it.itemNumber} × {it.quantity} {it.unitOfMeasure}</span>
                    <span>{fmtMoney(it.itemTotalPrice)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
