import { useEffect, useRef, useState } from 'react';
import '@/lib/pdfRenderer';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { inspectPageFonts, TEXT_EDIT_GAP, type FontCapability } from '@/lib/pdf-engine/textCapabilities';

export function PdfTextInspector({ bytes }: { bytes: Uint8Array }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [runs, setRuns] = useState<{ text: string; font: string; size: number; matrix: number[]; width: number; height: number }[]>([]);
  const [fonts, setFonts] = useState<FontCapability[]>([]);
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
    setSelected(null); setRuns([]); setFonts([]); setError(''); setLoading(true);
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
      try { const found = await inspectPageFonts(bytes, pageIndex); if (!cancelled) setFonts(found); }
      catch { if (!cancelled) setError('Font resources could not be verified. Original-font editing is blocked.'); }
    })().catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; render?.cancel(); };
  }, [doc, pageIndex, bytes]);

  const run = selected === null ? null : runs[selected];
  return <section className="space-y-3">
    <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>{TEXT_EDIT_GAP}</AlertDescription></Alert>
    <div className="flex items-center gap-2">
      <Button size="icon" variant="outline" aria-label="Previous text page" disabled={!doc || pageIndex === 0 || loading} onClick={() => setPageIndex(i => i - 1)}><ChevronLeft className="h-4 w-4" /></Button>
      <span className="text-sm">Page {pageIndex + 1} / {doc?.numPages ?? '…'}</span>
      <Button size="icon" variant="outline" aria-label="Next text page" disabled={!doc || pageIndex + 1 >= doc.numPages || loading} onClick={() => setPageIndex(i => i + 1)}><ChevronRight className="h-4 w-4" /></Button>
      <Badge variant="secondary">{runs.length} text areas</Badge>
    </div>
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    {!loading && !runs.length && !error && <p role="status" className="text-sm text-muted-foreground">No selectable text on this page. It may be scanned or outlined; OCR cannot recover its exact original font.</p>}
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
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
      <aside className="space-y-3 min-w-0">
        {run && <><label className="text-sm font-medium" htmlFor="original-text">Original text</label><Textarea id="original-text" readOnly value={run.text} aria-label="Selected original text" />
          <p className="text-xs text-muted-foreground">Font resource: {run.font} · {run.size.toFixed(2)} pt</p><Badge variant="outline">Original text: read-only</Badge></>}
        <h3 className="font-medium text-sm">Page fonts</h3>
        {fonts.map(f => <div key={f.resource} className="border-b pb-2 text-xs break-words"><p>{f.name}</p><p className="text-muted-foreground">/{f.resource} · {f.subset ? 'Subset — original font file may be required' : f.embedded ? 'Embedded font' : 'Font program not embedded'}{f.complexEncoding ? ' · Complex encoding — unsupported' : ''}</p></div>)}
      </aside>
    </div>
  </section>;
}