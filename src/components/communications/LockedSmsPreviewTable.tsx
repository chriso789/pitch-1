import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export interface LockedSmsPreviewTableProps {
  blastId: string;
  tenantId: string;
}

type FilterKey = 'all' | 'rendered' | 'missing_address' | 'opted_out' | 'failed';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'rendered', label: 'Rendered' },
  { key: 'missing_address', label: 'Missing Address' },
  { key: 'opted_out', label: 'Opted Out' },
  { key: 'failed', label: 'Failed' },
];

function statusTone(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (['sent', 'delivered', 'replied'].includes(status)) return 'default';
  if (['skipped_opt_out', 'opted_out'].includes(status)) return 'secondary';
  if (['skipped_missing_address', 'failed', 'cancelled'].includes(status)) return 'destructive';
  return 'outline';
}

export function LockedSmsPreviewTable({ blastId, tenantId }: LockedSmsPreviewTableProps) {
  const [filter, setFilter] = useState<FilterKey>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['locked-sms-preview', blastId, tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('sms_blast_items') as any)
        .select('id, contact_name, phone, status, personalized_message, address_street_snapshot, address_city_snapshot, address_state_snapshot, error_message, last_error')
        .eq('blast_id', blastId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
    enabled: !!blastId && !!tenantId,
  });

  const filtered = useMemo(() => {
    const rows = (data || []) as any[];
    if (filter === 'all') return rows.slice(0, 25);
    if (filter === 'rendered') {
      return rows.filter(r => !!r.personalized_message && !['skipped_opt_out', 'skipped_missing_address', 'failed', 'opted_out'].includes(r.status)).slice(0, 25);
    }
    if (filter === 'missing_address') {
      return rows.filter(r => r.status === 'skipped_missing_address' || !r.address_street_snapshot).slice(0, 25);
    }
    if (filter === 'opted_out') {
      return rows.filter(r => r.status === 'skipped_opt_out' || r.status === 'opted_out').slice(0, 25);
    }
    if (filter === 'failed') {
      return rows.filter(r => r.status === 'failed' || r.status === 'cancelled').slice(0, 25);
    }
    return rows.slice(0, 25);
  }, [data, filter]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Locked Message Preview</span>
          <span className="text-[11px] font-normal text-muted-foreground">
            Reading <code className="font-mono">sms_blast_items.personalized_message</code>
          </span>
        </CardTitle>
        <div className="flex flex-wrap gap-1 pt-1">
          {FILTERS.map(f => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? 'default' : 'outline'}
              className="h-6 px-2 text-[11px]"
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No items match this filter.</p>
        ) : (
          <div className="space-y-2 max-h-[480px] overflow-auto">
            {filtered.map((row: any) => {
              const addr = [row.address_street_snapshot, row.address_city_snapshot, row.address_state_snapshot]
                .filter(Boolean).join(', ');
              return (
                <div key={row.id} className="rounded border p-2 text-xs space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={statusTone(row.status)} className="text-[10px]">{row.status}</Badge>
                    <span className="font-medium">{row.contact_name || '(no name)'}</span>
                    <span className="text-muted-foreground font-mono">{row.phone}</span>
                  </div>
                  {addr && <div className="text-[11px] text-muted-foreground">📍 {addr}</div>}
                  {row.personalized_message ? (
                    <div className="bg-muted/40 rounded p-2 text-[11px] whitespace-pre-wrap font-mono">
                      {row.personalized_message}
                    </div>
                  ) : (
                    <div className="text-[11px] italic text-muted-foreground">No locked message rendered.</div>
                  )}
                  {(row.error_message || row.last_error) && (
                    <div className="text-[11px] text-destructive">⚠ {row.error_message || row.last_error}</div>
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

export default LockedSmsPreviewTable;
