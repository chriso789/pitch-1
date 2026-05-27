import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Truck, Package, CheckCircle2, Clock, Receipt, Image as ImageIcon, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { format, formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface Props {
  projectId: string;
  compact?: boolean;
}

type SupplierBadge = 'SRS' | 'QXO';

interface OrderDoc {
  id: string;
  doc_type: string;
  file_name: string | null;
  mime_type: string | null;
  storage_path: string | null;
  captured_at: string | null;
  signedUrl?: string;
}

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
  deliveryDate?: string | null;
  onHold?: boolean;
  rawId: string;
  docs: OrderDoc[];
}

// 4-step supplier delivery flow
const STAGES = [
  { key: 'submitted', label: 'Submitted', icon: Package },
  { key: 'received', label: 'Received by Supplier', icon: CheckCircle2 },
  { key: 'shipped', label: 'Out for Delivery', icon: Truck },
  { key: 'delivered', label: 'Delivered', icon: CheckCircle2 },
];

function stageIndex(status?: string | null, hasExternalId?: boolean): number {
  const s = (status || '').toLowerCase();
  if (s.includes('deliver') || s === 'iu') return 3;
  if (s.includes('ship') || s === 'du' || s.includes('out_for')) return 2;
  if (s.includes('confirm') || s.includes('process') || s.includes('received') || s === 'oc' || s === 'oa' || s === 'accepted' || s === 'acknowledged') return 1;
  if (s.includes('submit') || s === 'ou' || s === 'queued' || hasExternalId) return 0;
  return 0;
}

const SRS_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  queued: 'Queued at SRS',
  submitted: 'Submitted',
  accepted: 'Accepted',
  rejected_by_srs: 'Rejected by SRS',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  ou: 'Submitted',
  oc: 'Confirmed by SRS',
  du: 'Out for Delivery',
  iu: 'Invoiced / Delivered',
};

function prettyStatus(raw?: string | null): string {
  const s = (raw || '').toLowerCase();
  if (!s) return 'Unknown';
  if (SRS_STATUS_LABELS[s]) return SRS_STATUS_LABELS[s];
  return raw!.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function LiveOrderTracker({ projectId, compact = false }: Props) {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const signDocs = async (docs: OrderDoc[]): Promise<OrderDoc[]> => {
    if (docs.length === 0) return docs;
    const paths = docs.map(d => d.storage_path).filter(Boolean) as string[];
    if (paths.length === 0) return docs;
    const { data } = await supabase.storage
      .from('srs-order-documents')
      .createSignedUrls(paths, 3600);
    const map = new Map<string, string>();
    (data || []).forEach((r: any) => { if (r.path && r.signedUrl) map.set(r.path, r.signedUrl); });
    return docs.map(d => ({ ...d, signedUrl: d.storage_path ? map.get(d.storage_path) : undefined }));
  };

  const fetchOrders = useCallback(async () => {
    if (!tenantId || !projectId) return;

    // Resolve all sibling project ids tied to the same customer so orders
    // placed under a previous pipeline entry / job for the same contact
    // still surface on the current lead page.
    const relatedIds = new Set<string>([projectId]);
    try {
      // The incoming projectId may be a pipeline_entries.id, jobs.id, OR projects.id.
      // SRS orders are stored against projects.id (see PushToSupplierDialog), so we
      // must resolve across all three tables and union every related id.
      let contactId: string | null = null;

      // 1) pipeline_entries lookup
      const { data: pe } = await supabase
        .from('pipeline_entries')
        .select('id, contact_id')
        .eq('id', projectId)
        .maybeSingle();
      if ((pe as any)?.contact_id) contactId = (pe as any).contact_id;

      // 2) jobs lookup
      if (!contactId) {
        const { data: jb } = await supabase
          .from('jobs')
          .select('id, contact_id, pipeline_entry_id')
          .eq('id', projectId)
          .maybeSingle();
        contactId = (jb as any)?.contact_id || null;
        if ((jb as any)?.pipeline_entry_id) relatedIds.add((jb as any).pipeline_entry_id);
      }

      // 3) projects lookup (projectId could itself be a projects.id)
      // NOTE: public.projects has no `contact_id` column — derive contact from pipeline_entry.
      const { data: prjSelf } = await supabase
        .from('projects')
        .select('id, pipeline_entry_id')
        .eq('id', projectId)
        .maybeSingle();
      if (prjSelf) {
        relatedIds.add((prjSelf as any).id);
        if ((prjSelf as any).pipeline_entry_id) relatedIds.add((prjSelf as any).pipeline_entry_id);
      }

      // 4) projects linked to this pipeline_entry directly
      const { data: prjByPe } = await supabase
        .from('projects')
        .select('id, pipeline_entry_id')
        .eq('pipeline_entry_id', projectId)
        .eq('tenant_id', tenantId as any);
      (prjByPe || []).forEach((r: any) => {
        if (r.id) relatedIds.add(r.id);
        if (r.pipeline_entry_id) relatedIds.add(r.pipeline_entry_id);
      });

      // 5) fan out across every sibling for the same contact
      if (contactId) {
        // Pipeline entries for this contact
        const { data: peList } = await (supabase.from('pipeline_entries') as any)
          .select('id')
          .eq('contact_id', contactId)
          .eq('tenant_id', tenantId);
        const peIds = (peList || []).map((r: any) => r.id).filter(Boolean);
        peIds.forEach((id: string) => relatedIds.add(id));

        // Jobs for this contact
        const { data: jobList } = await (supabase.from('jobs') as any)
          .select('id, pipeline_entry_id')
          .eq('contact_id', contactId)
          .eq('tenant_id', tenantId);
        (jobList || []).forEach((r: any) => {
          if (r.id) relatedIds.add(r.id);
          if (r.pipeline_entry_id) relatedIds.add(r.pipeline_entry_id);
        });

        // Projects tied to any sibling pipeline_entry (projects has no contact_id)
        if (peIds.length) {
          const { data: prjList } = await (supabase.from('projects') as any)
            .select('id, pipeline_entry_id')
            .in('pipeline_entry_id', peIds)
            .eq('tenant_id', tenantId);
          (prjList || []).forEach((r: any) => {
            if (r.id) relatedIds.add(r.id);
            if (r.pipeline_entry_id) relatedIds.add(r.pipeline_entry_id);
          });
        }
      }
    } catch (e) {
      // Non-fatal — fall back to direct projectId match
      console.warn('[LiveOrderTracker] sibling id resolution failed', e);
    }

    const idList = Array.from(relatedIds);

    const [srsRes, qxoRes] = await Promise.all([
      (supabase
        .from('srs_orders') as any)
        .select('id, order_number, srs_order_id, branch_code, status, total_amount, delivery_address, delivery_date, submitted_at, updated_at, project_id')
        .eq('tenant_id', tenantId)
        .in('project_id', idList)
        .order('created_at', { ascending: false }),
      (supabase
        .from('qxo_orders') as any)
        .select('id, po_number, beacon_order_id, status_code, status_value, on_hold, total, ship_address, order_placed_date, last_synced_at, selling_branch')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
    ]);

    const srsIds = (srsRes.data || []).map((o: any) => o.id);
    const docsByOrder = new Map<string, OrderDoc[]>();
    if (srsIds.length) {
      const { data: docs } = await supabase
        .from('srs_order_documents')
        .select('id, order_id, doc_type, file_name, mime_type, storage_path, captured_at')
        .in('order_id', srsIds)
        .order('captured_at', { ascending: false });
      for (const d of (docs || []) as any[]) {
        const arr = docsByOrder.get(d.order_id) || [];
        arr.push(d);
        docsByOrder.set(d.order_id, arr);
      }
      // Sign URLs in batch
      const allDocs = Array.from(docsByOrder.values()).flat();
      const signed = await signDocs(allDocs);
      const signedById = new Map(signed.map(s => [s.id, s]));
      for (const [k, arr] of docsByOrder.entries()) {
        docsByOrder.set(k, arr.map(d => signedById.get(d.id) || d));
      }
    }

    const unified: UnifiedOrder[] = [];
    (srsRes.data || []).forEach((o: any) => {
      // Hide pure drafts (never submitted)
      if ((o.status || '').toLowerCase() === 'draft' && !o.srs_order_id) return;
      unified.push({
        id: `srs:${o.id}`,
        rawId: o.id,
        supplier: 'SRS',
        poNumber: o.order_number,
        externalId: o.srs_order_id,
        status: o.status,
        statusLabel: prettyStatus(o.status),
        branch: o.branch_code,
        total: Number(o.total_amount || 0),
        shipAddress: o.delivery_address,
        submittedAt: o.submitted_at,
        lastSyncedAt: o.updated_at,
        deliveryDate: o.delivery_date,
        docs: docsByOrder.get(o.id) || [],
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
        statusLabel: o.status_value || prettyStatus(o.status_code) || 'Submitted',
        branch: o.selling_branch,
        total: Number(o.total || 0),
        shipAddress: o.ship_address?.freeForm || o.ship_address?.address1,
        submittedAt: o.order_placed_date,
        lastSyncedAt: o.last_synced_at,
        onHold: o.on_hold,
        docs: [],
      });
    });
    setOrders(unified);
    setLoading(false);
  }, [tenantId, projectId]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    if (!tenantId || !projectId) return;
    const channel = supabase
      .channel(`orders-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'srs_orders' }, () => fetchOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'srs_order_status_history' }, () => fetchOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'srs_order_documents' }, () => fetchOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qxo_orders' }, () => fetchOrders())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId, projectId, fetchOrders]);

  const refresh = async (o: UnifiedOrder) => {
    setRefreshingId(o.id);
    try {
      if (o.supplier === 'SRS') {
        const { data, error } = await supabase.functions.invoke('srs-api-proxy', {
          body: { action: 'get_order_status', tenant_id: tenantId, order_id: o.rawId },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
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
            <Badge variant="outline" className="ml-auto">Awaiting order</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed p-4">
            <div className="flex items-start justify-between gap-1">
              {STAGES.map((s) => {
                const Icon = s.icon;
                return (
                  <div key={s.key} className="flex flex-1 flex-col items-center text-center">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="mt-1 text-[10px] leading-tight text-muted-foreground">
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 text-center text-xs text-muted-foreground">
              No active supplier orders yet. Use "Push to Supplier" to create one — the tracker will populate automatically.
            </div>
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
          const activeIdx = stageIndex(o.status, !!o.externalId);
          return (
            <div key={o.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">{o.supplier}</Badge>
                    <span className="font-medium">{o.poNumber}</span>
                    {o.externalId && (
                      <span className="text-xs text-muted-foreground">→ {o.externalId}</span>
                    )}
                    <Badge
                      variant="outline"
                      className={
                        o.status?.toLowerCase().includes('reject') ? 'text-destructive border-destructive' :
                        o.status?.toLowerCase() === 'queued' ? 'text-amber-600 border-amber-600' :
                        activeIdx === 3 ? 'text-emerald-700 border-emerald-500' :
                        'text-foreground'
                      }
                    >
                      {o.status?.toLowerCase() === 'queued' && (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      )}
                      {o.statusLabel}
                    </Badge>
                    {o.onHold && <Badge variant="outline" className="text-amber-600 border-amber-600">On Hold</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {o.branch && <>Branch {o.branch} · </>}
                    {o.total ? `$${o.total.toLocaleString()}` : ''}
                    {o.submittedAt && <> · Sent {format(new Date(o.submittedAt), 'MMM d, h:mm a')}</>}
                    {o.deliveryDate && <> · Delivery {format(new Date(o.deliveryDate), 'MMM d, yyyy')}</>}
                    {o.lastSyncedAt && <> · Synced {formatDistanceToNow(new Date(o.lastSyncedAt), { addSuffix: true })}</>}
                  </div>
                  {!compact && o.shipAddress && (
                    <div className="mt-1 text-xs text-muted-foreground">Ship to: {o.shipAddress}</div>
                  )}
                </div>
                <Button size="sm" variant="ghost" onClick={() => refresh(o)} disabled={refreshingId === o.id}>
                  {refreshingId === o.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>

              {/* Supplier confirmation banner */}
              {o.externalId && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900 p-2.5">
                  <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs">
                    <div className="font-medium text-green-900 dark:text-green-200">
                      Confirmed received by {o.supplier}
                    </div>
                    <div className="text-green-700 dark:text-green-300 mt-0.5 break-all">
                      Order ID: <span className="font-mono">{o.externalId}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 flex items-start justify-between gap-1">
                {STAGES.map((s, idx) => {
                  const reached = idx <= activeIdx;
                  const Icon = s.icon;
                  return (
                    <div key={s.key} className="flex flex-1 flex-col items-center text-center">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full ${
                        reached ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className={`mt-1 text-[10px] leading-tight ${reached ? 'font-medium' : 'text-muted-foreground'}`}>
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {o.docs.length > 0 && (
                <div className="mt-3 border-t pt-3">
                  <div className="text-xs font-medium mb-2 flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" /> Delivery Documents ({o.docs.length})
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {o.docs.map(d => {
                      const isImg = (d.mime_type || '').startsWith('image/');
                      return (
                        <a
                          key={d.id}
                          href={d.signedUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group relative aspect-square rounded border overflow-hidden bg-muted flex items-center justify-center hover:ring-2 hover:ring-primary transition"
                          title={`${d.file_name || d.doc_type}${d.captured_at ? ` · ${format(new Date(d.captured_at), 'MMM d, h:mm a')}` : ''}`}
                        >
                          {isImg && d.signedUrl ? (
                            <img src={d.signedUrl} alt={d.file_name || 'delivery'} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <FileText className="h-6 w-6 text-muted-foreground" />
                          )}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

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
