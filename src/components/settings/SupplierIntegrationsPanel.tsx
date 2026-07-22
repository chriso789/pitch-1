import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, Truck, Building2, Package, FileText, CreditCard, ExternalLink, DollarSign } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAbcConnectionStatus } from '@/hooks/useAbcConnectionStatus';
import { useSrsConnectionStatus } from '@/hooks/useSrsConnectionStatus';
import { useQxoConnectionStatus } from '@/hooks/useQxoConnectionStatus';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { ConnectSupplierDialog } from './ConnectSupplierDialog';

type SupplierKey = 'abc' | 'srs' | 'qxo';


interface SupplierStatus {
  connected: boolean;
  lastValidatedAt: string | null;
  lastError: string | null;
  lastOrderAt: string | null;
  lastOrderStatus: string | null;
  ordersCount: number;
}

interface OrderRow {
  id: string;
  supplier: SupplierKey;
  reference: string;
  status: string;
  createdAt: string;
  branch: string | null;
}

const SUPPLIER_META: Record<SupplierKey, { name: string; description: string; icon: any; color: string; loginUrl: string }> = {
  abc: {
    name: 'ABC Supply',
    description: 'Live pricing and orders for shingles, underlayment, and accessories.',
    icon: Building2,
    color: 'text-orange-500 bg-orange-500/10',
    loginUrl: 'https://account.abcsupply.com/orderdraft/login',
  },
  srs: {
    name: 'SRS Distribution',
    description: 'Order materials and track deliveries from SRS branches.',
    icon: Truck,
    color: 'text-emerald-500 bg-emerald-500/10',
    loginUrl: 'https://myportal.srsdistribution.com/',
  },
  qxo: {
    name: 'QXO / Beacon',
    description: 'Pricing, orders, and invoice sync from QXO (Beacon) accounts.',
    icon: Package,
    color: 'text-blue-500 bg-blue-500/10',
    loginUrl: 'https://my.becn.com/',
  },
};

const EMPTY_STATUS: SupplierStatus = {
  connected: false,
  lastValidatedAt: null,
  lastError: null,
  lastOrderAt: null,
  lastOrderStatus: null,
  ordersCount: 0,
};

interface Props {
  /** Caller can request the advanced developer tab from outside. */
  onOpenAdvanced?: (supplier: SupplierKey) => void;
}

/**
 * Customer-facing supplier integrations panel. Strictly tenant-scoped:
 * every query filters by useEffectiveTenantId() and RLS enforces it
 * server-side as well. Hides all OAuth URLs / raw audit / WAF / sandbox
 * tooling — those belong in the Advanced (Developer) tab.
 */
export function SupplierIntegrationsPanel({ onOpenAdvanced }: Props) {
  const navigate = useNavigate();
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const abcStatus = useAbcConnectionStatus();
  const srsStatus = useSrsConnectionStatus();
  const qxoStatus = useQxoConnectionStatus();
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<Record<SupplierKey, SupplierStatus>>({
    abc: EMPTY_STATUS,
    srs: EMPTY_STATUS,
    qxo: EMPTY_STATUS,
  });
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectSupplier, setConnectSupplier] = useState<SupplierKey | null>(null);
  const [disconnecting, setDisconnecting] = useState<SupplierKey | null>(null);
  const [startingAbcOAuth, setStartingAbcOAuth] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;


    const load = async () => {
      setLoading(true);
      try {
        const [abcConn, srsConn, qxoConn, abcOrders, srsOrders, qxoOrders] = await Promise.all([
          (supabase as any).from('abc_connections').select('connection_status, last_validated_at, last_error, updated_at').eq('tenant_id', tenantId).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
          (supabase as any).from('srs_connections').select('connection_status, last_validated_at, last_error, updated_at').eq('tenant_id', tenantId).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
          (supabase as any).from('qxo_connections').select('connection_status, last_validated_at, last_error, has_credentials, updated_at').eq('tenant_id', tenantId).maybeSingle(),
          (supabase as any).from('abc_orders').select('id, order_number, confirmation_number, order_status, branch_number, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(20),
          (supabase as any).from('srs_orders').select('id, order_number, order_status, branch_code, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(20),
          (supabase as any).from('qxo_orders').select('id, order_number, order_status, branch_code, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(20),
        ]);

        if (cancelled) return;

        const abcOrderRows: OrderRow[] = ((abcOrders?.data as any[]) || []).map((o) => ({
          id: o.id,
          supplier: 'abc',
          reference: o.order_number || o.confirmation_number || '—',
          status: o.order_status || 'pending',
          createdAt: o.created_at,
          branch: o.branch_number,
        }));
        const srsOrderRows: OrderRow[] = ((srsOrders?.data as any[]) || []).map((o) => ({
          id: o.id,
          supplier: 'srs',
          reference: o.order_number || '—',
          status: o.order_status || 'pending',
          createdAt: o.created_at,
          branch: o.branch_code,
        }));
        const qxoOrderRows: OrderRow[] = ((qxoOrders?.data as any[]) || []).map((o) => ({
          id: o.id,
          supplier: 'qxo',
          reference: o.order_number || '—',
          status: o.order_status || 'pending',
          createdAt: o.created_at,
          branch: o.branch_code,
        }));

        const combined = [...abcOrderRows, ...srsOrderRows, ...qxoOrderRows].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        const next: Record<SupplierKey, SupplierStatus> = {
          abc: {
            connected: abcConn?.data?.connection_status === 'connected',
            lastValidatedAt: abcConn?.data?.last_validated_at ?? null,
            lastError: abcConn?.data?.last_error ?? null,
            lastOrderAt: abcOrderRows[0]?.createdAt ?? null,
            lastOrderStatus: abcOrderRows[0]?.status ?? null,
            ordersCount: abcOrderRows.length,
          },
          srs: {
            connected: srsConn?.data?.connection_status === 'connected',
            lastValidatedAt: srsConn?.data?.last_validated_at ?? null,
            lastError: srsConn?.data?.last_error ?? null,
            lastOrderAt: srsOrderRows[0]?.createdAt ?? null,
            lastOrderStatus: srsOrderRows[0]?.status ?? null,
            ordersCount: srsOrderRows.length,
          },
          qxo: {
            connected:
              qxoConn?.data?.connection_status === 'connected' ||
              !!qxoConn?.data?.has_credentials,
            lastValidatedAt: qxoConn?.data?.last_validated_at ?? null,
            lastError: qxoConn?.data?.last_error ?? null,
            lastOrderAt: qxoOrderRows[0]?.createdAt ?? null,
            lastOrderStatus: qxoOrderRows[0]?.status ?? null,
            ordersCount: qxoOrderRows.length,
          },
        };

        setStatuses(next);
        setOrders(combined.slice(0, 25));
      } catch (e) {
        console.error('[SupplierIntegrationsPanel] load failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [tenantId, reloadKey]);

  const startAbcOAuth = async () => {
    if (!tenantId) return;
    setStartingAbcOAuth(true);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: {
          action: 'start_oauth',
          tenant_id: tenantId,
          return_origin: window.location.origin,
        },
      });
      if (error) throw error;
      const url = (data as any)?.authorization_url;
      if (!url) {
        const msg = (data as any)?.human_message || 'ABC OAuth did not return an authorization URL.';
        throw new Error(msg);
      }
      // Full-page redirect into ABC's hosted Okta login. The callback edge
      // function writes the tenant-scoped abc_connections row.
      window.location.href = url;
    } catch (e: any) {
      toast({
        title: 'Could not start ABC connection',
        description: e?.message || 'Unknown error',
        variant: 'destructive',
      });
      setStartingAbcOAuth(false);
    }
  };

  const openConnect = (supplier: SupplierKey) => {
    // ABC uses the OAuth flow; SRS/QXO still use the credentials dialog.
    if (supplier === 'abc') {
      void startAbcOAuth();
      return;
    }
    setConnectSupplier(supplier);
    setConnectOpen(true);
  };

  const handleDisconnect = async (supplier: SupplierKey) => {
    if (!tenantId) return;
    if (!confirm(`Disconnect ${SUPPLIER_META[supplier].name}? Stored credentials will be removed.`)) return;
    setDisconnecting(supplier);
    try {
      if (supplier === 'srs') {
        const { error } = await supabase.functions.invoke('srs-api-proxy', {
          body: { action: 'revoke_credentials', tenant_id: tenantId },
        });
        if (error) throw error;
      } else if (supplier === 'qxo') {
        const { error } = await supabase.functions.invoke('qxo-save-credentials', {
          body: { tenant_id: tenantId, clear: true },
        });
        if (error) throw error;
      } else if (supplier === 'abc') {
        const environment = abcStatus.environment || 'production';
        const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
          body: { action: 'revoke_connection', tenant_id: tenantId, environment },
        });
        if (error) throw error;
        if (data && data.success === false) throw new Error(data.error || 'ABC disconnect failed');
      }

      toast({ title: `${SUPPLIER_META[supplier].name} disconnected` });
      setReloadKey((k) => k + 1);
      if (supplier === 'abc') void abcStatus.refresh();
      if (supplier === 'srs') void srsStatus.refresh();
      if (supplier === 'qxo') void qxoStatus.refresh();
    } catch (e: any) {
      toast({ title: 'Disconnect failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setDisconnecting(null);
    }
  };

  // Merge order-history-derived metadata (from `load()` above) with the
  // shared connection hooks so card "Connected/Not connected" badge is
  // the SAME value rendered in ABCConnectionSettings, AbcDiagnosticsPanel,
  // and PushToSupplierDialog. No more "Cox sees O'Brien connected".
  const mergedStatuses: Record<SupplierKey, SupplierStatus> = {
    abc: { ...statuses.abc, connected: abcStatus.isConnected },
    srs: { ...statuses.srs, connected: srsStatus.isConnected },
    qxo: { ...statuses.qxo, connected: qxoStatus.isConnected },
  };

  const cards = useMemo(
    () => (['abc', 'srs', 'qxo'] as SupplierKey[]).map((k) => ({
      key: k,
      meta: SUPPLIER_META[k],
      status: mergedStatuses[k],
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statuses, abcStatus.isConnected, srsStatus.isConnected, qxoStatus.isConnected],
  );


  if (!tenantId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Select a company to view supplier integrations.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Supplier Integrations</h2>
        <p className="text-muted-foreground">
          Connect your supplier accounts to send orders and track status from inside Pitch.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(({ key, meta, status }) => {
          const Icon = meta.icon;
          return (
            <Card key={key} className="flex flex-col overflow-hidden">
              <CardHeader className="space-y-3 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center ${meta.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                  ) : status.connected ? (
                    <Badge variant="default" className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600 whitespace-nowrap shrink-0">
                      <CheckCircle2 className="h-3 w-3" /> Connected
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1 whitespace-nowrap shrink-0">
                      <XCircle className="h-3 w-3" /> Not connected
                    </Badge>
                  )}
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base truncate">{meta.name}</CardTitle>
                  <CardDescription className="text-xs line-clamp-2 mt-0.5">{meta.description}</CardDescription>
                </div>
              </CardHeader>

              <CardContent className="flex-1 flex flex-col gap-2 text-xs">
                {key === 'srs' && status.connected ? (
                  <>
                    {srsStatus.row?.customer_name && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Customer</span>
                        <span className="font-medium text-right truncate ml-2">{srsStatus.row.customer_name}</span>
                      </div>
                    )}
                    {srsStatus.row?.customer_code && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Account #</span>
                        <span className="font-mono">{srsStatus.row.customer_code}</span>
                      </div>
                    )}
                    {(srsStatus.row?.home_branch_code || srsStatus.row?.default_branch_code) && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Home branch</span>
                        <span className="font-mono">{srsStatus.row?.home_branch_code || srsStatus.row?.default_branch_code}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-muted-foreground">
                      <span>Branches</span>
                      <span>{srsStatus.branchCount}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Last sync</span>
                      <span>
                        {srsStatus.row?.last_sync_at
                          ? formatDistanceToNow(new Date(srsStatus.row.last_sync_at), { addSuffix: true })
                          : status.lastValidatedAt
                            ? formatDistanceToNow(new Date(status.lastValidatedAt), { addSuffix: true })
                            : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Recent orders</span>
                      <span>{status.ordersCount}</span>
                    </div>
                  </>
                ) : key === 'qxo' && status.connected ? (
                  <>
                    {(qxoStatus.row?.account_number || qxoStatus.row?.account_id) && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Account #</span>
                        <span className="font-mono">{qxoStatus.row?.account_number || qxoStatus.row?.account_id}</span>
                      </div>
                    )}
                    {qxoStatus.row?.default_branch_code && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Default branch</span>
                        <span className="font-mono">{qxoStatus.row.default_branch_code}</span>
                      </div>
                    )}
                    {qxoStatus.row?.job_account && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Job account</span>
                        <span className="font-mono">{qxoStatus.row.job_account}</span>
                      </div>
                    )}
                    {qxoStatus.row?.branch_contact_name && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Branch contact</span>
                        <span className="text-right truncate ml-2">{qxoStatus.row.branch_contact_name}</span>
                      </div>
                    )}
                    {qxoStatus.row?.template_name && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Default template</span>
                        <span className="text-right truncate ml-2">{qxoStatus.row.template_name}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-muted-foreground">
                      <span>Branches</span>
                      <span>{qxoStatus.branchCount}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Last sync</span>
                      <span>
                        {(qxoStatus.row?.last_sync_at || qxoStatus.row?.last_validated_at)
                          ? formatDistanceToNow(new Date(qxoStatus.row.last_sync_at || qxoStatus.row.last_validated_at!), { addSuffix: true })
                          : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Recent orders</span>
                      <span>{status.ordersCount}</span>
                    </div>
                  </>
                ) : key === 'qxo' && (qxoStatus.state === 'needs_mapping' || qxoStatus.state === 'expired') ? (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] p-2">
                    {qxoStatus.state === 'needs_mapping'
                      ? 'Sign-in succeeded. Finish picking your QXO account and default branch to start ordering.'
                      : 'Your QXO sign-in expired. Reconnect to resume pricing and orders.'}
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Last sync</span>
                      <span>
                        {status.lastValidatedAt
                          ? formatDistanceToNow(new Date(status.lastValidatedAt), { addSuffix: true })
                          : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Last order</span>
                      <span>
                        {status.lastOrderAt
                          ? `${status.lastOrderStatus || 'pending'} · ${formatDistanceToNow(new Date(status.lastOrderAt), { addSuffix: true })}`
                          : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Recent orders</span>
                      <span>{status.ordersCount}</span>
                    </div>
                  </>
                )}
                {status.lastError && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-[11px] p-2">
                    {status.lastError}
                  </div>
                )}
                <div className="mt-auto pt-3 flex flex-wrap gap-2">
                  {status.connected ? (
                    <>
                      {onOpenAdvanced && (
                        <Button size="sm" variant="outline" onClick={() => onOpenAdvanced(key)}>
                          Manage
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/supplier-verify/${key}`)}
                        title={`Verify ${meta.name} item mappings and pull live pricing`}
                      >
                        <DollarSign className="h-3 w-3 mr-1" />
                        Verify Pricing
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={disconnecting === key}
                        onClick={() => handleDisconnect(key)}
                      >
                        {disconnecting === key && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                        Disconnect
                      </Button>
                      {/* Optional secondary link to the supplier's own portal.
                          Only shown AFTER the tenant has connected, never as
                          the connect action itself — the portal carries
                          whatever public browser session the user happens to
                          have, which is how Cox previously landed in
                          O'Brien's ABC account. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => window.open(meta.loginUrl, '_blank', 'noopener,noreferrer')}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Open {meta.name} portal
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full min-w-0"
                      onClick={() => openConnect(key)}
                      disabled={key === 'abc' && startingAbcOAuth}
                    >
                      {key === 'abc' && startingAbcOAuth && (
                        <Loader2 className="h-3 w-3 mr-1 shrink-0 animate-spin" />
                      )}
                      <span className="truncate">Connect {meta.name}</span>
                    </Button>

                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Billtrust — payments integration placeholder */}
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center text-violet-500 bg-violet-500/10">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base">Billtrust</CardTitle>
                  <CardDescription className="text-xs line-clamp-2">
                    Supplier invoice payments and AR reconciliation.
                  </CardDescription>
                </div>
              </div>
              <Badge variant="secondary" className="gap-1">Coming soon</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-2 text-xs">
            <p className="text-muted-foreground">
              Pay supplier invoices and reconcile statements automatically. Available in an upcoming release.
            </p>
            <div className="mt-auto pt-3">
              <Button size="sm" variant="outline" disabled>Notify Me</Button>
            </div>
          </CardContent>
        </Card>
      </div>


      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Supplier Order History
          </CardTitle>
          <CardDescription>
            Orders sent from your company across all connected suppliers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No supplier orders yet. Connect a supplier above, then send your first order from a project's Materials tab.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left font-medium py-2 pr-3">Supplier</th>
                    <th className="text-left font-medium py-2 pr-3">Reference</th>
                    <th className="text-left font-medium py-2 pr-3">Branch</th>
                    <th className="text-left font-medium py-2 pr-3">Status</th>
                    <th className="text-left font-medium py-2 pr-3">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={`${o.supplier}-${o.id}`} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className="uppercase">{o.supplier}</Badge>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{o.reference}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{o.branch || '—'}</td>
                      <td className="py-2 pr-3 capitalize">{o.status}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {formatDistanceToNow(new Date(o.createdAt), { addSuffix: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConnectSupplierDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        supplier={connectSupplier}
        tenantId={tenantId}
        onConnected={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}

