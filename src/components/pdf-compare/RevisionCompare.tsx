import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { loadPDFFromArrayBuffer } from '@/lib/pdfRenderer';
import { loadDocumentPdf, type DocRow } from '@/lib/pdf-pages/documentVersions';
import { diffRasters, revisionReport, type ChangeRegion } from '@/lib/pdf-compare/diff';
import { ComparisonRecords } from './ComparisonRecords';

const WIDTH = 1100; // both sheets rendered to the same width → compensates for different sheet sizes; PDF.js applies /Rotate and crop boxes

async function renderPage(bytes: Uint8Array, page: number) {
  const pdf: any = await loadPDFFromArrayBuffer(bytes.slice().buffer);
  const p = await pdf.getPage(Math.min(page, pdf.numPages));
  const base = p.getViewport({ scale: 1 });
  const vp = p.getViewport({ scale: WIDTH / base.width });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await p.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas: c, pages: pdf.numPages as number };
}

/** Phase 2C — read-only comparison. Never changes either version, takeoffs, estimates or budgets. */
export function RevisionCompare({ tenantId, doc, bytes }: { tenantId: string; doc: DocRow; bytes: Uint8Array }) {
  const [versions, setVersions] = useState<{ id: string; filename: string; created_at: string }[]>([]);
  const [otherId, setOtherId] = useState('');
  const [other, setOther] = useState<Uint8Array | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [view, setView] = useState<'side' | 'overlay' | 'diff'>('diff');
  const [opacity, setOpacity] = useState(50);
  const [dx, setDx] = useState(0); const [dy, setDy] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [imgs, setImgs] = useState<{ a: string; b: string; d: string; w: number; h: number } | null>(null);
  const [regions, setRegions] = useState<ChangeRegion[]>([]);
  const left = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = doc.metadata?.versions_root_id ?? doc.id;
    (supabase as any).from('documents').select('id, filename, created_at').eq('tenant_id', tenantId)
      .or(`id.eq.${root},metadata->>versions_root_id.eq.${root}`).order('created_at', { ascending: true })
      .then(({ data, error }: any) => { if (error) toast.error(error.message); setVersions((data ?? []).filter((v: any) => v.id !== doc.id)); });
  }, [tenantId, doc]);

  useEffect(() => { if (otherId) loadDocumentPdf(tenantId, otherId).then(r => setOther(r.bytes)).catch(e => toast.error(e.message)); }, [otherId, tenantId]);

  useEffect(() => {
    if (!other) return;
    let off = false;
    (async () => {
      const [a, b] = await Promise.all([renderPage(other, page), renderPage(bytes, page)]);
      if (off) return;
      setPages(Math.max(a.pages, b.pages));
      const ga = a.canvas.getContext('2d')!.getImageData(0, 0, a.canvas.width, a.canvas.height);
      const gb = b.canvas.getContext('2d')!.getImageData(0, 0, b.canvas.width, b.canvas.height);
      const r = diffRasters(ga, gb, { dx, dy });
      const W = Math.min(ga.width, gb.width), H = Math.min(ga.height, gb.height);
      const dc = document.createElement('canvas'); dc.width = W; dc.height = H;
      dc.getContext('2d')!.putImageData(new ImageData(r.overlay as unknown as Uint8ClampedArray<ArrayBuffer>, W, H), 0, 0);
      setRegions(r.regions);
      setImgs({ a: a.canvas.toDataURL('image/png'), b: b.canvas.toDataURL('image/png'), d: dc.toDataURL('image/png'), w: W, h: H });
    })().catch(e => toast.error(`Comparison failed: ${e.message}`));
    return () => { off = true; };
  }, [other, bytes, page, dx, dy]);

  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => { if (from && to) { to.scrollTop = from.scrollTop; to.scrollLeft = from.scrollLeft; } };
  const oldName = versions.find(v => v.id === otherId)?.filename ?? 'previous';
  const report = () => {
    if (!imgs) return;
    const text = revisionReport({ oldName, newName: doc.filename, page }, regions, { width: imgs.w, height: imgs.h });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = `revision-report-p${page}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const sheet = (src: string, extra?: React.ReactNode) => <div className="relative" style={{ width: (imgs?.w ?? 0) * zoom }}><img src={src} alt="" className="block w-full" />{extra}</div>;
  const boxes = imgs && regions.map((r, i) => <div key={i} title={r.kind} className={`absolute border-2 ${r.kind === 'added' ? 'border-primary' : r.kind === 'deleted' ? 'border-destructive' : 'border-accent-foreground'}`} style={{ left: `${(r.x / imgs.w) * 100}%`, top: `${(r.y / imgs.h) * 100}%`, width: `${(r.w / imgs.w) * 100}%`, height: `${(r.h / imgs.h) * 100}%` }} />);

  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Compares this version against another saved version. Highlighted areas are candidates for review only — nothing is changed in takeoffs, estimates or budgets, and both files stay as they are.</p>
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1"><Label htmlFor="cmp-ver">Compare with</Label>
        <select id="cmp-ver" className="border rounded-md bg-background p-2 text-sm" value={otherId} onChange={e => setOtherId(e.target.value)}>
          <option value="">{versions.length ? 'Choose a version…' : 'No other versions yet'}</option>
          {versions.map(v => <option key={v.id} value={v.id}>{v.filename} · {new Date(v.created_at).toLocaleString()}</option>)}
        </select></div>
      {(['diff', 'overlay', 'side'] as const).map(v => <Button key={v} size="sm" variant={view === v ? 'default' : 'outline'} onClick={() => setView(v)}>{v === 'diff' ? 'Changes' : v === 'overlay' ? 'Overlay' : 'Side by side'}</Button>)}
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button><span className="text-sm">Page {page}/{pages}</span><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</Button>
      <Button size="sm" variant="outline" onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}>−</Button><span className="text-sm">{Math.round(zoom * 100)}%</span><Button size="sm" variant="outline" onClick={() => setZoom(z => Math.min(4, z + 0.25))}>+</Button>
    </div>
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <span>Nudge alignment:</span>
      <Button size="sm" variant="outline" onClick={() => setDx(x => x - 1)}>←</Button><Button size="sm" variant="outline" onClick={() => setDx(x => x + 1)}>→</Button>
      <Button size="sm" variant="outline" onClick={() => setDy(y => y - 1)}>↑</Button><Button size="sm" variant="outline" onClick={() => setDy(y => y + 1)}>↓</Button>
      <span className="text-muted-foreground">offset {dx}, {dy}px</span>
      {view === 'overlay' && <div className="w-40"><Slider value={[opacity]} onValueChange={v => setOpacity(v[0])} max={100} aria-label="Overlay transparency" /></div>}
      {imgs && <Badge variant="secondary">{regions.length} change area(s)</Badge>}
      <Button size="sm" variant="outline" disabled={!imgs} onClick={report}>Download revision report</Button>
    </div>
    {!otherId ? null : !imgs ? <p className="text-muted-foreground">Rendering…</p> : view === 'side'
      ? <div className="grid grid-cols-2 gap-2">
          <div ref={left} onScroll={() => sync(left.current, right.current)} className="overflow-auto max-h-[75vh] border"><p className="text-xs p-1">Previous</p>{sheet(imgs.a)}</div>
          <div ref={right} onScroll={() => sync(right.current, left.current)} className="overflow-auto max-h-[75vh] border"><p className="text-xs p-1">This version</p>{sheet(imgs.b, boxes)}</div>
        </div>
      : <div className="overflow-auto max-h-[75vh] border">{sheet(view === 'diff' ? imgs.b : imgs.a, <>
          {view === 'overlay' && <img src={imgs.b} alt="" className="absolute inset-0 w-full" style={{ opacity: opacity / 100 }} />}
          {view === 'diff' && <><img src={imgs.d} alt="" className="absolute inset-0 w-full" />{boxes}</>}
        </>)}</div>}
    {view === 'diff' && imgs && <p className="text-xs text-muted-foreground">Green = added in this version, red = removed. Boxes group nearby changes.</p>}
    <ComparisonRecords tenantId={tenantId} revisedId={doc.id} baseId={otherId} page={page} dx={dx} dy={dy}
      size={otherId && imgs ? { w: imgs.w, h: imgs.h } : null} regions={regions}
      onOpen={s => { setOtherId(s.baseId); setPage(s.page); setDx(s.dx); setDy(s.dy); setView('diff'); }} />
  </div>;
}
