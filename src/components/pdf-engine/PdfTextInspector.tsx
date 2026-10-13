import { useEffect, useMemo, useRef, useState } from 'react';
import '@/lib/pdfRenderer';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
type PageViewport = ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getViewport']>;
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, AlertTriangle, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, RotateCcw, Unlock } from 'lucide-react';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readPageText, checkReplacement, checkRestyle, replaceSegmentText, rewriteSegment, pageFontChoices, STANDARD_CHOICES, type PageText, type FontChoice } from '@/lib/pdf-engine/contentTextEdit';
import { openForEditing } from '@/lib/pdf-engine/decrypt';
import { toast } from 'sonner';

type Run = { text: string; font: string; size: number; raw: number[]; matrix: number[]; width: number; height: number };

const hexToRgb = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

/** Positions of every text item on a page (PDF user space) — used to prove nothing else moved. */
async function textPositions(bytes: Uint8Array, pageIndex: number) {
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    const c = await (await pdf.getPage(pageIndex + 1)).getTextContent();
    return c.items.filter((i): i is TextItem => 'str' in i && !!i.str.trim()).map(i => `${i.str.trim()}|${i.transform[4].toFixed(1)}|${i.transform[5].toFixed(1)}`);
  } finally { void pdf.destroy(); }
}
function sameExcept(before: string[], after: string[], removedKey: string, addedText: string) {
  const b = [...before]; const bi = b.indexOf(removedKey); if (bi >= 0) b.splice(bi, 1);
  const a = [...after]; const ai = a.findIndex(k => k.startsWith(addedText.trim() + '|')); if (ai >= 0) a.splice(ai, 1);
  b.sort(); a.sort(); return a.length === b.length && a.every((k, i) => k === b[i]);
}

export function PdfTextInspector({ bytes, onSaveVersion }: { bytes: Uint8Array; onSaveVersion?: (b: Uint8Array, summary: string) => Promise<void> }) {
  const [work, setWork] = useState<{ bytes: Uint8Array; decrypted: boolean } | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [runs, setRuns] = useState<Run[]>([]);
  const [pt, setPt] = useState<PageText | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  // edit controls
  const [draft, setDraft] = useState('');
  const [fontId, setFontId] = useState('');
  const [size, setSize] = useState(0);
  const [keepColor, setKeepColor] = useState(true);
  const [color, setColor] = useState('#000000');
  const [dx, setDx] = useState(0); const [dy, setDy] = useState(0);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  // 1) make the file parseable (unlock owner-protected files locally)
  useEffect(() => {
    let cancelled = false; setWork(null); setError(''); setLoading(true);
    openForEditing(bytes).then(w => { if (!cancelled) setWork(w); })
      .catch(e => { if (!cancelled) { setWork({ bytes, decrypted: false }); setError((e as Error).message); } });
    return () => { cancelled = true; };
  }, [bytes]);

  useEffect(() => {
    if (!work) return;
    let cancelled = false;
    const task = pdfjs.getDocument({ data: work.bytes.slice() });
    task.promise.then(pdf => { if (!cancelled) { setDoc(pdf); setPageIndex(0); } }).catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; void task.destroy(); };
  }, [work]);

  useEffect(() => {
    if (!doc || !work) return;
    let cancelled = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setSelected(null); setRuns([]); setPt(null); setLoading(true);
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(0.1, Math.min(1.5, ((wrapper.current?.clientWidth ?? 800) - 24) / base.width));
      const vp = page.getViewport({ scale });
      const content = await page.getTextContent();
      if (cancelled || !canvas.current) return;
      const c = canvas.current; c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const context = c.getContext('2d'); if (!context) throw new Error('Page rendering unavailable');
      render = page.render({ canvasContext: context, viewport: vp });
      await render.promise;
      if (cancelled) return;
      setViewport(vp);
      setRuns(content.items.filter((item): item is TextItem => 'str' in item && !!item.str.trim()).map(item => {
        const tx = pdfjs.Util.transform(vp.transform, item.transform);
        const height = Math.hypot(tx[2], tx[3]);
        const angle = Math.atan2(tx[1], tx[0]);
        const ascent = content.styles[item.fontName]?.ascent ?? 0.8;
        return { text: item.str, font: item.fontName, size: Math.hypot(item.transform[2], item.transform[3]), raw: item.transform as number[], width: item.width * scale, height,
          matrix: [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), tx[4] + height * ascent * Math.sin(angle), tx[5] - height * ascent * Math.cos(angle)] };
      }));
      try { const d = await PDFDocument.load(work.bytes.slice(), { updateMetadata: false }); if (!cancelled) setPt(readPageText(d, pageIndex)); }
      catch (e) { if (!cancelled) setError(`The page's content could not be read for editing: ${(e as Error).message}`); }
    })().catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; render?.cancel(); };
  }, [doc, pageIndex, work]);

  const run = selected === null ? null : runs[selected];
  // Map the selected visual text area to the real content-stream operator (nth identical occurrence).
  const seg = useMemo(() => {
    if (!run || !pt) return null;
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
    const nth = runs.slice(0, selected!).filter(r => norm(r.text) === norm(run.text)).length;
    return pt.segments.filter(s => norm(s.text) === norm(run.text))[nth] ?? null;
  }, [run, pt, runs, selected]);
  const font = seg?.fontKey ? pt?.fonts[seg.fontKey] : undefined;
  const originalId = seg?.fontKey ? `page:${seg.fontKey}` : '';

  useEffect(() => {
    setDraft(seg?.text ?? ''); setFontId(originalId); setSize(run ? Math.round(run.size * 100) / 100 : 0);
    setKeepColor(true); setDx(0); setDy(0);
  }, [seg?.id, pt]); // eslint-disable-line react-hooks/exhaustive-deps

  const choice: FontChoice | null = fontId.startsWith('page:') ? { kind: 'page', key: fontId.slice(5) } : fontId.startsWith('std:') ? { kind: 'standard', name: fontId.slice(4) as StandardFonts } : null;
  const restyled = !!run && (fontId !== originalId || Math.abs(size - run.size) > 0.01 || !keepColor || dx !== 0 || dy !== 0);
  const check = seg && pt && choice ? (restyled ? checkRestyle(pt, seg, { text: draft, font: choice, size }) : draft !== seg.text ? checkReplacement(pt, seg, draft) : null) : null;
  const changed = !!seg && (restyled || draft !== seg.text);
  const reason = !run ? '' : pt?.blocked ? pt.blocked : !pt ? (error || 'Reading page…') : !seg ? 'This text area does not map to exactly one text operator on the page (it may be split across operators, drawn inside a reusable form object, or be outlined/scanned).' : !font ? `Font resource /${seg.fontKey} is missing from the page resources.` : '';
  const fontLocked = !!font && !font.editable; // original font unusable — other fonts may still be chosen

  // drag the selected box to move it
  const toPdfDelta = (sx: number, sy: number) => {
    if (!viewport) return [0, 0];
    const [x0, y0] = viewport.convertToPdfPoint(0, 0), [x1, y1] = viewport.convertToPdfPoint(sx, sy);
    return [x1 - x0, y1 - y0];
  };
  const onDown = (e: React.PointerEvent) => { if (reason || !seg) return; (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, dx, dy }; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const [px, py] = toPdfDelta(e.clientX - d.x, e.clientY - d.y);
    setDx(Math.round((d.dx + px) * 10) / 10); setDy(Math.round((d.dy + py) * 10) / 10);
  };
  const onUp = () => { drag.current = null; };
  const screenOffset = (() => {
    if (!viewport) return [0, 0];
    const [ox, oy] = viewport.convertToViewportPoint(0, 0), [nx, ny] = viewport.convertToViewportPoint(dx, dy);
    return [nx - ox, ny - oy];
  })();

  const fontLabel = (id: string) => id.startsWith('std:') ? STANDARD_CHOICES.find(s => `std:${s.name}` === id)?.label ?? id : pt?.fonts[id.slice(5)]?.baseFont.replace(/^[A-Z]{6}\+/, '') ?? id;

  const apply = async () => {
    if (!seg || !work || !run || !choice || !pt) return;
    setBusy(true);
    try {
      const out = restyled
        ? await rewriteSegment(work.bytes, pageIndex, seg.id, { text: draft, font: choice, size, matrix: run.raw, dx, dy, color: keepColor ? null : hexToRgb(color) })
        : await replaceSegmentText(work.bytes, pageIndex, seg.id, draft);
      // independent check with a second PDF engine: every other text item is exactly where it was
      const [before, after] = await Promise.all([textPositions(work.bytes, pageIndex), textPositions(out, pageIndex)]);
      const key = `${run.text.trim()}|${run.raw[4].toFixed(1)}|${run.raw[5].toFixed(1)}`;
      if (!sameExcept(before, after, key, draft)) throw new Error('Verification failed: other text on the page would move or change. Nothing was saved.');
      const summary = restyled
        ? `Edited text on page ${pageIndex + 1}: ${fontLabel(fontId)} ${size}pt${dx || dy ? `, moved ${dx}, ${dy} pt` : ''}${work.decrypted ? ' (unlocked from owner-protected original)' : ''}`
        : `Edited existing text on page ${pageIndex + 1} in original font ${font?.baseFont}${work.decrypted ? ' (unlocked from owner-protected original)' : ''}`;
      if (onSaveVersion) await onSaveVersion(out, summary);
      else { const url = URL.createObjectURL(new Blob([out.slice().buffer as ArrayBuffer], { type: 'application/pdf' })); const a = document.createElement('a'); a.href = url; a.download = 'edited.pdf'; a.click(); URL.revokeObjectURL(url); toast.success('Edited PDF downloaded'); }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const nudge = (x: number, y: number) => { setDx(v => Math.round((v + x) * 10) / 10); setDy(v => Math.round((v + y) * 10) / 10); };
  const pageFonts = pt ? pageFontChoices(pt) : [];

  return <section className="space-y-3">
    <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Click text on the page to edit it. You can change the words, font, size, colour and position (drag the box or use the arrows). The real text in the PDF is replaced — no cover-up box — and saved as a new version; the original file is never changed.</AlertDescription></Alert>
    {work?.decrypted && <Alert><Unlock className="h-4 w-4" /><AlertDescription>This PDF was protected with editing restrictions (it opens without a password). It was unlocked on this device for editing. Versions you save will not carry those restrictions; the original file is unchanged.</AlertDescription></Alert>}
    <div className="flex items-center gap-2">
      <Button size="icon" variant="outline" aria-label="Previous text page" disabled={!doc || pageIndex === 0 || loading} onClick={() => setPageIndex(i => i - 1)}><ChevronLeft className="h-4 w-4" /></Button>
      <span className="text-sm">Page {pageIndex + 1} / {doc?.numPages ?? '…'}</span>
      <Button size="icon" variant="outline" aria-label="Next text page" disabled={!doc || pageIndex + 1 >= doc.numPages || loading} onClick={() => setPageIndex(i => i + 1)}><ChevronRight className="h-4 w-4" /></Button>
      <Badge variant="secondary">{runs.length} text areas</Badge>
    </div>
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    {pt?.blocked && <p role="alert" className="text-destructive text-sm">{pt.blocked}</p>}
    {!loading && !runs.length && !error && <p role="status" className="text-sm text-muted-foreground">No selectable text on this page. It may be scanned or outlined; OCR cannot recover its exact original font.</p>}
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div ref={wrapper} className="overflow-auto border rounded-md p-3 max-h-[75vh]">
        {loading && <p role="status">Reading page…</p>}
        <div className="relative" style={{ width: viewport?.width ?? 0, height: viewport?.height ?? 0 }}>
          <canvas ref={canvas} className="block" />
          {!loading && viewport && <svg className="absolute inset-0" width={viewport.width} height={viewport.height} aria-label="Original PDF text areas">
            {runs.map((r, i) => {
              const sel = selected === i; const off = sel ? screenOffset : [0, 0];
              return <g key={i}>
                {sel && (dx !== 0 || dy !== 0) && <g transform={`matrix(${r.matrix.join(' ')})`}><rect x={0} y={0} width={Math.max(6, r.width)} height={Math.max(6, r.height)} className="fill-none stroke-muted-foreground" strokeDasharray="3 3" /></g>}
                <g transform={`translate(${off[0]} ${off[1]}) matrix(${r.matrix.join(' ')})`}>
                  <rect role="button" tabIndex={0} aria-label={`Select text: ${r.text}`} x={0} y={0} width={Math.max(6, r.width)} height={Math.max(6, r.height)}
                    className={sel ? 'fill-primary/10 stroke-primary cursor-move' : 'fill-transparent hover:fill-primary/10 cursor-text'}
                    onClick={() => setSelected(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(i); } }}
                    onPointerDown={sel ? onDown : undefined} onPointerMove={sel ? onMove : undefined} onPointerUp={sel ? onUp : undefined} />
                </g>
              </g>;
            })}
          </svg>}
        </div>
      </div>
      <aside className="space-y-3 min-w-0 text-sm">
        {!run && <p className="text-muted-foreground">Click any text on the page.</p>}
        {run && <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs break-words">
            {font ? <><dt className="text-muted-foreground">Font</dt><dd>{font.baseFont.replace(/^[A-Z]{6}\+/, '')}</dd>
              <dt className="text-muted-foreground">Type</dt><dd>{font.subtype} · {font.encoding}</dd>
              <dt className="text-muted-foreground">Program</dt><dd>{font.embedded ? 'Embedded' : font.standard14 ? 'Standard PDF font' : 'Not embedded'}{font.subset ? ' · subset' : ''}</dd></>
              : <><dt className="text-muted-foreground">Viewer alias</dt><dd>{run.font} (internal)</dd></>}
            <dt className="text-muted-foreground">Size</dt><dd>{run.size.toFixed(2)} pt</dd>
          </dl>
          {reason ? <><Badge variant="outline">Read-only</Badge><p className="text-xs text-destructive">{reason}</p><Textarea readOnly value={run.text} aria-label="Selected original text" /></>
          : <>
            <Badge>{fontLocked ? 'Editable with another font' : 'Editable'}</Badge>
            {font?.note && <p className="text-xs text-muted-foreground">{font.note}</p>}
            {fontLocked && <p className="text-xs text-muted-foreground">The original font can't be reused ({font!.reason}) Pick another font below.</p>}
            <div className="space-y-1"><Label htmlFor="pte-text">Text</Label>
              <Textarea id="pte-text" value={draft} onChange={e => setDraft(e.target.value)} disabled={busy} rows={3} /></div>
            <div className="space-y-1"><Label>Font</Label>
              <Select value={fontId} onValueChange={setFontId} disabled={busy}>
                <SelectTrigger aria-label="Font"><SelectValue placeholder="Choose a font" /></SelectTrigger>
                <SelectContent>
                  {pageFonts.length > 0 && <SelectGroup><SelectLabel>Fonts in this document</SelectLabel>
                    {pageFonts.map(f => <SelectItem key={f.key} value={`page:${f.key}`}>{f.label}{`page:${f.key}` === originalId ? ' — original' : ''}</SelectItem>)}</SelectGroup>}
                  <SelectGroup><SelectLabel>Standard fonts</SelectLabel>
                    {STANDARD_CHOICES.map(s => <SelectItem key={s.name} value={`std:${s.name}`}>{s.label}</SelectItem>)}</SelectGroup>
                </SelectContent>
              </Select></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label htmlFor="pte-size">Size (pt)</Label><Input id="pte-size" type="number" step="0.5" min="1" value={size} onChange={e => setSize(parseFloat(e.target.value) || 0)} disabled={busy} /></div>
              <div className="space-y-1"><Label htmlFor="pte-color">Colour</Label>
                <div className="flex items-center gap-2"><Input id="pte-color" type="color" className="h-9 w-12 p-1" value={color} onChange={e => { setColor(e.target.value); setKeepColor(false); }} disabled={busy} />
                  <Button type="button" size="sm" variant={keepColor ? 'secondary' : 'outline'} onClick={() => setKeepColor(true)} disabled={busy}>Original</Button></div></div>
            </div>
            <div className="space-y-1"><Label>Position (drag the box, or nudge 1 pt)</Label>
              <div className="flex items-center gap-1">
                <Button type="button" size="icon" variant="outline" aria-label="Move left" onClick={() => nudge(-1, 0)}><ArrowLeft className="h-4 w-4" /></Button>
                <Button type="button" size="icon" variant="outline" aria-label="Move up" onClick={() => nudge(0, 1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button type="button" size="icon" variant="outline" aria-label="Move down" onClick={() => nudge(0, -1)}><ArrowDown className="h-4 w-4" /></Button>
                <Button type="button" size="icon" variant="outline" aria-label="Move right" onClick={() => nudge(1, 0)}><ArrowRight className="h-4 w-4" /></Button>
                <span className="text-xs text-muted-foreground ml-1">{dx}, {dy} pt</span>
              </div></div>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setDraft(seg!.text); setFontId(originalId); setSize(Math.round(run.size * 100) / 100); setKeepColor(true); setDx(0); setDy(0); }}><RotateCcw className="h-4 w-4 mr-1" />Reset</Button>
            {fontLocked && fontId === originalId && <p className="text-xs text-destructive">Choose a different font to edit this text.</p>}
            {check && 'reason' in check && <p className="text-xs text-destructive">{check.reason}</p>}
            {restyled && <p className="text-xs text-muted-foreground">The original text is removed from the page and rewritten with these settings; nothing else on the line moves.</p>}
            <Button size="sm" disabled={busy || !changed || !check?.ok || (fontLocked && fontId === originalId)} onClick={apply}>{busy ? 'Saving…' : onSaveVersion ? 'Apply & save new version' : 'Apply & download'}</Button>
          </>}
        </>}
      </aside>
    </div>
  </section>;
}
