import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { loadPDFFromArrayBuffer } from '@/lib/pdfRenderer';
import { applyRedactions, normalizeBox, type RedactBox } from '@/lib/pdf-redact/redact';
import { openForEditing } from '@/lib/pdf-engine/decrypt';

const VIEW_W = 900, BURN_SCALE = 200 / 72; // flattened pages are rendered at 200 dpi

async function render(pdf: any, i: number, scaleFor: (w: number) => number) {
  const p = await pdf.getPage(i + 1);
  const base = p.getViewport({ scale: 1, rotation: 0 });
  const vp = p.getViewport({ scale: scaleFor(base.width), rotation: 0 });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await p.render({ canvasContext: ctx, viewport: vp }).promise;
  return c;
}

/** Phase 2E — true redaction. Marked pages are flattened to images with areas blacked out; their real content is deleted. */
export function PdfRedactPanel({ bytes, onSaveVersion }: { bytes: Uint8Array; onSaveVersion: (out: Uint8Array, summary: string) => Promise<void> }) {
  const [pdf, setPdf] = useState<any>(null);
  const [page, setPage] = useState(0);
  const [img, setImg] = useState<string>('');
  const [boxes, setBoxes] = useState<Record<number, RedactBox[]>>({});
  const [drag, setDrag] = useState<RedactBox | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchable, setSearchable] = useState(true);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => { loadPDFFromArrayBuffer(bytes.slice().buffer).then(setPdf).catch((e: any) => toast.error(e.message)); }, [bytes]);
  useEffect(() => { if (pdf) render(pdf, page, w => VIEW_W / w).then(c => setImg(c.toDataURL('image/png'))); }, [pdf, page]);

  const pos = (e: React.PointerEvent) => { const r = host.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const finish = () => { if (!drag) return; const n = normalizeBox(drag); if (n) setBoxes(b => ({ ...b, [page]: [...(b[page] ?? []), n] })); setDrag(null); };
  const marked = Object.entries(boxes).filter(([, v]) => v.length).map(([k]) => Number(k));

  const apply = async () => {
    setBusy(true);
    try {
      const { bytes: editable } = await openForEditing(bytes);
      const flat = [];
      for (const i of marked) {
        const c = await render(pdf, i, () => BURN_SCALE);
        const ctx = c.getContext('2d')!; ctx.fillStyle = '#000';
        for (const b of boxes[i]) ctx.fillRect(b.x * c.width, b.y * c.height, b.w * c.width, b.h * c.height);
        const blob: Blob = await new Promise(r => c.toBlob(x => r(x!), 'image/jpeg', 0.85));
        flat.push({ pageIndex: i, jpeg: new Uint8Array(await blob.arrayBuffer()) });
      }
      const out = await applyRedactions(editable, flat);
      // Independent check with PDF.js: redacted pages must have no readable text.
      const check: any = await loadPDFFromArrayBuffer(out.slice().buffer);
      for (const i of marked) if ((await (await check.getPage(i + 1)).getTextContent()).items.length) throw new Error(`Page ${i + 1} still has readable text; nothing was saved.`);
      let final = out, note = '';
      if (searchable) {
        // Re-read only what is still visible on the flattened pages; blacked-out areas have nothing to read.
        const { ocrSearchable } = await import('@/lib/pdf-ocr/batchOcr');
        const r = await ocrSearchable(out);
        final = r.bytes; note = `; ${r.note}`;
      }
      await onSaveVersion(final, `Redacted ${marked.length} page(s)${note}`);
      setBoxes({});
    } catch (e: any) { toast.error(e.message ?? String(e)); }
    setBusy(false);
  };

  if (!pdf) return <p className="text-muted-foreground">Loading…</p>;
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Drag to black out areas. When you apply, every marked page becomes a flat picture of itself: the blacked-out content is permanently deleted — along with that page's selectable text, comments and form fields — and checked before saving. Unmarked pages are kept as they are. This saves a new version; the original stays in PITCH, so restrict who can see it if needed.</p>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={page <= 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
      <span className="text-sm">Page {page + 1}/{pdf.numPages}</span>
      <Button size="sm" variant="outline" disabled={page >= pdf.numPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
      <Button size="sm" variant="ghost" disabled={!boxes[page]?.length} onClick={() => setBoxes(b => ({ ...b, [page]: (b[page] ?? []).slice(0, -1) }))}>Undo box</Button>
      {marked.length > 0 && <Badge variant="secondary">{marked.length} page(s) marked</Badge>}
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={searchable} onChange={e => setSearchable(e.target.checked)} /> Keep visible text searchable</label>
      <Button size="sm" variant="destructive" disabled={busy || !marked.length} onClick={apply}>Apply redactions (new version)</Button>
    </div>
    <div ref={host} className="relative border select-none touch-none cursor-crosshair" style={{ width: VIEW_W, maxWidth: '100%' }}
      onPointerDown={e => { const p = pos(e); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag({ x: p.x, y: p.y, w: 0, h: 0 }); }}
      onPointerMove={e => { if (drag) { const p = pos(e); setDrag({ ...drag, w: p.x - drag.x, h: p.y - drag.y }); } }}
      onPointerUp={finish}>
      {img && <img src={img} alt={`Page ${page + 1}`} className="block w-full pointer-events-none" draggable={false} />}
      {[...(boxes[page] ?? []), ...(drag ? [normalizeBox(drag)].filter(Boolean) as RedactBox[] : [])].map((b, i) =>
        <div key={i} className="absolute bg-foreground" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} />)}
    </div>
    <p className="text-xs text-muted-foreground">Pages are shown unrotated here so the black boxes land exactly where you draw them.</p>
  </div>;
}
