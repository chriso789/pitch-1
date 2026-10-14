import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { diffMeasurements, type MeasureChange, type MeasureRow } from '@/lib/pdf-compare/measureDiff';

const LABEL: Record<MeasureChange['type'], string> = { added: 'Added', removed: 'Removed', value_changed: 'Quantity changed', reshaped: 'Redrawn', unchanged: 'Same' };
const fmt = (m: MeasureRow) => `${m.label || m.kind} — ${Number(m.value).toFixed(2)} ${m.unit}${m.status === 'draft' ? ' (draft)' : ''}`;

async function load(tenantId: string, docId: string, pageIndex: number): Promise<MeasureRow[]> {
  const { data, error } = await (supabase as any).from('plan_measurements')
    .select('id, kind, points, value, unit, label, status, scale_id')
    .eq('tenant_id', tenantId).eq('document_id', docId).eq('page_index', pageIndex).is('deleted_at', null);
  if (error) throw error;
  return data ?? [];
}

/** Read-only list. Never changes measurements, takeoffs, estimates or budgets. */
export function MeasurementChanges({ tenantId, baseId, revisedId, page }: { tenantId: string; baseId: string; revisedId: string; page: number }) {
  const [changes, setChanges] = useState<MeasureChange[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let off = false; setChanges(null); setErr('');
    Promise.all([load(tenantId, baseId, page - 1), load(tenantId, revisedId, page - 1)])
      .then(([a, b]) => { if (!off) setChanges(diffMeasurements(a, b)); })
      .catch(e => { if (!off) setErr(e.message); });
    return () => { off = true; };
  }, [tenantId, baseId, revisedId, page]);

  const shown = (changes ?? []).filter(c => c.type !== 'unchanged');
  return <div className="border rounded p-3 space-y-2 text-sm">
    <div className="font-medium">Saved measurements on this page</div>
    {err ? <p className="text-destructive">{err}</p> : !changes ? <p className="text-muted-foreground">Loading…</p>
      : !changes.length ? <p className="text-muted-foreground">Neither version has saved measurements on this page.</p>
      : <>
        <p className="text-muted-foreground">{changes.length - shown.length} unchanged. Review only — nothing here updates takeoffs, estimates or budgets.</p>
        {!shown.length ? <p>No measurement differences.</p> : <ul className="space-y-1">
          {shown.map((c, i) => <li key={i} className="flex gap-2 items-start">
            <Badge variant={c.type === 'removed' ? 'destructive' : 'secondary'}>{LABEL[c.type]}</Badge>
            <span>{c.type === 'added' ? fmt(c.after) : c.type === 'removed' ? fmt(c.before) : `${fmt(c.before)} → ${fmt(c.after)}`}</span>
          </li>)}
        </ul>}
      </>}
  </div>;
}
