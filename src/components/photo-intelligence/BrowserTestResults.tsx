import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { loadBrowserTest, type BrowserPreparationResult, type BrowserTest } from '@/lib/photo-intelligence/training/browserResults';

/** Photo links are short-lived, so each preview requests a fresh signed link instead of reusing one from page load. */
export function BrowserTestResults({ results, photos }: { results: BrowserPreparationResult[]; photos: BrowserTest['photos'] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const item = results.find((r) => r.photoId === selected);
  const refresh = async (photoId: string) => {
    setState('loading'); setUrl(null);
    try {
      const fresh = await loadBrowserTest();
      const next = fresh.photos.find((p) => p.id === photoId)?.url ?? null;
      setUrl(next); setState(next ? 'ready' : 'unavailable');
    } catch {
      const fallback = photos.find((p) => p.id === photoId)?.url ?? null;
      setUrl(fallback); setState(fallback ? 'ready' : 'unavailable');
    }
  };
  const select = (photoId: string) => { setSelected(photoId); void refresh(photoId); };
  return <section className="space-y-3">
    <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="text-left font-semibold py-2">Browser test results</caption><thead><tr className="text-left text-muted-foreground"><th>Photo</th><th>Status</th><th>Analysis resolution</th><th>Usable outlines</th><th>Invalid outlines</th><th>Time</th><th>Save / read-back</th><th>Failure</th></tr></thead><tbody>{results.map((r) => <tr key={r.photoId} className="border-t"><td><Button variant="ghost" size="sm" onClick={() => select(r.photoId)}>Photo {r.photo}</Button></td><td>{r.status.replace(/_/g, ' ')}</td><td>{r.width && r.height ? `${r.width} × ${r.height}` : '—'}</td><td>{r.outlines.length}</td><td>{r.invalidRegions}</td><td>{(r.durationMs / 1000).toFixed(1)}s</td><td>{r.saveStatus}{r.existingOutlinesPreserved ? ' · prior outlines preserved' : ''}</td><td>{r.error ?? '—'}</td></tr>)}</tbody></table></div>
    {item && <figure className="space-y-2">
      <figcaption className="font-medium">Photo {item.photo} — unverified outlines, component unknown</figcaption>
      {state === 'loading' && <p role="status" className="text-sm text-muted-foreground">Loading photo…</p>}
      {state === 'ready' && url && <div className="relative max-w-3xl">
        <img src={url} alt={`Photo ${item.photo}`} className="block w-full h-auto" onError={() => setState('unavailable')} />
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full text-primary pointer-events-none" aria-label="Generated unverified outlines">{item.outlines.map((outline, i) => <polygon key={i} points={outline.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}</svg>
      </div>}
      {state === 'unavailable' && <div className="flex items-center gap-2"><p role="status" className="text-sm text-muted-foreground">Current photo access unavailable.</p><Button variant="outline" size="sm" onClick={() => void refresh(item.photoId)}>Retry</Button></div>}
    </figure>}
  </section>;
}
