import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import type { ChangeRegion } from '@/lib/pdf-compare/diff';
import { REVIEW_ITEM_LABELS, regionTitle, type ReviewItemType } from '@/lib/pdf-compare/reviewItems';

interface Saved { id: string; base_document_id: string; page: number; offset_x: number; offset_y: number; render_width: number; render_height: number; regions: ChangeRegion[]; created_at: string }
interface Item { id: string; comparison_id: string; region_index: number; item_type: ReviewItemType; title: string; status: string; created_at: string }

const db = supabase as any;

/** Saved comparison records + review items (RFI / change-order review / takeoff task). Review items never change quantities. */
export function ComparisonRecords({ tenantId, revisedId, baseId, page, dx, dy, size, regions, onOpen }: {
  tenantId: string; revisedId: string; baseId: string; page: number; dx: number; dy: number;
  size: { w: number; h: number } | null; regions: ChangeRegion[];
  onOpen: (s: { baseId: string; page: number; dx: number; dy: number }) => void;
}) {
  const [saved, setSaved] = useState<Saved[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await db.from('pdf_revision_comparisons').select('*').eq('tenant_id', tenantId).eq('revised_document_id', revisedId).order('created_at', { ascending: false }).limit(50);
    if (error) return toast.error(error.message);
    setSaved(data ?? []);
    const ids = (data ?? []).map((d: Saved) => d.id);
    if (!ids.length) return setItems([]);
    const r = await db.from('pdf_revision_review_items').select('*').eq('tenant_id', tenantId).in('comparison_id', ids).order('created_at');
    if (r.error) toast.error(r.error.message); else setItems(r.data ?? []);
  }, [tenantId, revisedId]);
  useEffect(() => { load(); }, [load]);

  // A saved record only matches the current view when everything that produced the regions is identical.
  useEffect(() => {
    const m = saved.find(s => s.base_document_id === baseId && s.page === page && s.offset_x === dx && s.offset_y === dy);
    setCurrent(m?.id ?? null);
  }, [saved, baseId, page, dx, dy]);

  const save = async () => {
    if (!size || !baseId) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await db.from('pdf_revision_comparisons').insert({
      tenant_id: tenantId, base_document_id: baseId, revised_document_id: revisedId, page, offset_x: dx, offset_y: dy,
      render_width: size.w, render_height: size.h, regions, created_by: u.user?.id,
    }).select('id').single();
    setBusy(false);
    if (error) return toast.error(`Could not save comparison: ${error.message}`);
    toast.success('Comparison saved'); setCurrent(data.id); load();
  };

  const createItem = async (idx: number, type: ReviewItemType) => {
    if (!current || !size) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await db.from('pdf_revision_review_items').insert({
      tenant_id: tenantId, comparison_id: current, region_index: idx, item_type: type,
      title: regionTitle(type, regions[idx], idx, page, size), created_by: u.user?.id,
    });
    if (error) return toast.error(error.message);
    toast.success(`${REVIEW_ITEM_LABELS[type]} created for review`); load();
  };

  const setStatus = async (id: string, status: string) => {
    const { error } = await db.from('pdf_revision_review_items').update({ status }).eq('id', id).eq('tenant_id', tenantId);
    if (error) toast.error(error.message); else load();
  };

  const curItems = items.filter(i => i.comparison_id === current);
  return <div className="space-y-3 border rounded-md p-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium text-sm">Review records</span>
      {current ? <Badge variant="secondary">Saved</Badge> : <Button size="sm" disabled={!size || busy} onClick={save}>Save this comparison</Button>}
      <span className="text-xs text-muted-foreground">Saved comparisons are permanent. Items created here are review tasks only — they never change takeoffs, estimates or budgets.</span>
    </div>
    {size && regions.length > 0 && <div className="space-y-1">
      {regions.map((r, i) => {
        const existing = curItems.filter(x => x.region_index === i);
        return <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={r.kind === 'deleted' ? 'destructive' : 'outline'}>{i + 1}. {r.kind}</Badge>
          {(Object.keys(REVIEW_ITEM_LABELS) as ReviewItemType[]).map(t =>
            <Button key={t} size="sm" variant="outline" disabled={!current || existing.some(e => e.item_type === t)} onClick={() => createItem(i, t)}>{REVIEW_ITEM_LABELS[t]}</Button>)}
          {!current && i === 0 && <span className="text-xs text-muted-foreground">Save the comparison first</span>}
        </div>;
      })}
    </div>}
    {curItems.length > 0 && <div className="space-y-1">
      <p className="text-sm font-medium">Open items for this comparison</p>
      {curItems.map(it => <div key={it.id} className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{REVIEW_ITEM_LABELS[it.item_type]}</Badge><span className="flex-1">{it.title}</span>
        <Badge variant={it.status === 'open' ? 'default' : 'secondary'}>{it.status}</Badge>
        {it.status === 'open'
          ? <><Button size="sm" variant="outline" onClick={() => setStatus(it.id, 'resolved')}>Resolve</Button><Button size="sm" variant="ghost" onClick={() => setStatus(it.id, 'dismissed')}>Dismiss</Button></>
          : <Button size="sm" variant="ghost" onClick={() => setStatus(it.id, 'open')}>Reopen</Button>}
      </div>)}
    </div>}
    {saved.length > 0 && <div className="space-y-1">
      <p className="text-sm font-medium">Saved comparisons</p>
      {saved.map(s => <div key={s.id} className="flex items-center gap-2 text-xs">
        <span>{new Date(s.created_at).toLocaleString()} · page {s.page} · {s.regions.length} area(s) · {items.filter(i => i.comparison_id === s.id && i.status === 'open').length} open item(s)</span>
        <Button size="sm" variant="ghost" onClick={() => onOpen({ baseId: s.base_document_id, page: s.page, dx: s.offset_x, dy: s.offset_y })}>Open</Button>
      </div>)}
    </div>}
  </div>;
}
