import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/commission-calculator';
import { Wallet, AlertTriangle, Download } from 'lucide-react';
import { format } from 'date-fns';

interface RepRow {
  id: string;
  name: string;
  totalDraws: number;
  earned: number;
  future: number;
  netOwed: number; // earned - draws (negative = rep was overpaid vs what's earned)
  coverage: number; // earned + future - draws
  drawCount: number;
  earnedJobs: number;
  futureJobs: number;
}

export default function DrawReport() {
  const [search, setSearch] = useState('');

  const { data: currentUser } = useQuery({
    queryKey: ['draw-report-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, tenant_id')
        .eq('id', user.id)
        .single();
      return profile;
    },
  });

  const tenantId = currentUser?.tenant_id;

  // Stage keys: order >= 6 excluding lost/canceled = "earned" (converted/closed)
  // Stage keys: order < 6 excluding lost/canceled = "future" (pre-conversion pipeline)
  const { data: stageBuckets } = useQuery({
    queryKey: ['draw-report-stages', tenantId],
    queryFn: async () => {
      if (!tenantId) return { earned: [] as string[], future: [] as string[] };
      const { data } = await supabase
        .from('pipeline_stages')
        .select('key, stage_order')
        .eq('tenant_id', tenantId);
      const filtered = (data || []).filter(s => !['lost', 'canceled'].includes(s.key));
      return {
        earned: filtered.filter(s => s.stage_order >= 6).map(s => s.key),
        future: filtered.filter(s => s.stage_order < 6).map(s => s.key),
      };
    },
    enabled: !!tenantId,
  });

  const { data: rows = [], isLoading } = useQuery<RepRow[]>({
    queryKey: ['draw-report', tenantId, stageBuckets],
    enabled: !!tenantId && !!stageBuckets,
    queryFn: async () => {
      if (!tenantId) return [];

      // 1. Reps in tenant
      const { data: reps } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, commission_rate, commission_structure')
        .eq('tenant_id', tenantId);

      // 2. Draws
      const { data: draws } = await supabase
        .from('commission_draws')
        .select('user_id, amount')
        .eq('tenant_id', tenantId);

      // 3. Pipeline entries (earned + future)
      const allStageKeys = [...(stageBuckets!.earned), ...(stageBuckets!.future)];
      const { data: entries } = allStageKeys.length
        ? await supabase
            .from('pipeline_entries')
            .select('id, status, assigned_to, estimated_value')
            .eq('tenant_id', tenantId)
            .eq('is_deleted', false)
            .in('status', allStageKeys)
        : { data: [] as any[] };

      const entryIds = (entries || []).map(e => e.id);
      const { data: estimates } = entryIds.length
        ? await supabase
            .from('estimates')
            .select('pipeline_entry_id, selling_price, material_cost, labor_cost, overhead_amount, created_at')
            .in('pipeline_entry_id', entryIds)
            .order('created_at', { ascending: false })
        : { data: [] as any[] };

      const estByEntry = new Map<string, any>();
      (estimates || []).forEach(est => {
        if (!estByEntry.has(est.pipeline_entry_id)) estByEntry.set(est.pipeline_entry_id, est);
      });

      const repMap = new Map<string, RepRow>();
      (reps || []).forEach(r => {
        repMap.set(r.id, {
          id: r.id,
          name: `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Unknown',
          totalDraws: 0, earned: 0, future: 0, netOwed: 0, coverage: 0,
          drawCount: 0, earnedJobs: 0, futureJobs: 0,
        });
      });

      (draws || []).forEach(d => {
        const row = repMap.get(d.user_id);
        if (!row) return;
        row.totalDraws += Number(d.amount);
        row.drawCount += 1;
      });

      const earnedSet = new Set(stageBuckets!.earned);
      (entries || []).forEach(e => {
        if (!e.assigned_to) return;
        const row = repMap.get(e.assigned_to);
        if (!row) return;
        const rep = (reps || []).find(r => r.id === e.assigned_to);
        if (!rep) return;
        const est = estByEntry.get(e.id);
        const contractValue = Number(est?.selling_price || e.estimated_value || 0);
        const matCost = Number(est?.material_cost || 0);
        const labCost = Number(est?.labor_cost || 0);
        const overhead = Number(est?.overhead_amount || 0);
        const grossProfit = contractValue - matCost - labCost;
        const commRate = Number(rep.commission_rate || 0);
        const commType = rep.commission_structure || 'profit_split';
        let comm = 0;
        if (commType === 'percentage_contract_price' || commType === 'percentage_selling_price') {
          comm = contractValue * (commRate / 100);
        } else {
          comm = Math.max(0, (grossProfit - overhead) * (commRate / 100));
        }
        if (earnedSet.has(e.status)) {
          row.earned += comm;
          row.earnedJobs += 1;
        } else {
          row.future += comm;
          row.futureJobs += 1;
        }
      });

      repMap.forEach(r => {
        r.netOwed = r.earned - r.totalDraws;
        r.coverage = r.earned + r.future - r.totalDraws;
      });

      return Array.from(repMap.values())
        .filter(r => r.totalDraws > 0 || r.earned > 0 || r.future > 0)
        .sort((a, b) => b.totalDraws - a.totalDraws);
    },
  });

  const filtered = useMemo(
    () => rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase())),
    [rows, search],
  );

  const totals = useMemo(() => filtered.reduce((acc, r) => ({
    draws: acc.draws + r.totalDraws,
    earned: acc.earned + r.earned,
    future: acc.future + r.future,
    netOwed: acc.netOwed + r.netOwed,
  }), { draws: 0, earned: 0, future: 0, netOwed: 0 }), [filtered]);

  const exportCSV = () => {
    const header = ['Rep', 'Draws Paid', 'Draw Count', 'Earned Commissions', 'Earned Jobs', 'Future Commissions', 'Future Jobs', 'Net Owed (Earned - Draws)', 'Coverage (Earned + Future - Draws)'];
    const lines = [
      header.join(','),
      ...filtered.map(r => [
        `"${r.name}"`, r.totalDraws.toFixed(2), r.drawCount,
        r.earned.toFixed(2), r.earnedJobs,
        r.future.toFixed(2), r.futureJobs,
        r.netOwed.toFixed(2), r.coverage.toFixed(2),
      ].join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `draw-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <GlobalLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Wallet className="h-6 w-6 text-amber-500" />
              Draw Report
            </h1>
            <p className="text-muted-foreground text-sm">
              Rep pay vs earned and future commissions on converted jobs
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Search reps…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-56"
            />
            <Button variant="outline" onClick={exportCSV}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Draws Paid</p>
              <p className="text-2xl font-bold text-red-600">-{formatCurrency(totals.draws)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Earned (Converted Jobs)</p>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(totals.earned)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Future (Pipeline)</p>
              <p className="text-2xl font-bold text-blue-600">{formatCurrency(totals.future)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Net Owed Today</p>
              <p className={`text-2xl font-bold ${totals.netOwed >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(totals.netOwed)}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By Rep</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-center py-6 text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-center py-6 text-muted-foreground">No data</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rep</TableHead>
                      <TableHead className="text-right">Draws</TableHead>
                      <TableHead className="text-right">Earned</TableHead>
                      <TableHead className="text-right">Future</TableHead>
                      <TableHead className="text-right">Net Owed</TableHead>
                      <TableHead className="text-right">After Future</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(r => {
                      const overpaid = r.netOwed < 0;
                      const exposed = r.coverage < 0;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell className="text-right text-red-600">
                            -{formatCurrency(r.totalDraws)}
                            <span className="text-xs text-muted-foreground ml-1">({r.drawCount})</span>
                          </TableCell>
                          <TableCell className="text-right text-green-600">
                            {formatCurrency(r.earned)}
                            <span className="text-xs text-muted-foreground ml-1">({r.earnedJobs})</span>
                          </TableCell>
                          <TableCell className="text-right text-blue-600">
                            {formatCurrency(r.future)}
                            <span className="text-xs text-muted-foreground ml-1">({r.futureJobs})</span>
                          </TableCell>
                          <TableCell className={`text-right font-semibold ${r.netOwed >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(r.netOwed)}
                          </TableCell>
                          <TableCell className={`text-right font-semibold ${r.coverage >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(r.coverage)}
                          </TableCell>
                          <TableCell>
                            {exposed ? (
                              <Badge variant="destructive" className="gap-1">
                                <AlertTriangle className="h-3 w-3" /> Exposed
                              </Badge>
                            ) : overpaid ? (
                              <Badge className="bg-amber-500 text-white">Advance</Badge>
                            ) : (
                              <Badge variant="secondary">Healthy</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
}
