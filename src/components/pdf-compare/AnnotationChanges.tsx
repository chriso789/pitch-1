import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { listAnnots, diffAnnots, type AnnotDiff, type AnnotInfo } from '@/lib/pdf-compare/annotDiff';

const label = (a: AnnotInfo) => `${a.subtype}${a.pitch ? ' (PITCH markup)' : ''}${a.contents ? ` — “${a.contents.slice(0, 80)}”` : ''}`;

export function AnnotationChanges({ before, after, page }: { before: Uint8Array; after: Uint8Array; page: number }) {
  const [d, setD] = useState<AnnotDiff | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true; setD(null); setErr('');
    Promise.all([listAnnots(before, page - 1), listAnnots(after, page - 1)])
      .then(([a, b]) => live && setD(diffAnnots(a, b)))
      .catch(e => live && setErr(e?.message ?? String(e)));
    return () => { live = false; };
  }, [before, after, page]);
  if (err) return <p className="text-xs text-destructive">Couldn't compare comments: {err}</p>;
  if (!d) return null;
  const none = !d.added.length && !d.removed.length && !d.changed.length;
  return <div className="border rounded p-2 space-y-1 text-sm">
    <div className="flex flex-wrap gap-2 items-center"><span className="font-medium">Comments & markups on this page</span>
      <Badge variant="secondary">{d.added.length} added</Badge><Badge variant="secondary">{d.removed.length} removed</Badge>
      <Badge variant="secondary">{d.changed.length} text changed</Badge><Badge variant="outline">{d.unchanged} same</Badge></div>
    {none && <p className="text-xs text-muted-foreground">No differences in comments or markups.</p>}
    {d.added.map((a, i) => <p key={`a${i}`} className="text-xs">+ {label(a)}</p>)}
    {d.removed.map((a, i) => <p key={`r${i}`} className="text-xs">− {label(a)}</p>)}
    {d.changed.map((c, i) => <p key={`c${i}`} className="text-xs">~ {c.after.subtype}: “{c.before.contents.slice(0, 60)}” → “{c.after.contents.slice(0, 60)}”</p>)}
  </div>;
}
