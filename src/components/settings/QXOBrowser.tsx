import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FileText, RefreshCw, ExternalLink, Search } from 'lucide-react';
import { Package, Receipt, FileCheck } from 'lucide-react';

interface Props {
  tenantId: string;
}

type Order = {
  orderId: string;
  purchaseOrderNo?: string;
  job?: { jobName?: string; jobNumber?: string };
  orderPlacedDate?: string;
  orderStatusValue?: string;
  orderStatusCode?: string;
  total?: number;
  sellingBranch?: string;
  shipping?: any;
  accountId?: string;
};
type Invoice = {
  orderNumber: string;
  invoiceDate?: string;
  jobName?: string;
  jobNumber?: string;
  purchaseOrderNumber?: string;
  sales?: number;
  otherCharges?: number;
  salesPlusOtherCharges?: number;
};

const fmtMoney = (n?: number | null) =>
  n == null ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function QXOBrowser({ tenantId }: Props) {
  const { toast } = useToast();

  // ---------------- Orders ----------------
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersSearch, setOrdersSearch] = useState('');

  const loadOrders = async (page = 1, term = '') => {
    setOrdersLoading(true);
    try {
      const params: any = { tenant_id: tenantId, pageSize: 25, pageNo: page };
      if (term) {
        params.searchBy = 'CustPO';
        params.searchTerm = term;
      }
      const { data, error } = await supabase.functions.invoke('qxo-orders?action=list', { body: params });
      if (error) throw error;
      setOrders(data?.orders || []);
      setOrdersTotal(data?.pagination?.totalCount || 0);
      setOrdersPage(page);
    } catch (e: any) {
      toast({ title: 'Failed to load orders', description: e.message, variant: 'destructive' });
    } finally {
      setOrdersLoading(false);
    }
  };

  // ---------------- Invoices ----------------
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invPage, setInvPage] = useState(1);
  const [invTotal, setInvTotal] = useState(0);
  const [invSearch, setInvSearch] = useState('');

  const loadInvoices = async (page = 1, term = '') => {
    setInvLoading(true);
    try {
      const params: any = { tenant_id: tenantId, pageSize: 25, pageNo: page };
      if (term) {
        params.searchBy = 'OrderNumber';
        params.searchTerm = term;
      }
      const { data, error } = await supabase.functions.invoke('qxo-invoices-v4?action=list', { body: params });
      if (error) throw error;
      setInvoices(data?.invoices || []);
      setInvTotal(data?.pagination?.totalCount || 0);
      setInvPage(page);
    } catch (e: any) {
      toast({ title: 'Failed to load invoices', description: e.message, variant: 'destructive' });
    } finally {
      setInvLoading(false);
    }
  };

  // ---------------- Quotes ----------------
  type QuoteRow = {
    quoteId: string;
    quoteName?: string;
    creationDate?: string;
    expirationDate?: string;
    status?: string;
    displayStatus?: string;
    createdBy?: string;
  };
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesPage, setQuotesPage] = useState(1);
  const [quotesTotal, setQuotesTotal] = useState(0);
  const [quotesSearch, setQuotesSearch] = useState('');
  const [quoteType, setQuoteType] = useState<'draft' | 'inProcess' | 'received'>('received');

  const loadQuotes = async (page = 1, term = '', type = quoteType) => {
    setQuotesLoading(true);
    try {
      const params: any = { tenant_id: tenantId, pageSize: 25, pageNo: page, quoteType: type };
      if (term) {
        params.filterBy = 'quoteName';
        params.filter = term;
      }
      const { data, error } = await supabase.functions.invoke('qxo-quotes?action=list', { body: params });
      if (error) throw error;
      const bucket =
        type === 'draft' ? data?.draftQuote :
        type === 'inProcess' ? data?.inProcessQuote :
        data?.receivedQuote;
      setQuotes(bucket?.quoteList || []);
      setQuotesTotal(bucket?.pagination?.totalCount || 0);
      setQuotesPage(page);
    } catch (e: any) {
      toast({ title: 'Failed to load quotes', description: e.message, variant: 'destructive' });
    } finally {
      setQuotesLoading(false);
    }
  };

  const fetchQuoteById = async (quoteId: string) => {
    if (!quoteId) return;
    try {
      const { data, error } = await supabase.functions.invoke('qxo-quotes', {
        body: { action: 'detail', tenant_id: tenantId, quoteId },
      });
      if (error) throw error;
      if (data?.quote) {
        toast({ title: 'Quote synced', description: `${data.quote.id} — ${data.quote.statusDescription || data.quote.status || ''}` });
        loadQuotes(1, '', quoteType);
      } else {
        toast({ title: 'Quote not found', variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Quote fetch failed', description: e.message, variant: 'destructive' });
    }
  };

  useEffect(() => {
    loadOrders(1);
    loadInvoices(1);
    loadQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const downloadPdf = async (fn: string, params: Record<string, any>, fileName: string) => {
    try {
      const url = new URL(`https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/${fn}`);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${session?.access_token || ''}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
    } catch (e: any) {
      toast({ title: 'PDF download failed', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>QXO / Beacon Activity</CardTitle>
        <CardDescription>
          Browse orders, invoices, and quotes synced from your QXO/Beacon account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="orders" className="space-y-4">
          <TabsList>
            <TabsTrigger value="orders" className="gap-2"><Package className="h-4 w-4" /> Orders</TabsTrigger>
            <TabsTrigger value="invoices" className="gap-2"><Receipt className="h-4 w-4" /> Invoices</TabsTrigger>
            <TabsTrigger value="quotes" className="gap-2"><FileCheck className="h-4 w-4" /> Quotes</TabsTrigger>
          </TabsList>

          {/* Orders */}
          <TabsContent value="orders" className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search by PO #"
                  value={ordersSearch}
                  onChange={(e) => setOrdersSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadOrders(1, ordersSearch)}
                />
              </div>
              <Button variant="outline" onClick={() => loadOrders(1, ordersSearch)} disabled={ordersLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${ordersLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>PO #</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordersLoading && (
                    <TableRow><TableCell colSpan={7} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>
                  )}
                  {!ordersLoading && orders.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No orders found.</TableCell></TableRow>
                  )}
                  {orders.map((o) => (
                    <TableRow key={o.orderId}>
                      <TableCell className="font-mono text-xs">{o.orderId}</TableCell>
                      <TableCell>{o.purchaseOrderNo || '—'}</TableCell>
                      <TableCell>{o.job?.jobName || o.job?.jobNumber || '—'}</TableCell>
                      <TableCell>{o.orderPlacedDate || '—'}</TableCell>
                      <TableCell><Badge variant="outline">{o.orderStatusValue || o.orderStatusCode || '—'}</Badge></TableCell>
                      <TableCell className="text-right">{fmtMoney(o.total)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            downloadPdf('qxo-orders', {
                              action: 'pdf',
                              tenant_id: tenantId,
                              orderId: o.orderId,
                            }, `qxo-order-${o.orderId}.pdf`)
                          }
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span>{ordersTotal} total</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={ordersPage <= 1 || ordersLoading} onClick={() => loadOrders(ordersPage - 1, ordersSearch)}>Prev</Button>
                <span className="self-center">Page {ordersPage}</span>
                <Button size="sm" variant="outline" disabled={ordersLoading || orders.length < 25} onClick={() => loadOrders(ordersPage + 1, ordersSearch)}>Next</Button>
              </div>
            </div>
          </TabsContent>

          {/* Invoices */}
          <TabsContent value="invoices" className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search by Order Number"
                  value={invSearch}
                  onChange={(e) => setInvSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadInvoices(1, invSearch)}
                />
              </div>
              <Button variant="outline" onClick={() => loadInvoices(1, invSearch)} disabled={invLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${invLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>PO #</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Invoice Date</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Other</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invLoading && (
                    <TableRow><TableCell colSpan={8} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>
                  )}
                  {!invLoading && invoices.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No invoices found.</TableCell></TableRow>
                  )}
                  {invoices.map((inv) => (
                    <TableRow key={inv.orderNumber}>
                      <TableCell className="font-mono text-xs">{inv.orderNumber}</TableCell>
                      <TableCell>{inv.purchaseOrderNumber || '—'}</TableCell>
                      <TableCell>{inv.jobName || inv.jobNumber || '—'}</TableCell>
                      <TableCell>{inv.invoiceDate || '—'}</TableCell>
                      <TableCell className="text-right">{fmtMoney(inv.sales)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(inv.otherCharges)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(inv.salesPlusOtherCharges)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            downloadPdf('qxo-invoices-v4', {
                              action: 'pdf',
                              tenant_id: tenantId,
                              invoiceNumbers: inv.orderNumber,
                            }, `qxo-invoice-${inv.orderNumber}.pdf`)
                          }
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span>{invTotal} total</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={invPage <= 1 || invLoading} onClick={() => loadInvoices(invPage - 1, invSearch)}>Prev</Button>
                <span className="self-center">Page {invPage}</span>
                <Button size="sm" variant="outline" disabled={invLoading || invoices.length < 25} onClick={() => loadInvoices(invPage + 1, invSearch)}>Next</Button>
              </div>
            </div>
          </TabsContent>

          {/* Quotes */}
          <TabsContent value="quotes" className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                placeholder="Quote ID to fetch from Beacon"
                className="flex-1 min-w-[200px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    fetchQuoteById((e.target as HTMLInputElement).value.trim());
                  }
                }}
              />
              <Button variant="outline" onClick={loadQuotes} disabled={quotesLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${quotesLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quote ID</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotesLoading && (
                    <TableRow><TableCell colSpan={6} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>
                  )}
                  {!quotesLoading && quotes.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No quotes synced. Enter a Quote ID above to fetch one from Beacon.</TableCell></TableRow>
                  )}
                  {quotes.map((q: any) => (
                    <TableRow key={q.beacon_quote_id}>
                      <TableCell className="font-mono text-xs">{q.beacon_quote_id}</TableCell>
                      <TableCell>{q.account_name || q.account_id || '—'}</TableCell>
                      <TableCell>{q.job_name || q.job_number || '—'}</TableCell>
                      <TableCell><Badge variant="outline">{q.status_description || q.status || '—'}</Badge></TableCell>
                      <TableCell>{q.expires || '—'}</TableCell>
                      <TableCell className="text-right">{fmtMoney(q.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
