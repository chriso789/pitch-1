import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { loadDocumentPdf, saveDocumentVersion, type DocRow } from '@/lib/pdf-pages/documentVersions';
import { runWorkflow, validateSteps, STEP_LABELS, MAX_DOCS, type BatchStep } from '@/lib/pdf-batch/workflow';
import { isBatchEnabled } from '@/lib/pdf-pages/featureGate';

const defaults: Record<BatchStep['type'], BatchStep> = {
  rotate: { type: 'rotate', pages: 'all', angle: 90 },
  keep_pages: { type: 'keep_pages', pages: '1' },
  page_numbers: { type: 'page_numbers', format: 'Page {n} of {total}' },
  watermark: { type: 'watermark', text: 'DRAFT', opacity: 0.2 },
  set_title: { type: 'set_title', title: '' },
  strip_metadata: { type: 'strip_metadata' },
};

type Status = { state: 'waiting' | 'running' | 'saved' | 'failed' | 'preview'; note?: string };

export default function PdfBatchPage() {
  const tenantId = useEffectiveTenantId();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [steps, setSteps] = useState<BatchStep[]>([]);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    (supabase as any).from('documents').select('id, filename, file_path, document_type, tenant_id, metadata')
      .eq('tenant_id', tenantId).eq('mime_type', 'application/pdf').order('created_at', { ascending: false }).limit(300)
      .then(({ data }: any) => setDocs(data ?? []));
  }, [tenantId]);

  if (!isBatchEnabled()) return <div className="p-6">Batch PDF tasks aren't turned on here yet.</div>;

  const stepError = validateSteps(steps);
  const setStep = (i: number, patch: Partial<BatchStep>) => setSteps(s => s.map((x, j) => (j === i ? ({ ...x, ...patch } as BatchStep) : x)));
  const shown = docs.filter(d => d.filename.toLowerCase().includes(search.toLowerCase()));

  async function run(previewOnly: boolean) {
    if (!tenantId || stepError) return;
    setBusy(true);
    const ids = previewOnly ? picked.slice(0, 1) : picked;
    for (const id of ids) {
      setStatus(s => ({ ...s, [id]: { state: 'running' } }));
      try {
        const { doc, bytes } = await loadDocumentPdf(tenantId, id);
        const r = await runWorkflow(bytes, steps);
        if (previewOnly) {
          const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: 'application/pdf' }));
          window.open(url, '_blank');
          setStatus(s => ({ ...s, [id]: { state: 'preview', note: `${r.pagesIn} → ${r.pagesOut} pages · not saved` } }));
        } else {
          const v = await saveDocumentVersion({ tenantId, doc, bytes: r.bytes, kind: 'markup', summary: `Batch: ${r.log.join('; ')}`, metadata: { batch_workflow: { steps, log: r.log, ran_at: new Date().toISOString() } } });
          setStatus(s => ({ ...s, [id]: { state: 'saved', note: `New version v${v.version} · ${r.pagesOut} pages` } }));
        }
      } catch (e: any) {
        setStatus(s => ({ ...s, [id]: { state: 'failed', note: e?.message ?? 'Failed' } }));
      }
    }
    setBusy(false);
  }

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold">Batch PDF tasks</h1>
        <p className="text-sm text-muted-foreground">Pick up to {MAX_DOCS} company PDFs, build a list of steps, preview on the first file, then run. Each file gets a new version — originals are never changed.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">1. Files ({picked.length}/{MAX_DOCS})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Search files" value={search} onChange={e => setSearch(e.target.value)} />
            <div className="max-h-96 overflow-auto space-y-1">
              {shown.map(d => (
                <label key={d.id} className="flex items-center gap-2 text-sm py-1">
                  <Checkbox checked={picked.includes(d.id)} disabled={!picked.includes(d.id) && picked.length >= MAX_DOCS}
                    onCheckedChange={c => setPicked(p => (c ? [...p, d.id] : p.filter(x => x !== d.id)))} />
                  <span className="truncate flex-1">{d.filename}</span>
                  {status[d.id] && <span className={`text-xs ${status[d.id].state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{status[d.id].state}{status[d.id].note ? ` · ${status[d.id].note}` : ''}</span>}
                </label>
              ))}
              {!shown.length && <p className="text-sm text-muted-foreground">No PDFs found for this company.</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">2. Steps (run in order)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {steps.map((st, i) => (
              <div key={i} className="border rounded-md p-2 space-y-2">
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>{i + 1}. {STEP_LABELS[st.type]}</span>
                  <Button size="sm" variant="ghost" onClick={() => setSteps(s => s.filter((_, j) => j !== i))}>Remove</Button>
                </div>
                {(st.type === 'rotate' || st.type === 'keep_pages') && <Input value={st.pages} onChange={e => setStep(i, { pages: e.target.value })} placeholder="all or 1-3,5" />}
                {st.type === 'rotate' && (
                  <Select value={String(st.angle)} onValueChange={v => setStep(i, { angle: +v as 90 })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{[90, 180, 270].map(a => <SelectItem key={a} value={String(a)}>{a}° clockwise</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {st.type === 'page_numbers' && <Input value={st.format} onChange={e => setStep(i, { format: e.target.value })} />}
                {st.type === 'watermark' && <div className="flex gap-2"><Input value={st.text} onChange={e => setStep(i, { text: e.target.value })} /><Input type="number" step="0.05" min="0.05" max="1" className="w-24" value={st.opacity} onChange={e => setStep(i, { opacity: +e.target.value })} /></div>}
                {st.type === 'set_title' && <Input value={st.title} onChange={e => setStep(i, { title: e.target.value })} placeholder="Title" />}
              </div>
            ))}
            <Select value="" onValueChange={v => setSteps(s => [...s, { ...defaults[v as BatchStep['type']] }])}>
              <SelectTrigger><SelectValue placeholder="Add a step…" /></SelectTrigger>
              <SelectContent>{Object.entries(STEP_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
            {steps.length > 0 && stepError && <p className="text-sm text-destructive">{stepError}</p>}
          </CardContent>
        </Card>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy || !picked.length || !!stepError} onClick={() => run(true)}>Preview on first file</Button>
        <Button disabled={busy || !picked.length || !!stepError} onClick={() => run(false)}>{busy ? 'Working…' : `Run on ${picked.length} file(s)`}</Button>
        <Button variant="ghost" asChild><Link to="/documents">Back to documents</Link></Button>
      </div>
      <p className="text-xs text-muted-foreground">Password-protected files are skipped. Files run one at a time; a failure on one file doesn't stop the others. Every saved version records the exact steps used.</p>
    </div>
  );
}
