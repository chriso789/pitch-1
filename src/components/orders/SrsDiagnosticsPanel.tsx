import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, AlertCircle, CheckCircle2, Webhook, Bug, Copy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { format, formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface Props {
  projectId?: string;
}

interface StatusEvent {
  id: string;
  old_status: string | null;
  new_status: string | null;
  status_message: string | null;
  raw_webhook_data: any;
  created_at: string;
}

interface JobInfo {
  job_number?: string | null;
  customer_name?: string | null;
  address?: string | null;
}

interface SrsAttempt {
  id: string;
  project_id: string | null;
  order_number: string;
  srs_order_id: string | null;
  srs_transaction_id: string | null;
  branch_code: string | null;
  branch_name: string | null;
  status: string;
  total_amount: number | null;
  submitted_at: string | null;
  updated_at: string;
  srs_response: any;
  delivery_address: any;
  history: StatusEvent[];
  job?: JobInfo;
}

function extractError(resp: any, history: StatusEvent[]): string | null {
  if (!resp && !history.length) return null;
  const candidates = [
    resp?.error,
    resp?.message,
    resp?.errorMessage,
    resp?.validationErrors,
    resp?.errors,
    resp?.body?.error,
    resp?.body?.message,
  ].filter(Boolean);
  if (candidates.length) {
    const c = candidates[0];
    return typeof c === 'string' ? c : JSON.stringify(c);
  }
  const errEvt = history.find(h =>
    /fail|reject|error|invalid|cancel/i.test(`${h.new_status || ''} ${h.status_message || ''}`)
  );
  return errEvt?.status_message || null;
}

export function SrsDiagnosticsPanel({ projectId }: Props) {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState<SrsAttempt[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    let q = supabase
      .from('srs_orders')
      .select('id, order_number, srs_order_id, srs_transaction_id, branch_code, status, total_amount, submitted_at, updated_at, srs_response')
      .eq('tenant_id', tenantId as any)
      .order('created_at', { ascending: false })
      .limit(5);
    if (projectId) q = q.eq('project_id', projectId);
    const { data: orders } = await q;
    const ids = (orders || []).map((o: any) => o.id);
    const historyById = new Map<string, StatusEvent[]>();
    if (ids.length) {
      const { data: hist } = await supabase
        .from('srs_order_status_history')
        .select('id, order_id, old_status, new_status, status_message, raw_webhook_data, created_at')
        .in('order_id', ids)
        .order('created_at', { ascending: false });
      for (const h of (hist || []) as any[]) {
        const arr = historyById.get(h.order_id) || [];
        arr.push(h);
        historyById.set(h.order_id, arr);
      }
    }
    setAttempts((orders || []).map((o: any) => ({ ...o, history: historyById.get(o.id) || [] })));
    setLoading(false);
  }, [tenantId, projectId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`srs-diag-${projectId || 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'srs_orders' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'srs_order_status_history' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, projectId, load]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: label });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bug className="h-4 w-4" /> SRS Submit Diagnostics
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
        ) : attempts.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No SRS submit attempts {projectId ? 'for this project' : 'yet'}.
          </div>
        ) : (
          <div className="space-y-3">
            {attempts.map(a => {
              const errMsg = extractError(a.srs_response, a.history);
              const webhookCount = a.history.filter(h => h.raw_webhook_data).length;
              const isExpanded = expanded === a.id;
              const failed = /fail|reject|error|cancel/i.test(a.status) || !!errMsg;
              return (
                <div key={a.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary">SRS</Badge>
                        <span className="font-medium">{a.order_number}</span>
                        {failed ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertCircle className="h-3 w-3" /> {a.status}
                          </Badge>
                        ) : (
                          <Badge className="gap-1 bg-green-600 text-white">
                            <CheckCircle2 className="h-3 w-3" /> {a.status}
                          </Badge>
                        )}
                        <Badge variant="outline" className="gap-1">
                          <Webhook className="h-3 w-3" /> {webhookCount} webhook{webhookCount === 1 ? '' : 's'}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {a.submitted_at && (
                          <div>
                            Submitted {format(new Date(a.submitted_at), 'MMM d yyyy, h:mm:ss a')} (
                            {formatDistanceToNow(new Date(a.submitted_at), { addSuffix: true })})
                          </div>
                        )}
                        {a.branch_code && <div>Branch: {a.branch_code}</div>}
                        {a.srs_order_id && (
                          <div className="flex items-center gap-1">
                            orderID: <code className="text-[11px]">{a.srs_order_id}</code>
                            <button onClick={() => copy(a.srs_order_id!, 'orderID')}>
                              <Copy className="h-3 w-3 hover:text-foreground" />
                            </button>
                          </div>
                        )}
                        {a.srs_transaction_id && (
                          <div className="flex items-center gap-1">
                            transactionID: <code className="text-[11px]">{a.srs_transaction_id}</code>
                            <button onClick={() => copy(a.srs_transaction_id!, 'transactionID')}>
                              <Copy className="h-3 w-3 hover:text-foreground" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setExpanded(isExpanded ? null : a.id)}>
                      {isExpanded ? 'Hide' : 'Inspect'}
                    </Button>
                  </div>

                  {errMsg && (
                    <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                      <div className="font-medium mb-0.5">Rejection reason</div>
                      <div className="whitespace-pre-wrap break-words">{errMsg}</div>
                    </div>
                  )}

                  {isExpanded && (
                    <div className="mt-3 space-y-3 border-t pt-3">
                      <div>
                        <div className="text-xs font-medium mb-1">Submit response</div>
                        <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-[11px]">
{JSON.stringify(a.srs_response ?? { note: 'no response captured' }, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs font-medium mb-1">
                          Webhook timeline ({a.history.length})
                        </div>
                        {a.history.length === 0 ? (
                          <div className="text-xs text-muted-foreground">
                            No webhooks received yet. SRS accepted the submit but has not posted back a status.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {a.history.map(h => (
                              <div key={h.id} className="rounded border p-2 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    {h.old_status && (
                                      <>
                                        <code>{h.old_status}</code>
                                        <span>→</span>
                                      </>
                                    )}
                                    <code className="font-semibold">{h.new_status || '—'}</code>
                                  </div>
                                  <span className="text-muted-foreground">
                                    {format(new Date(h.created_at), 'MMM d, h:mm:ss a')}
                                  </span>
                                </div>
                                {h.status_message && (
                                  <div className="mt-1 text-muted-foreground">{h.status_message}</div>
                                )}
                                {h.raw_webhook_data && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                      raw payload
                                    </summary>
                                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[10px]">
{JSON.stringify(h.raw_webhook_data, null, 2)}
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
