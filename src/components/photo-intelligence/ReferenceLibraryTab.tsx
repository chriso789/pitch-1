import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PhotoAnnotationEditor } from '@/components/photo-intelligence/PhotoAnnotationEditor';
import { BENCHMARK_COMPONENT_CLASSES } from '@/lib/photo-intelligence/benchmarkHarness';
import { approveCandidate, approvedToExamples, inventoryCompanyPhotos, loadCandidates, saveReferenceCrops, type InventoryPhoto } from '@/lib/photo-intelligence/components/referenceCandidates';
import { calibrateThresholds, type CalibrationReport } from '@/lib/photo-intelligence/components/calibration';
import { toast } from 'sonner';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export function ReferenceLibraryTab({ tenantId, userId }: { tenantId: string; userId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<InventoryPhoto | null>(null);
  const [json, setJson] = useState<unknown>({});
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const photos = useQuery({ queryKey: ['ref-inventory', tenantId], queryFn: () => inventoryCompanyPhotos(tenantId) });
  const cands = useQuery({ queryKey: ['ref-candidates', tenantId], queryFn: () => loadCandidates(tenantId) });
  const rows = cands.data ?? [];
  const approved = useMemo(() => approvedToExamples(rows), [rows]);
  const props = new Set(approved.map((a) => a.propertyKey)).size;
  const pending = rows.filter((r) => !r.approved_by);
  const refresh = () => qc.invalidateQueries({ queryKey: ['ref-candidates', tenantId] });

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Outline roof components on this company's existing photos. Originals are never copied or changed, and the category a rep picked is never used as a label. A crop joins this company's reference library only after a second inspector approves it.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{approved.length}</div><div className="text-xs text-muted-foreground">Approved real component examples</div></div>
        <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{props}</div><div className="text-xs text-muted-foreground">Unique source properties</div></div>
        <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{report?.chosen ? pct(report.chosen.coverageAccuracy) : '—'}</div><div className="text-xs text-muted-foreground">Accuracy on unseen properties</div></div>
      </div>
      <div className="flex gap-2 items-center">
        <Button variant="outline" disabled={!approved.length} onClick={() => setReport(calibrateThresholds(approved))}>Calibrate thresholds</Button>
        {report?.blockedReason && <span className="text-sm text-muted-foreground">{report.blockedReason}</span>}
        {report?.chosen && <span className="text-sm">Chosen: similarity ≥ {report.chosen.thresholds.minSimilarity}, margin ≥ {report.chosen.thresholds.minMargin} · precision {pct(report.chosen.precision)} · {report.chosen.unknown} of {report.chosen.evaluated} unknown</span>}
      </div>
      {report?.chosen && <table className="text-sm"><thead><tr className="text-left text-muted-foreground"><th className="pr-4">Class</th><th className="pr-4">Examples</th><th className="pr-4">Precision</th><th>Recall</th></tr></thead><tbody>{report.chosen.perClass.map((c) => <tr key={c.cls}><td className="pr-4">{c.cls.replace(/_/g, ' ')}</td><td className="pr-4">{c.support}</td><td className="pr-4">{pct(c.precision)}</td><td>{pct(c.recall)}</td></tr>)}</tbody></table>}

      <section className="space-y-2">
        <h3 className="font-medium">Awaiting second-inspector approval ({pending.length})</h3>
        {pending.map((r) => <div key={r.id} className="flex items-center gap-3 text-sm border rounded p-2"><Badge variant="outline">{r.cls.replace(/_/g, ' ')}</Badge><span className="text-muted-foreground">{r.source_property_key}</span>
          <Button size="sm" className="ml-auto" disabled={busy || r.labeled_by === userId} title={r.labeled_by === userId ? 'You labeled this — another inspector must approve' : ''} onClick={async () => { setBusy(true); try { await approveCandidate(r.id, userId); toast.success('Approved into reference library'); refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }}>Approve</Button></div>)}
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Company photos ({photos.data?.length ?? 0})</h3>
        {photos.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {photos.data?.filter((p) => p.url).map((p) => <button key={p.id} className="border rounded overflow-hidden text-left" onClick={() => { setJson({}); setEditing(p); }}><img src={p.url!} alt="" loading="lazy" className="aspect-square w-full object-cover" /><div className="p-1 text-xs text-muted-foreground truncate">{rows.filter((r) => r.source_photo_id === p.id).length} crops</div></button>)}
        </div>
      </section>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Outline components · {editing?.propertyKey}</DialogTitle></DialogHeader>
          {editing?.url && <PhotoAnnotationEditor key={editing.id} imageUrl={editing.url} initialAnnotations={json} damageCategories={[...BENCHMARK_COMPONENT_CLASSES]} saving={busy} onChange={setJson}
            onSave={async (j) => { setBusy(true); try { const n = await saveReferenceCrops(tenantId, editing, j); toast.success(`${n} crop(s) saved — awaiting a second inspector`); setEditing(null); refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
