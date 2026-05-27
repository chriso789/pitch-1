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

function extractError(resp: any, history: StatusEvent[], currentStatus: string): string | null {
  // Only surface a rejection reason when the CURRENT order status is actually
  // a failed/rejected state. A later webhook (e.g. SRS "OU" Order Update) may
  // promote the row back to `submitted`/`accepted`, in which case any earlier
  // "404 after queue" history message is stale and must not be shown.
  if (!/reject|fail|cancel|error/i.test(currentStatus)) return null;

  const errEvt = [...history]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .find(h =>
      /fail|reject|error|invalid|cancel|drop|404|timeout/i.test(
        `${h.new_status || ''} ${h.status_message || ''}`
      )
    );
  if (errEvt?.status_message) return errEvt.status_message;

  if (!resp) return null;
  const candidates = [
    resp?.error,
    resp?.errorMessage,
    resp?.validationErrors,
    resp?.errors,
    resp?.body?.error,
    resp?.body?.message,
    resp?.message,
  ].filter(Boolean);
  if (candidates.length) {
    const c = candidates[0];
    return typeof c === 'string' ? c : JSON.stringify(c);
  }
  return null;
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
    const relatedIds = new Set<string>();
    if (projectId) {
      relatedIds.add(projectId);
      try {
        let contactId: string | null = null;
        const { data: pe } = await supabase
          .from('pipeline_entries')
          .select('id, contact_id')
          .eq('id', projectId)
          .eq('tenant_id', tenantId as any)
          .maybeSingle();
        if ((pe as any)?.contact_id) contactId = (pe as any).contact_id;

        if (!contactId) {
          const { data: prjSelf } = await supabase
            .from('projects')
            .select('id, contact_id, pipeline_entry_id')
            .eq('id', projectId)
            .eq('tenant_id', tenantId as any)
            .maybeSingle();
          if (prjSelf) {
            relatedIds.add((prjSelf as any).id);
            if ((prjSelf as any).pipeline_entry_id) relatedIds.add((prjSelf as any).pipeline_entry_id);
            if ((prjSelf as any).contact_id) contactId = (prjSelf as any).contact_id;
          }
        }

        const { data: prjByPe } = await supabase
          .from('projects')
          .select('id, contact_id')
          .eq('pipeline_entry_id', projectId)
          .eq('tenant_id', tenantId as any);
        (prjByPe || []).forEach((r: any) => {
          if (r.id) relatedIds.add(r.id);
          if (!contactId && r.contact_id) contactId = r.contact_id;
        });

        if (contactId) {
          const [{ data: peList }, { data: prjList }] = await Promise.all([
            (supabase.from('pipeline_entries') as any).select('id').eq('contact_id', contactId).eq('tenant_id', tenantId),
            (supabase.from('projects') as any).select('id, pipeline_entry_id').eq('contact_id', contactId).eq('tenant_id', tenantId),
          ]);
          (peList || []).forEach((r: any) => r.id && relatedIds.add(r.id));
          (prjList || []).forEach((r: any) => {
            if (r.id) relatedIds.add(r.id);
            if (r.pipeline_entry_id) relatedIds.add(r.pipeline_entry_id);
          });
        }
      } catch (e) {
        console.warn('[SrsDiagnosticsPanel] related id resolution failed', e);
      }
    }
    let q = supabase
      .from('srs_orders')
      .select('id, project_id, order_number, srs_order_id, srs_transaction_id, branch_code, branch_name, status, total_amount, submitted_at, updated_at, srs_response, delivery_address')
      .eq('tenant_id', tenantId as any)
      .order('created_at', { ascending: false })
      .limit(5);
    if (projectId) q = q.in('project_id', Array.from(relatedIds) as any);
    const { data: orders } = await q;
    const ids = (orders || []).map((o: any) => o.id);
    const projectIds = Array.from(new Set((orders || []).map((o: any) => o.project_id).filter(Boolean)));

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

    // Fetch job info — tenant-scoped explicitly so cross-tenant leakage is impossible
    const jobById = new Map<string, JobInfo>();
    if (projectIds.length) {
      const { data: projects } = await supabase
        .from('projects')
        .select('id, job_number, pipeline_entry_id')
        .eq('tenant_id', tenantId as any)
        .in('id', projectIds as any);
      const peIds = Array.from(new Set((projects || []).map((p: any) => p.pipeline_entry_id).filter(Boolean)));
      const peMap = new Map<string, any>();
      if (peIds.length) {
        const { data: pes } = await supabase
          .from('pipeline_entries')
          .select('id, contact_id, contacts!pipeline_entries_contact_id_fkey(first_name, last_name, company_name, address_street, address_city, address_state, address_zip)')
          .eq('tenant_id', tenantId as any)
          .in('id', peIds as any);
        for (const pe of (pes || []) as any[]) peMap.set(pe.id, pe);
      }
      for (const p of (projects || []) as any[]) {
        const pe = p.pipeline_entry_id ? peMap.get(p.pipeline_entry_id) : null;
        const c = pe?.contacts;
        const name = c
          ? (c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || null)
          : null;
        const addr = c
          ? [c.address_street, [c.address_city, c.address_state].filter(Boolean).join(', '), c.address_zip].filter(Boolean).join(' · ')
          : null;
        jobById.set(p.id, { job_number: p.job_number, customer_name: name, address: addr || null });
      }
    }

    setAttempts((orders || []).map((o: any) => ({
      ...o,
      history: historyById.get(o.id) || [],
      job: o.project_id ? jobById.get(o.project_id) : undefined,
    })));
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
                      {(a.job?.job_number || a.job?.customer_name || a.job?.address) && (
                        <div className="rounded-md bg-muted/50 border px-2 py-1.5 text-xs space-y-0.5">
                          {a.job?.job_number && (
                            <div><span className="text-muted-foreground">Job:</span> <span className="font-medium">{a.job.job_number}</span></div>
                          )}
                          {a.job?.customer_name && (
                            <div><span className="text-muted-foreground">Customer:</span> {a.job.customer_name}</div>
                          )}
                          {a.job?.address && (
                            <div><span className="text-muted-foreground">Address:</span> {a.job.address}</div>
                          )}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {a.submitted_at && (
                          <div>
                            Submitted {format(new Date(a.submitted_at), 'MMM d yyyy, h:mm:ss a')} (
                            {formatDistanceToNow(new Date(a.submitted_at), { addSuffix: true })})
                          </div>
                        )}
                        {(a.branch_code || a.branch_name) && <div>Branch: {a.branch_name || a.branch_code} {a.branch_name && a.branch_code ? `(${a.branch_code})` : ''}</div>}
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
                    <div className="flex flex-col items-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setExpanded(isExpanded ? null : a.id)}>
                        {isExpanded ? 'Hide' : 'Inspect'}
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
