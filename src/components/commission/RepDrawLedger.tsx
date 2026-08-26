import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/commission-calculator';
import { format } from 'date-fns';
import { Scale } from 'lucide-react';

export interface LedgerCommission {
  id: string;
  name: string;
  commissionAmount: number;
  settled: boolean;
  createdAt: string;
}

interface RepDrawLedgerProps {
  tenantId: string;
  repId: string;
  /** Commission-eligible jobs for this rep (open + settled). */
  commissions: LedgerCommission[];
}

type LedgerRow = {
  key: string;
  date: string;
  label: string;
  jobLabel: string;
  earned: number;
  draw: number;
  balance: number;
};

/**
 * Rolling balance sheet for a rep: commissions earned credit the balance,
 * draws paid debit it. Shows which jobs had a draw applied and how much the
 * rep is still owed once the outstanding draw balance is paid off.
 */
export function RepDrawLedger({ tenantId, repId, commissions }: RepDrawLedgerProps) {
  const { data: draws = [] } = useQuery({
    queryKey: ['rep-draw-ledger', tenantId, repId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commission_draws')
        .select(`
          id, amount, draw_date, notes, pipeline_entry_id,
          pipeline_entries!commission_draws_pipeline_entry_id_fkey(
            id, lead_name, contact_number,
            contacts!pipeline_entries_contact_id_fkey(first_name, last_name, address_street)
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('user_id', repId)
        .order('draw_date', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId && !!repId,
  });

  const { rows, totals } = useMemo(() => {
    const events: Array<Omit<LedgerRow, 'balance'>> = [];

    commissions.forEach(c => {
      events.push({
        key: `comm-${c.id}`,
        date: c.createdAt,
        label: c.settled ? 'Commission (capped out)' : 'Commission (pending)',
        jobLabel: c.name,
        earned: c.commissionAmount,
        draw: 0,
      });
    });

    draws.forEach((d: any) => {
      const entry = d.pipeline_entries;
      const contact = entry?.contacts;
      const jobLabel = entry
        ? entry.lead_name ||
          (contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : `Lead #${entry.contact_number || ''}`)
        : 'Unassigned advance';
      events.push({
        key: `draw-${d.id}`,
        date: d.draw_date,
        label: d.notes ? `Draw — ${d.notes}` : 'Draw / advance paid',
        jobLabel,
        earned: 0,
        draw: Number(d.amount || 0),
      });
    });

    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    const rows: LedgerRow[] = events.map(e => {
      running += e.earned - e.draw;
      return { ...e, balance: running };
    });

    const totalEarned = commissions.reduce((s, c) => s + c.commissionAmount, 0);
    const totalDraws = draws.reduce((s: number, d: any) => s + Number(d.amount || 0), 0);
    const jobsWithDraws = new Set(
      draws.filter((d: any) => d.pipeline_entry_id).map((d: any) => d.pipeline_entry_id),
    ).size;

    return {
      rows,
      totals: {
        totalEarned,
        totalDraws,
        netOwed: totalEarned - totalDraws,
        drawOutstanding: Math.max(0, totalDraws - totalEarned),
        jobsWithDraws,
      },
    };
  }, [commissions, draws]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          Draw Balance Sheet
          {totals.jobsWithDraws > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {totals.jobsWithDraws} job{totals.jobsWithDraws === 1 ? '' : 's'} with draws
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-xs text-muted-foreground">Commissions Earned</div>
            <div className="text-lg font-bold text-green-600">{formatCurrency(totals.totalEarned)}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-xs text-muted-foreground">Draws Paid</div>
            <div className="text-lg font-bold text-red-600">-{formatCurrency(totals.totalDraws)}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-xs text-muted-foreground">Draw Still To Recover</div>
            <div className="text-lg font-bold text-amber-600">{formatCurrency(totals.drawOutstanding)}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-xs text-muted-foreground">Owed After Draw</div>
            <div className={`text-lg font-bold ${totals.netOwed >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(totals.netOwed)}
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-center py-4 text-sm text-muted-foreground">No commission or draw activity yet</p>
        ) : (
          <div className="rounded-md border max-h-[340px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Draw</TableHead>
                  <TableHead className="text-right">Running Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.key}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {format(new Date(row.date), 'MM/dd/yyyy')}
                    </TableCell>
                    <TableCell className="text-sm truncate max-w-[180px]">{row.jobLabel}</TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{row.label}</TableCell>
                    <TableCell className="text-right text-sm text-green-600">
                      {row.earned ? formatCurrency(row.earned) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm text-red-600">
                      {row.draw ? `-${formatCurrency(row.draw)}` : '—'}
                    </TableCell>
                    <TableCell className={`text-right text-sm font-medium ${row.balance >= 0 ? 'text-foreground' : 'text-red-600'}`}>
                      {formatCurrency(row.balance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
