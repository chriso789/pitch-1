import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PhotoAnnotationEditor } from '@/components/photo-intelligence/PhotoAnnotationEditor';
import { BENCHMARK_COMPONENT_CLASSES } from '@/lib/photo-intelligence/benchmarkHarness';
import { type ComponentCondition, approveCandidate, approvedToExamples, inventoryCompanyPhotos, loadCandidates, saveReferenceCrops, type InventoryPhoto } from '@/lib/photo-intelligence/components/referenceCandidates';
import { heldOutEvaluation, type HeldOutReport, type SplitMetrics } from '@/lib/photo-intelligence/components/heldOutEvaluation';
import { recommendForLabeling, triagePhotos, type TriagedPhoto } from '@/lib/photo-intelligence/components/photoTriage';
import { proposeRegions, proposalsToAnnotations, type ProposalReport } from '@/lib/photo-intelligence/components/regionProposals';
import { parseAnnotationSet, serializeAnnotations } from '@/lib/photo-intelligence/annotations';
import { toast } from 'sonner';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const nice = (c: string) => c.replace(/_/g, ' ');

function MetricsTable({ m }: { m: SplitMetrics }) {
  return (
    <div className="space-y-1 text-sm">
      <div>Precision {pct(m.precision)} · accuracy {pct(m.coverageAccuracy)} · {m.unknown} of {m.evaluated} unknown · {m.falsePositives} false component claims on shadows/debris · {m.correctRejections} correct "unknown" on unseen classes</div>
      <table><thead><tr className="text-left text-muted-foreground"><th className="pr-4">Class</th><th className="pr-4">Examples</th><th className="pr-4">Properties</th><th className="pr-4">Precision</th><th>Recall</th></tr></thead>
        <tbody>{m.perClass.map((c) => <tr key={c.cls}><td className="pr-4">{nice(c.cls)}</td><td className="pr-4">{c.support}</td><td className="pr-4">{c.properties}</td><td className="pr-4">{pct(c.precision)}</td><td>{pct(c.recall)}</td></tr>)}</tbody></table>
    </div>
  );
}

export function ReferenceLibraryTab({ tenantId, userId }: { tenantId: string; userId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<InventoryPhoto | null>(null);
  const [json, setJson] = useState<unknown>({});
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<HeldOutReport | null>(null);
  const [triage, setTriage] = useState<TriagedPhoto[] | null>(null);
  const [triageDone, setTriageDone] = useState(0);
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  const [proposal, setProposal] = useState<ProposalReport | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [assignCls, setAssignCls] = useState<string>(BENCHMARK_COMPONENT_CLASSES[0]);
  const [approveSel, setApproveSel] = useState<Set<string>>(new Set());
  const [conditions, setConditions] = useState<Record<string, ComponentCondition>>({});
  const [assignCond, setAssignCond] = useState<ComponentCondition | ''>('');
  const [comment, setComment] = useState('');

  const photos = useQuery({ queryKey: ['ref-inventory', tenantId], queryFn: () => inventoryCompanyPhotos(tenantId, 500) });
  const cands = useQuery({ queryKey: ['ref-candidates', tenantId], queryFn: () => loadCandidates(tenantId) });
  const rows = cands.data ?? [];
  const approved = useMemo(() => approvedToExamples(rows), [rows]);
  const props = new Set(approved.map((a) => a.propertyKey)).size;
  const pending = rows.filter((r) => !r.approved_by);
  const refresh = () => qc.invalidateQueries({ queryKey: ['ref-candidates', tenantId] });
  const library = useMemo(() => ({ version: 1, embeddingModelId: 'dinov2-small', examples: approved }), [approved]);

  const classCoverage = useMemo(() => {
    const m = new Map<string, { approved: number; pending: number; props: Set<string> }>();
    for (const r of rows) {
      if (!m.has(r.cls)) m.set(r.cls, { approved: 0, pending: 0, props: new Set() });
      const e = m.get(r.cls)!;
      if (r.approved_by) { e.approved++; e.props.add(r.source_property_key); } else e.pending++;
    }
    return [...m].sort((a, b) => b[1].props.size - a[1].props.size);
  }, [rows]);

  const triageById = useMemo(() => new Map((triage ?? []).map((t) => [t.id, t])), [triage]);
  const recommended = useMemo(() => new Set(triage ? recommendForLabeling(triage, 100).map((t) => t.id) : []), [triage]);
  const allPhotos = photos.data ?? [];
  const propertyCount = new Set(allPhotos.map((p) => p.propertyKey)).size;
  const shown = allPhotos.filter((p) => p.url && (!onlyRecommended || recommended.has(p.id)));

  const runTriage = async () => {
    setBusy(true); setTriageDone(0);
    try { setTriage(await triagePhotos(allPhotos, setTriageDone)); } finally { setBusy(false); }
  };

  const runProposals = async () => {
    if (!editing?.url) return;
    setBusy(true);
    try {
      const r = await proposeRegions(editing.url, library, report?.chosen ?? undefined);
      setProposal(r);
      const existing = parseAnnotationSet(json);
      setJson(serializeAnnotations([...existing, ...proposalsToAnnotations(r.regions)]));
      setPicked(new Set()); setEditorKey((k) => k + 1);
      r.warnings.forEach((w) => toast.warning(w));
      if (!r.regions.length) toast.info('No outlines were proposed for this photo.');
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const assignPicked = () => {
    const anns = parseAnnotationSet(json).map((a) => (picked.has(a.id) ? { ...a, damageCategory: assignCls } : a));
    if (assignCond) setConditions((c) => { const n = { ...c }; picked.forEach((id) => { n[id] = assignCond; }); return n; });
    setJson(serializeAnnotations(anns)); setPicked(new Set()); setEditorKey((k) => k + 1);
  };

  const currentAnns = parseAnnotationSet(json);
  const proposalIds = new Set(proposal?.regions.map((r) => r.id) ?? []);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Label roof components on this company's existing photos. Originals are never copied or changed, rep-picked categories are never used as labels, and automatic outlines and suggestions stay unverified until an inspector assigns a type and a second inspector approves it.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{allPhotos.length}</div><div className="text-xs text-muted-foreground">Company photos from {propertyCount} properties</div></div>
        <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{approved.length}</div><div className="text-xs text-muted-foreground">Approved component examples</div></div>
        <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{props}</div><div className="text-xs text-muted-foreground">Properties with approved examples</div></div>
        <div className="rounded-md border p-3"><div className="text-2xl font-semibold">{report?.test ? pct(report.test.coverageAccuracy) : '—'}</div><div className="text-xs text-muted-foreground">Accuracy on held-out test properties{report?.experimental ? ' (experimental)' : ''}</div></div>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="outline" disabled={!approved.length || busy} onClick={() => setReport(heldOutEvaluation(approved))}>Evaluate on held-out properties</Button>
          {report?.blockedReason && <span className="text-sm text-muted-foreground">{report.blockedReason}</span>}
        </div>
        {report && <div className="text-sm text-muted-foreground">Properties — reference {report.splits.reference.properties} · calibration {report.splits.calibration.properties} · test {report.splits.test.properties}. Thresholds are chosen on calibration properties only; test properties are scored once.{report.experimental && ' Fewer than 5 test properties: results are experimental.'}</div>}
        {report?.chosen && <div className="text-sm">Chosen on calibration: similarity ≥ {report.chosen.minSimilarity}, margin ≥ {report.chosen.minMargin}</div>}
        {report?.test && <div><h4 className="font-medium text-sm">Test properties</h4><MetricsTable m={report.test} /></div>}
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Properties per component type</h3>
        {classCoverage.length ? <table className="text-sm"><thead><tr className="text-left text-muted-foreground"><th className="pr-4">Type</th><th className="pr-4">Approved</th><th className="pr-4">Awaiting approval</th><th>Properties</th></tr></thead>
          <tbody>{classCoverage.map(([c, v]) => <tr key={c}><td className="pr-4">{nice(c)}</td><td className="pr-4">{v.approved}</td><td className="pr-4">{v.pending}</td><td>{v.props.size}</td></tr>)}</tbody></table>
          : <p className="text-sm text-muted-foreground">No labels yet. Suggested first types: roof covering (tile/shingle/metal), ridge cap, penetrations, and shadows.</p>}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Awaiting second-inspector approval ({pending.length})</h3>
          <Button size="sm" className="ml-auto" disabled={busy || !approveSel.size} onClick={async () => {
            setBusy(true);
            try { for (const id of approveSel) await approveCandidate(id, userId, comment); setComment(''); toast.success(`${approveSel.size} approved`); setApproveSel(new Set()); refresh(); }
            catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
          }}>Approve {approveSel.size || ''} I checked</Button>
          <input className="border rounded px-2 py-1 text-sm bg-background" placeholder="Reviewer comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        {pending.map((r) => {
          const mine = r.labeled_by === userId;
          return <label key={r.id} className="flex items-center gap-3 text-sm border rounded p-2">
            <Checkbox disabled={mine} checked={approveSel.has(r.id)} onCheckedChange={(v) => setApproveSel((s) => { const n = new Set(s); if (v) n.add(r.id); else n.delete(r.id); return n; })} />
            <Badge variant="outline">{nice(r.cls)}</Badge>{r.condition && <Badge variant="secondary">{nice(r.condition)}</Badge>}<span className="text-muted-foreground">{r.source_property_key}</span>
            {mine && <span className="ml-auto text-xs text-muted-foreground">You labeled this — another inspector must approve</span>}
          </label>;
        })}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">Company photos</h3>
          <Button size="sm" variant="outline" disabled={busy || !allPhotos.length} onClick={runTriage}>{busy && !triage ? `Checking ${triageDone}/${allPhotos.length}…` : 'Check quality & duplicates'}</Button>
          {triage && <>
            <span className="text-sm text-muted-foreground">{triage.filter((t) => !t.assessable).length} too dark/blurry · {triage.filter((t) => t.duplicateOf).length} near-duplicates · {recommended.size} recommended across {new Set(triage.filter((t) => recommended.has(t.id)).map((t) => t.propertyKey)).size} properties</span>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={onlyRecommended} onCheckedChange={(v) => setOnlyRecommended(!!v)} />Show recommended only</label>
          </>}
        </div>
        {photos.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {shown.map((p) => {
            const t = triageById.get(p.id);
            return <button key={p.id} className="border rounded overflow-hidden text-left" onClick={() => { setJson({}); setConditions({}); setProposal(null); setPicked(new Set()); setEditorKey((k) => k + 1); setEditing(p); }}>
              <img src={p.url!} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              <div className="p-1 text-xs text-muted-foreground truncate">
                {rows.filter((r) => r.source_photo_id === p.id).length} labels
                {t && (t.duplicateOf ? ' · duplicate' : !t.assessable ? ' · poor quality' : recommended.has(p.id) ? ' · recommended' : '')}
              </div>
            </button>;
          })}
        </div>
      </section>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Label components · {editing?.propertyKey}</DialogTitle></DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={runProposals}>{busy ? 'Working…' : 'Propose outlines'}</Button>
            <span className="text-xs text-muted-foreground">Runs locally in this browser. Outlines start unlabeled; drag points to correct them.</span>
          </div>

          {proposal && <div className="rounded-md border p-3 space-y-2 text-sm">
            <div className="font-medium">Recognition report (component recognition only — not damage detection)</div>
            <div className="text-muted-foreground">Segmenter {proposal.models.segmenter ?? 'not loaded'} · embedder {proposal.models.embedder ?? 'not loaded'} · reference library v{proposal.models.libraryVersion} ({proposal.models.libraryExamples} approved examples){report?.chosen ? ` · thresholds from calibration` : ' · default thresholds (unvalidated)'}</div>
            <div className="text-muted-foreground">Time: decode {Math.round(proposal.timingsMs.decode)} ms · segment {Math.round(proposal.timingsMs.segment)} ms · embed {Math.round(proposal.timingsMs.embed)} ms · classify {Math.round(proposal.timingsMs.classify)} ms · anomaly check {Math.round(proposal.timingsMs.anomaly)} ms</div>
            <div className="text-muted-foreground">{proposal.anomalies.length} possible visual anomalies (pattern check, not confirmed damage).</div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="border rounded px-2 py-1 bg-background" value={assignCls} onChange={(e) => setAssignCls(e.target.value)}>
                {BENCHMARK_COMPONENT_CLASSES.map((c) => <option key={c} value={c}>{nice(c)}</option>)}
              </select>
              <select className="border rounded px-2 py-1 bg-background" value={assignCond} onChange={(e) => setAssignCond(e.target.value as ComponentCondition | '')}>
                <option value="">condition: not set</option><option value="normal">normal</option><option value="possible_damage">possible damage</option><option value="maintenance">maintenance</option><option value="uncertain">uncertain</option>
              </select>
              <Button size="sm" disabled={!picked.size} onClick={assignPicked}>Assign to {picked.size} selected</Button>
            </div>
            <div className="space-y-1">
              {proposal.regions.map((r, i) => {
                const ann = currentAnns.find((a) => a.id === r.id);
                return <label key={r.id} className="flex items-center gap-2">
                  <Checkbox checked={picked.has(r.id)} onCheckedChange={(v) => setPicked((s) => { const n = new Set(s); if (v) n.add(r.id); else n.delete(r.id); return n; })} />
                  <span>Outline {i + 1} · group {r.group + 1}</span>
                  {conditions[r.id] && <Badge variant="secondary">{nice(conditions[r.id])}</Badge>}{ann?.damageCategory ? <Badge>{nice(ann.damageCategory)}</Badge> : <Badge variant="outline">unlabeled</Badge>}
                  <span className="text-muted-foreground">{r.suggestion.cls ? `suggests ${nice(r.suggestion.cls)} ${r.suggestion.similarity?.toFixed(2)} (margin ${r.suggestion.margin?.toFixed(2)})` : 'unknown'}{r.suggestion.runnerUp ? ` · next ${nice(r.suggestion.runnerUp.cls)} ${r.suggestion.runnerUp.similarity.toFixed(2)}` : ''}</span>
                </label>;
              })}
              {proposal.regions.length > 0 && <Button size="sm" variant="ghost" onClick={() => { const g = new Map<number, string[]>(); proposal.regions.forEach((r) => g.set(r.group, [...(g.get(r.group) ?? []), r.id])); const first = [...picked][0]; const grp = proposal.regions.find((r) => r.id === first)?.group; if (grp !== undefined) setPicked(new Set(g.get(grp))); }} disabled={!picked.size}>Select whole group of first selected</Button>}
            </div>
          </div>}

          {editing?.url && <PhotoAnnotationEditor key={`${editing.id}-${editorKey}`} imageUrl={editing.url} initialAnnotations={json} damageCategories={[...BENCHMARK_COMPONENT_CLASSES]} saving={busy} onChange={setJson}
            onSave={async (j) => {
              setBusy(true);
              try {
                const unlabeled = parseAnnotationSet(j).filter((a) => proposalIds.has(a.id) && !a.damageCategory).length;
                const n = await saveReferenceCrops(tenantId, editing, j, conditions);
                toast.success(`${n} label(s) saved — awaiting a second inspector${unlabeled ? `; ${unlabeled} unlabeled outline(s) skipped` : ''}`);
                setEditing(null); refresh();
              } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
            }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
