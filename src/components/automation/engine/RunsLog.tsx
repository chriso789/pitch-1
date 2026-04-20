import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface Run {
  id: string;
  status: string;
  skip_reason: string | null;
  entity_type: string;
  entity_id: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  automation_rule_id: string;
  domain_event_id: string;
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-muted text-foreground',
  running: 'bg-blue-500/10 text-blue-600',
  success: 'bg-emerald-500/10 text-emerald-600',
  failed: 'bg-destructive/10 text-destructive',
  skipped: 'bg-amber-500/10 text-amber-600',
};

export function RunsLog() {
  const tenantId = useEffectiveTenantId();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase
      .from('automation_runs')
      .select('*')
      .eq('company_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100);
    setRuns((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Recent runs</h3>
          <p className="text-sm text-muted-foreground">Last 100 rule executions for this company.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {!loading && runs.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No runs yet. Once Phase 2 workers are deployed and an event matches a rule, runs will appear here.
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {runs.map((r) => (
          <Card key={r.id}>
            <CardContent className="flex items-center justify-between p-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={STATUS_COLOR[r.status] || ''}>{r.status}</Badge>
                  <span className="text-sm">{r.entity_type}</span>
                  <code className="text-xs text-muted-foreground">{r.entity_id.slice(0, 8)}</code>
                </div>
                {r.skip_reason && (
                  <p className="text-xs text-amber-600">Skipped: {r.skip_reason}</p>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleString()}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
