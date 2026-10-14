import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { loadPDFFromArrayBuffer } from '@/lib/pdfRenderer';
import { addSearchableLayer, LOW_CONFIDENCE, type PageOcr } from '@/lib/pdf-ocr/searchableLayer';

const SCALE = 2; // ~144 dpi render for recognition

async function renderPages(bytes: Uint8Array) {
  const pdf: any = await loadPDFFromArrayBuffer(bytes.slice().buffer);
  return pdf;
}
async function renderOne(pdf: any, i: number) {
  const p = await pdf.getPage(i + 1);
  const vp = p.getViewport({ scale: SCALE });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await p.render({ canvasContext: ctx, viewport: vp }).promise;
  const existing = (await p.getTextContent()).items.length;
  return { canvas: c, existing };
}
const download = (blob: Blob, name: string) => { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 60000); };

/** Phase 2D — local OCR (Tesseract, in the browser) and page-image conversion. OCR text is never used as dimensions. */
export function PdfOcrPanel({ bytes, name, onSaveVersion }: { bytes: Uint8Array; name: string; onSaveVersion: (out: Uint8Array, summary: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<(PageOcr & { text: string; meanConf: number; existing: number })[]>([]);

  const runOcr = async () => {
    setBusy(true); setProgress(0); setResults([]);
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      const pdf = await renderPages(bytes);
      const out: typeof results = [];
      for (let i = 0; i < pdf.numPages; i++) {
        const { canvas, existing } = await renderOne(pdf, i);
        const { data } = await worker.recognize(canvas, {}, { blocks: true });
        const words = (data.blocks ?? []).flatMap((b: any) => b.paragraphs.flatMap((p: any) => p.lines.flatMap((l: any) => l.words)))
          .map((w: any) => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, confidence: w.confidence }));
        out.push({ pageIndex: i, imageWidth: canvas.width, imageHeight: canvas.height, words, text: data.text, meanConf: data.confidence, existing });
        setProgress(Math.round(((i + 1) / pdf.numPages) * 100)); setResults([...out]);
      }
      await worker.terminate();
    } catch (e: any) { toast.error(`Text recognition failed: ${e.message ?? e}`); }
    setBusy(false);
  };

  const makeSearchable = async () => {
    const todo = results.filter(r => r.existing === 0);
    if (!todo.length) return toast.info('Every page already has real text — nothing to add.');
    setBusy(true);
    try {
      const r = await addSearchableLayer(bytes, todo);
      await onSaveVersion(r.bytes, `OCR text layer on ${todo.length} page(s)`);
      if (r.skippedRotatedPages.length) toast.warning(`Rotated page(s) ${r.skippedRotatedPages.join(', ')} were left without a text layer.`);
      if (r.skipped) toast.info(`${r.skipped} word(s) with unsupported characters were not added.`);
    } catch (e: any) { toast.error(e.message ?? String(e)); }
    setBusy(false);
  };

  const exportPng = async () => {
    setBusy(true);
    try {
      const pdf = await renderPages(bytes);
      for (let i = 0; i < pdf.numPages; i++) {
        const { canvas } = await renderOne(pdf, i);
        const blob: Blob = await new Promise(res => canvas.toBlob(b => res(b!), 'image/png'));
        download(blob, `${name.replace(/\.pdf$/i, '')}-p${i + 1}.png`);
      }
    } catch (e: any) { toast.error(e.message ?? String(e)); }
    setBusy(false);
  };

  const exportText = () => download(new Blob([results.map(r => `--- Page ${r.pageIndex + 1} (OCR confidence ${Math.round(r.meanConf)}%) ---\n${r.text}`).join('\n\n')], { type: 'text/plain' }), `${name.replace(/\.pdf$/i, '')}-ocr.txt`);

  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Reads text from scanned pages on this computer (nothing is uploaded). Recognized text is a best guess: it is never used as a measurement, quantity or price. Making the file searchable saves a new version with invisible text under the scan — what you see doesn't change and the original stays as it is.</p>
    <div className="flex flex-wrap gap-2">
      <Button onClick={runOcr} disabled={busy}>Read text from pages</Button>
      <Button variant="outline" onClick={makeSearchable} disabled={busy || !results.length}>Make searchable (new version)</Button>
      <Button variant="outline" onClick={exportText} disabled={busy || !results.length}>Download text</Button>
      <Button variant="outline" onClick={exportPng} disabled={busy}>Export pages as images</Button>
    </div>
    {busy && <Progress value={progress} />}
    {results.map(r => {
      const low = r.words.filter(w => w.confidence < LOW_CONFIDENCE).length;
      return <div key={r.pageIndex} className="border rounded-md p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Page {r.pageIndex + 1}</span>
          <Badge variant="secondary">{Math.round(r.meanConf)}% confidence</Badge>
          {low > 0 && <Badge variant="destructive">{low} uncertain word(s)</Badge>}
          {r.existing > 0 && <Badge variant="outline">Already has real text — layer won't be added</Badge>}
        </div>
        <p className="text-sm whitespace-pre-wrap max-h-48 overflow-auto">
          {r.words.map((w, i) => <span key={i} className={w.confidence < LOW_CONFIDENCE ? 'bg-destructive/20' : ''} title={`${Math.round(w.confidence)}%`}>{w.text} </span>)}
        </p>
      </div>;
    })}
  </div>;
}
