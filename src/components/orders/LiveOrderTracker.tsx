import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Truck, Package, CheckCircle2, Clock, Receipt } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { format, formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface Props {
  projectId: string;
  compact?: boolean;
}

type SupplierBadge = 'SRS' | 'QXO';

interface UnifiedOrder {
  id: string;
  supplier: SupplierBadge;
  poNumber: string;
  externalId?: string | null;
  status: string;
  statusLabel: string;
  branch?: string | null;
  total?: number | null;
  shipAddress?: string | null;
  submittedAt?: string | null;
  lastSyncedAt?: string | null;
  onHold?: boolean;
  rawId: string;
}

const SRS_STAGES = [
  { code: 'submitted', label: 'Submitted', icon: Package },
  { code: 'OC', label: 'Confirmed', icon: CheckCircle2 },
  { code: 'DU', label: 'In Fulfillment', icon: Truck },
  { code: 'IU', label: 'Invoiced', icon: Receipt },
];

const QXO_STAGES = [
  { code: 'submitted', label: 'Submitted', icon: Package },
  { code: 'confirmed', label: 'Confirmed', icon: CheckCircle2 },
  { code: 'shipped', label: 'Shipped', icon: Truck },
  { code: 'invoiced', label: 'Invoiced', icon: Receipt },
];

function srsStageIndex(statusCode?: string | null): number {
  if (!statusCode) return 0;
  const c = statusCode.toUpperCase();
  if (c.startsWith('IU')) return 3;
  if (c.startsWith('DU')) return 2;
  if (c.startsWith('OC')) return 1;
  return 0;
}

function qxoStageIndex(status?: string | null): number {
  const s = (status || '').toLowerCase();
  if (s.includes('invoice')) return 3;
  if (s.includes('ship') || s.includes('deliver')) return 2;
  if (s.includes('confirm')) return 1;
  return 0;
}

export function LiveOrderTracker({ projectId, compact = false }: Props) {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!tenantId || !projectId) return;
    const [srsRes, qxoRes] = await Promise.all([
      supabase
        .from('srs_orders')
        .select('id, order_number, srs_order_id, branch_code, status, total_amount, delivery_address, submitted_at, updated_at, notes')
        .eq('tenant_id', tenantId as any)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
      supabase
        .from('qxo_orders')
        .select('id, po_number, beacon_order_id, status_code, status_value, on_hold, total, ship_address, order_placed_date, last_synced_at, selling_branch')
        .eq('tenant_id', tenantId as any)
        .order('created_at', { ascending: false }),
    ]);

    const unified: UnifiedOrder[] = [];
    (srsRes.data || []).forEach((o: any) => {
      unified.push({
        id: `srs:${o.id}`,
        rawId: o.id,
        supplier: 'SRS',
        poNumber: o.order_number,
        externalId: o.srs_order_id,
        status: o.status,
        statusLabel: o.status,
        branch: o.branch_code,
        total: Number(o.total_amount || 0),
        shipAddress: o.delivery_address,
        submittedAt: o.submitted_at,
        lastSyncedAt: o.updated_at,
      });
    });
    (qxoRes.data || []).forEach((o: any) => {
      unified.push({
        id: `qxo:${o.id}`,
        rawId: o.id,
        supplier: 'QXO',
        poNumber: o.po_number,
        externalId: o.beacon_order_id,
        status: o.status_code || o.status_value || 'submitted',
        statusLabel: o.status_value || o.status_code || 'Submitted',
        branch: o.selling_branch,
        total: Number(o.total || 0),
        shipAddress: o.ship_address?.freeForm || o.ship_address?.address1,
        submittedAt: o.order_placed_date,
        lastSyncedAt: o.last_synced_at,
        onHold: o.on_hold,
      });
    });
    setOrders(unified);
    setLoading(false);
  }, [tenantId, projectId]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Realtime subscriptions
  useEffect(() => {
    if (!tenantId || !projectId) return;
    const channel = supabase
      .channel(`orders-${projectId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'srs_orders', filter: `project_id=eq.${projectId}` },
        () => fetchOrders())
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'srs_order_status_history' },
        () => fetchOrders())
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'qxo_orders' },
        () => fetchOrders())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId, projectId, fetchOrders]);

  const refresh = async (o: UnifiedOrder) => {
    setRefreshingId(o.id);
    try {
      if (o.supplier === 'SRS') {
        await supabase.functions.invoke('srs-api-proxy', {
          body: { action: 'get_order_status', tenant_id: tenantId, order_id: o.rawId },
        });
      }
      await fetchOrders();
      toast({ title: 'Refreshed', description: `${o.supplier} ${o.poNumber} status updated.` });
    } catch (e: any) {
      toast({ title: 'Refresh failed', description: e.message, variant: 'destructive' });
    } finally {
      setRefreshingId(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="ml-2 text-sm">Loading live orders…</span>
        </CardContent>
      </Card>
    );
  }

  if (orders.length === 0) {
    if (compact) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4" /> Live Order Tracking
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-6 text-center text-sm text-muted-foreground">
            No active supplier orders for this project. Use “Push to Supplier” to create one.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className={compact ? 'py-3' : ''}>
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="h-4 w-4" /> Live Order Tracking
          <Badge variant="outline" className="ml-auto">{orders.length} active</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {orders.map(o => {
          const stages = o.supplier === 'SRS' ? SRS_STAGES : QXO_STAGES;
          const activeIdx = o.supplier === 'SRS' ? srsStageIndex(o.status) : qxoStageIndex(o.status);
          return (
            <div key={o.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{o.supplier}</Badge>
                    <span className="font-medium">{o.poNumber}</span>
                    {o.externalId && (
                      <span className="text-xs text-muted-foreground">→ {o.externalId}</span>
                    )}
                    {o.onHold && <Badge variant="outline" className="text-amber-600">On Hold</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {o.branch && <>Branch {o.branch} · </>}
                    {o.total ? `$${o.total.toLocaleString()}` : ''}
                    {o.submittedAt && <> · Submitted {format(new Date(o.submittedAt), 'MMM d, h:mm a')}</>}
                  </div>
                  {!compact && o.shipAddress && (
                    <div className="mt-1 text-xs text-muted-foreground">Ship to: {o.shipAddress}</div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => refresh(o)}
                  disabled={refreshingId === o.id}
                >
                  {refreshingId === o.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>

              <div className="mt-3 flex items-center justify-between gap-1">
                {stages.map((s, idx) => {
                  const reached = idx <= activeIdx;
                  const Icon = s.icon;
                  return (
                    <div key={s.code} className="flex flex-1 flex-col items-center">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full ${
                        reached ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className={`mt-1 text-[10px] ${reached ? 'font-medium' : 'text-muted-foreground'}`}>
                        {s.label}
                      </span>
                      {idx < stages.length - 1 && (
                        <div className={`absolute hidden ${reached ? 'bg-primary' : 'bg-muted'}`} />
                      )}
                    </div>
                  );
                })}
              </div>

              {o.lastSyncedAt && (
                <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Last update {formatDistanceToNow(new Date(o.lastSyncedAt), { addSuffix: true })}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
