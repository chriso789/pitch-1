import { useEffect, useRef, useState } from 'react';
import '@/lib/pdfRenderer';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import { readPageText, checkReplacement, replaceSegmentText, type PageText } from '@/lib/pdf-engine/contentTextEdit';
import { toast } from 'sonner';

export function PdfTextInspector({ bytes, onSaveVersion }: { bytes: Uint8Array; onSaveVersion?: (b: Uint8Array, summary: string) => Promise<void> }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [runs, setRuns] = useState<{ text: string; font: string; size: number; matrix: number[]; width: number; height: number }[]>([]);
  const [pt, setPt] = useState<PageText | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(''); setLoading(true);
    const task = pdfjs.getDocument({ data: bytes.slice() });
    task.promise.then(pdf => { if (!cancelled) { setDoc(pdf); setPageIndex(0); } }).catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; void task.destroy(); };
  }, [bytes]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setSelected(null); setRuns([]); setPt(null); setError(''); setLoading(true);
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(0.1, Math.min(1.5, ((wrapper.current?.clientWidth ?? 800) - 24) / base.width));
      const viewport = page.getViewport({ scale });
      const content = await page.getTextContent();
      if (cancelled || !canvas.current) return;
      const c = canvas.current; c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
      const context = c.getContext('2d'); if (!context) throw new Error('Page rendering unavailable');
      render = page.render({ canvasContext: context, viewport });
      await render.promise;
      if (cancelled) return;
      setDimensions({ width: viewport.width, height: viewport.height });
      setRuns(content.items.filter((item): item is TextItem => 'str' in item && !!item.str.trim()).map(item => {
        const tx = pdfjs.Util.transform(viewport.transform, item.transform);
        const height = Math.hypot(tx[2], tx[3]);
        const angle = Math.atan2(tx[1], tx[0]);
        const ascent = content.styles[item.fontName]?.ascent ?? 0.8;
        return { text: item.str, font: item.fontName, size: Math.hypot(item.transform[2], item.transform[3]), width: item.width * scale, height,
          matrix: [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), tx[4] + height * ascent * Math.sin(angle), tx[5] - height * ascent * Math.cos(angle)] };
      }));
      try { const d = await PDFDocument.load(bytes.slice(), { updateMetadata: false, ignoreEncryption: true }); if (!cancelled) setPt(readPageText(d, pageIndex)); }
      catch (e) { if (!cancelled) setError(`The page's content could not be read for editing: ${(e as Error).message}`); }
    })().catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; render?.cancel(); };
  }, [doc, pageIndex, bytes]);

  const run = selected === null ? null : runs[selected];
  // Map the selected visual text area to the real content-stream operator (nth identical occurrence).
  const seg = (() => {
    if (!run || !pt) return null;
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
    const nth = runs.slice(0, selected!).filter(r => norm(r.text) === norm(run.text)).length;
    return pt.segments.filter(s => norm(s.text) === norm(run.text))[nth] ?? null;
  })();
  const font = seg?.fontKey ? pt?.fonts[seg.fontKey] : undefined;
  const check = seg && pt && draft !== seg.text ? checkReplacement(pt, seg, draft) : null;
  useEffect(() => { setDraft(seg?.text ?? ''); }, [seg?.id, pt]); // eslint-disable-line react-hooks/exhaustive-deps
  const reason = !run ? '' : pt?.blocked ? pt.blocked : !seg ? 'This text area does not map to exactly one text operator on the page (it may be split across operators, drawn inside a reusable form object, or be outlined/scanned).' : !font ? `Font resource /${seg.fontKey} is missing from the page resources.` : font.reason ?? '';
  const apply = async () => {
    if (!seg || !onSaveVersion) return;
    setBusy(true);
    try { const out = await replaceSegmentText(bytes, pageIndex, seg.id, draft); await onSaveVersion(out, `Edited existing text on page ${pageIndex + 1} in original font ${font?.baseFont}`); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="space-y-3">
    <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Select text to see its real font. Text can be changed only when its original font is verified to contain every new character; the actual text in the PDF is replaced (no cover-up box, no substitute font) and saved as a new version.</AlertDescription></Alert>
    <div className="flex items-center gap-2">
      <Button size="icon" variant="outline" aria-label="Previous text page" disabled={!doc || pageIndex === 0 || loading} onClick={() => setPageIndex(i => i - 1)}><ChevronLeft className="h-4 w-4" /></Button>
      <span className="text-sm">Page {pageIndex + 1} / {doc?.numPages ?? '…'}</span>
      <Button size="icon" variant="outline" aria-label="Next text page" disabled={!doc || pageIndex + 1 >= doc.numPages || loading} onClick={() => setPageIndex(i => i + 1)}><ChevronRight className="h-4 w-4" /></Button>
      <Badge variant="secondary">{runs.length} text areas</Badge>
    </div>
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    {pt?.blocked && <p role="alert" className="text-destructive text-sm">{pt.blocked}</p>}
    {!loading && !runs.length && !error && <p role="status" className="text-sm text-muted-foreground">No selectable text on this page. It may be scanned or outlined; OCR cannot recover its exact original font.</p>}
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div ref={wrapper} className="overflow-auto border rounded-md p-3 max-h-[70vh]">
        {loading && <p role="status">Reading page…</p>}
        <div className="relative" style={{ width: dimensions.width, height: dimensions.height }}>
          <canvas ref={canvas} className="block" />
          {!loading && <svg className="absolute inset-0" width={dimensions.width} height={dimensions.height} aria-label="Original PDF text areas">
            {runs.map((r, i) => <g key={i} transform={`matrix(${r.matrix.join(' ')})`}><rect role="button" tabIndex={0} aria-label={`Select text: ${r.text}`} x={0} y={0} width={Math.max(6, r.width)} height={Math.max(6, r.height)}
              className={selected === i ? 'fill-primary/10 stroke-primary cursor-text' : 'fill-transparent hover:fill-primary/10 cursor-text'}
              onClick={() => setSelected(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(i); } }} /></g>)}
          </svg>}
        </div>
      </div>
      <aside className="space-y-3 min-w-0 text-sm">
        {!run && <p className="text-muted-foreground">Click any text on the page.</p>}
        {run && <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs break-words">
            <dt className="text-muted-foreground">Viewer alias</dt><dd>{run.font} (internal, not the font name)</dd>
            <dt className="text-muted-foreground">Size</dt><dd>{run.size.toFixed(2)} pt</dd>
            {seg && <><dt className="text-muted-foreground">PDF resource</dt><dd>/{seg.fontKey} · operator {seg.op}{seg.kerned ? ' (kerned)' : ''}</dd></>}
            {font && <><dt className="text-muted-foreground">Font</dt><dd>{font.baseFont.replace(/^[A-Z]{6}\+/, '')}</dd>
              <dt className="text-muted-foreground">Type</dt><dd>{font.subtype} · {font.encoding}</dd>
              <dt className="text-muted-foreground">Program</dt><dd>{font.embedded ? 'Embedded' : font.standard14 ? 'Standard PDF font' : 'Not embedded'}{font.subset ? ' · subset' : ''}</dd>
              <dt className="text-muted-foreground">Glyphs available</dt><dd>{font.standard14 ? 'Full standard set' : `${font.usedCodes.size} proven in this page`}</dd></>}
          </dl>
          {reason ? <><Badge variant="outline">Read-only</Badge><p className="text-xs text-destructive">{reason}</p><Textarea readOnly value={run.text} aria-label="Selected original text" /></>
          : <>
            <Badge>Verified editable — original font</Badge>
            <Textarea aria-label="Replacement text" value={draft} onChange={e => setDraft(e.target.value)} disabled={busy} />
            {check && "reason" in check && <p className="text-xs text-destructive">{check.reason}</p>}
            {seg?.kerned && <p className="text-xs text-muted-foreground">Original letter-spacing adjustments in this text will be removed; the font itself is unchanged.</p>}
            {onSaveVersion && <Button size="sm" disabled={busy || !check?.ok} onClick={apply}>{busy ? 'Saving…' : 'Replace text & save new version'}</Button>}
          </>}
        </>}
      </aside>
    </div>
  </section>;
}
