import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PenTool, Type, CalendarDays, Check, Trash2, Save, Download, Signature } from 'lucide-react';
import { toast } from 'sonner';
import { loadPDFFromArrayBuffer, renderPageToDataUrl } from '@/lib/pdfRenderer';
import { applyFillSign, typedSignaturePng, canvasPng, type SignPlacement } from '@/lib/pdf-engine/fillSign';

type Tool = SignPlacement['kind'];
const SIZE: Record<Tool, [number, number]> = { signature: [0.28, 0.06], initials: [0.1, 0.05], text: [0.3, 0.03], date: [0.16, 0.03], check: [0.03, 0.03] };

export function PdfFillSign({ bytes, name, onSaveVersion }: { bytes: Uint8Array; name: string; onSaveVersion?: (b: Uint8Array, s: string) => Promise<void> }) {
  const [pages, setPages] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [tool, setTool] = useState<Tool>('signature');
  const [items, setItems] = useState<SignPlacement[]>([]);
  const [sigPng, setSigPng] = useState<Record<'signature' | 'initials', Uint8Array | null>>({ signature: null, initials: null });
  const [typed, setTyped] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const pad = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    let off = false; setItems([]); setPage(0);
    (async () => {
      const pdf = await loadPDFFromArrayBuffer(bytes.slice().buffer);
      const out: string[] = [];
      for (let i = 1; i <= (pdf as any).numPages; i++) out.push((await renderPageToDataUrl(pdf, i, 1.3, undefined, true, 0.8)).dataUrl);
      if (!off) setPages(out);
    })().catch(e => toast.error(`Could not show PDF: ${e.message}`));
    return () => { off = true; };
  }, [bytes]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [(e.clientX - r.left) * e.currentTarget.width / r.width, (e.clientY - r.top) * e.currentTarget.height / r.height]; };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => { const c = e.currentTarget.getContext('2d')!; drawing.current = true; c.lineWidth = 4; c.lineCap = 'round'; c.strokeStyle = '#0a1f5c'; const [x, y] = pos(e); c.beginPath(); c.moveTo(x, y); };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => { if (!drawing.current) return; const c = e.currentTarget.getContext('2d')!; const [x, y] = pos(e); c.lineTo(x, y); c.stroke(); };
  const clearPad = () => pad.current?.getContext('2d')?.clearRect(0, 0, pad.current.width, pad.current.height);
  const adopt = async (which: 'signature' | 'initials', mode: 'draw' | 'type') => {
    try {
      const png = mode === 'draw' ? await canvasPng(pad.current!) : await typedSignaturePng(typed, which === 'initials');
      if (mode === 'type' && !typed.trim()) throw new Error('Type your name first');
      setSigPng(s => ({ ...s, [which]: png })); setTool(which); toast.success(`${which === 'signature' ? 'Signature' : 'Initials'} ready — click the page to place it.`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const place = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const [w, h] = SIZE[tool];
    const x = Math.min(1 - w, (e.clientX - r.left) / r.width), y = Math.min(1 - h, (e.clientY - r.top) / r.height);
    const base = { id: crypto.randomUUID(), page, kind: tool, x, y, w, h };
    if (tool === 'signature' || tool === 'initials') { if (!sigPng[tool]) return toast.error(`Create your ${tool} first`); setItems(i => [...i, { ...base, png: sigPng[tool]! }]); }
    else if (tool === 'date') setItems(i => [...i, { ...base, text: new Date().toLocaleDateString('en-US') }]);
    else if (tool === 'text') { if (!text.trim()) return toast.error('Type the text to place first'); setItems(i => [...i, { ...base, text }]); }
    else setItems(i => [...i, base]);
  };

  const output = async (save: boolean) => {
    setBusy(true);
    try {
      const out = await applyFillSign(bytes, items);
      const sigs = items.filter(i => i.kind === 'signature' || i.kind === 'initials').length;
      const summary = `Fill & Sign: ${items.length} item(s) placed${sigs ? `, ${sigs} signature image(s) — not a certificate signature` : ''}`;
      if (save && onSaveVersion) await onSaveVersion(out, summary);
      else { const url = URL.createObjectURL(new Blob([out as BlobPart], { type: 'application/pdf' })); const a = document.createElement('a'); a.href = url; a.download = name.replace(/\.pdf$/i, '') + '-signed.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
      setItems([]);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const tools: [Tool, any, string][] = [['signature', Signature, 'Signature'], ['initials', PenTool, 'Initials'], ['text', Type, 'Text'], ['date', CalendarDays, 'Date'], ['check', Check, 'Check']];
  return <div className="grid lg:grid-cols-[320px_1fr] gap-4">
    <aside className="space-y-4">
      <p className="text-xs text-muted-foreground">Signatures are placed as images (an electronic signature mark). This is not a certificate-based digital signature. The original file is never changed.</p>
      <div className="space-y-2">
        <Label>Draw signature or initials</Label>
        <canvas ref={pad} width={600} height={160} className="w-full h-24 border rounded-md bg-background touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={() => (drawing.current = false)} onPointerLeave={() => (drawing.current = false)} />
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={clearPad}>Clear</Button><Button size="sm" onClick={() => adopt('signature', 'draw')}>Use as signature</Button><Button size="sm" variant="secondary" onClick={() => adopt('initials', 'draw')}>Use as initials</Button></div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="typed-sig">Or type it</Label>
        <Input id="typed-sig" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Full name or initials" />
        <div className="flex gap-2"><Button size="sm" onClick={() => adopt('signature', 'type')}>Typed signature</Button><Button size="sm" variant="secondary" onClick={() => adopt('initials', 'type')}>Typed initials</Button></div>
      </div>
      <div className="space-y-2"><Label htmlFor="fs-text">Text to place</Label><Input id="fs-text" value={text} onChange={e => setText(e.target.value)} placeholder="e.g. Policy number" /></div>
      <div className="flex flex-wrap gap-1">{tools.map(([k, Icon, l]) => <Button key={k} size="sm" variant={tool === k ? 'default' : 'outline'} onClick={() => setTool(k)}><Icon className="h-4 w-4 mr-1" />{l}</Button>)}</div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || !items.length} onClick={() => output(false)}><Download className="h-4 w-4 mr-1" />Download</Button>
        {onSaveVersion && <Button disabled={busy || !items.length} onClick={() => output(true)}><Save className="h-4 w-4 mr-1" />Save new version</Button>}
      </div>
      {items.length > 0 && <Badge variant="secondary">{items.length} placed</Badge>}
    </aside>
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-sm"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button><span>Page {page + 1} / {pages.length || '…'}</span><Button size="sm" variant="outline" disabled={page >= pages.length - 1} onClick={() => setPage(p => p + 1)}>Next</Button><span className="text-muted-foreground">Click the page to place the selected item.</span></div>
      {pages[page] ? <div className="relative inline-block border shadow-sm cursor-crosshair max-w-full" onClick={place}>
        <img src={pages[page]} alt={`Page ${page + 1}`} className="block max-w-full select-none" draggable={false} />
        {items.filter(i => i.page === page).map(i => <div key={i.id} className="absolute border border-primary bg-primary/10 text-[10px] flex items-center justify-between px-1 overflow-hidden" style={{ left: `${i.x * 100}%`, top: `${i.y * 100}%`, width: `${i.w * 100}%`, height: `${i.h * 100}%` }} onClick={e => e.stopPropagation()}>
          {i.png ? <img src={URL.createObjectURL(new Blob([i.png as BlobPart], { type: 'image/png' }))} alt={i.kind} className="h-full" /> : <span className="truncate">{i.kind === 'check' ? 'X' : i.text}</span>}
          <button aria-label="Remove" onClick={() => setItems(x => x.filter(y => y.id !== i.id))}><Trash2 className="h-3 w-3" /></button>
        </div>)}
      </div> : <p className="text-muted-foreground">Loading pages…</p>}
    </section>
  </div>;
}
