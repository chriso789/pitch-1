import { useEffect, useState } from 'react';
import { readPdfFields, savePdfFields, type EditablePdfField } from '@/lib/pdf-engine/formEditing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Save, Download } from 'lucide-react';
import { toast } from 'sonner';

export function PdfFormEditor({ bytes, name, onSaveVersion }: { bytes: Uint8Array; name: string; onSaveVersion?: (bytes: Uint8Array, summary: string) => Promise<void> }) {
  const [fields, setFields] = useState<EditablePdfField[]>([]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError(''); setValues({});
    readPdfFields(bytes).then(f => { if (!cancelled) setFields(f); }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bytes]);
  const output = async (save: boolean) => {
    setBusy(true); setError('');
    try {
      const out = await savePdfFields(bytes, values);
      if (save && onSaveVersion) await onSaveVersion(out, `${Object.keys(values).length} form fields filled (values verified)`);
      else {
        const url = URL.createObjectURL(new Blob([out as BlobPart], { type: 'application/pdf' }));
        const a = document.createElement('a'); a.href = url; a.download = name.replace(/\.pdf$/i, '') + '-filled.pdf'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      toast.success('Form values saved and verified.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save form'); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4 max-w-2xl">
    <h2 className="text-lg font-semibold">Fill PDF forms</h2>
    <p className="text-sm text-muted-foreground">Form appearances use the available standard form font; exact original-font matching and digital signatures are not supported.</p>
    {loading && <p role="status">Reading fields…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!loading && !error && !fields.length && <p role="status">This PDF has no fillable form fields.</p>}
    {fields.map((field, i) => <div key={field.name} className="space-y-1 border-b pb-3">
      <Label htmlFor={`pdf-field-${i}`}>{field.name}</Label>
      {field.kind === 'text' ? <Input id={`pdf-field-${i}`} disabled={field.readOnly || busy} value={String(values[field.name] ?? field.value)} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))} />
        : field.kind === 'checkbox' ? <Checkbox id={`pdf-field-${i}`} disabled={field.readOnly || busy} checked={Boolean(values[field.name] ?? field.value)} onCheckedChange={v => setValues(old => ({ ...old, [field.name]: v === true }))} />
        : field.kind === 'choice' ? <select id={`pdf-field-${i}`} className="w-full border rounded-md bg-background p-2 text-sm" disabled={field.readOnly || busy} value={String(values[field.name] ?? field.value)} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}><option value="" disabled>Choose…</option>{field.options?.map(o => <option key={o}>{o}</option>)}</select>
        : <p className="text-xs text-muted-foreground">{String(field.value)}</p>}
    </div>)}
    <div className="flex gap-2">
      <Button variant="outline" disabled={busy || !Object.keys(values).length} onClick={() => output(false)}><Download className="h-4 w-4 mr-1" />Download filled PDF</Button>
      {onSaveVersion && <Button disabled={busy || !Object.keys(values).length} onClick={() => output(true)}><Save className="h-4 w-4 mr-1" />Save new version</Button>}
    </div>
  </section>;
}