import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, Wallet, FileText, Search } from 'lucide-react';

interface Profile {
  account_id: string | null;
  profile_id: string | null;
  account_name: string | null;
  default_branch_code: string | null;
  default_branch_name: string | null;
  last_synced_at: string | null;
}

interface BalanceSnapshot {
  balance: number | null;
  available_credit: number | null;
  credit_limit: number | null;
  currency: string | null;
  snapshot_date: string;
  created_at: string;
}

interface Invoice {
  id: string;
  qxo_invoice_id: string;
  invoice_number: string | null;
  po_number: string | null;
  branch_code: string | null;
  status: string;
  issued_date: string | null;
  due_date: string | null;
  amount: number | null;
  balance: number | null;
  currency: string | null;
  raw_payload: any;
}

const fmtMoney = (v: number | null | undefined, ccy = 'USD') =>
  v === null || v === undefined
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy }).format(v);

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  open: 'destructive',
  partial: 'secondary',
  paid: 'default',
  credit: 'outline',
};

interface Props {
  tenantId: string;
}

export function QXOArDashboard({ tenantId }: Props) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState<BalanceSnapshot | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'paid' | 'credit'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<Invoice | null>(null);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [{ data: p }, { data: b }, { data: inv }] = await Promise.all([
        (supabase as any).from('qxo_account_profile').select('*').eq('tenant_id', tenantId).maybeSingle(),
        (supabase as any).from('qxo_balance_snapshots').select('*').eq('tenant_id', tenantId).order('snapshot_date', { ascending: false }).limit(1).maybeSingle(),
        (supabase as any).from('qxo_invoices').select('*').eq('tenant_id', tenantId).order('issued_date', { ascending: false }).limit(500),
      ]);
      setProfile(p || null);
      setBalance(b || null);
      setInvoices((inv as Invoice[]) || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId]);

  const handleRefresh = async () => {
    if (!tenantId) return;
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('qxo-sync-orchestrator', {
        body: { tenant_id: tenantId, source: 'manual' },
      });
      if (error) throw error;
      const r = data?.results?.[0];
      if (r?.profile?.ok === false) {
        toast({ title: 'Sync issue', description: r.profile.error, variant: 'destructive' });
      } else {
        toast({
          title: 'Sync complete',
          description: `Invoices synced: ${r?.invoices?.count ?? 0}`,
        });
      }
      await load();
    } catch (e: any) {
      toast({ title: 'Sync failed', description: e.message, variant: 'destructive' });
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = useMemo(() => {
    return invoices.filter((i) => {
      if (filter !== 'all' && i.status !== filter) return false;
      if (search) {
        const s = search.toLowerCase();
        return (
          (i.invoice_number || '').toLowerCase().includes(s) ||
          (i.po_number || '').toLowerCase().includes(s) ||
          (i.branch_code || '').toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [invoices, filter, search]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const ccy = balance?.currency || 'USD';
  const hasAnyData = profile || balance || invoices.length;

  return (
    <div className="space-y-6">
      {/* Live profile card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Beacon Account Profile</CardTitle>
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Field label="Account Name" value={profile?.account_name} />
            <Field label="Account ID" value={profile?.account_id} />
            <Field label="Profile ID" value={profile?.profile_id} />
            <Field label="Default Branch" value={profile?.default_branch_code ? `${profile.default_branch_code}${profile.default_branch_name ? ' — ' + profile.default_branch_name : ''}` : null} />
          </div>
          {profile?.last_synced_at && (
            <p className="text-xs text-muted-foreground mt-3">
              Last synced {new Date(profile.last_synced_at).toLocaleString()}
            </p>
          )}
          {!hasAnyData && (
            <p className="text-sm text-muted-foreground mt-2">
              No data yet. Click Refresh to pull profile, balance, and invoices from Beacon.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Balance card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" /> Account Balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Stat label="Current Balance" value={fmtMoney(balance?.balance ?? null, ccy)} />
            <Stat label="Available Credit" value={fmtMoney(balance?.available_credit ?? null, ccy)} />
            <Stat label="Credit Limit" value={fmtMoney(balance?.credit_limit ?? null, ccy)} />
          </div>
          {balance?.created_at && (
            <p className="text-xs text-muted-foreground mt-3">
              As of {new Date(balance.created_at).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" /> Invoices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
              <TabsList>
                <TabsTrigger value="all">All ({invoices.length})</TabsTrigger>
                <TabsTrigger value="open">Open ({invoices.filter((i) => i.status === 'open').length})</TabsTrigger>
                <TabsTrigger value="paid">Paid ({invoices.filter((i) => i.status === 'paid').length})</TabsTrigger>
                <TabsTrigger value="credit">Credits ({invoices.filter((i) => i.status === 'credit').length})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search invoice #, PO, branch..."
                className="pl-10"
              />
            </div>
          </div>

          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>PO #</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No invoices to show.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((i) => (
                    <TableRow key={i.id} className="cursor-pointer" onClick={() => setDrawer(i)}>
                      <TableCell className="font-medium">{i.invoice_number || i.qxo_invoice_id}</TableCell>
                      <TableCell>{i.po_number || '—'}</TableCell>
                      <TableCell>{i.branch_code || '—'}</TableCell>
                      <TableCell>{i.issued_date || '—'}</TableCell>
                      <TableCell>{i.due_date || '—'}</TableCell>
                      <TableCell className="text-right">{fmtMoney(i.amount, i.currency || ccy)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(i.balance, i.currency || ccy)}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[i.status] || 'secondary'}>{i.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Sheet open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              Invoice {drawer?.invoice_number || drawer?.qxo_invoice_id}
            </SheetTitle>
          </SheetHeader>
          {drawer && (
            <div className="mt-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="PO #" value={drawer.po_number} />
                <Field label="Branch" value={drawer.branch_code} />
                <Field label="Issued" value={drawer.issued_date} />
                <Field label="Due" value={drawer.due_date} />
                <Field label="Amount" value={fmtMoney(drawer.amount, drawer.currency || ccy)} />
                <Field label="Balance" value={fmtMoney(drawer.balance, drawer.currency || ccy)} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Raw payload</p>
                <pre className="bg-muted p-3 rounded text-xs overflow-x-auto max-h-[60vh]">
                  {JSON.stringify(drawer.raw_payload, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-medium break-words">{value || '—'}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}
