import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';

interface Run {
  id: string;
  run_type: string;
  status: string;
  orders_checked: number;
  mismatches_found: number;
  updates_applied: number;
  errors_count: number;
  started_at: string;
  completed_at: string | null;
  results: { diffs?: Array<Record<string, any>> } | null;
}

export function SRSReconciliationPanel() {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await (supabase
      .from('srs_reconciliation_runs') as any)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .limit(20);
    setRuns((data as Run[]) || []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('srs-reconciliation-report', {
        body: { tenant_id: tenantId, run_type: 'manual' },
      });
      if (error) throw error;
      const summary = data?.runs?.[0];
      toast({
        title: 'Reconciliation complete',
        description: summary
          ? `${summary.orders_checked} orders checked · ${summary.mismatches} mismatches · ${summary.updates} updates`
          : 'No stale orders to reconcile.',
      });
      await load();
    } catch (e: any) {
      toast({ title: 'Reconciliation failed', description: e.message, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const latest = runs[0];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Order Reconciliation
            </CardTitle>
            <CardDescription>
              Daily sweep comparing local SRS order statuses against SRS. Catches anything the webhook missed.
            </CardDescription>
          </div>
          <Button size="sm" onClick={runNow} disabled={running}>
            {running
              ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Running…</>
              : <><RefreshCw className="h-3.5 w-3.5 mr-1" /> Run now</>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : runs.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground text-center">
            No reconciliation runs yet. Click <span className="font-medium">Run now</span> to do one immediately,
            or wait for the nightly schedule.
          </div>
        ) : (
          <>
            {latest && (
              <div className="rounded-md border p-3 bg-muted/30">
                <div className="flex items-center gap-2 text-sm">
                  {latest.errors_count > 0
                    ? <AlertTriangle className="h-4 w-4 text-amber-600" />
                    : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                  <span className="font-medium">Last run</span>
                  <span className="text-muted-foreground">
                    {formatDistanceToNow(new Date(latest.started_at), { addSuffix: true })}
                  </span>
                  <Badge variant="outline" className="ml-auto">{latest.run_type}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                  <Stat label="Checked" value={latest.orders_checked} />
                  <Stat label="Mismatches" value={latest.mismatches_found} tone={latest.mismatches_found > 0 ? 'warn' : undefined} />
                  <Stat label="Corrected" value={latest.updates_applied} tone={latest.updates_applied > 0 ? 'ok' : undefined} />
                  <Stat label="Errors" value={latest.errors_count} tone={latest.errors_count > 0 ? 'bad' : undefined} />
                </div>
              </div>
            )}

            <div className="space-y-1">
              {runs.map(r => (
                <div key={r.id} className="rounded-md border text-xs">
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    className="w-full px-3 py-2 flex items-center gap-3 hover:bg-muted/40 text-left"
                  >
                    <span className="text-muted-foreground w-32 shrink-0">
                      {new Date(r.started_at).toLocaleString()}
                    </span>
                    <Badge variant="outline" className="shrink-0">{r.run_type}</Badge>
                    <span className="shrink-0">{r.orders_checked} checked</span>
                    {r.mismatches_found > 0 && (
                      <Badge className="bg-amber-500/15 text-amber-700 border-amber-300">
                        {r.mismatches_found} mismatch
                      </Badge>
                    )}
                    {r.errors_count > 0 && (
                      <Badge variant="destructive">{r.errors_count} err</Badge>
                    )}
                    <span className="ml-auto text-muted-foreground">{r.status}</span>
                  </button>
                  {expanded === r.id && r.results?.diffs && r.results.diffs.length > 0 && (
                    <div className="border-t bg-muted/20 p-3 space-y-1 font-mono text-[11px]">
                      {r.results.diffs.slice(0, 50).map((d, i) => (
                        <div key={i} className="flex flex-wrap gap-x-3">
                          <span className="text-muted-foreground">{d.order_number || d.order_id}</span>
                          {d.local_status && <span>{d.local_status} → <span className="font-semibold">{d.remote_status}</span></span>}
                          {d.error && <span className="text-destructive">{d.error}</span>}
                        </div>
                      ))}
                      {r.results.diffs.length > 50 && (
                        <div className="text-muted-foreground">+ {r.results.diffs.length - 50} more…</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' }) {
  const color =
    tone === 'ok' ? 'text-emerald-600' :
    tone === 'warn' ? 'text-amber-600' :
    tone === 'bad' ? 'text-destructive' :
    'text-foreground';
  return (
    <div className="rounded border bg-background px-2 py-1.5">
      <div className="text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
    </div>
  );
}
