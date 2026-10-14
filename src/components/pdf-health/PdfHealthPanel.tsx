import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { compressPdf, repairPdf, canvasReencoder } from '@/lib/pdf-health/health';

const LEVELS = { lossless: { label: 'Lossless (no quality change)', img: null }, balanced: { label: 'Balanced (photos up to 2000px)', img: { maxDim: 2000, quality: 0.8 } }, small: { label: 'Smallest for email (photos up to 1400px)', img: { maxDim: 1400, quality: 0.65 } } } as const;
const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`;

export function PdfHealthPanel({ bytes, onSaveVersion }: { bytes: Uint8Array; onSaveVersion: (b: Uint8Array, note: string) => Promise<void> }) {
  const [level, setLevel] = useState<keyof typeof LEVELS>('balanced');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(''); try { await fn(); } catch (e: any) { setMsg(e?.message ?? String(e)); toast.error(e?.message ?? 'Failed'); } finally { setBusy(false); } };
  const compress = () => run(async () => {
    const l = LEVELS[level];
    const r = await compressPdf(bytes.slice(), l.img ? { images: { ...l.img, encode: canvasReencoder } } : {});
    if (r.after === r.before) { setMsg(r.note); return; }
    await onSaveVersion(r.bytes, `${r.note} (${mb(r.before)} → ${mb(r.after)})`);
    setMsg(`${mb(r.before)} → ${mb(r.after)}. Saved as a new version.`);
  });
  const repair = () => run(async () => {
    const r = await repairPdf(bytes.slice());
    await onSaveVersion(r.bytes, `Rebuilt file structure (${r.pages} pages${r.warnings ? ', with fixes' : ''})`);
    setMsg(`Rebuilt with ${r.pages} page(s)${r.warnings ? '; damaged parts were fixed' : ''}. Saved as a new version.`);
  });
  return (
    <div className="max-w-xl space-y-6">
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Compress</h2>
        <p className="text-sm text-muted-foreground">Current size: {mb(bytes.length)}. Text, drawings and form fields are kept; only photos are resized when you choose it.</p>
        <div className="flex flex-wrap gap-2">{(Object.keys(LEVELS) as (keyof typeof LEVELS)[]).map(k => <Button key={k} size="sm" variant={level === k ? 'default' : 'outline'} onClick={() => setLevel(k)}>{LEVELS[k].label}</Button>)}</div>
        <Button disabled={busy} onClick={compress}>{busy ? 'Working…' : 'Compress (new version)'}</Button>
      </section>
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Repair</h2>
        <p className="text-sm text-muted-foreground">Rebuilds a file that opens slowly, shows errors, or won't open in other readers. Nothing is added or guessed.</p>
        <Button variant="outline" disabled={busy} onClick={repair}>Repair (new version)</Button>
      </section>
      {msg && <p className="text-sm">{msg}</p>}
      <p className="text-xs text-muted-foreground">The original file is never changed.</p>
    </div>
  );
}
