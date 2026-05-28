import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Webhook,
  Bug,
  Copy,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { format, formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface Props {
  projectId?: string;
}

interface AbcOrderRow {
  id: string;
  tenant_id: string;
  request_id: string | null;
  purchase_order: string | null;
  order_number: string | null;
  confirmation_number: string | null;
  order_status: string | null;
  branch_number: string | null;
  ship_to_number: string | null;
  source: string | null;
  raw_payload: any;
  created_at: string;
  updated_at: string;
  // hydrated
  webhooks: WebhookEvent[];
  audit: AuditRow | null;
  job?: { job_number?: string | null; customer_name?: string | null; address?: string | null };
}

interface WebhookEvent {
  id: string;
  event_type: string | null;
  order_number: string | null;
  confirmation_number: string | null;
  payload: any;
  received_at: string;
  accepted: boolean;
}

interface AuditRow {
  id: string;
  action: string;
  endpoint: string | null;
  status_code: number | null;
  error_code: string | null;
  duration_ms: number | null;
  request_body_redacted: any;
  response_body: any;
  created_at: string;
}

function mapRejectMessage(o: AbcOrderRow): string | null {
  const status = (o.order_status || '').toLowerCase();
  if (!/reject|fail|cancel|error/.test(status)) return null;
  const resp = o.raw_payload?.response?.body;
  if (resp) {
    const c =
      resp?.error ||
      resp?.message ||
      resp?.errorMessage ||
      resp?.errors ||
      (Array.isArray(resp) ? resp?.[0]?.error || resp?.[0]?.message : null);
    if (c) return typeof c === 'string' ? c : JSON.stringify(c);
  }
  if (o.audit?.error_code) return `${o.audit.error_code} (HTTP ${o.audit.status_code ?? '—'})`;
  return `HTTP ${o.raw_payload?.response?.status ?? '—'}`;
}

export function AbcDiagnosticsPanel({ projectId }: Props) {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [orders, setOrders] = useState<AbcOrderRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);

    let q = (supabase as any)
      .from('abc_orders')
      .select(
        'id, tenant_id, request_id, purchase_order, order_number, confirmation_number, order_status, branch_number, ship_to_number, source, raw_payload, created_at, updated_at',
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (projectId) {
      const { data: links } = await (supabase as any)
        .from('abc_order_job_links')
        .select('order_id')
        .eq('tenant_id', tenantId)
        .or(`job_id.eq.${projectId},estimate_id.eq.${projectId}`);
      const ids = (links || []).map((l: any) => l.order_id).filter(Boolean);
      if (!ids.length) {
        setOrders([]);
        setLoading(false);
        return;
      }
      q = q.in('id', ids);
    }

    const { data: ordersData } = await q;
    const rows: AbcOrderRow[] = (ordersData || []).map((o: any) => ({
      ...o,
      webhooks: [],
      audit: null,
    }));

    if (rows.length === 0) {
      setOrders([]);
      setLoading(false);
      return;
    }

    // Webhook events — match on order_number OR confirmation_number for this tenant
    const orderNums = rows.map((r) => r.order_number).filter(Boolean) as string[];
    const confNums = rows.map((r) => r.confirmation_number).filter(Boolean) as string[];
    const webhookByKey = new Map<string, WebhookEvent[]>();
    if (orderNums.length || confNums.length) {
      const filters: string[] = [];
      if (orderNums.length) filters.push(`order_number.in.(${orderNums.map((s) => `"${s}"`).join(',')})`);
      if (confNums.length) filters.push(`confirmation_number.in.(${confNums.map((s) => `"${s}"`).join(',')})`);
      const { data: wh } = await (supabase as any)
        .from('abc_webhook_events')
        .select('id, event_type, order_number, confirmation_number, payload, received_at, accepted')
        .eq('tenant_id', tenantId)
        .or(filters.join(','))
        .order('received_at', { ascending: false })
        .limit(200);
      for (const w of (wh || []) as WebhookEvent[]) {
        const keys = [w.order_number, w.confirmation_number].filter(Boolean) as string[];
        for (const k of keys) {
          const arr = webhookByKey.get(k) || [];
          arr.push(w);
          webhookByKey.set(k, arr);
        }
      }
    }

    // Audit rows — pull latest 50 submit_test_order rows for this tenant, then match by requestId/purchaseOrder
    const { data: audit } = await (supabase as any)
      .from('abc_api_audit')
      .select(
        'id, action, endpoint, status_code, error_code, duration_ms, request_body_redacted, response_body, created_at',
      )
      .eq('tenant_id', tenantId)
      .in('action', ['submit_test_order', 'place_order', 'submit_order', 'get_order_status'])
      .order('created_at', { ascending: false })
      .limit(50);

    const auditByKey = (req: string | null, po: string | null): AuditRow | null => {
      for (const a of (audit || []) as AuditRow[]) {
        const body = a.request_body_redacted;
        const obj = Array.isArray(body) ? body[0] : body;
        const aReq = obj?.requestId ?? obj?.request_id;
        const aPo = obj?.purchaseOrder ?? obj?.purchase_order;
        if ((req && aReq === req) || (po && aPo === po)) return a;
      }
      return null;
    };

    // Job lookups
    const jobByOrderId = new Map<string, AbcOrderRow['job']>();
    const orderIds = rows.map((r) => r.id);
    if (orderIds.length) {
      const { data: links } = await (supabase as any)
        .from('abc_order_job_links')
        .select('order_id, job_id')
        .eq('tenant_id', tenantId)
        .in('order_id', orderIds);
      const projIds = Array.from(new Set((links || []).map((l: any) => l.job_id).filter(Boolean)));
      if (projIds.length) {
        const { data: projects } = await (supabase as any)
          .from('projects')
          .select('id, job_number, pipeline_entry_id')
          .eq('tenant_id', tenantId)
          .in('id', projIds);
        const peIds = Array.from(
          new Set(((projects as any[]) || []).map((p: any) => p.pipeline_entry_id).filter(Boolean)),
        );
        const peMap = new Map<string, any>();
        if (peIds.length) {
          const { data: pes } = await (supabase as any)
            .from('pipeline_entries')
            .select(
              'id, contacts!pipeline_entries_contact_id_fkey(first_name, last_name, company_name, address_street, address_city, address_state, address_zip)',
            )
            .eq('tenant_id', tenantId)
            .in('id', peIds);
          for (const pe of ((pes as any[]) || []) as any[]) peMap.set(pe.id, pe);
        }
        const projInfo = new Map<string, AbcOrderRow['job']>();
        for (const p of ((projects as any[]) || []) as any[]) {
          const pe = p.pipeline_entry_id ? peMap.get(p.pipeline_entry_id) : null;
          const c = pe?.contacts;
          const name = c
            ? c.company_name ||
              [c.first_name, c.last_name].filter(Boolean).join(' ').trim() ||
              null
            : null;
          const addr = c
            ? [c.address_street, [c.address_city, c.address_state].filter(Boolean).join(', '), c.address_zip]
                .filter(Boolean)
                .join(' · ')
            : null;
          projInfo.set(p.id, { job_number: p.job_number, customer_name: name, address: addr || null });
        }
        for (const l of (links || []) as any[]) {
          const info = projInfo.get(l.job_id);
          if (info) jobByOrderId.set(l.order_id, info);
        }
      }
    }

    setOrders(
      rows.map((r) => {
        const w = [
          ...(r.order_number ? webhookByKey.get(r.order_number) || [] : []),
          ...(r.confirmation_number ? webhookByKey.get(r.confirmation_number) || [] : []),
        ];
        // dedupe by id
        const seen = new Set<string>();
        const webhooks = w.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
        return {
          ...r,
          webhooks,
          audit: auditByKey(r.request_id, r.purchase_order),
          job: jobByOrderId.get(r.id),
        };
      }),
    );
    setLoading(false);
  }, [tenantId, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`abc-diag-${projectId || 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'abc_orders' }, () => load())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'abc_webhook_events' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [tenantId, projectId, load]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: label });
  };

  const refreshOne = async (o: AbcOrderRow) => {
    const tracker = o.order_number || o.confirmation_number;
    if (!tracker) {
      toast({
        title: 'No identifier',
        description: 'ABC did not return an order or confirmation number for status lookup.',
        variant: 'destructive',
      });
      return;
    }
    setRefreshingId(o.id);
    try {
      const numeric = /^\d+$/.test(tracker);
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: {
          action: 'get_order_status',
          orderNumber: numeric ? tracker : undefined,
          confirmationNumber: numeric ? undefined : tracker,
        },
      });
      if (error) throw error;
      toast({
        title: data?.success ? 'Status refreshed' : 'Refresh failed',
        description: data?.success ? 'ABC status updated.' : data?.error || 'See Inspect for details.',
        variant: data?.success ? 'default' : 'destructive',
      });
      await load();
    } catch (e: any) {
      toast({ title: 'Refresh failed', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setRefreshingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bug className="h-4 w-4" /> ABC Submit Diagnostics
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No ABC submit attempts {projectId ? 'for this project' : 'yet'}.
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => {
              const errMsg = mapRejectMessage(o);
              const webhookCount = o.webhooks.length;
              const lastWebhook = o.webhooks[0];
              const isExpanded = expanded === o.id;
              const status = (o.order_status || 'pending').toLowerCase();
              const failed = /reject|fail|cancel|error/.test(status);
              const received = !failed && webhookCount > 0;
              const transactionID = o.raw_payload?.transactionID || null;
              const tracker = o.order_number || o.confirmation_number;

              return (
                <div key={o.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0 space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30">
                          ABC
                        </Badge>
                        <span className="font-medium font-mono text-xs">
                          {o.purchase_order || o.request_id || '—'}
                        </span>
                        {failed ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertCircle className="h-3 w-3" /> {o.order_status}
                          </Badge>
                        ) : (
                          <Badge className="gap-1 bg-green-600 text-white hover:bg-green-600">
                            <CheckCircle2 className="h-3 w-3" /> {o.order_status || 'submitted'}
                          </Badge>
                        )}
                        {received && (
                          <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                            <CheckCircle2 className="h-3 w-3" /> Received
                            {lastWebhook &&
                              ` · ${format(new Date(lastWebhook.received_at), 'MMM d, h:mm a')}`}
                          </Badge>
                        )}
                        <Badge variant="outline" className="gap-1">
                          <Webhook className="h-3 w-3" /> {webhookCount} webhook
                          {webhookCount === 1 ? '' : 's'}
                        </Badge>
                        {o.source === 'sandbox' && (
                          <Badge variant="outline" className="text-[10px]">
                            sandbox
                          </Badge>
                        )}
                      </div>

                      {received && lastWebhook && (
                        <div className="rounded border border-emerald-600/30 bg-emerald-600/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-400">
                          Last ABC update:{' '}
                          <code className="font-semibold">{o.order_status || '—'}</code>
                          {lastWebhook.event_type && (
                            <span className="ml-1">— {lastWebhook.event_type}</span>
                          )}
                        </div>
                      )}

                      {(o.job?.job_number || o.job?.customer_name || o.job?.address) && (
                        <div className="rounded-md bg-muted/50 border px-2 py-1.5 text-xs space-y-0.5">
                          {o.job?.job_number && (
                            <div>
                              <span className="text-muted-foreground">Job:</span>{' '}
                              <span className="font-medium">{o.job.job_number}</span>
                            </div>
                          )}
                          {o.job?.customer_name && (
                            <div>
                              <span className="text-muted-foreground">Customer:</span>{' '}
                              {o.job.customer_name}
                            </div>
                          )}
                          {o.job?.address && (
                            <div>
                              <span className="text-muted-foreground">Address:</span> {o.job.address}
                            </div>
                          )}
                        </div>
                      )}

                      {!tracker && o.source === 'sandbox' && (
                        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
                          Sandbox order submitted. ABC did not return an order/confirmation number in
                          this response.
                        </div>
                      )}

                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div>
                          Submitted {format(new Date(o.created_at), 'MMM d yyyy, h:mm:ss a')} (
                          {formatDistanceToNow(new Date(o.created_at), { addSuffix: true })})
                        </div>
                        {o.branch_number && <div>Branch: {o.branch_number}</div>}
                        {o.ship_to_number && <div>Ship-To: {o.ship_to_number}</div>}
                        {o.order_number && (
                          <div className="flex items-center gap-1">
                            ABC orderNumber: <code className="text-[11px]">{o.order_number}</code>
                            <button onClick={() => copy(o.order_number!, 'orderNumber')}>
                              <Copy className="h-3 w-3 hover:text-foreground" />
                            </button>
                          </div>
                        )}
                        {o.confirmation_number && (
                          <div className="flex items-center gap-1">
                            confirmationNumber:{' '}
                            <code className="text-[11px]">{o.confirmation_number}</code>
                            <button
                              onClick={() => copy(o.confirmation_number!, 'confirmationNumber')}
                            >
                              <Copy className="h-3 w-3 hover:text-foreground" />
                            </button>
                          </div>
                        )}
                        {o.request_id && (
                          <div className="flex items-center gap-1">
                            requestId: <code className="text-[11px]">{o.request_id}</code>
                            <button onClick={() => copy(o.request_id!, 'requestId')}>
                              <Copy className="h-3 w-3 hover:text-foreground" />
                            </button>
                          </div>
                        )}
                        {o.purchase_order && (
                          <div className="flex items-center gap-1">
                            purchaseOrder: <code className="text-[11px]">{o.purchase_order}</code>
                            <button onClick={() => copy(o.purchase_order!, 'purchaseOrder')}>
                              <Copy className="h-3 w-3 hover:text-foreground" />
                            </button>
                          </div>
                        )}
                        {transactionID && (
                          <div className="flex items-center gap-1">
                            transactionID: <code className="text-[11px]">{transactionID}</code>
                            <button onClick={() => copy(String(transactionID), 'transactionID')}>
                              <Copy className="h-3 w-3 hover:text-foreground" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpanded(isExpanded ? null : o.id)}
                      >
                        {isExpanded ? 'Hide' : 'Inspect'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => refreshOne(o)}
                        disabled={!tracker || refreshingId === o.id}
                      >
                        {refreshingId === o.id ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                        )}
                        Refresh Status
                      </Button>
                    </div>
                  </div>

                  {errMsg && (
                    <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                      <div className="font-medium mb-0.5">Rejection reason</div>
                      <div className="whitespace-pre-wrap break-words">{errMsg}</div>
                    </div>
                  )}

                  {isExpanded && (
                    <div className="mt-3 space-y-3 border-t pt-3">
                      {o.audit && (
                        <div className="rounded border p-2 text-xs space-y-1">
                          <div className="font-medium">Latest audit row</div>
                          <div>Endpoint: <code className="text-[11px]">{o.audit.endpoint}</code></div>
                          <div>
                            HTTP {o.audit.status_code ?? '—'} · {o.audit.duration_ms ?? '—'}ms ·{' '}
                            {o.audit.error_code || 'ok'}
                          </div>
                          <div className="text-muted-foreground">
                            {format(new Date(o.audit.created_at), 'MMM d, h:mm:ss a')}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-xs font-medium mb-1">Request payload</div>
                        <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-[11px]">
                          {JSON.stringify(o.raw_payload?.request ?? { note: 'no request captured' }, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs font-medium mb-1">
                          ABC response (HTTP {o.raw_payload?.response?.status ?? '—'})
                        </div>
                        <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-[11px]">
                          {JSON.stringify(o.raw_payload?.response?.body ?? { note: 'no response captured' }, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs font-medium mb-1">
                          Webhook timeline ({o.webhooks.length})
                        </div>
                        {o.webhooks.length === 0 ? (
                          <div className="text-xs text-muted-foreground">
                            No webhooks received yet.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {o.webhooks.map((w) => (
                              <div key={w.id} className="rounded border p-2 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <code className="font-semibold">{w.event_type || '—'}</code>
                                  <span className="text-muted-foreground">
                                    {format(new Date(w.received_at), 'MMM d, h:mm:ss a')}
                                  </span>
                                </div>
                                {w.payload && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                      raw payload
                                    </summary>
                                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[10px]">
                                      {JSON.stringify(w.payload, null, 2)}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
