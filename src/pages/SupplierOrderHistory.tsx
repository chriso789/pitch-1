import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowLeft, RefreshCcw, Truck, CheckCircle2, AlertCircle, XCircle, Search, Eye,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';

type SupplierKey = 'abc' | 'srs' | 'qxo';

interface SupplierConfig {
  key: SupplierKey;
  label: string;
  description: string;
  ordersTable: 'abc_orders' | 'srs_orders' | 'qxo_orders';
  connectionsTable: 'abc_connections' | 'srs_connections' | 'qxo_connections';
  refreshFn?: { name: string; body?: Record<string, unknown> };
}

const SUPPLIERS: SupplierConfig[] = [
  {
    key: 'abc',
    label: 'ABC Supply',
    description: 'Roofing & exterior building products',
    ordersTable: 'abc_orders',
    connectionsTable: 'abc_connections',
  },
  {
    key: 'srs',
    label: 'SRS Distribution',
    description: 'Roofing distributor (Heritage, Suncoast, Roofline)',
    ordersTable: 'srs_orders',
    connectionsTable: 'srs_connections',
    refreshFn: { name: 'srs-order-status-poller', body: { mode: 'poll' } },
  },
  {
    key: 'qxo',
    label: 'QXO (Beacon)',
    description: 'Beacon Building Products (QXO platform)',
    ordersTable: 'qxo_orders',
    connectionsTable: 'qxo_connections',
    refreshFn: { name: 'qxo-sync-orchestrator', body: { action: 'sync_orders' } },
  },
];

interface UnifiedOrder {
  supplier: SupplierKey;
  id: string;
  confirmation_number: string | null;
  supplier_order_number: string | null;
  po_number: string | null;
  status: string | null;
  total_amount: number | null;
  ordered_at: string | null;
  updated_at: string | null;
  raw: any;
}

interface ConnectionState {
  status: 'connected' | 'pending' | 'disconnected' | 'unknown';
  environment: string | null;
  updated_at: string | null;
}

function normalizeOrder(supplier: SupplierKey, row: any): UnifiedOrder {
  if (supplier === 'abc') {
    return {
      supplier,
      id: row.id,
      confirmation_number: row.confirmation_number ?? null,
      supplier_order_number: row.order_number ?? null,
      po_number: row.purchase_order ?? null,
      status: row.order_status ?? null,
      total_amount: row.total_amount ?? null,
      ordered_at: row.ordered_on ?? row.created_date ?? row.created_at ?? null,
      updated_at: row.updated_at ?? row.created_at ?? null,
      raw: row,
    };
  }
  if (supplier === 'srs') {
    const resp = row.srs_response ?? {};
    return {
      supplier,
      id: row.id,
      confirmation_number: resp.confirmationNumber ?? row.srs_transaction_id ?? null,
      supplier_order_number: row.srs_order_id ?? row.order_number ?? null,
      po_number: row.order_number ?? null,
      status: row.status ?? null,
      total_amount: row.total_amount ?? null,
      ordered_at: row.submitted_at ?? row.created_at ?? null,
      updated_at: row.updated_at ?? row.created_at ?? null,
      raw: row,
    };
  }
  // qxo
  return {
    supplier,
    id: row.id,
    confirmation_number: row.beacon_order_id ?? null,
    supplier_order_number: row.job_number ?? row.beacon_order_id ?? null,
    po_number: row.po_number ?? null,
    status: row.status_value ?? row.status_code ?? null,
    total_amount: row.total ?? null,
    ordered_at: row.order_placed_date ?? row.created_at ?? null,
    updated_at: row.last_synced_at ?? row.updated_at ?? row.created_at ?? null,
    raw: row,
  };
}

function statusVariant(status: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!status) return 'outline';
  const s = status.toLowerCase();
  if (['delivered', 'accepted', 'confirmed', 'complete', 'completed', 'invoiced'].some(k => s.includes(k))) return 'default';
  if (['cancel', 'reject', 'fail', 'error'].some(k => s.includes(k))) return 'destructive';
  if (['queue', 'pending', 'submit', 'process'].some(k => s.includes(k))) return 'secondary';
  return 'outline';
}

export default function SupplierOrderHistory() {
  const navigate = useNavigate();
  const tenantId = useEffectiveTenantId();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<SupplierKey | 'all' | null>(null);
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
  const [connections, setConnections] = useState<Record<SupplierKey, ConnectionState>>({
    abc: { status: 'unknown', environment: null, updated_at: null },
    srs: { status: 'unknown', environment: null, updated_at: null },
    qxo: { status: 'unknown', environment: null, updated_at: null },
  });
  const [filter, setFilter] = useState<SupplierKey | 'all'>('all');
  const [search, setSearch] = useState('');
  const [inspect, setInspect] = useState<UnifiedOrder | null>(null);

  const loadConnections = useCallback(async () => {
    if (!tenantId) return;
    const next: Record<SupplierKey, ConnectionState> = {
      abc: { status: 'disconnected', environment: null, updated_at: null },
      srs: { status: 'disconnected', environment: null, updated_at: null },
      qxo: { status: 'disconnected', environment: null, updated_at: null },
    };
    await Promise.all(SUPPLIERS.map(async (s) => {
      const { data } = await supabase
        .from(s.connectionsTable)
        .select('connection_status, environment, updated_at')
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false });
      if (data && data.length) {
        const connected = data.find((r: any) => r.connection_status === 'connected') ?? data[0];
        next[s.key] = {
          status: (connected.connection_status as ConnectionState['status']) ?? 'unknown',
          environment: connected.environment ?? null,
          updated_at: connected.updated_at ?? null,
        };
      }
    }));
    setConnections(next);
  }, [tenantId]);

  const loadOrders = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const all: UnifiedOrder[] = [];
      await Promise.all(SUPPLIERS.map(async (s) => {
        const { data, error } = await supabase
          .from(s.ordersTable)
          .select('*')
          .eq('tenant_id', tenantId)
          .order('updated_at', { ascending: false })
          .limit(200);
        if (error) {
          console.error(`[${s.key}] orders fetch error`, error);
          return;
        }
        (data ?? []).forEach((row) => all.push(normalizeOrder(s.key, row)));
      }));
      all.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
      setOrders(all);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadConnections();
    loadOrders();
  }, [loadConnections, loadOrders]);

  const handleRefresh = async (key: SupplierKey | 'all') => {
    setRefreshing(key);
    try {
      const targets = key === 'all' ? SUPPLIERS : SUPPLIERS.filter(s => s.key === key);
      await Promise.all(targets.map(async (s) => {
        if (!s.refreshFn) return;
        if (connections[s.key].status !== 'connected') return;
        try {
          await supabase.functions.invoke(s.refreshFn.name, { body: s.refreshFn.body ?? {} });
        } catch (e) {
          console.error(`[${s.key}] refresh failed`, e);
        }
      }));
      await Promise.all([loadConnections(), loadOrders()]);
      toast.success(key === 'all' ? 'All suppliers refreshed' : `${key.toUpperCase()} refreshed`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Refresh failed');
    } finally {
      setRefreshing(null);
    }
  };

  const countsBySupplier = useMemo(() => {
    const c: Record<SupplierKey, number> = { abc: 0, srs: 0, qxo: 0 };
    orders.forEach((o) => { c[o.supplier]++; });
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter !== 'all' && o.supplier !== filter) return false;
      if (!term) return true;
      return [o.confirmation_number, o.supplier_order_number, o.po_number, o.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [orders, filter, search]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Supplier Order History</h1>
            <p className="text-muted-foreground">All ABC, SRS, and QXO orders for your company</p>
          </div>
        </div>
        <Button onClick={() => handleRefresh('all')} disabled={refreshing !== null}>
          <RefreshCcw className={`h-4 w-4 mr-2 ${refreshing === 'all' ? 'animate-spin' : ''}`} />
          Refresh All
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SUPPLIERS.map((s) => {
          const conn = connections[s.key];
          const isConnected = conn.status === 'connected';
          const Icon = isConnected ? CheckCircle2 : conn.status === 'pending' ? AlertCircle : XCircle;
          const iconColor = isConnected ? 'text-emerald-500' : conn.status === 'pending' ? 'text-amber-500' : 'text-muted-foreground';
          return (
            <Card key={s.key} variant={isConnected ? 'interactive' : 'default'}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Truck className="h-5 w-5 text-primary" />
                    <div>
                      <CardTitle className="text-lg">{s.label}</CardTitle>
                      <CardDescription className="text-xs">{s.description}</CardDescription>
                    </div>
                  </div>
                  <Icon className={`h-5 w-5 ${iconColor}`} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant={isConnected ? 'default' : 'outline'} className="capitalize">
                    {conn.status}
                  </Badge>
                  {conn.environment && (
                    <Badge variant="secondary" className="capitalize">{conn.environment}</Badge>
                  )}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Orders on file</span>
                  <span className="font-semibold">{countsBySupplier[s.key]}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Last update</span>
                  <span>
                    {conn.updated_at
                      ? formatDistanceToNow(new Date(conn.updated_at), { addSuffix: true })
                      : '—'}
                  </span>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setFilter(s.key)}
                  >
                    View orders
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRefresh(s.key)}
                    disabled={refreshing !== null}
                  >
                    <RefreshCcw className={`h-4 w-4 ${refreshing === s.key ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <CardTitle>Orders</CardTitle>
              <CardDescription>Confirmation #, supplier order #, and last update</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search confirmation, PO, status..."
                  className="pl-8 w-72"
                />
              </div>
              <div className="flex gap-1">
                {(['all', 'abc', 'srs', 'qxo'] as const).map((k) => (
                  <Button
                    key={k}
                    size="sm"
                    variant={filter === k ? 'default' : 'outline'}
                    onClick={() => setFilter(k)}
                  >
                    {k === 'all' ? 'All' : k.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No supplier orders found for this company yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Confirmation #</TableHead>
                  <TableHead>Supplier Order #</TableHead>
                  <TableHead>PO #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Last update</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o) => (
                  <TableRow key={`${o.supplier}-${o.id}`}>
                    <TableCell>
                      <Badge variant="outline" className="uppercase">{o.supplier}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{o.confirmation_number ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{o.supplier_order_number ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{o.po_number ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(o.status)} className="capitalize">
                        {o.status ?? 'unknown'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {o.total_amount != null ? formatCurrency(Number(o.total_amount)) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {o.updated_at
                        ? formatDistanceToNow(new Date(o.updated_at), { addSuffix: true })
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setInspect(o)}>
                        <Eye className="h-4 w-4 mr-1" /> Inspect
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!inspect} onOpenChange={(open) => !open && setInspect(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {inspect ? `${inspect.supplier.toUpperCase()} Order` : 'Order'}
            </DialogTitle>
            <DialogDescription>
              Summary of the data we hold for this supplier order
            </DialogDescription>
          </DialogHeader>
          {inspect && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <SummaryRow label="Supplier" value={inspect.supplier.toUpperCase()} />
                <SummaryRow label="Status" value={inspect.status ?? '—'} />
                <SummaryRow label="Confirmation #" value={inspect.confirmation_number ?? '—'} mono />
                <SummaryRow label="Supplier Order #" value={inspect.supplier_order_number ?? '—'} mono />
                <SummaryRow label="PO #" value={inspect.po_number ?? '—'} mono />
                <SummaryRow
                  label="Total"
                  value={inspect.total_amount != null ? formatCurrency(Number(inspect.total_amount)) : '—'}
                />
                <SummaryRow
                  label="Ordered"
                  value={inspect.ordered_at ? format(new Date(inspect.ordered_at), 'PPp') : '—'}
                />
                <SummaryRow
                  label="Last update"
                  value={inspect.updated_at ? format(new Date(inspect.updated_at), 'PPp') : '—'}
                />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Raw payload
                </div>
                <pre className="bg-muted rounded p-3 text-xs overflow-auto max-h-72">
                  {JSON.stringify(inspect.raw, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-sm' : 'text-sm font-medium'}>{value}</span>
    </div>
  );
}
